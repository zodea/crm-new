import type { MaterialContractCommandRequestDTO } from '../../app/lib/material-contract/command-contract'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, expect, it } from 'vitest'
import { decodeContractPriceRead } from '../../app/lib/material-contract/price-facts'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { readProductionConstructionScopeMainFact } from '../../server/utils/production-construction-scope-record'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionMaterialContractService, readMaterialContractProjectFacts } from '../../server/utils/production-material-contract-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

async function fixture() {
  const base = testTempRoot('a02-material-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/storage-`)
  const options = { directory, workspaceId: 'material-disk-workspace', ownerId: 'material-disk-owner', purpose: 'verification' as const }
  const storage = await createSeededProductionStorage(options)
  const actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['material-contract:read', 'material-contract:write', 'construction-contract:read', 'construction-contract:write', 'construction-scope:read', 'construction-scope:write', 'project:list:read', 'project:write', 'customer:list:read', 'customer:write', 'supplier:list:read', 'supplier:write', 'our-signatory:read', 'our-signatory:write'] }
  const session = () => structuredClone(actor)
  const envelope = { workspaceId: actor.workspaceId, actorId: actor.actorId, baseVersion: null, action: 'save', attachments: {} }
  const customer = await createProductionCustomerService(storage).execute({ ...envelope, requiredCapability: 'customer:write', commandId: 'create-customer', draft: { name: '合成正式客户', contact: '合成人' } }, session)
  const project = await createProductionProjectService(storage).execute({ ...envelope, requiredCapability: 'project:write', commandId: 'create-project', draft: { name: '合成正式项目', customerId: customer.id, manager: '合成人' } }, session)
  const supplier = await createProductionSupplierService(storage).execute({ ...envelope, requiredCapability: 'supplier:write', commandId: 'create-supplier', draft: { name: '合成正式分供方', supplierCategory: '其他', contact: '合成人' } }, session)
  const signatory = await createProductionOurSignatoryService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'our-signatory:write', commandId: 'create-own-party', baseVersion: null, draft: { name: '合成我方公司', taxNo: 'SYNTHETIC-TAX-NO', registeredAddress: null, legalRepresentative: null, verificationNote: '独立合成文书核实事实', status: 'active' } }, session)
  const bytes = Buffer.from('synthetic material original')
  const main = await createProductionConstructionContractService(storage).execute({ ...envelope, requiredCapability: 'construction-contract:write', commandId: 'material-upstream-main', draft: { name: '原采购工程施工合同', projectId: project.id, customerId: customer.id, content: '真实工程', signDate: '2026-10-07', ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, status: '已签订' } }, session)
  const actualMain = await storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, actor, main.id))
  const constructionMain = { id: actualMain.id, projectId: project.id, basis: actualMain.basis }
  const command: MaterialContractCommandRequestDTO = { ...envelope, requiredCapability: 'material-contract:write', commandId: 'create-material', action: 'submit', constructionMain, draft: {
    name: '合成方管采购',
    projectId: project.id,
    supplierId: supplier.id,
    ourSignatoryId: signatory.id,
    ourSignatoryVersion: signatory.version,
    content: '合成原签约事实',
    signDate: '2026-10-04',
    amount: 4800,
    taxRate: null,
    lineItems: [{ materialName: '方管', spec: '40×40×2', materialGrade: '304', unit: '米', qty: 100, taxInclusiveUnitPrice: 20 }, { materialName: '方管', materialGrade: '', unit: '米', qty: 100, taxInclusiveUnitPrice: 30 }],
    deductions: [{ name: '整单优惠', amount: 200, basis: '合成合同明确优惠200元' }],
  }, attachments: { add: [{ fileName: '合成合同原件.txt', fileSize: bytes.length, mimeType: 'text/plain', payloadBase64: bytes.toString('base64') }, { fileName: '合成空文件.txt', fileSize: 0, mimeType: 'text/plain', payloadBase64: '' }] } }
  return { storage, options, actor, session, command, bytes, service: createProductionMaterialContractService(storage), signatories: createProductionOurSignatoryService(storage) }
}

it('新建工程必选在原请求固定后校验，缺失拒绝不留半份合同且同原键不能更换内容', async () => {
  const f = await fixture()
  try {
    const { constructionMain: selected, ...withoutMain } = f.command
    expect(selected).toBeDefined()
    const request = { ...withoutMain, commandId: 'missing-engineering-original' }
    await expect(f.service.execute(request, f.session)).rejects.toThrow('必须搜索并选择')
    expect(await f.storage.select('SELECT * FROM material_contract_records')).toEqual([])
    expect(await f.storage.select('SELECT * FROM construction_scope_links')).toEqual([])
    expect((await f.storage.select<{ request_json: string }>('SELECT request_json FROM material_contract_commands')).map(row => JSON.parse(row.request_json))).toEqual([{ ...request, attachments: { ...request.attachments, removeIds: [], restoreIds: [] } }])
    await expect(f.service.execute({ ...request, constructionMain: selected }, f.session)).rejects.toThrow('同一命令编号')
    await f.storage.close()
    expect(await f.service.resolve(request.commandId, f.session)).toEqual({ outcome: 'not-applied', commandId: request.commandId })
    await expect(f.service.execute(request, f.session)).rejects.toThrow('封存')
    expect(await f.storage.select('SELECT * FROM material_contract_records')).toEqual([])
  }
  finally { await f.storage.close() }
})

it('工程关联回执故障整事务回滚原合同、原件和占号，原编号冷重开仍只创建一次', async () => {
  const f = await fixture()
  const fault = new Error('synthetic-scope-receipt-disk-failure')
  const brokenStorage: typeof f.storage = {
    ...f.storage,
    withTransaction: async work => f.storage.withTransaction(tx => work({
      ...tx,
      execute: async (sql, ...args) => {
        if (/INSERT INTO construction_scope_receipts/i.test(sql))
          throw fault
        return tx.execute(sql, ...args)
      },
    })),
  }
  const command = { ...f.command, commandId: 'atomic-engineering-original', draft: { ...f.command.draft, no: 'ATOMIC-MAT-1' } }
  const tables = ['material_contract_records', 'material_contract_commands', 'construction_scope_links', 'construction_scope_history', 'construction_scope_intents', 'construction_scope_receipts', 'file_refs', 'file_payloads', 'contract_number_claims', 'contract_number_history']
  try {
    const before = await Promise.all(tables.map(table => f.storage.select(`SELECT * FROM ${table} ORDER BY rowid`)))
    await expect(createProductionMaterialContractService(brokenStorage).execute(command, f.session)).rejects.toBe(fault)
    expect(await Promise.all(tables.map(table => f.storage.select(`SELECT * FROM ${table} ORDER BY rowid`)))).toEqual(before)
    const saved = await f.service.execute(command, f.session)
    const links = await f.storage.select('SELECT * FROM construction_scope_links')
    expect(links).toEqual([expect.objectContaining({ source_domain: 'material-contract', source_id: saved.id, main_id: command.constructionMain!.id, project_id: command.draft.projectId })])
    await f.storage.close()
    expect(await f.service.execute(command, f.session)).toEqual(saved)
    expect(await f.service.resolve(command.commandId, f.session)).toEqual({ outcome: 'applied', result: saved })
    expect(await f.storage.select('SELECT * FROM construction_scope_links')).toEqual(links)
    expect(Buffer.from((await f.service.file(saved.id, saved.attachmentIds[0]!, f.session)).bytes).equals(f.bytes)).toBe(true)
    expect(await inspectProductionBackup(await f.storage.backupTo(resolve(f.options.directory, 'atomic-complete.sqlite')).then(() => resolve(f.options.directory, 'atomic-complete.sqlite')))).toMatchObject({ originals: { files: saved.attachmentIds.length, bytes: f.bytes.length } })
  }
  finally { await f.storage.close() }
})

it('备份及冷读拒绝丢失整份工程关联证据的已保存原合同，不能把空关系误当历史未关联', async () => {
  const f = await fixture()
  try {
    const saved = await f.service.execute(f.command, f.session)
    const directory = resolve(f.options.directory, 'missing-whole-engineering-proof')
    await mkdir(directory)
    const path = resolve(directory, 'ruihang.sqlite')
    await f.storage.backupTo(path)
    await inspectProductionBackup(path)
    const damaged = new DatabaseSync(path)
    try {
      const guards = damaged.prepare('SELECT name,sql FROM sqlite_schema WHERE type=\'trigger\' AND tbl_name LIKE \'construction_scope_%\'').all()
      for (const guard of guards)
        damaged.exec(`DROP TRIGGER "${guard.name}"`)
      for (const table of ['construction_scope_receipts', 'construction_scope_history', 'construction_scope_intents', 'construction_scope_links'])
        damaged.exec(`DELETE FROM ${table}`)
      damaged.exec('UPDATE construction_scope_revision SET revision=0')
      for (const guard of guards)
        damaged.exec(String(guard.sql))
    }
    finally { damaged.close() }
    await expect(inspectProductionBackup(path)).rejects.toThrow('材采')
    const copy = createProductionStorage({ ...f.options, directory })
    try {
      await expect(createProductionMaterialContractService(copy).form(saved.id, f.session)).rejects.toThrow('证据损坏')
      expect(await copy.select('SELECT * FROM construction_scope_links')).toEqual([])
    }
    finally { await copy.close() }
    expect((await f.service.form(saved.id, f.session)).constructionMain?.id).toBe(f.command.constructionMain!.id)
  }
  finally { await f.storage.close() }
})

it('目录更名与停用保核实历史，原合同与既有协议快照固定；新选择核对当前目录版本', async () => {
  const f = await fixture()
  try {
    const saved = await f.service.execute(f.command, f.session)
    const original = await f.service.form(saved.id, f.session)
    const catalog = (await f.signatories.list(f.session)).records[0]!
    const protocol = await f.service.execute({ ...f.command, commandId: 'snapshot-protocol', attachments: {}, draft: { ...f.command.draft, isSupplement: true, originalContractId: saved.id, amount: 20, deductions: [], lineItems: [{ materialName: '新增材料', qty: 1, unit: '米', taxInclusiveUnitPrice: 20 }] } }, f.session)
    await f.signatories.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'our-signatory:write', commandId: 'rename-our-party', id: catalog.id, baseVersion: '1', draft: { ...catalog.draft, name: '后来更名的我方公司', status: 'inactive' } }, f.session)
    const later = await f.service.execute({ ...f.command, id: saved.id, baseVersion: '1', commandId: 'keep-adopted-our-party', attachments: {}, draft: { ...original.draft, content: '只补说明' } }, f.session, saved.id)
    expect(later.version).toBe('2')
    expect((await f.service.form(saved.id, f.session)).draft.ourSignatorySnapshot).toMatchObject({ name: '合成我方公司', version: '1' })
    expect((await f.service.form(protocol.id, f.session)).draft.ourSignatorySnapshot).toEqual(original.draft.ourSignatorySnapshot)
    const detail = await f.service.detail(saved.id, { origin: 'real' }, f.session)
    expect(detail.contract.ourSignatorySnapshot?.name).toBe('合成我方公司')
    expect(detail.sections.supplements?.[0]?.ourSignatorySnapshot).toEqual(original.draft.ourSignatorySnapshot)
    await expect(f.service.execute({ ...f.command, commandId: 'inactive-own-party-new-contract' }, f.session)).rejects.toThrow('已停用')
    await expect(f.storage.execute('UPDATE our_signatory_history SET draft_json=\'{}\'')).rejects.toThrow('immutable')
    await expect(f.storage.execute('DELETE FROM our_signatories WHERE id=?', [catalog.id])).rejects.toThrow('without deleting')
    await f.storage.close()
    expect((await f.signatories.list(f.session)).records[0]).toMatchObject({ id: catalog.id, version: '2', draft: { name: '后来更名的我方公司', status: 'inactive' } })
    expect((await f.service.form(protocol.id, f.session)).draft.ourSignatorySnapshot?.name).toBe('合成我方公司')
  }
  finally { await f.storage.close() }
})

it('真实同库占号不依赖分页，草稿提示但不占号；改号原值留历史，重放不重新抢号', async () => {
  const f = await fixture()
  try {
    const firstRequest = { ...f.command, draft: { ...f.command.draft, no: 'GLOBAL-A' } }
    const first = await f.service.execute(firstRequest, f.session)
    const duplicate = { ...f.command, commandId: 'global-duplicate', attachments: {}, draft: { ...f.command.draft, no: 'GLOBAL-A' } }
    const draft = await f.service.execute({ ...duplicate, action: 'draft', commandId: 'duplicate-draft' }, f.session)
    expect(draft.warnings).toEqual(['草稿编号与其他正式主合同重复，正式提交前请核对。'])
    await expect(f.service.execute(duplicate, f.session)).rejects.toThrow('其他正式主合同重复')
    expect(await f.service.resolve(duplicate.commandId, f.session)).toEqual({ outcome: 'not-applied', commandId: duplicate.commandId })
    const form = await f.service.form(first.id, f.session)
    const renumber = { ...f.command, id: first.id, baseVersion: '1', commandId: 'global-renumber', attachments: {}, draft: { ...form.draft, no: 'GLOBAL-B' } }
    const second = await f.service.execute(renumber, f.session, first.id)
    const reused = await f.service.execute({ ...duplicate, commandId: 'released-number-reused' }, f.session)
    await f.service.execute({ ...renumber, baseVersion: second.version, commandId: 'global-renumber-again', draft: { ...renumber.draft, no: 'GLOBAL-C' } }, f.session, first.id)
    expect(await f.service.execute(renumber, f.session, first.id)).toEqual(second)
    expect(await f.storage.select('SELECT number FROM contract_number_claims WHERE contract_id=?', [first.id])).toEqual([{ number: 'GLOBAL-C' }])
    expect(await f.storage.select('SELECT number FROM contract_number_history WHERE contract_id=? ORDER BY CAST(version AS INTEGER)', [first.id])).toEqual([{ number: 'GLOBAL-A' }, { number: 'GLOBAL-B' }, { number: 'GLOBAL-C' }])
    const reusedForm = await f.service.form(reused.id, f.session)
    await f.service.execute({ ...f.command, id: reused.id, baseVersion: reused.version, commandId: 'cancel-established', attachments: {}, draft: { ...reusedForm.draft, status: '作废' } }, f.session, reused.id)
    await expect(f.service.execute({ ...duplicate, commandId: 'cancelled-number-blocked' }, f.session)).rejects.toThrow('其他正式主合同重复')
    await f.storage.close()
    expect((await f.service.form(first.id, f.session)).draft.no).toBe('GLOBAL-C')
    expect(await f.service.resolve(renumber.commandId, f.session)).toEqual({ outcome: 'applied', result: second })
  }
  finally { await f.storage.close() }
})

it('我方目录完整请求固定，业务拒绝后封存原键，冷开回执与未应用墓碑保全', async () => {
  const f = await fixture()
  try {
    const request = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'our-signatory:write', commandId: 'exact-own-request', baseVersion: null, draft: { name: ' 原核实名称 ', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '原依据', status: 'active' } }
    const result = await f.signatories.execute(request, f.session)
    const blank = { ...request, commandId: 'blank-name-original', draft: { ...request.draft, name: '  ' } }
    await expect(f.signatories.execute(blank, f.session)).rejects.toThrow('真实签约名称')
    await expect(f.signatories.execute({ ...blank, draft: { ...blank.draft, name: '后来修正文' } }, f.session)).rejects.toThrow('不同的完整请求')
    expect(await f.signatories.resolve(blank.commandId, f.session)).toEqual({ outcome: 'not-applied', commandId: blank.commandId })
    await expect(f.signatories.execute({ ...request, draft: { ...request.draft, name: '原核实名称' } }, f.session)).rejects.toThrow('同一命令编号')
    expect(await f.signatories.resolve('own-request-never-applied', f.session)).toEqual({ outcome: 'not-applied', commandId: 'own-request-never-applied' })
    await expect(f.signatories.execute({ ...request, commandId: 'own-request-never-applied' }, f.session)).rejects.toThrow('已封存')
    await f.storage.close()
    expect(await f.signatories.execute(request, f.session)).toEqual(result)
    expect(await f.signatories.resolve(request.commandId, f.session)).toEqual({ outcome: 'applied', result })
    expect((await f.signatories.list(f.session)).records.find(row => row.id === result.id)?.draft.name).toBe('原核实名称')
    expect(await f.signatories.resolve('own-request-never-applied', f.session)).toEqual({ outcome: 'not-applied', commandId: 'own-request-never-applied' })
  }
  finally { await f.storage.close() }
})

it('完整备份核验混合 owner、原件、原命令、回执及墓碑；副本冷恢复仍读取原版本', async () => {
  const f = await fixture()
  try {
    const saved = await f.service.execute(f.command, f.session)
    await f.service.resolve('sealed-before-backup', f.session)
    const copyDirectory = resolve(f.options.directory, 'cold-backup')
    await mkdir(copyDirectory)
    const path = resolve(copyDirectory, 'ruihang.sqlite')
    await f.storage.backupTo(path)
    const inventory = await inspectProductionBackup(path)
    expect(inventory.tables.material_contract_records?.rows).toBe(1)
    expect(inventory.tables.material_contract_commands?.rows).toBe(1)
    expect(inventory.tables.material_contract_resolutions?.rows).toBe(1)
    expect(inventory.originals).toEqual({ files: 2, bytes: f.bytes.length })
    const copy = createProductionStorage({ ...f.options, directory: copyDirectory })
    try {
      const owner = createProductionMaterialContractService(copy)
      expect(await owner.resolve(f.command.commandId, f.session)).toEqual({ outcome: 'applied', result: saved })
      expect(await owner.resolve('sealed-before-backup', f.session)).toEqual({ outcome: 'not-applied', commandId: 'sealed-before-backup' })
      expect(await owner.form(saved.id, f.session)).toMatchObject({ draft: { amount: 4800, deductions: [{ amount: 200 }] } })
      expect([...(await owner.file(saved.id, saved.attachmentIds[0]!, f.session)).bytes]).toEqual([...f.bytes])
    }
    finally { await copy.close() }
    const corrupt = new DatabaseSync(path)
    corrupt.exec('UPDATE material_contract_commands SET fingerprint=\'bad-fingerprint\'')
    corrupt.close()
    await expect(inspectProductionBackup(path)).rejects.toThrow('材采')
  }
  finally { await f.storage.close() }
})

it('正常业务拒绝也固定原提交，核对封存后才换新编号；上游撤权不泄露历史定位', async () => {
  const f = await fixture()
  try {
    const invalid = { ...f.command, commandId: 'bad-sum', draft: { ...f.command.draft, amount: 4700 } }
    await expect(f.service.execute(invalid, f.session)).rejects.toThrow('不一致')
    await f.storage.close()
    await expect(f.service.execute({ ...f.command, commandId: invalid.commandId }, f.session)).rejects.toThrow('同一命令编号')
    expect(await f.service.resolve(invalid.commandId, f.session)).toEqual({ outcome: 'not-applied', commandId: invalid.commandId })
    await expect(f.service.execute(invalid, f.session)).rejects.toThrow('封存')
    const saved = await f.service.execute(f.command, f.session)
    const restricted = () => ({ ...f.actor, capabilities: ['material-contract:read'] })
    const detail = await f.service.detail(saved.id, { origin: 'real' }, restricted)
    expect(detail.contract.project).toEqual({ state: 'forbidden', entity: 'project', id: null, label: null, reason: 'permission-denied' })
    expect(detail.contract.supplier).toEqual({ state: 'forbidden', entity: 'supplier', id: null, label: null, reason: 'permission-denied' })
    expect(JSON.stringify(detail)).not.toContain(f.command.draft.projectId)
    expect(JSON.stringify(detail)).not.toContain(f.command.draft.supplierId)
    expect(detail.meta).toMatchObject({ schemaVersion: 'material-contract-read-v2', workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, sources: expect.arrayContaining([
      { key: 'projects', state: 'forbidden', sourceVersion: null, asOf: null },
      { key: 'suppliers', state: 'forbidden', sourceVersion: null, asOf: null },
      { key: 'material-finance', state: 'unavailable', sourceVersion: null, asOf: null },
    ]) })
    const list = await f.service.list({}, restricted)
    expect(list.summary.projects).toEqual([])
    expect(list.summary.suppliers).toEqual([])
    expect(list.originMeta.demo.sources).toEqual([{ key: 'material-demo', state: 'not-requested', sourceVersion: null, asOf: null }])
    await expect(f.service.context(restricted)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally { await f.storage.close() }
})

it('正式用途首次写入继续被现行备份及上线门禁拒绝，不建立材采半份记录', async () => {
  const f = await fixture()
  await f.storage.close()
  const directory = resolve(f.options.directory, 'production-gate')
  await mkdir(directory)
  const formal = createProductionStorage({ ...f.options, directory, purpose: 'production' })
  try {
    // 换用途不能接管已标记的验证库；正式冷库亦不能绕过首次写入门禁。
    await expect(createProductionMaterialContractService(formal).execute(f.command, f.session)).rejects.toThrow('首次正式写入')
    expect(await formal.select('SELECT * FROM material_contract_records')).toEqual([])
    expect(await formal.select('SELECT * FROM material_contract_commands')).toEqual([])
  }
  finally { await formal.close() }
})

it('主合同、减项、协议自有明细、原件、回执和冻结原价格跨磁盘冷开保全', async () => {
  const f = await fixture()
  try {
    const [saved, duplicate] = await Promise.all([f.service.execute(f.command, f.session), f.service.execute(structuredClone(f.command), f.session)])
    expect(duplicate).toEqual(saved)
    expect(await f.storage.select('SELECT count(*) AS count FROM material_contract_records')).toEqual([{ count: 1 }])
    const original = await f.service.form(saved.id, f.session)
    const lineId = original.draft.lineItems![0]!.id!
    const supplement = await f.service.execute({ ...f.command, commandId: 'create-supplement', attachments: {}, draft: { ...f.command.draft, isSupplement: true, originalContractId: saved.id, name: '合成单价核增协议', amount: 100, deductions: [], lineItems: [{ materialName: '方管', spec: '40×40×2', materialGrade: '304', unit: '米', qty: 100, originalLineId: lineId, taxInclusiveUnitPrice: 21, changeAmount: 100, changeBasis: '原100米每米核增1元' }] } }, f.session)
    await f.service.execute({ ...f.command, id: saved.id, commandId: 'edit-main-explanation', baseVersion: '1', draft: { ...original.draft, content: '后来说明，仅保留原事实' }, attachments: {} }, f.session, saved.id)
    await f.storage.close()
    const reopened = createProductionStorage(f.options)
    try {
      const owner = createProductionMaterialContractService(reopened)
      expect(await owner.execute(f.command, f.session)).toEqual(saved)
      expect(await owner.resolve('create-supplement', f.session)).toEqual({ outcome: 'applied', result: supplement })
      expect(await owner.form(saved.id, f.session)).toMatchObject({ version: '2', draft: { amount: 4800, lineItems: [{ id: lineId, materialGrade: '304', qty: 100, taxInclusiveUnitPrice: 20 }, { id: original.draft.lineItems![1]!.id, materialGrade: '', qty: 100, taxInclusiveUnitPrice: 30 }] } })
      const detail = await owner.detail(saved.id, { origin: 'real' }, f.session)
      expect(detail.contract.amounts).toEqual({ contract: '4800.00', changed: '4900.00', settled: null, invoiced: null, paid: null, payable: null })
      expect(detail.sections.supplements).toMatchObject([{ id: supplement.id, lineItems: [{ originalLineId: lineId, unitPrice: '21.00', amount: '100.00' }], originalLineSnapshots: [{ originalLineId: lineId, parentVersion: 1, unitPrice: '20.00', qty: '100' }] }])
      expect(detail.sections.deductions).toEqual([{ id: original.draft.deductions![0]!.id!, name: '整单优惠', amount: '-200.00', basis: '合成合同明确优惠200元' }])
      expect([...(await owner.file(saved.id, saved.attachmentIds[0]!, f.session)).bytes]).toEqual([...f.bytes])
      expect((await owner.file(saved.id, saved.attachmentIds[1]!, f.session)).bytes.length).toBe(0)
      expect((await owner.snapshot(f.session)).contracts.find(row => row.id === saved.id)!.history).toMatchObject([{ version: 1, draft: { content: '合成原签约事实' }, commandId: 'edit-main-explanation' }])
    }
    finally { await reopened.close() }
  }
  finally { await f.storage.close() }
})

it('原件事务失败、提交前撤权、旧版本、异主附件和同键异文均不能留下半份业务', async () => {
  const f = await fixture()
  try {
    await f.storage.execute('CREATE TRIGGER fail_material_original BEFORE INSERT ON file_payloads BEGIN SELECT RAISE(ABORT,\'material-original-write-failed\'); END')
    await expect(f.service.execute(f.command, f.session)).rejects.toThrow('material-original-write-failed')
    expect(await f.storage.select('SELECT id FROM material_contract_records')).toEqual([])
    expect(await f.storage.select('SELECT scoped_id FROM material_contract_commands')).toEqual([])
    expect(await f.storage.select('SELECT id FROM file_refs')).toEqual([])
    await f.storage.execute('DROP TRIGGER fail_material_original')
    let checks = 0
    await expect(f.service.execute(f.command, () => ({ ...f.actor, capabilities: ++checks < 3 ? f.actor.capabilities : ['material-contract:read'] }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.storage.select('SELECT id FROM material_contract_records')).toEqual([])
    const saved = await f.service.execute(f.command, f.session)
    await expect(f.service.execute({ ...f.command, draft: { ...f.command.draft, name: '异文' } }, f.session)).rejects.toThrow('同一命令编号')
    const form = await f.service.form(saved.id, f.session)
    await expect(f.service.execute({ ...f.command, id: saved.id, commandId: 'stale-edit', baseVersion: '0', draft: form.draft, attachments: {} }, f.session, saved.id)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const other = await f.service.execute({ ...f.command, commandId: 'other-contract', attachments: {} }, f.session)
    await expect(f.service.execute({ ...f.command, id: other.id, commandId: 'foreign-attachment', baseVersion: '1', attachments: { removeIds: saved.attachmentIds } }, f.session, other.id)).rejects.toThrow('不属于')
    await expect(f.service.file(other.id, saved.attachmentIds[0]!, f.session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    expect((await f.service.form(saved.id, f.session)).version).toBe('1')
  }
  finally { await f.storage.close() }
})

it('核对未应用后持久封存迟到请求；只读查询不写回，无权限与跨来源不给旧正文', async () => {
  const f = await fixture()
  try {
    const saved = await f.service.execute(f.command, f.session)
    expect(await f.service.resolve('late-material-command', f.session)).toEqual({ outcome: 'not-applied', commandId: 'late-material-command' })
    const before = await f.service.snapshot(f.session)
    const filesBefore = await f.storage.select('SELECT * FROM file_refs')
    const asOf = '2026-10-04T12:00:00.000Z'
    const facts = await f.storage.withTransaction(tx => readMaterialContractProjectFacts(tx, f.actor, f.command.draft.projectId!, asOf))
    expect(facts).toEqual({ count: 1, source: { key: 'material-contracts', state: 'readable', sourceVersion: 'material-contract-command-1', asOf } })
    expect(await f.storage.withTransaction(tx => readMaterialContractProjectFacts(tx, { ...f.actor, capabilities: [] }, f.command.draft.projectId!, asOf))).toEqual({ count: null, source: { key: 'material-contracts', state: 'forbidden', sourceVersion: null, asOf: null } })
    await f.service.list({}, f.session)
    await f.service.detail(saved.id, {}, f.session)
    await f.service.context(f.session)
    expect(await f.service.snapshot(f.session)).toEqual(before)
    expect(await f.storage.select('SELECT * FROM file_refs')).toEqual(filesBefore)
    await f.storage.close()
    await expect(f.service.execute({ ...f.command, commandId: 'late-material-command' }, f.session)).rejects.toThrow('封存')
    expect(await f.service.resolve(f.command.commandId, f.session)).toEqual({ outcome: 'applied', result: saved })
    await expect(f.service.detail(saved.id, { origin: 'demo' }, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(f.service.file(saved.id, saved.attachmentIds[0]!, () => ({ ...f.actor, capabilities: [] }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(f.service.resolve('other-owner', () => ({ ...f.actor, actorId: 'other-owner' }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally { await f.storage.close() }
})

it('缺字节新上传拒绝，已存原件损坏后停止读取，不能降格为历史缺件', async () => {
  const f = await fixture()
  try {
    await expect(f.service.execute({ ...f.command, attachments: { add: [{ fileName: '只有路径.txt', filePath: 'D:/old/file.txt', fileSize: 3 }] } }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const saved = await f.service.execute(f.command, f.session)
    await f.storage.execute('UPDATE file_payloads SET content=? WHERE file_ref_id=?', [Buffer.from('altered'), saved.attachmentIds[0]!])
    await expect(f.service.form(saved.id, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.storage.select('SELECT count(*) AS count FROM material_contract_records')).toEqual([{ count: 1 }])
  }
  finally { await f.storage.close() }
})

it.each(['claim', 'signatory-history', 'signatory-command', 'snapshot'])('完整备份拒绝%s坏归属或原事实，不因目录/占号参与者已登记而恢复坏图', async (part) => {
  const f = await fixture()
  try {
    await f.service.execute({ ...f.command, draft: { ...f.command.draft, no: 'BACKUP-OWN-NUMBER' } }, f.session)
    const path = resolve(f.options.directory, `${part}-backup.sqlite`)
    await f.storage.backupTo(path)
    expect((await inspectProductionBackup(path)).tables).toMatchObject({ our_signatories: { rows: 1 }, our_signatory_history: { rows: 1 }, contract_number_claims: { rows: 1 }, contract_number_history: { rows: 1 } })
    const tampered = new DatabaseSync(path)
    try {
      if (part === 'claim') {
        tampered.exec('UPDATE contract_number_claims SET contract_id=\'orphan-contract\'')
      }
      else if (part === 'signatory-history') {
        tampered.exec('DROP TRIGGER our_signatory_history_update_guard')
        tampered.exec('UPDATE our_signatory_history SET actor_id=\'other-actor\'')
      }
      else if (part === 'signatory-command') {
        tampered.exec('UPDATE our_signatory_commands SET fingerprint=\'replaced\'')
      }
      else {
        const row = tampered.prepare('SELECT id,record_json FROM material_contract_records').get()!
        const record = JSON.parse(String(row.record_json))
        record.draft.ourSignatorySnapshot.name = '未经该版本核实的名称'
        tampered.prepare('UPDATE material_contract_records SET record_json=? WHERE id=?').run(JSON.stringify(record), String(row.id))
      }
    }
    finally { tampered.close() }
    await expect(inspectProductionBackup(path)).rejects.toThrow()
    expect((await f.service.list({}, f.session)).pagination.total).toBe(1)
  }
  finally { await f.storage.close() }
})

it('合同约定价从真实磁盘owner读取，本行NULL不套头税，冷打开和重复回执保原价，撤权收起关联', async () => {
  const f = await fixture()
  try {
    const request = { ...f.command, draft: { ...f.command.draft, taxRate: 13, lineItems: f.command.draft.lineItems?.map((row, index) => ({ ...row, applicableTaxRate: index ? 0 : null })) } }
    const saved = await f.service.execute(request, f.session)
    expect(await f.service.execute(request, f.session)).toEqual(saved)
    const first = decodeContractPriceRead(await f.service.prices('real', f.session), 'real')
    expect(first.items.map(row => row.applicableTaxRate)).toEqual([null, 0])
    expect(first.items.map(row => row.taxInclusiveUnitPrice)).toEqual([20, 30])
    expect(first.meta.sources.find(row => row.key === 'material-contracts')).toMatchObject({ state: 'readable', sourceVersion: 'material-contract-command-1' })
    await f.storage.close()
    const cold = decodeContractPriceRead(await f.service.prices('real', f.session), 'real')
    expect(cold.items).toEqual(first.items)
    expect((await f.service.form(saved.id, f.session)).draft.taxRate).toBe(13)
    f.actor.capabilities = f.actor.capabilities.filter(value => !['supplier:list:read', 'project:list:read'].includes(value))
    const restricted = decodeContractPriceRead(await f.service.prices('real', f.session), 'real')
    expect(restricted.items.every(row => row.supplierId === null && row.supplierName === null && row.projectId === null && row.projectName === null)).toBe(true)
    expect(restricted.meta.sources.find(row => row.key === 'suppliers')?.state).toBe('forbidden')
    await expect(f.service.prices('demo', f.session)).rejects.toThrow('不接受')
    f.actor.capabilities = []
    await expect(f.service.prices('real', f.session)).rejects.toThrow('权限')
  }
  finally { await f.storage.close() }
})
