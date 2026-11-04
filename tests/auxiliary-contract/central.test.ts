import type { AuxiliaryContractCommand, AuxiliaryContractDraft, AuxiliaryImportCommand } from '../../app/lib/auxiliary-contract/contract'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { Buffer } from 'node:buffer'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { signatorySnapshot } from '../../app/lib/our-signatory/contract'
import { readOurSignatories } from '../../app/lib/our-signatory/storage'
import { createAuxiliaryContractTestInstance } from '../../server/utils/auxiliary-contract-test-instance'
import { contractOriginalDigest } from '../../server/utils/contract-original'
import { readAuxiliaryContractScopeFacts, validateProductionAuxiliaryState } from '../../server/utils/production-auxiliary-contract-record'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { createProductionConstructionScopeService } from '../../server/utils/production-construction-scope-service'
import { financeRecordSnapshot } from '../../server/utils/production-finance-journal'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { runColdProcess } from '../helpers/cold-process'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { constructionScopeCommand } from '../helpers/production-construction-scope-fixture'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'
import { cleanupTestTempRoot } from '../helpers/test-temp-root'

const company = { kind: 'company_expense' as const, name: '办公室租赁', no: 'GS-330', category: '房租', counterparty: '出租单位', signDate: '2026-09-06', amount: 1060, taxRate: 6, partyA: '承租公司' }
const productionClosers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(productionClosers.splice(0).map(close => close()))
})
async function productionFixture() {
  const f = await createSubcontractFixture()
  f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'auxiliary-contract:read', 'auxiliary-contract:write', 'auxiliary-contract:import', 'other-settlement:read'] })
  productionClosers.push(() => f.storage.close())
  const service = createProductionAuxiliaryContractService(f.storage)
  let sequence = 0
  const request = (patch: Partial<AuxiliaryContractCommand> = {}): AuxiliaryContractCommand => ({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'auxiliary-contract:write', commandId: `auxiliary-command-${++sequence}`, baseVersion: null, action: 'draft', constructionMain: f.constructionMain, draft: { kind: 'other_expense', name: '真实检测合同', no: `AUX-${sequence}`, category: '检测服务', projectId: f.project.id, supplierId: f.supplier.id, signDate: '2026-10-07', amount: 0, taxRate: 0, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version }, attachments: { add: [{ fileName: '实际原件.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] }, ...patch })
  return { ...f, auxiliary: service, request }
}
async function nativeAuxiliary(f: Awaited<ReturnType<typeof productionFixture>>, legacy = false, specialIdentity = false, duplicateNumber = false, adoptedSignatory = false) {
  const source = await createMigratedMemoryDb()
  await source.execute('INSERT INTO projects(id,name) VALUES(\'legacy-aux-project\',\'原检测项目\')')
  await source.execute('INSERT INTO suppliers(id,name) VALUES(\'legacy-aux-supplier\',\'原检测商\')')
  await source.execute('ALTER TABLE contracts ADD COLUMN extension_integer INTEGER')
  await source.execute('ALTER TABLE contracts ADD COLUMN extension_blob BLOB')
  await source.execute('ALTER TABLE contracts ADD COLUMN extension_json TEXT')
  await source.execute('INSERT INTO contracts(id,no,name,kind,project_id,supplier_id,other_expense_kind,amount,status,extension_integer,extension_blob,extension_json) VALUES (\'same-aux-id\',\'OLD-AUX\',\'原检测合同\',\'其他支出\',\'legacy-aux-project\',\'legacy-aux-supplier\',\'检测服务\',NULL,\'已签订\',CAST(\'9223372036854775807\' AS INTEGER),x\'0080FF\',?)', ['{"原扩展":"不能改JSON"}'])
  await source.execute('INSERT INTO company_expense_contracts(id,no,name,category,counterparty,amount,status,party_a) VALUES (\'same-aux-id\',\'OLD-COMPANY\',\'原办公室合同\',\'房租\',\'原出租方\',0,\'履约中\',\'原公司文本\')')
  await source.execute('INSERT INTO contract_supplements(id,contract_id,name,amount,status) VALUES (\'legacy-aux-supp\',\'same-aux-id\',\'原检测增补\',0,\'有效\')')
  await source.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES (\'legacy-aux-head-file\',\'contract\',\'same-aux-id\',\'原检测.txt\',\'\',3,\'text/plain\'),(\'legacy-aux-supp-file\',\'contract_supplement\',\'legacy-aux-supp\',\'原增补.bin\',\'D:/旧原件/增补.bin\',4,\'application/octet-stream\'),(\'legacy-aux-company-file\',\'company_expense_contract\',\'same-aux-id\',\'公司合同.txt\',\'\',3,\'text/plain\')')
  await source.execute('INSERT INTO file_payloads VALUES (\'legacy-aux-head-file\',\'base64\',\'YWJj\'),(\'legacy-aux-company-file\',\'base64\',\'YWJj\')')
  await source.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data) VALUES (\'legacy-aux-audit\',\'contracts\',\'same-aux-id\',\'update\',?)', ['{"原审计":"保持原字节"}'])
  const signer = adoptedSignatory ? (await f.storage.withTransaction(readOurSignatories)).records.find(row => row.id === f.signatory.id)! : null
  if (signer) {
    const legacyId = 'native-auxiliary-original-signatory'
    const snapshot = { ...signatorySnapshot(signer), id: legacyId }
    await source.execute('INSERT INTO our_signatories VALUES(?,?,?,?,?)', [legacyId, JSON.stringify(signer.draft), Number(signer.version), signer.createdAt, signer.updatedAt])
    for (const table of ['contracts', 'contract_supplements', 'company_expense_contracts'])
      await source.execute(`UPDATE ${table} SET our_signatory_id=?,our_signatory_snapshot=?`, [legacyId, JSON.stringify(snapshot)])
  }
  if (specialIdentity) {
    await source.execute('PRAGMA foreign_keys=OFF')
    await source.execute('UPDATE contracts SET id=? WHERE id=\'same-aux-id\'', ['旧 合同/稳定:原ID'])
    await source.execute('UPDATE company_expense_contracts SET id=? WHERE id=\'same-aux-id\'', ['旧 合同/稳定:原ID'])
    await source.execute('UPDATE contract_supplements SET id=?,contract_id=? WHERE id=\'legacy-aux-supp\'', ['旧 增补/原ID', '旧 合同/稳定:原ID'])
    await source.execute('UPDATE file_refs SET owner_id=? WHERE owner_type IN(\'contract\',\'company_expense_contract\')', ['旧 合同/稳定:原ID'])
    await source.execute('UPDATE file_refs SET owner_id=? WHERE owner_type=\'contract_supplement\'', ['旧 增补/原ID'])
    await source.execute('UPDATE file_refs SET id=?,uploaded_at=NULL WHERE id=\'legacy-aux-head-file\'', ['旧 原件/原ID'])
    await source.execute('UPDATE file_payloads SET file_ref_id=? WHERE file_ref_id=\'legacy-aux-head-file\'', ['旧 原件/原ID'])
    await source.execute('UPDATE operation_logs SET record_id=? WHERE id=\'legacy-aux-audit\'', ['旧 合同/稳定:原ID'])
    await source.execute('PRAGMA foreign_keys=ON')
  }
  if (duplicateNumber)
    await source.execute('UPDATE company_expense_contracts SET no=\'OLD-AUX\'')
  if (legacy) {
    await source.execute('CREATE TABLE auxiliary_contract_receipts(command_id TEXT PRIMARY KEY,contract_id TEXT,actor_id TEXT,result_json TEXT)')
    await source.execute('INSERT INTO auxiliary_contract_receipts VALUES (\'legacy-aux-command\',\'same-aux-id\',\'unmapped-old-actor\',?)', ['{"id":"same-aux-id","commandId":"legacy-aux-command","unknown":"旧回执"}'])
  }
  await source.execute('CREATE TABLE private_other_domain(secret TEXT)')
  await source.execute('INSERT INTO private_other_domain VALUES(\'DONT_COPY_AUXILIARY_PRIVATE_OTHER_DOMAIN\')')
  const bytes = source.raw.export()
  source.close()
  const command: AuxiliaryImportCommand = { commandId: 'auxiliary-native-adopt', workspaceId: f.session().workspaceId, actorId: f.session().actorId, source: { sha256: contractOriginalDigest(bytes), payloadBase64: Buffer.from(bytes).toString('base64') }, projects: [{ legacyId: 'legacy-aux-project', id: f.project.id, version: f.project.version }], suppliers: [{ legacyId: 'legacy-aux-supplier', id: f.supplier.id, version: f.supplier.version }], signatories: signer ? [{ legacyId: `native-auxiliary-original-signatory@${signer.version}`, id: signer.id, version: signer.version }] : [], originals: [{ fileId: 'legacy-aux-supp-file', payloadBase64: 'AAECAw==' }] }
  return { command, bytes }
}

describe('正式 Auxiliary 同库完整owner', () => {
  it('草稿必须真实工程选择，头和单份Main原子保存；重复原号、真实零、未知经济源与实际原件冷读取', async () => {
    const f = await productionFixture()
    const missing = f.request({ constructionMain: undefined })
    await expect(f.auxiliary.execute(missing, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.storage.select('SELECT * FROM auxiliary_contract_records')).toEqual([])
    const request = f.request()
    const saved = await f.auxiliary.execute(request, f.session)
    expect(await f.auxiliary.execute(request, f.session)).toEqual(saved)
    const detail = await f.auxiliary.detail(saved.id, { kind: 'other_expense', origin: 'real' }, f.session)
    expect(detail.constructionMain).toEqual(f.constructionMain)
    expect(detail.contract.amounts).toMatchObject({ contract: '0.00', changed: '0.00', paid: null, invoiced: null, settled: '0.00' })
    expect((await f.auxiliary.file(saved.id, detail.attachments[0]!.id, f.session)).payloadBase64).toBe('YWJj')
    expect(await f.storage.select('SELECT * FROM construction_scope_history WHERE source_domain=\'auxiliary-contract\'')).toHaveLength(1)
    expect(await f.storage.withTransaction(tx => readAuxiliaryContractScopeFacts(tx, f.session()))).toMatchObject([{ id: saved.id, amount: 0, supplementAmount: 0 }])
    const drafted = await f.auxiliary.execute(f.request({ draft: { ...request.draft, amount: null } }), f.session)
    expect((await f.auxiliary.detail(drafted.id, { kind: 'other_expense' }, f.session)).contract.amounts.contract).toBeNull()
  })
  it('公司头独立且需明确真实分供方，拒工程与自由甲方冒名，版本冲突和原号封存不能迟到提交', async () => {
    const f = await productionFixture()
    const companyRequest = f.request({ constructionMain: undefined, draft: { ...company, supplierId: f.supplier.id, supplierVersion: f.supplier.version, partyA: undefined, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version } })
    const saved = await f.auxiliary.execute(companyRequest, f.session)
    const detail = (await f.auxiliary.detail(saved.id, { kind: 'company_expense' }, f.session)).contract
    expect(detail.project).toBeNull()
    expect(detail.draft).toMatchObject({ supplierId: f.supplier.id, supplierVersion: f.supplier.version, counterparty: '分包正式分供方' })
    expect(detail.supplier).toMatchObject({ state: 'resolved', id: f.supplier.id })
    expect(await f.auxiliary.execute(companyRequest, f.session)).toEqual(saved)
    const changed = { ...companyRequest, id: saved.id, commandId: 'auxiliary-stale-version', baseVersion: '0' }
    await expect(f.auxiliary.execute(changed, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const scope = { commandId: changed.commandId, workspaceId: f.session().workspaceId, actorId: f.session().actorId, action: 'save' as const, scopeId: saved.id }
    expect(await f.auxiliary.resolve(scope, f.session)).toMatchObject({ outcome: 'not-applied' })
    await expect(f.auxiliary.execute(changed, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.auxiliary.execute({ ...companyRequest, commandId: 'auxiliary-forged-company', constructionMain: f.constructionMain }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })
  it('新公司合同拒绝缺分供方、过期版本与无读取权限，均不写合同', async () => {
    const f = await productionFixture()
    const request = f.request({ constructionMain: undefined, draft: { ...company, partyA: undefined, supplierId: f.supplier.id, supplierVersion: f.supplier.version } })
    await expect(f.auxiliary.execute({ ...request, commandId: 'company-missing-supplier', draft: { ...request.draft, supplierId: null, supplierVersion: null } }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(f.auxiliary.execute({ ...request, commandId: 'company-stale-supplier', draft: { ...request.draft, supplierVersion: '999999' } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const actor = f.session()
    f.setActor({ ...actor, capabilities: actor.capabilities.filter(item => item !== 'supplier:list:read') })
    await expect(f.auxiliary.execute({ ...request, commandId: 'company-supplier-forbidden' }, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT id FROM auxiliary_contract_records')).toEqual([])
  })
  it('公司合同回执及分供方采用快照在独立进程与数据库备份冷读保持一致，撤权隐藏关系', async () => {
    const f = await productionFixture()
    const request = f.request({ constructionMain: undefined, draft: { ...company, partyA: undefined, supplierId: f.supplier.id, supplierVersion: f.supplier.version } })
    const saved = await f.auxiliary.execute(request, f.session)
    const detail = await f.auxiliary.detail(saved.id, { kind: 'company_expense' }, f.session)
    const backupDirectory = resolve(f.options.directory, 'company-backup')
    await mkdir(backupDirectory)
    await f.storage.backupTo(resolve(backupDirectory, 'ruihang.sqlite'))
    const actor = f.session()
    f.setActor({ ...actor, capabilities: actor.capabilities.filter(item => item !== 'supplier:list:read') })
    const restricted = await f.auxiliary.detail(saved.id, { kind: 'company_expense' }, f.session)
    expect(restricted.contract.supplier).toMatchObject({ state: 'forbidden', id: null, label: null })
    expect(restricted.contract.draft).toMatchObject({ supplierId: null, supplierVersion: null })
    await f.storage.close()
    const descriptor = { commandId: request.commandId, workspaceId: actor.workspaceId, actorId: actor.actorId, family: 'auxiliary-contract', targetId: null, action: 'draft' }
    for (const directory of [f.options.directory, backupDirectory]) {
      const output = resolve(directory, 'company-cold.json')
      await runColdProcess('production-auxiliary-cold', [directory, saved.id, 'company_expense', JSON.stringify(descriptor), output])
      const cold = JSON.parse(await readFile(output, 'utf8'))
      expect(cold.resolution).toEqual({ outcome: 'applied', result: saved })
      expect(cold.detail.contract).toEqual(detail.contract)
      expect(cold.history).toHaveLength(1)
    }
  })
  it('分供方主档变化时拒绝过期新选择，已采用的合同名称和版本不反向改写', async () => {
    const f = await productionFixture()
    const request = f.request({ constructionMain: undefined, draft: { ...company, partyA: undefined, supplierId: f.supplier.id, supplierVersion: f.supplier.version } })
    const saved = await f.auxiliary.execute(request, f.session)
    const storedSupplier = (await f.storage.select<{ draft_json: string }>('SELECT draft_json FROM suppliers WHERE id=?', [f.supplier.id]))[0]!
    await createProductionSupplierService(f.storage).execute({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'supplier:write', commandId: 'company-supplier-renamed', id: f.supplier.id, baseVersion: f.supplier.version, action: 'save', attachments: {}, draft: { ...JSON.parse(storedSupplier.draft_json), name: '分供方新名称' } }, f.session, f.supplier.id)
    await expect(f.auxiliary.execute({ ...request, commandId: 'company-stale-real-change' }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const detail = await f.auxiliary.detail(saved.id, { kind: 'company_expense' }, f.session)
    expect(detail.contract.draft).toMatchObject({ supplierId: f.supplier.id, supplierVersion: f.supplier.version, counterparty: '分包正式分供方' })
    expect(detail.contract.supplier).toMatchObject({ state: 'resolved', label: '分供方新名称' })
    const edited = await f.auxiliary.execute({ ...request, id: saved.id, baseVersion: saved.version, commandId: 'company-save-frozen-name', draft: detail.contract.draft }, f.session)
    expect((await f.auxiliary.detail(edited.id, { kind: 'company_expense' }, f.session)).contract.draft).toMatchObject({ supplierVersion: f.supplier.version, counterparty: '分包正式分供方' })
  })
  it.each([false, true])('公司发票当前或历史消费后不得改分供方（历史=%s）', async (history) => {
    const f = await productionFixture()
    const request = f.request({ constructionMain: undefined, draft: { ...company, partyA: undefined, supplierId: f.supplier.id, supplierVersion: f.supplier.version } })
    const saved = await f.auxiliary.execute(request, f.session)
    await f.storage.execute(`INSERT INTO invoices(id,source_kind,ocr_status,review_status,account_status,owner_kind,contract_domain,contract_id,contract_version,version,created_at,updated_at)
      VALUES('company-invoice','manual','pending','unreviewed','none','company','company',?,?,1,'t','t')`, [saved.id, saved.version])
    if (history) {
      await f.storage.execute(`INSERT INTO invoice_command_receipts VALUES('company-invoice-command','w','actor','company-invoice','link-contract','fp','{}','t')`)
      await f.storage.execute('INSERT INTO invoice_audits VALUES(?,?,?,?,?,?,?,?)', ['company-invoice-audit', 'company-invoice', 'company-invoice-command', 'actor', 'link-contract', null, JSON.stringify({ contract: { domain: 'company', id: saved.id, version: saved.version } }), 't'])
      await f.storage.execute(`UPDATE invoices SET contract_domain=NULL,contract_id=NULL,contract_version=NULL WHERE id='company-invoice'`)
    }
    await expect(f.auxiliary.execute({ ...request, id: saved.id, baseVersion: saved.version, commandId: `company-change-${history}`, draft: { ...request.draft, supplierId: 'another-supplier', supplierVersion: '1' } }, f.session)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    const head = await f.auxiliary.detail(saved.id, { kind: 'company_expense' }, f.session)
    expect(head.contract.draft.supplierId).toBe(f.supplier.id)
  })
  it('两类同原ID完整Native图按原表命名空间隔离，原列i64/BLOB/JSON、有效增补与完整原件保全且无其他域字节', async () => {
    const f = await productionFixture()
    const source = await nativeAuxiliary(f)
    const saved = await f.auxiliary.adopt(source.command, f.session)
    expect(await f.auxiliary.adopt(source.command, f.session)).toEqual(saved)
    expect(saved.ids).toEqual(['same-aux-id', 'company-expense-same-aux-id'])
    const projectDetail = await f.auxiliary.detail('same-aux-id', { kind: 'other_expense' }, f.session)
    expect(projectDetail.constructionMain).toBeNull()
    expect(projectDetail.contract.amounts).toMatchObject({ contract: null, changed: null, paid: null })
    expect(projectDetail.facts).toContainEqual(expect.objectContaining({ id: 'legacy-aux-supp', kind: 'supplement', amount: '0.00', effective: true }))
    expect(projectDetail.attachments.map(file => file.id).sort()).toEqual(['legacy-aux-head-file', 'legacy-aux-supp-file'])
    const companyDetail = await f.auxiliary.detail('company-expense-same-aux-id', { kind: 'company_expense' }, f.session)
    expect(companyDetail.contract).toMatchObject({ project: null, draft: { partyA: '原公司文本' } })
    expect(companyDetail.contract.supplier).toBeNull()
    expect(companyDetail.contract.draft.supplierId ?? null).toBeNull()
    expect(companyDetail.contract.draft.counterparty).toBe('原出租方')
    expect((await f.auxiliary.file(companyDetail.contract.id, 'legacy-aux-company-file', f.session)).payloadBase64).toBe('YWJj')
    const evidence = JSON.parse((await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM auxiliary_contract_imports'))[0]!.evidence_json)
    expect(evidence.rawDomain.contracts[0].columns).toMatchObject({ extension_integer: { sqliteType: 'integer', exactValue: '9223372036854775807' }, extension_blob: { sqliteType: 'blob', exactValue: '0080FF' }, extension_json: { exactValue: '{"原扩展":"不能改JSON"}' } })
    expect(JSON.stringify(evidence)).not.toContain('DONT_COPY_AUXILIARY_PRIVATE_OTHER_DOMAIN')
    expect(JSON.stringify(evidence)).not.toContain(source.command.source.payloadBase64)
    expect(JSON.stringify(await f.storage.select('SELECT request_json FROM auxiliary_contract_intents'))).not.toContain(source.command.source.payloadBase64)
    expect(await f.storage.select('SELECT id FROM projects')).toHaveLength(1)
    expect(await f.storage.select('SELECT id FROM suppliers')).toHaveLength(1)
    const restored = await f.auxiliary.restore({ commandId: 'auxiliary-native-restore', workspaceId: f.session().workspaceId, actorId: f.session().actorId, importId: saved.importId }, f.session)
    expect(restored.restored).toBe(true)
    expect(await f.storage.select('SELECT * FROM file_payloads')).toHaveLength(3)
    await expect(f.auxiliary.detail(saved.ids[0]!, { kind: 'other_expense' }, f.session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    expect(contractOriginalDigest(source.bytes)).toBe(source.command.source.sha256)
  })
  it('旧原回执保原scope结果未知，不能用新编号声明未应用；危险current/history/原意图整批恢复拒绝并保原件', async () => {
    const f = await productionFixture()
    const source = await nativeAuxiliary(f, true)
    const saved = await f.auxiliary.adopt(source.command, f.session)
    await expect(f.auxiliary.resolve({ commandId: 'legacy-aux-command', workspaceId: f.session().workspaceId, actorId: f.session().actorId, action: 'save', scopeId: 'same-aux-id' }, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const failed = f.request({ id: 'same-aux-id', baseVersion: '0', constructionMain: undefined })
    await expect(f.auxiliary.execute(failed, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.auxiliary.restore({ commandId: 'auxiliary-danger-restore', workspaceId: f.session().workspaceId, actorId: f.session().actorId, importId: saved.importId }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await f.auxiliary.file('same-aux-id', 'legacy-aux-supp-file', f.session)).payloadBase64).toBe('AAECAw==')
  })
  it('普通保存与完整Native采用均在独立新Node冷恢复，只凭最小原定位回读真实原件和冻结目录', async () => {
    for (const importing of [false, true]) {
      const f = await productionFixture()
      const request = f.request()
      const source = importing ? await nativeAuxiliary(f) : null
      const saved = source ? await f.auxiliary.adopt(source.command, f.session) : await f.auxiliary.execute(request, f.session)
      const id = 'ids' in saved ? saved.ids[0]! : saved.id
      const detail = await f.auxiliary.detail(id, { kind: 'other_expense' }, f.session)
      const descriptor = { commandId: saved.commandId, workspaceId: f.session().workspaceId, actorId: f.session().actorId, family: importing ? 'auxiliary-contract-import' : 'auxiliary-contract', targetId: null, action: importing ? 'adopt' : 'draft', ...(source ? { scopeId: source.command.source.sha256 } : { scopeId: 'other_expense' }) }
      const output = resolve(f.options.directory, 'cold-auxiliary.json')
      await f.storage.close()
      await runColdProcess('production-auxiliary-cold', [f.options.directory, id, 'other_expense', JSON.stringify(descriptor), output])
      const cold = JSON.parse(await readFile(output, 'utf8'))
      expect(cold.resolution).toEqual({ outcome: 'applied', result: saved })
      expect(cold.detail.contract).toEqual(detail.contract)
      expect(cold.detail.attachments).toEqual(detail.attachments)
      expect(cold.detail.constructionMain).toEqual(detail.constructionMain)
      expect(cold.files.find((file: { fileName: string }) => file.fileName.includes(importing ? '原检测' : '实际原件')).payloadBase64).toBe('YWJj')
      if (importing) {
        expect(cold.detail.facts).toContainEqual(expect.objectContaining({ id: 'legacy-aux-supp', amount: '0.00' }))
        expect(JSON.parse(cold.proof[0].evidence_json).rawDomain.operation_logs[0].columns.after_data.exactValue).toBe('{"原审计":"保持原字节"}')
      }
      else {
        expect(cold.relation.map((row: { main_id: string }) => row.main_id)).toEqual([f.main.id])
      }
    }
  }, 45000)
  it('真实权限切换、坏原件/不可变版本/编号孤儿都拒绝，并保源操作日志与主档数量', async () => {
    const f = await productionFixture()
    const saved = await f.auxiliary.execute(f.request(), f.session)
    const counts = await f.storage.select('SELECT (SELECT COUNT(*) FROM projects) AS projects,(SELECT COUNT(*) FROM suppliers) AS suppliers,(SELECT COUNT(*) FROM auxiliary_contract_intents) AS intents,(SELECT COUNT(*) FROM operation_logs) AS logs')
    const denied = () => ({ ...f.session(), capabilities: [] })
    await expect(f.auxiliary.detail(saved.id, { kind: 'other_expense' }, denied)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await f.auxiliary.detail(saved.id, { kind: 'other_expense' }, f.session)
    expect(await f.storage.select('SELECT (SELECT COUNT(*) FROM projects) AS projects,(SELECT COUNT(*) FROM suppliers) AS suppliers,(SELECT COUNT(*) FROM auxiliary_contract_intents) AS intents,(SELECT COUNT(*) FROM operation_logs) AS logs')).toEqual(counts)
    await f.storage.withTransaction(tx => tx.execute('UPDATE file_payloads SET content=x\'66616b65\' WHERE file_ref_id=(SELECT file_ref_id FROM auxiliary_contract_files LIMIT 1)'))
    await expect(f.storage.withTransaction(tx => validateProductionAuxiliaryState(tx, f.session()))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
  it('合法Native非路由原ID通过明确命名空间稳定采用，父补原件全链映射；NULL上传时间保原未知而非造时间', async () => {
    const f = await productionFixture()
    const source = await nativeAuxiliary(f, false, true)
    const saved = await f.auxiliary.adopt(source.command, f.session)
    expect(saved.ids).toHaveLength(2)
    const proof = JSON.parse((await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM auxiliary_contract_imports'))[0]!.evidence_json)
    const mapping = proof.identityMappings.find((row: { legacyId: string }) => row.legacyId === 'other_expense:旧 合同/稳定:原ID')
    const supplement = proof.identityMappings.find((row: { legacyId: string }) => row.legacyId === 'contract_supplements:旧 增补/原ID')
    const file = proof.identityMappings.find((row: { legacyId: string }) => row.legacyId === 'file_refs:旧 原件/原ID')
    const detail = await f.auxiliary.detail(mapping.id, { kind: 'other_expense' }, f.session)
    expect(detail.facts).toContainEqual(expect.objectContaining({ id: supplement.id, contractId: mapping.id }))
    expect(detail.attachments).toContainEqual(expect.objectContaining({ id: file.id, ownerId: mapping.id, uploadedAt: null }))
    expect((await f.auxiliary.file(mapping.id, file.id, f.session)).payloadBase64).toBe('YWJj')
    expect(proof.rawDomain.contracts[0].legacyId).toBe('旧 合同/稳定:原ID')
    expect(proof.rawDomain.file_refs.find((row: { legacyId: string }) => row.legacyId === '旧 原件/原ID').columns.uploaded_at).toMatchObject({ sqliteType: 'null', exactValue: null })
    expect(proof.rawDomain.operation_logs[0].columns.record_id.exactValue).toBe('旧 合同/稳定:原ID')
  })
  it('原历史同编号合法重复保原号及诊断证据，新正式提交仍拒重复，不覆写冻结旧文书', async () => {
    const f = await productionFixture()
    const source = await nativeAuxiliary(f, false, false, true)
    await f.auxiliary.adopt(source.command, f.session)
    expect(await f.storage.select('SELECT contract_id,number FROM contract_number_claims WHERE owner_domain=\'auxiliary-contract\' ORDER BY contract_id')).toEqual([{ contract_id: 'company-expense-same-aux-id', number: 'OLD-AUX' }, { contract_id: 'same-aux-id', number: 'OLD-AUX' }])
    const request = f.request({ action: 'submit' })
    request.draft.no = 'OLD-AUX'
    await expect(f.auxiliary.execute(request, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await f.auxiliary.detail('same-aux-id', { kind: 'other_expense' }, f.session)).contract.draft.no).toBe('OLD-AUX')
    expect((await f.auxiliary.detail('company-expense-same-aux-id', { kind: 'company_expense' }, f.session)).contract.draft.no).toBe('OLD-AUX')
  })
  it('business-invalid公司关系原意图只保raw fingerprint，封存未应用后不污染后续合法source/只读与validator', async () => {
    const f = await productionFixture()
    const invalid = f.request({ constructionMain: undefined, draft: { kind: 'company_expense', name: '不能挂项目的公司头', projectId: f.project.id } })
    await expect(f.auxiliary.execute(invalid, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const raw = (await f.storage.select<{ request_json: string }>('SELECT request_json FROM auxiliary_contract_intents WHERE command_id=?', [invalid.commandId]))[0]!
    expect(JSON.parse(raw.request_json).draft.projectId).toBe(f.project.id)
    expect(await f.auxiliary.resolve({ commandId: invalid.commandId, workspaceId: f.session().workspaceId, actorId: f.session().actorId, action: 'save', scopeId: 'new-company_expense' }, f.session)).toMatchObject({ outcome: 'not-applied', commandId: invalid.commandId })
    const valid = await f.auxiliary.execute(f.request({ constructionMain: undefined, draft: { kind: 'company_expense', name: '真正独立公司头', supplierId: f.supplier.id, supplierVersion: f.supplier.version } }), f.session)
    expect((await f.auxiliary.detail(valid.id, { kind: 'company_expense' }, f.session)).contract.draft.name).toBe('真正独立公司头')
    await f.storage.withTransaction(tx => validateProductionAuxiliaryState(tx, f.session()))
    expect(await f.storage.select('SELECT id FROM auxiliary_contract_records')).toEqual([{ id: valid.id }])
    await expect(f.auxiliary.execute(invalid, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })
  it('历史已有source独立关联并解绑仍保消费证据，原Scope最小定位可核对，整批危险restore拒绝不删历史', async () => {
    const f = await productionFixture()
    const source = await nativeAuxiliary(f)
    const adopted = await f.auxiliary.adopt(source.command, f.session)
    const scope = createProductionConstructionScopeService(f.storage)
    const identity = { domain: 'auxiliary-contract' as const, id: 'same-aux-id' }
    const current = await scope.read(identity, f.session)
    const bound = await scope.execute(constructionScopeCommand(current, 'auxiliary-history-bind', f.main.id), f.session)
    const unbound = await scope.execute(constructionScopeCommand(await scope.read(identity, f.session), 'auxiliary-history-unbind', null), f.session)
    expect(unbound.relation.mainId).toBeNull()
    expect(await scope.resolve({ commandId: bound.commandId, workspaceId: f.session().workspaceId, actorId: f.session().actorId, family: 'construction-scope', targetId: 'auxiliary-contract:same-aux-id', scopeId: 'same-aux-id', action: 'bind' }, f.session)).toEqual({ outcome: 'applied', result: bound })
    await expect(f.auxiliary.restore({ commandId: 'auxiliary-history-danger-restore', workspaceId: f.session().workspaceId, actorId: f.session().actorId, importId: adopted.importId }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.storage.select('SELECT version FROM construction_scope_history WHERE source_domain=\'auxiliary-contract\'')).toEqual([{ version: 1 }, { version: 2 }])
    expect((await f.auxiliary.file('same-aux-id', 'legacy-aux-supp-file', f.session)).payloadBase64).toBe('AAECAw==')
  })
  it('真实Native v53主体列与JSON内版本保头/原协议采用身份，逐项映射实际历史，不按当前目录改原文书', async () => {
    const f = await productionFixture()
    const source = await nativeAuxiliary(f, false, false, false, true)
    const preview = await f.auxiliary.preflight(source.command, f.session)
    expect(preview.references.filter(row => row.kind === 'signatory')).toMatchObject([{ id: 'native-auxiliary-original-signatory@1', candidates: [{ id: f.signatory.id, version: '1' }] }])
    await f.auxiliary.adopt(source.command, f.session)
    const detail = await f.auxiliary.detail('same-aux-id', { kind: 'other_expense' }, f.session)
    expect(detail.contract.draft).toMatchObject({ ourSignatoryId: f.signatory.id, ourSignatoryVersion: '1', ourSignatorySnapshot: { id: f.signatory.id, name: '分包正式我方', version: '1' } })
    const supplementary = JSON.parse((await f.storage.select<{ record_json: string }>('SELECT record_json FROM auxiliary_contract_supplements WHERE id=\'legacy-aux-supp\''))[0]!.record_json)
    expect(supplementary.ourSignatorySnapshot).toMatchObject({ id: f.signatory.id, version: '1' })
    const evidence = JSON.parse((await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM auxiliary_contract_imports'))[0]!.evidence_json)
    expect(JSON.parse(evidence.rawDomain.contracts[0].columns.our_signatory_snapshot.exactValue).id).toBe('native-auxiliary-original-signatory')
    await f.storage.withTransaction(tx => validateProductionAuxiliaryState(tx, f.session()))
  })
  it('固定原增补的amount/effective/status/snapshot破坏不能通过PureState或Source facts，不把原图修成新事实', async () => {
    const f = await productionFixture()
    const source = await nativeAuxiliary(f)
    await f.auxiliary.adopt(source.command, f.session)
    const original = (await f.storage.select<{ record_json: string }>('SELECT record_json FROM auxiliary_contract_supplements WHERE id=\'legacy-aux-supp\''))[0]!.record_json
    for (const patch of [{ amount: '100.00' }, { effective: false }, { status: '已作废' }]) {
      await f.storage.withTransaction(tx => tx.execute('UPDATE auxiliary_contract_supplements SET record_json=? WHERE id=\'legacy-aux-supp\'', [JSON.stringify({ ...JSON.parse(original), ...patch })]))
      await expect(f.storage.withTransaction(tx => validateProductionAuxiliaryState(tx, f.session()))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      await expect(f.storage.withTransaction(tx => readAuxiliaryContractScopeFacts(tx, f.session()))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      await f.storage.withTransaction(tx => tx.execute('UPDATE auxiliary_contract_supplements SET record_json=? WHERE id=\'legacy-aux-supp\'', [original]))
    }
  })
  it('只有真实finance history.head仍消费合同，即使current与后来意图无引用也整批拒绝restore', async () => {
    const f = await productionFixture()
    const source = await nativeAuxiliary(f)
    const saved = await f.auxiliary.adopt(source.command, f.session)
    await f.storage.withTransaction(async (tx) => {
      await tx.execute('INSERT INTO payment_applications(id,project_id,supplier_id,contract_id) VALUES(?,?,?,?)', ['historical-aux-finance', f.project.id, f.supplier.id, 'same-aux-id'])
      const original = await financeRecordSnapshot(tx, 'payment_application', 'historical-aux-finance')
      await tx.execute('INSERT INTO finance_history VALUES(?,?,?,?,?,?,?)', ['payment_application', 'historical-aux-finance', 1, 'historical-source-adoption', f.session().actorId, '2026-10-07T10:00:00.000Z', JSON.stringify(original)])
      await tx.execute('UPDATE payment_applications SET contract_id=NULL WHERE id=\'historical-aux-finance\'')
    })
    await expect(f.auxiliary.restore({ commandId: 'auxiliary-finance-history-danger', workspaceId: f.session().workspaceId, actorId: f.session().actorId, importId: saved.importId }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.storage.select('SELECT * FROM auxiliary_contract_import_restores')).toEqual([])
    expect((await f.auxiliary.file('same-aux-id', 'legacy-aux-supp-file', f.session)).payloadBase64).toBe('AAECAw==')
  })
  it('native显式version可采用已归档真实项目且原冻结图保留，不复活、不进入日常source候选；版本变化拒整批', async () => {
    const f = await productionFixture()
    const source = await nativeAuxiliary(f)
    await f.storage.withTransaction(tx => tx.execute('UPDATE projects SET deleted_at=\'2026-10-07T10:00:00.000Z\' WHERE id=?', [f.project.id]))
    const preview = await f.auxiliary.preflight(source.command, f.session)
    expect(preview.references.find(row => row.kind === 'project')?.candidates).toContainEqual(expect.objectContaining({ id: f.project.id, version: f.project.version, deletedAt: '2026-10-07T10:00:00.000Z' }))
    const stale = { ...source.command, commandId: 'auxiliary-stale-archived-version', projects: source.command.projects.map(row => ({ ...row, version: String(Number(row.version) + 1) })) }
    await expect(f.auxiliary.adopt(stale, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.storage.select('SELECT * FROM auxiliary_contract_records')).toEqual([])
    const saved = await f.auxiliary.adopt(source.command, f.session)
    expect(saved.ids).toContain('same-aux-id')
    expect((await f.auxiliary.list({ kind: 'other_expense' }, f.session)).items).toEqual([])
    expect(await f.storage.withTransaction(tx => readAuxiliaryContractScopeFacts(tx, f.session()))).toContainEqual(expect.objectContaining({ id: 'same-aux-id', eligible: false }))
    expect((await f.storage.select<{ deleted_at: string }>('SELECT deleted_at FROM projects WHERE id=?', [f.project.id]))[0]!.deleted_at).toBe('2026-10-07T10:00:00.000Z')
  })
  it('业务tx进行期间实际身份/权限变化在commit前再次阻断，保原号但不发表迟到header/Main/原件', async () => {
    const f = await productionFixture()
    const originalActor = f.session()
    let armed = true
    const gated: ProductionStorage = { ...f.storage, withTransaction: work => f.storage.withTransaction(tx => work({ ...tx, async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const rows = await tx.select<T>(sql, params)
      if (armed && sql === 'SELECT * FROM auxiliary_contract_receipts WHERE command_id=?') {
        armed = false
        f.setActor({ ...originalActor, capabilities: [] })
      }
      return rows
    } })) }
    await expect(createProductionAuxiliaryContractService(gated).execute(f.request(), f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT * FROM auxiliary_contract_records')).toEqual([])
    expect(await f.storage.select('SELECT * FROM auxiliary_contract_receipts')).toEqual([])
    expect(await f.storage.select('SELECT * FROM construction_scope_links WHERE source_domain=\'auxiliary-contract\'')).toEqual([])
    expect(await f.storage.select('SELECT * FROM auxiliary_contract_intents')).toHaveLength(1)
  })
})

const session = { workspaceId: 'workspace-test', actorId: 'actor-test', capabilities: ['auxiliary-contract:read', 'auxiliary-contract:write'] }
const command = (draft: AuxiliaryContractDraft = company): AuxiliaryContractCommand => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'auxiliary-contract:write', commandId: 'create-330', baseVersion: null, action: 'save', draft, attachments: {} })

describe('辅助合同中央事实', () => {
  it('多选类别和状态先取字段并集再交集，单值旧链接与不限仍有效', async () => {
    let counter = 0
    const repository = createAuxiliaryContractTestInstance({ createId: () => `multi-${++counter}` })
    for (const category of ['房租', '软件', '其他']) {
      await repository.execute({ ...command({ ...company, category }), commandId: category, action: 'draft' }, session)
    }
    expect(repository.list({ kind: 'company_expense', category: ['房租', '软件'], status: ['草稿', '已签订'] }, session).pagination.total).toBe(2)
    expect(repository.list({ kind: 'company_expense', category: ['房租', '软件'], status: ['已签订'] }, session).pagination.total).toBe(0)
    expect(repository.list({ kind: 'company_expense', category: '房租' }, session).pagination.total).toBe(1)
    expect(repository.list({ kind: 'company_expense', category: [], status: [] }, session).pagination.total).toBe(3)
  })
  it('无税金额在半分边界按十进制四舍五入，税额与含税金额对齐', async () => {
    const repository = createAuxiliaryContractTestInstance()
    const result = await repository.execute(command({ ...company, amount: 0.09, taxRate: 20 }), session)
    expect(repository.detail(result.id, { kind: 'company_expense' }, session).contract.amounts).toMatchObject({ contract: '0.09', taxExclusive: '0.08', tax: '0.01' })
  })
  it('关系身份失效后读取为缺失关系，更新不可沿用已删除身份', async () => {
    let projects = [{ id: 'p-live', name: '动态项目' }]
    const repository = createAuxiliaryContractTestInstance({ identities: () => ({ projects, suppliers: [{ id: 's-live', name: '动态分供方' }] }) })
    const input = command({ kind: 'other_expense', name: '检测服务', category: '检测服务', projectId: 'p-live', supplierId: 's-live', signDate: '2026-09-06', amount: 1 })
    const result = await repository.execute(input, session)
    projects = []
    expect(repository.detail(result.id, { kind: 'other_expense' }, session).contract.project?.state).toBe('missing')
    await expect(repository.execute({ ...input, id: result.id, baseVersion: '1', commandId: 'update-stale-ref' }, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })
  it('公司合同没有项目，通过显式命令保存后只读详情保留税务与操作者，重试不重复', async () => {
    const repository = createAuxiliaryContractTestInstance({ createId: () => 'contract-330', now: () => '2026-09-06T01:00:00.000Z' })
    const result = await repository.execute(command(), session)
    expect(await repository.execute(command(), session)).toEqual(result)
    const detail = repository.detail('contract-330', { kind: 'company_expense', origin: 'real' }, session)
    expect(detail.contract.project).toBeNull()
    expect(detail.contract.supplier).toBeNull()
    expect(detail.contract.amounts).toMatchObject({ contract: '1060.00', taxExclusive: '1000.00', tax: '60.00', invoiced: '0.00', paid: '0.00' })
    expect(detail.contract.audit).toMatchObject({ createdBy: 'actor-test', updatedBy: 'actor-test' })
    expect(repository.list({ kind: 'company_expense' }, session).pagination.total).toBe(1)
  })
  it('项目合同只接受稳定项目/分供方 ID，公司合同拒绝项目和伪造明细；失败不落事实', async () => {
    const repository = createAuxiliaryContractTestInstance({ projects: [{ id: 'p-1', name: '同名项目' }], suppliers: [{ id: 's-1', name: '同名单位' }] })
    const draft = { kind: 'other_expense' as const, name: '检测服务', category: '检测服务', projectId: 'p-1', supplierId: 's-1', amount: 0, signDate: '2026-09-06' }
    await expect(repository.execute(command({ ...draft, supplierId: '同名单位' }), session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(repository.execute(command({ ...company, projectId: 'p-1' }), session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(repository.execute(command({ ...draft, lineItems: [{}] } as AuxiliaryContractDraft), session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(repository.list({ kind: 'other_expense' }, session).pagination.total).toBe(0)
    const saved = await repository.execute(command(draft), session)
    expect(repository.detail(saved.id, { kind: draft.kind }, session).contract).toMatchObject({ project: { id: 'p-1' }, supplier: { id: 's-1' }, amounts: { contract: '0.00' } })
    expect(() => repository.detail(saved.id, { kind: 'company_expense' }, session)).toThrow(/不匹配/)
  })
  it.each(([{ amount: -1 }, { amount: 1.001 }, { amount: Number.NaN }, { signDate: '2026-02-30' }, { status: '已结清' }]).map(input => ({ input })))('命令隔离会话、版本和幂等内容，未知身份、金额、日期与状态不可写入：输入案例 %#', async ({ input: patch }) => {
    const repository = createAuxiliaryContractTestInstance()
    const saved = await repository.execute(command(), session)
    await expect(repository.execute({ ...command(), draft: { ...company, name: '偷换内容' } }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(repository.execute({ ...command(), commandId: 'update', id: saved.id, baseVersion: '0' }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(() => repository.detail(saved.id, { kind: 'company_expense' }, { ...session, workspaceId: 'another' })).toThrow(/不存在/)
    expect(() => repository.list({ kind: 'company_expense' }, { ...session, capabilities: [] })).toThrow(/权限/)
    await expect(repository.execute({ ...command({ ...company, ...patch }), commandId: crypto.randomUUID() }, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })
  it('附件归当前合同，移除可恢复；票款只汇总同类型同 ID 的有效事实并保留未知金额', async () => {
    const repository = createAuxiliaryContractTestInstance({ createId: () => 'c-330', facts: [
      { id: 'i-1', contractId: 'c-330', contractKind: 'company_expense', dataOrigin: 'real', kind: 'invoice', no: 'FP-1', name: '收票', amount: '800.00', date: null, status: 'confirmed', effective: true },
      { id: 'p-1', contractId: 'c-330', contractKind: 'company_expense', dataOrigin: 'real', kind: 'payment', no: 'ZF-1', name: '支付分摊', amount: '300.00', date: null, status: 'confirmed', effective: true },
      { id: 'i-2', contractId: 'c-330', contractKind: 'other_expense', dataOrigin: 'real', kind: 'invoice', no: '同名错类', name: '收票', amount: '999.00', date: null, status: 'confirmed', effective: true },
    ] })
    const saved = await repository.execute({ ...command(), attachments: { add: [{ fileName: '合同审批稿.pdf', category: '合同审批稿', fileSize: 20 }] } }, session)
    const read = () => repository.detail(saved.id, { kind: 'company_expense' }, session)
    expect(read().contract.amounts).toMatchObject({ invoiced: '800.00', paid: '300.00', byInvoicePayable: '500.00' })
    const file = read().attachments[0]!
    expect(file).toMatchObject({ ownerId: saved.id, ownerType: 'company_expense_contract', uploader: session.actorId })
    await expect(repository.execute({ ...command(), id: saved.id, baseVersion: '1', commandId: 'bad-file', attachments: { removeIds: ['unknown-file'] } }, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await repository.execute({ ...command(), id: saved.id, baseVersion: '1', commandId: 'remove', attachments: { removeIds: [file.id] } }, session)
    expect(read().attachments).toHaveLength(0)
    await repository.execute({ ...command(), id: saved.id, baseVersion: '2', commandId: 'restore', attachments: { restoreIds: [file.id] } }, session)
    expect(read().attachments).toHaveLength(1)
  })
  it('来源筛选分页与汇总属于同一结果，0 与 null 不混淆', async () => {
    let counter = 0
    const repository = createAuxiliaryContractTestInstance({ createId: () => `c-${++counter}` })
    for (let i = 0; i < 12; i++)
      await repository.execute({ ...command({ ...company, name: `软件 ${i}`, category: '软件', amount: i === 0 ? null : 0 }), commandId: `create-${i}`, action: 'draft' }, session)
    const page = repository.list({ kind: 'company_expense', category: '软件', page: '2', pageSize: '10' }, session)
    expect(page).toMatchObject({ pagination: { total: 12, page: 2, pageSize: 10 }, empty: null, summary: { real: { count: 12, amount: null } } })
    expect(page.items).toHaveLength(2)
    expect(repository.list({ kind: 'company_expense', search: '不存在' }, session)).toMatchObject({ pagination: { total: 0 }, empty: { reason: 'no-filter-match' } })
    expect(() => repository.list({ kind: 'company_expense', projectId: 'p-1' }, session)).toThrow(/项目/)
  })
})

afterAll(cleanupTestTempRoot)
