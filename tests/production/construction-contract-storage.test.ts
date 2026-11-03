import type { ConstructionContractCommandRequestDTO } from '../../app/lib/construction-contract/command-contract'
import type { ConstructionImportCommand } from '../../app/lib/construction-contract/import-contract'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, afterEach, expect, it } from 'vitest'
import { createHttpConstructionContractCommandRepository } from '../../app/lib/construction-contract/command-http-repository'
import { decodeProjectDetailRead } from '../../app/lib/project/read-decoder'
import { contractOriginalDigest } from '../../server/utils/contract-original'
import { createProductionConstructionMigration } from '../../server/utils/production-construction-contract-migration'
import { validateProductionConstructionState } from '../../server/utils/production-construction-contract-record'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { readProductionConstructionContractReference, readProductionConstructionSourceIdentities } from '../../server/utils/production-construction-contract-sources'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { runColdProcess } from '../helpers/cold-process'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { constructionScopeCommand, createConstructionScopeFixture } from '../helpers/production-construction-scope-fixture'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})
async function fixture() {
  const base = testTempRoot('opt-02/construction-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/construction-`)
  const options = { directory, workspaceId: 'construction-workspace', ownerId: 'construction-owner', purpose: 'verification' as const }
  const storage = await createSeededProductionStorage(options)
  closers.push(() => storage.close())
  let actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['construction-contract:read', 'construction-contract:write', 'construction-contract:import', 'project:list:read', 'project:write', 'customer:list:read', 'customer:write', 'our-signatory:read', 'our-signatory:write', 'material-contract:read', 'material-contract:write', 'supplier:list:read'] }
  const session = () => structuredClone(actor)
  const customer = await createProductionCustomerService(storage).execute({ commandId: 'construction-customer-create', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'customer:write', baseVersion: null, action: 'draft', draft: { name: '施工正式客户' }, attachments: {} }, session)
  const project = await createProductionProjectService(storage).execute({ commandId: 'construction-project-create', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'project:write', baseVersion: null, action: 'draft', draft: { name: '施工正式项目', code: 'CP', customerId: customer.id }, attachments: {} }, session)
  const signatory = await createProductionOurSignatoryService(storage).execute({ commandId: 'construction-signatory-create', workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'our-signatory:write', baseVersion: null, draft: { name: '施工我方公司', taxNo: 'CONSTRUCTION-ID', registeredAddress: null, legalRepresentative: null, verificationNote: '施工原签约核实', status: 'active' } }, session)
  const service = createProductionConstructionContractService(storage)
  let sequence = 0
  const command = (overrides: Partial<ConstructionContractCommandRequestDTO> = {}): ConstructionContractCommandRequestDTO => ({ commandId: `construction-command-${++sequence}`, workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'construction-contract:write', baseVersion: null, action: 'save', draft: { name: '正式施工主合同', no: `CONSTRUCTION-${sequence}`, projectId: project.id, customerId: customer.id, content: '真实施工范围', signDate: '2026-10-07', amount: null, taxRate: 0, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, managementFeeAmount: 0, managementFeeBasis: '明确零记取' }, attachments: { add: [{ fileName: '原签约.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] }, ...overrides })
  return { storage, options, session, project, customer, signatory, service, command, setActor: (next: typeof actor) => {
    actor = next
  } }
}
async function nativeSource(f: Pick<Awaited<ReturnType<typeof fixture>>, 'storage' | 'session' | 'project' | 'customer'>, duplicateNumber = false, legacyCommand = false, times: { uploadedAt?: string | null, headAmount?: number } = {}) {
  const native = await createMigratedMemoryDb()
  let bytes: Uint8Array
  try {
    await native.execute('INSERT INTO customers(id,name) VALUES(\'legacy-construction-customer\',\'原甲方\')')
    await native.execute('INSERT INTO projects(id,name,customer_id) VALUES(\'legacy-construction-project\',\'原项目\',\'legacy-construction-customer\')')
    await native.execute('ALTER TABLE contracts ADD COLUMN future_json TEXT')
    await native.execute('ALTER TABLE contracts ADD COLUMN future_integer INTEGER')
    await native.execute('ALTER TABLE contracts ADD COLUMN future_blob BLOB')
    await native.execute('ALTER TABLE contract_supplements ADD COLUMN extension_json TEXT')
    await native.execute('INSERT INTO contracts(id,no,name,kind,project_id,customer_id,amount,tax_rate,status,content,sign_date,future_json) VALUES (\'legacy-construction-head\',\'LEGACY-C21\',\'原主合同\',\'施工\',\'legacy-construction-project\',\'legacy-construction-customer\',NULL,0,\'已签订\',\'原施工约定\',\'2026-09-01\',?)', ['{"original":"legacy-construction-project","unknown":7}'])
    await native.execute('UPDATE contracts SET future_integer=CAST(\'9223372036854775807\' AS INTEGER),future_blob=x\'0080FF\' WHERE id=\'legacy-construction-head\'')
    await native.execute('INSERT INTO contract_supplements(id,contract_id,no,name,amount,status,sign_date,extension_json) VALUES (\'legacy-construction-supp\',\'legacy-construction-head\',\'SUP21\',\'原补充协议\',0,\'有效\',\'2026-09-02\',?)', ['{"future":"保原JSON"}'])
    if (duplicateNumber)
      await native.execute('INSERT INTO contracts(id,no,name,kind,project_id,customer_id,amount,tax_rate,status,content,sign_date) VALUES (\'legacy-construction-second-head\',\'LEGACY-C21\',\'原历史重复主合同\',\'施工\',\'legacy-construction-project\',\'legacy-construction-customer\',0,NULL,\'已签订\',\'真实旧重复必须保留\',\'2026-09-01\')')
    if (legacyCommand) {
      await native.execute('CREATE TABLE construction_contract_receipts(command_id TEXT PRIMARY KEY,contract_id TEXT,actor_id TEXT,result_json TEXT)')
      await native.execute('INSERT INTO construction_contract_receipts VALUES (?,?,?,?)', ['legacy-construction-command', 'legacy-construction-head', 'legacy-trusted-identity-unmapped', '{"commandId":"legacy-construction-command","id":"legacy-construction-head","version":"old","future":"保原回执"}'])
    }
    await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES (\'legacy-head-file\',\'contract\',\'legacy-construction-head\',\'原签约.txt\',\'\',3,\'text/plain\'),(\'legacy-supp-file\',\'contract_supplement\',\'legacy-construction-supp\',\'原协议.bin\',\'D:/原项目/协议.bin\',4,\'application/octet-stream\')')
    await native.execute('INSERT INTO file_payloads VALUES(\'legacy-head-file\',\'base64\',\'YWJj\')')
    if (Object.hasOwn(times, 'uploadedAt'))
      await native.execute('UPDATE file_refs SET uploaded_at=?', [times.uploadedAt ?? null])
    if (times.headAmount !== undefined)
      await native.execute('UPDATE contracts SET amount=? WHERE id=\'legacy-construction-head\'', [times.headAmount])
    await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data,operator) VALUES (\'legacy-construction-audit\',\'contracts\',\'legacy-construction-head\',\'update\',?,NULL)', ['{"id":"legacy-construction-head","future_note":"原审计JSON"}'])
    await native.execute('CREATE TABLE private_other_domain(secret TEXT)')
    await native.execute('INSERT INTO private_other_domain VALUES (\'DONT_PERSIST_CONSTRUCTION_OTHER_PRIVATE_DOMAIN\')')
    bytes = native.raw.export()
  }
  finally { native.close() }
  const service = createProductionConstructionMigration(f.storage)
  const command: ConstructionImportCommand = { commandId: 'construction-native-adopt', workspaceId: f.session().workspaceId, actorId: f.session().actorId, source: { sha256: contractOriginalDigest(bytes), payloadBase64: Buffer.from(bytes).toString('base64') }, projects: [], customers: [], signatories: [], originals: [{ fileId: 'legacy-supp-file', payloadBase64: 'AAECAw==' }] }
  const preview = await service.preflight(command, f.session)
  command.projects = preview.references.filter(row => row.kind === 'project').map(row => ({ legacyId: row.id, id: f.project.id, version: row.candidates.find(candidate => candidate.id === f.project.id)!.version }))
  command.customers = preview.references.filter(row => row.kind === 'customer').map(row => ({ legacyId: row.id, id: f.customer.id, version: row.candidates.find(candidate => candidate.id === f.customer.id)!.version }))
  return { service, command, bytes }
}
it('真实完整SQLite施工主补图保原ID/原JSON/精确i64+BLOB/原件，不拷整库或主档；安全整批恢复保历史', async () => {
  const f = await fixture()
  const source = await nativeSource(f)
  const saved = await source.service.adopt(source.command, f.session)
  expect(await source.service.adopt(source.command, f.session)).toEqual(saved)
  const read = await f.service.detail('legacy-construction-head', { origin: 'real' }, f.session)
  expect(read.sections.files.map(file => file.id).sort()).toEqual(['legacy-head-file', 'legacy-supp-file'])
  const commands = createHttpConstructionContractCommandRepository({ fetcher: async () => f.service.form('legacy-construction-head', f.session) })
  expect((await commands.loadForm('legacy-construction-head')).attachments[0]!.uploadedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/)
  expect(read.sections.supplements[0]).toMatchObject({ id: 'legacy-construction-supp', amount: '0.00' })
  const proof = JSON.parse((await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM construction_contract_imports'))[0]!.evidence_json)
  expect(proof.rawDomain.contracts[0].columns).toMatchObject({ future_integer: { sqliteType: 'integer', exactValue: '9223372036854775807' }, future_blob: { sqliteType: 'blob', exactValue: '0080FF' }, future_json: { exactValue: '{"original":"legacy-construction-project","unknown":7}' } })
  expect(JSON.stringify(proof)).not.toContain('DONT_PERSIST_CONSTRUCTION_OTHER_PRIVATE_DOMAIN')
  expect(JSON.stringify(proof)).not.toContain(source.command.source.payloadBase64)
  expect((await f.service.file('legacy-construction-head', 'legacy-head-file', 'real', f.session)).bytes).toEqual(Buffer.from('abc'))
  const mapping = await f.storage.withTransaction(tx => readProductionConstructionSourceIdentities(tx, f.session(), source.command.source.sha256))
  expect(mapping.contracts[0]).toMatchObject({ legacyId: 'legacy-construction-head', id: 'legacy-construction-head', projectId: f.project.id })
  const restored = await source.service.restore({ commandId: 'construction-native-restore', workspaceId: f.session().workspaceId, actorId: f.session().actorId, importId: saved.importId }, f.session)
  expect(restored.restored).toBe(true)
  await expect(f.storage.withTransaction(tx => readProductionConstructionSourceIdentities(tx, f.session(), source.command.source.sha256))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  expect((await f.storage.select('SELECT content FROM file_payloads WHERE file_ref_id=\'legacy-supp-file\''))[0]).toBeTruthy()
  expect(contractOriginalDigest(source.bytes)).toBe(source.command.source.sha256)
})
it('施工主补原件未知上传时间NULL保全且历史表单仍可编辑，已采用frozen不重写，SQLite UTC不受本地时区改变', async () => {
  const f = await fixture()
  const source = await nativeSource(f, false, false, { uploadedAt: null, headAmount: 0 })
  const saved = await source.service.adopt(source.command, f.session)
  const commands = createHttpConstructionContractCommandRepository({ fetcher: async () => f.service.form('legacy-construction-head', f.session) })
  const form = await commands.loadForm('legacy-construction-head')
  expect(form.attachments[0]!.uploadedAt).toBeNull()
  expect((await f.storage.select<{ uploaded_at: string }>('SELECT uploaded_at FROM file_refs WHERE id=\'legacy-head-file\''))[0]!.uploaded_at).toBe('')
  const first = (await f.storage.select<{ snapshot_json: string }>('SELECT snapshot_json FROM construction_contract_versions WHERE id=\'legacy-construction-head\' AND version=1'))[0]!.snapshot_json
  const evidence = (await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM construction_contract_imports'))[0]!.evidence_json
  const proof = JSON.parse(evidence)
  expect(proof.rawDomain.file_refs.find((file: { legacyId: string }) => file.legacyId === 'legacy-head-file').columns.uploaded_at).toMatchObject({ sqliteType: 'null', exactValue: null })
  expect(proof.rawDomain.contracts[0].columns.created_at.exactValue.replace(' ', 'T')).toBe(JSON.parse(first).createdAt.slice(0, 19))
  await f.storage.withTransaction(tx => tx.execute('UPDATE file_refs SET uploaded_at=? WHERE id=\'legacy-head-file\'', ['2026-09-01T00:00:00.000Z']))
  expect((await commands.loadForm('legacy-construction-head')).attachments[0]!.uploadedAt).toBeNull()
  expect((await f.storage.select<{ snapshot_json: string }>('SELECT snapshot_json FROM construction_contract_versions WHERE id=\'legacy-construction-head\' AND version=1'))[0]!.snapshot_json).toBe(first)
  expect((await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM construction_contract_imports'))[0]!.evidence_json).toBe(evidence)
  await expect(createHttpConstructionContractCommandRepository({ fetcher: async () => ({ ...form, attachments: form.attachments.map(file => ({ ...file, uploadedAt: 'not-a-date' })) }) }).loadForm('legacy-construction-head')).rejects.toMatchObject({ problem: { code: 'internal-error' } })
  const edit = f.command({ id: 'legacy-construction-head', action: 'save', baseVersion: form.version, draft: { ...form.draft, note: '原上传时间未知仍保持，备注可保存', ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version, ourSignatorySnapshot: null }, attachments: {} })
  await f.service.execute(JSON.parse(JSON.stringify(edit)), f.session, 'legacy-construction-head')
  expect((await commands.loadForm('legacy-construction-head')).draft.note).toBe('原上传时间未知仍保持，备注可保存')
  expect((await commands.loadForm('legacy-construction-head')).attachments[0]!.uploadedAt).toBeNull()
  const detail = await f.service.detail('legacy-construction-head', { origin: 'real' }, f.session)
  expect(detail.sections.files.map(file => file.uploadedAt)).toEqual([null, null])
  await expect(f.storage.withTransaction(async (tx) => {
    await tx.execute('UPDATE construction_contract_files SET original_metadata_json=json_set(original_metadata_json,\'$.uploaded_at\',\'invented\') WHERE file_ref_id=\'legacy-head-file\'')
    await validateProductionConstructionState(tx, f.session())
  })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  expect((await commands.loadForm('legacy-construction-head')).attachments[0]!.uploadedAt).toBeNull()
  const descriptor = { commandId: saved.commandId, workspaceId: f.session().workspaceId, actorId: f.session().actorId, family: 'construction-contract-import', targetId: null, action: 'adopt', scopeId: source.command.source.sha256 }
  const output = resolve(f.options.directory, 'cold-upload-unknown.json')
  await f.storage.close()
  await runColdProcess('production-construction-cold', [f.options.directory, saved.ids[0]!, JSON.stringify(descriptor), output])
  const cold = JSON.parse(await readFile(output, 'utf8'))
  expect(cold.resolution).toEqual({ outcome: 'applied', result: saved })
  expect(cold.form.attachments[0].uploadedAt).toBeNull()
  expect(cold.files[0]).toMatchObject({ id: 'legacy-head-file', payloadBase64: 'YWJj' })
  expect(cold.detail.sections.files.map((file: { uploadedAt: string | null }) => file.uploadedAt)).toEqual([null, null])
})
it('施工主合同直接读取现formal主档，保null/0管理费和原件；原号重放不重复新建', async () => {
  const f = await fixture()
  const request = f.command()
  const saved = await f.service.execute(request, f.session)
  expect(await f.service.execute(request, f.session)).toEqual(saved)
  const form = await f.service.form(saved.id, f.session)
  expect(form.draft).toMatchObject({ amount: null, taxRate: 0, managementFeeAmount: 0, managementFeeBasis: '明确零记取', projectId: f.project.id })
  const before = (await f.storage.select<{ n: number }>('SELECT total_changes() AS n'))[0]!.n
  const detail = await f.service.detail(saved.id, { origin: 'real' }, f.session)
  expect(detail.contract.amounts).toMatchObject({ contract: null, received: null, settled: null, changed: null })
  expect((await f.storage.select<{ n: number }>('SELECT total_changes() AS n'))[0]!.n).toBe(before)
  const file = await f.service.file(saved.id, saved.attachmentIds[0]!, 'real', f.session)
  expect(Array.from(file.bytes)).toEqual([97, 98, 99])
  const reference = await f.storage.withTransaction(tx => readProductionConstructionContractReference(tx, f.session(), saved.id))
  expect(reference).toMatchObject({ id: saved.id, projectId: f.project.id, customerId: f.customer.id, version: '1', kind: '施工', deletedAt: null })
  expect(await f.service.resolve(request.commandId, f.session)).toEqual({ outcome: 'applied', result: saved })
})

it('客户和项目只读同一施工主合同上游：多合同配置、真实零和未知分别保留；撤权和归档不冒充空库', async () => {
  const f = await fixture()
  const empty = await createProductionCustomerService(f.storage).detail(f.customer.id, { origin: 'real' }, f.session)
  expect(empty.summary).toMatchObject({ contractCount: 0, effectiveContractAmount: '0.00', effectiveReceiptAmount: null })
  expect(empty.contractsProblem).toBeUndefined()
  const first = await f.service.execute(f.command(), f.session)
  await f.service.execute(f.command({ draft: { ...f.command().draft, no: 'CONSTRUCTION-PROJECTION-TWO', name: '另一份主合同', amount: 150, managementFeeAmount: null, managementFeeBasis: '' } }), f.session)
  const projects = createProductionProjectService(f.storage)
  const customers = createProductionCustomerService(f.storage)
  const customerRead = await customers.detail(f.customer.id, { origin: 'real' }, f.session)
  expect(customerRead.contracts.map(row => row.contract.id)).toContain(first.id)
  expect(customerRead.summary).toMatchObject({ contractCount: 2, effectiveContractAmount: null, effectiveReceiptAmount: null })
  const projectRead = await projects.detail(f.project.id, { origin: 'real' }, f.session)
  expect(decodeProjectDetailRead(projectRead)).toEqual(projectRead)
  expect(projectRead.constructionManagementFees.state).toBe('complete')
  expect(projectRead.constructionManagementFees.contracts.find(row => row.id === first.id)?.configuration).toMatchObject({ amount: 0, basis: '明确零记取' })
  expect(projectRead.constructionManagementFees.contracts.find(row => row.id !== first.id)?.configuration.amount).toBeNull()
  const forbidden = () => ({ ...f.session(), capabilities: f.session().capabilities.filter(capability => capability !== 'construction-contract:read') })
  expect((await projects.detail(f.project.id, {}, forbidden)).constructionManagementFees).toMatchObject({ state: 'forbidden', contracts: [] })
  expect((await customers.detail(f.customer.id, { origin: 'real' }, forbidden)).contractsProblem).toMatchObject({ code: 'forbidden' })
  const before = projectRead.sourceVersion
  await projects.executeLifecycle({ id: f.project.id, commandId: 'projection-project-archive', workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'project:write', baseVersion: f.project.version, action: 'delete' }, f.session)
  const archived = await projects.detail(f.project.id, {}, f.session)
  expect(archived.sourceVersion).not.toBe(before)
  expect(archived.constructionManagementFees).toMatchObject({ state: 'complete', contracts: [] })
  expect((await f.storage.select('SELECT id FROM construction_contract_records ORDER BY id')).map(row => row.id).sort()).toEqual(customerRead.contracts.map(row => row.contract.id).sort())
})
it('施工同目标版本冲突和原号不同正文拒绝，不改管理费历史；未应用封存阻迟到写', async () => {
  const f = await fixture()
  const initial = f.command()
  const saved = await f.service.execute(initial, f.session)
  const first = await f.service.form(saved.id, f.session)
  const updated = f.command({ id: saved.id, baseVersion: first.version, draft: { ...first.draft, managementFeeAmount: 8 }, attachments: {} })
  const changed = await f.service.execute(updated, f.session, saved.id)
  await expect(f.service.execute(f.command({ id: saved.id, baseVersion: first.version, draft: first.draft, attachments: {} }), f.session, saved.id)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  await expect(f.service.execute({ ...initial, draft: { ...initial.draft, name: '同编号另一正文' } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  const detail = await f.service.detail(saved.id, { origin: 'real' }, f.session)
  expect(detail.contract.managementFee.history.map(row => row.amount)).toEqual([0, 8])
  expect(changed.version).toBe('2')
  const absent = 'construction-not-applied'
  expect(await f.service.resolve(absent, f.session)).toEqual({ outcome: 'not-applied', commandId: absent })
  await expect(f.service.execute(f.command({ commandId: absent }), f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
})

it('原保存编号由独立Node冷恢复后读到同一正式合同/原件，空内存不重建正文', async () => {
  const f = await fixture()
  const request = f.command()
  const saved = await f.service.execute(request, f.session)
  const descriptor = { family: 'construction-contract', targetId: null, action: request.action, commandId: request.commandId, workspaceId: f.session().workspaceId, actorId: f.session().actorId }
  const output = resolve(f.options.directory, 'cold-main.json')
  await f.storage.close()
  await runColdProcess('production-construction-cold', [f.options.directory, saved.id, JSON.stringify(descriptor), output])
  const cold = JSON.parse(await readFile(output, 'utf8'))
  expect(cold.resolution).toEqual({ outcome: 'applied', result: saved })
  expect(cold.form.draft).toMatchObject({ amount: null, taxRate: 0, managementFeeAmount: 0, projectId: f.project.id })
  expect(cold.files).toEqual([{ id: saved.attachmentIds[0], sha256: contractOriginalDigest(Buffer.from('abc')), payloadBase64: 'YWJj' }])
}, 20_000)

it('迁入原号独立冷恢复保主补零未知与原件；错scope/封存/陌生字段不覆盖原意图', async () => {
  const f = await fixture()
  const source = await nativeSource(f)
  const saved = await source.service.adopt(source.command, f.session)
  const descriptor = { family: 'construction-contract-import', targetId: null, action: 'adopt', scopeId: source.command.source.sha256, commandId: source.command.commandId, workspaceId: f.session().workspaceId, actorId: f.session().actorId }
  await expect(source.service.resolve({ ...descriptor, scopeId: '0'.repeat(64) }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  await expect(source.service.preflight({ ...source.command, surprise: 'never decode unknown envelope' }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  const absent = { ...descriptor, commandId: 'construction-import-never-applied' }
  expect(await source.service.resolve(absent, f.session)).toEqual({ outcome: 'not-applied', commandId: absent.commandId })
  await expect(source.service.resolve({ ...absent, scopeId: '0'.repeat(64) }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  await expect(source.service.adopt({ ...source.command, commandId: absent.commandId }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  const output = resolve(f.options.directory, 'cold-import.json')
  await f.storage.close()
  await runColdProcess('production-construction-cold', [f.options.directory, saved.ids[0]!, JSON.stringify(descriptor), output])
  const cold = JSON.parse(await readFile(output, 'utf8'))
  expect(cold.resolution).toEqual({ outcome: 'applied', result: saved })
  expect(cold.detail.sections.supplements[0]).toMatchObject({ id: 'legacy-construction-supp', amount: '0.00' })
  expect(cold.form.draft.amount).toBeNull()
  expect(cold.files).toEqual([{ id: 'legacy-head-file', sha256: contractOriginalDigest(Buffer.from('abc')), payloadBase64: 'YWJj' }])
}, 20_000)

it('后来正式主合同原意图/修改使原批全部恢复拒绝，拒绝编号可封存而原图与原件不变', async () => {
  const f = await fixture()
  const source = await nativeSource(f)
  const saved = await source.service.adopt(source.command, f.session)
  const form = await f.service.form(saved.ids[0]!, f.session)
  await f.service.execute(f.command({ id: saved.ids[0], baseVersion: form.version, draft: { ...form.draft, name: '正式后来修改', ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version }, attachments: {} }), f.session, saved.ids[0])
  const before = await f.storage.select('SELECT * FROM construction_contract_records ORDER BY id')
  const commandId = 'construction-danger-restore'
  await expect(source.service.restore({ commandId, workspaceId: f.session().workspaceId, actorId: f.session().actorId, importId: saved.importId }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  expect(await f.storage.select('SELECT * FROM construction_contract_records ORDER BY id')).toEqual(before)
  expect(await f.storage.select('SELECT * FROM construction_contract_import_restores')).toEqual([])
  const descriptor = { family: 'construction-contract-import', targetId: null, action: 'restore', scopeId: saved.importId, commandId, workspaceId: f.session().workspaceId, actorId: f.session().actorId }
  expect(await source.service.resolve(descriptor, f.session)).toEqual({ outcome: 'not-applied', commandId })
  expect((await f.service.file(saved.ids[0]!, 'legacy-supp-file', 'real', f.session)).bytes).toEqual(Buffer.from([0, 1, 2, 3]))
})

it('真实来源和权限切换拒绝写入，真实已应用原号不因同库无关主合同改变而冲突', async () => {
  const f = await fixture()
  const request = f.command()
  const saved = await f.service.execute(request, f.session)
  await f.service.execute(f.command(), f.session)
  expect(await f.service.execute(request, f.session)).toEqual(saved)
  await expect(f.service.detail(saved.id, { origin: 'demo' }, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  const allowed = f.session()
  f.setActor({ ...allowed, capabilities: allowed.capabilities.filter(capability => capability !== 'construction-contract:write') })
  await expect(f.service.execute(f.command(), f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  expect((await f.service.detail(saved.id, { origin: 'real' }, f.session)).contract.id).toBe(saved.id)
})

it('真实支出关系bind再unbind仍保消费历史，施工原图整批恢复不得绕过历史main_id', async () => {
  const f = await createConstructionScopeFixture()
  closers.push(() => f.storage.close())
  const session = () => ({ ...f.session(), capabilities: [...f.actor.capabilities, 'construction-contract:import'] })
  const source = await nativeSource({ ...f, session })
  const saved = await source.service.adopt(source.command, session)
  const target = { domain: 'material-contract' as const, id: f.material.id }
  const first = await f.scope.read(target, session)
  await f.scope.execute(constructionScopeCommand(first, 'construction-scope-bind-imported', saved.ids[0]!), session)
  const bound = await f.scope.read(target, session)
  await f.scope.execute(constructionScopeCommand(bound, 'construction-scope-unbind-imported', null), session)
  const unbound = await f.scope.read(target, session)
  expect(unbound.relation?.mainId).toBeNull()
  expect(await f.storage.select<{ main_id: string | null }>('SELECT main_id FROM construction_scope_history WHERE command_id IN(\'construction-scope-bind-imported\',\'construction-scope-unbind-imported\') ORDER BY version')).toEqual([{ main_id: saved.ids[0] }, { main_id: null }])
  const before = await f.storage.select('SELECT * FROM construction_contract_records ORDER BY id')
  await expect(source.service.restore({ commandId: 'construction-scope-danger-restore', workspaceId: session().workspaceId, actorId: session().actorId, importId: saved.importId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  expect(await f.storage.select('SELECT * FROM construction_contract_records ORDER BY id')).toEqual(before)
  expect(await f.storage.select('SELECT * FROM construction_contract_import_restores')).toEqual([])
})

it('历史重复主合同号迁入保两份原事实诊断和占号；新建同号仍阻断，不自行改号', async () => {
  const f = await fixture()
  const source = await nativeSource(f, true)
  const saved = await source.service.adopt(source.command, f.session)
  expect(saved.ids).toEqual(['legacy-construction-head', 'legacy-construction-second-head'])
  expect(await f.storage.select<{ contract_id: string }>('SELECT contract_id FROM contract_number_claims WHERE number=\'LEGACY-C21\' ORDER BY contract_id')).toEqual([{ contract_id: saved.ids[0] }, { contract_id: saved.ids[1] }])
  const current = await f.service.form(saved.ids[0]!, f.session)
  await f.service.execute(f.command({ id: saved.ids[0], baseVersion: current.version, draft: { ...current.draft, note: '保原重复号核对', ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version }, attachments: {} }), f.session, saved.ids[0])
  await expect(f.service.execute(f.command({ draft: { ...f.command().draft, no: 'LEGACY-C21' } }), f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  expect((await f.service.form(saved.ids[1]!, f.session)).draft.no).toBe('LEGACY-C21')
})

it('原库同编号旧回执无可信操作者映射时保持未知，独立冷恢复也不封存/覆写成未应用', async () => {
  const f = await fixture()
  const source = await nativeSource(f, false, true)
  await source.service.adopt(source.command, f.session)
  await expect(f.service.resolve('legacy-construction-command', f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  await expect(f.service.execute(f.command({ commandId: 'legacy-construction-command' }), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  expect(await f.storage.select('SELECT * FROM construction_contract_resolutions WHERE command_id=\'legacy-construction-command\'')).toEqual([])
  expect(await f.storage.select('SELECT * FROM construction_contract_intents WHERE command_id=\'legacy-construction-command\'')).toEqual([])
  const proof = JSON.parse((await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM construction_contract_imports'))[0]!.evidence_json)
  expect(proof.rawDomain.construction_contract_receipts[0].columns.result_json.exactValue).toBe('{"commandId":"legacy-construction-command","id":"legacy-construction-head","version":"old","future":"保原回执"}')
  const descriptor = { family: 'construction-contract', targetId: 'legacy-construction-head', action: 'save', commandId: 'legacy-construction-command', workspaceId: f.session().workspaceId, actorId: f.session().actorId }
  const output = resolve(f.options.directory, 'cold-legacy-construction-command.json')
  await f.storage.close()
  await runColdProcess('production-construction-cold', [f.options.directory, 'legacy-construction-head', JSON.stringify(descriptor), output])
  const cold = JSON.parse(await readFile(output, 'utf8'))
  expect(cold.resolution).toBeUndefined()
  expect(cold.resolutionProblem).toMatchObject({ code: 'unavailable' })
  const restarted = createProductionStorage(f.options)
  closers.push(() => restarted.close())
  expect(await restarted.select('SELECT * FROM construction_contract_resolutions WHERE command_id=\'legacy-construction-command\'')).toEqual([])
}, 20_000)

it('项目改甲方不反改原主合同；保原project/customer组合编辑可存，新错配/已删除原客户仍拒', async () => {
  const f = await fixture()
  const saved = await f.service.execute(f.command(), f.session)
  const customer = await createProductionCustomerService(f.storage).execute({ commandId: 'construction-next-customer', workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'customer:write', baseVersion: null, action: 'draft', draft: { name: '项目新甲方' }, attachments: {} }, f.session)
  const projects = createProductionProjectService(f.storage)
  const project = await projects.form(f.project.id, f.session)
  await projects.execute({ commandId: 'construction-project-change-customer', workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'project:write', id: f.project.id, baseVersion: project.version, action: 'draft', draft: { ...project.draft, customerId: customer.id }, attachments: {} }, f.session)
  const current = await f.service.form(saved.id, f.session)
  await f.service.execute(f.command({ id: saved.id, baseVersion: current.version, draft: { ...current.draft, note: '保原合同甲方继续编辑' }, attachments: {} }), f.session, saved.id)
  expect((await f.service.form(saved.id, f.session)).draft.customerId).toBe(f.customer.id)
  await expect(f.service.execute(f.command(), f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  const adopted = await nativeSource(f)
  await adopted.service.adopt(adopted.command, f.session)
  expect((await f.service.form('legacy-construction-head', f.session)).draft.customerId).toBe(f.customer.id)
  await f.storage.withTransaction(tx => tx.execute('UPDATE customers SET deleted_at=? WHERE id=?', ['2026-10-07T00:00:00.000Z', f.customer.id]))
  await expect(f.service.execute(f.command({ id: saved.id, baseVersion: '2', draft: { ...current.draft, note: '不能复活原客户' }, attachments: {} }), f.session, saved.id)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
})

afterAll(cleanupTestTempRoot)
