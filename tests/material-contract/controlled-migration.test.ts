import type { CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { CORE_MIGRATION_CAPABILITY, CORE_MIGRATION_CONTRACT_VERSION, CORE_MIGRATION_SOURCE_MODE, CORE_MIGRATION_TOPOLOGY, coreMigrationSourceHashInput, isCoreMigrationBlockingIssue } from '~/lib/migration/core-contract'
import { readMaterialContractGraphs } from '~/lib/migration/material-contract-source'
import { prepareCoreMigrationCommandSources } from '../../server/utils/core-migration-preparation'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createMaterialContractCommandTestInstance } from '../../server/utils/material-contract-command-test-instance'
import { createMemoryDb } from '../helpers/memory-db'

const actor = { workspaceId: 'migration-material', actorId: 'migration-owner', capabilities: [CORE_MIGRATION_CAPABILITY, 'material-contract:read', 'material-contract:write'] }
async function fixture(version = 52, selectedSignatory = false) {
  const db = await createMemoryDb()
  await runMigrations(db, migrations.filter(row => row.version <= version))
  await db.execute('INSERT INTO projects(id,name) VALUES(\'old-project\',\'旧真实项目\')')
  await db.execute('INSERT INTO suppliers(id,name) VALUES(\'old-supplier\',\'旧真实分供方\')')
  await db.execute('INSERT INTO contracts(id,name,kind,project_id,supplier_id,amount,status,created_at,updated_at) VALUES(\'old-main\',\'旧方管合同\',\'材采\',\'old-project\',\'old-supplier\',4800,\'履约中\',\'2026-10-02T00:00:00.000Z\',\'2026-10-02T00:00:00.000Z\')')
  await db.execute('INSERT INTO contract_line_items(id,contract_id,material_name,unit,qty,tax_inclusive_unit_price) VALUES(\'old-line\',\'old-main\',\'方管\',\'米\',250,20)')
  await db.execute('INSERT INTO contract_supplements(id,contract_id,name,amount,status,created_at,updated_at) VALUES(\'old-protocol\',\'old-main\',\'旧核增协议\',100,\'履约中\',\'2026-10-03T00:00:00.000Z\',\'2026-10-03T00:00:00.000Z\')')
  if (version >= 50) {
    await db.execute('INSERT INTO contract_deductions(id,contract_id,name,amount,basis) VALUES(\'old-deduction\',\'old-main\',\'原件优惠\',200,\'文书记载\')')
    await db.execute('INSERT INTO contract_supplement_line_items(id,supplement_id,original_line_id,material_name,unit,qty,tax_inclusive_unit_price,change_amount,change_basis) VALUES(\'old-protocol-line\',\'old-protocol\',\'old-line\',\'方管\',\'米\',100,21,100,\'原100米每米核增1元\')')
    await db.execute('INSERT INTO contract_line_items(id,contract_id,material_name,unit,qty,tax_inclusive_unit_price,deleted_at) VALUES(\'old-deleted-line\',\'old-main\',\'旧已删行\',\'米\',3,7,\'2026-10-03T00:00:00.000Z\')')
  }
  const bytes = Buffer.from('synthetic migrated original')
  await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,uploaded_at) VALUES(\'old-original\',\'contract_supplement\',\'old-protocol\',\'旧协议.txt\',\'D:/历史路径\',?,\'text/plain\',\'2026-10-03T00:00:00.000Z\')', [bytes.length])
  await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(\'old-original\',\'base64\',?)', [bytes.toString('base64')])
  await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,uploaded_at) VALUES(\'old-missing\',\'contract\',\'old-main\',\'旧缺件.txt\',\'D:/不可冒充正文\',7,\'text/plain\',\'2026-10-02T00:00:00.000Z\')')
  await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,after_data) VALUES(\'old-audit\',\'contracts\',\'old-main\',\'update\',\'{旧证据未解析}\',\'{真实原文}\')')
  if (selectedSignatory) {
    const adopted = { name: '原核实我方公司', taxNo: 'ORIGINAL-TAX', registeredAddress: null, legalRepresentative: null, verificationNote: '旧文书核实原文', status: 'active' }
    const current = { ...adopted, name: '后来目录更名', status: 'inactive' }
    await db.execute('INSERT INTO our_signatories VALUES(?,?,?,?,?)', ['native-our-party', JSON.stringify(current), 2, '2026-10-01T00:00:00.000Z', '2026-10-04T00:00:00.000Z'])
    await db.execute('INSERT INTO our_signatory_history VALUES(?,?,?,?,?,?,?)', ['native-our-party-v1', 'native-our-party', 1, JSON.stringify(adopted), null, null, '2026-10-01T00:00:00.000Z'])
    await db.execute('INSERT INTO our_signatory_history VALUES(?,?,?,?,?,?,?)', ['native-our-party-v2', 'native-our-party', 2, JSON.stringify(current), null, null, '2026-10-04T00:00:00.000Z'])
    const { status: _status, ...facts } = adopted
    const snapshot = JSON.stringify({ id: 'native-our-party', version: '1', ...facts })
    await db.execute('UPDATE contracts SET our_signatory_id=?,our_signatory_snapshot=?,party_a=? WHERE id=?', ['native-our-party', snapshot, '  旧文书甲方原文（未猜映射）  ', 'old-main'])
    await db.execute('UPDATE contract_supplements SET our_signatory_id=?,our_signatory_snapshot=? WHERE id=?', ['native-our-party', snapshot, 'old-protocol'])
  }
  const material = await readMaterialContractGraphs(sql => db.select(sql), version)
  const unsigned = { contractVersion: CORE_MIGRATION_CONTRACT_VERSION, mode: CORE_MIGRATION_SOURCE_MODE, sourceVersion: `sqlite-v${version}`, entities: { ...Object.fromEntries(CORE_MIGRATION_TOPOLOGY.map(kind => [kind, []])), projects: [{ legacyId: 'old-project', name: '旧真实项目' }], suppliers: [{ legacyId: 'old-supplier', name: '旧真实分供方' }], material_contracts: material.entities, contract_supplements: [{ legacyId: 'old-protocol', name: '旧核增协议', references: { contractId: 'old-main' }, amount: '100.00', deletedAt: null, attributes: { materialGraphJson: JSON.stringify(material.graphs.get('old-protocol')) } }] } } as Omit<CoreMigrationSourceDTO, 'sourceHash'>
  const source = { ...unsigned, sourceHash: createHash('sha256').update(coreMigrationSourceHashInput(unsigned)).digest('hex') }
  const owner = createMaterialContractCommandTestInstance()
  const core = createCoreMigrationTestInstance({ now: () => '2026-10-04T00:00:00.000Z', createServerId: row => `central-${row.entityType}-${row.legacyId}`, prepareTransition: (snapshot, _workspace, previous) => prepareCoreMigrationCommandSources(snapshot, [owner], [], previous) })
  const envelope = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY }
  const command = parseCoreMigrationSourceCommand({ ...envelope, commandId: 'preflight', backup: null, source })
  expect(command.source.sourceHash).toBe(source.sourceHash)
  await core.preflight(command, actor)
  const batch = await core.dryRun({ ...command, commandId: 'dry-run', backup: { backupId: `core-migration-${source.sourceHash}-${'b'.repeat(64)}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: 'b'.repeat(64), byteLength: 4096, createdAt: '2026-10-04T00:00:00.000Z', immutable: true } }, actor)
  const batchCommand = { ...envelope, batchId: batch.batchId, commandId: 'apply' }
  return { db, owner, core, source, bytes, batch, batchCommand }
}

it.each([49, 50, 51, 52, 53, 54, 55, 56])('真实 SQLite v%s 材采网络迁入保全主合同、协议和旧证据，重试不重复', async (version) => {
  const f = await fixture(version)
  try {
    expect(f.batch.issues.filter(isCoreMigrationBlockingIssue)).toEqual([])
    await f.core.importBatch(f.batchCommand, actor)
    await f.core.confirm({ ...f.batchCommand, commandId: 'confirm' }, actor)
    const main = 'central-material_contracts-old-main'
    const protocol = 'central-contract_supplements-old-protocol'
    expect(f.owner.form(main, actor).draft).toMatchObject({ id: main, amount: 4800, lineItems: [{ id: 'old-line', taxInclusiveUnitPrice: 20, materialGrade: '' }], deductions: version >= 50 ? [{ id: 'old-deduction', amount: 200 }] : [] })
    expect(f.owner.form(protocol, actor).draft).toMatchObject({ isSupplement: true, originalContractId: main, lineItems: version >= 50 ? [{ id: 'old-protocol-line', originalLineId: 'old-line', taxInclusiveUnitPrice: 21, changeAmount: 100 }] : [] })
    expect([...f.owner.file(protocol, 'old-original', actor).bytes]).toEqual([...f.bytes])
    expect(() => f.owner.file(main, 'old-missing', actor)).toThrow('仅有元数据')
    const evidence = f.owner.exportState().contracts.find(row => row.id === main)!.migrationEvidence!.sourceGraph!
    expect(evidence.audit).toMatchObject([{ id: 'old-audit', before_data: '{旧证据未解析}', after_data: '{真实原文}' }])
    if (version >= 50)
      expect(evidence.lines).toContainEqual(expect.objectContaining({ id: 'old-deleted-line', deleted_at: '2026-10-03T00:00:00.000Z' }))
    // 无原冻结证据的旧协议保持未知，不能给它编造中央版本1的原行快照。
    expect(f.owner.facts().supplements[0]!.originalLineSnapshots).toEqual([])
    const before = f.owner.exportState()
    f.owner.synchronizeMigrationSnapshot(f.core.snapshot(actor))
    expect(f.owner.exportState()).toEqual(before)
    const cold = createMaterialContractCommandTestInstance()
    cold.importState(before)
    expect([...cold.file(protocol, 'old-original', actor).bytes]).toEqual([...f.bytes])
    await f.core.rollback({ ...f.batchCommand, commandId: 'rollback' }, actor)
    expect(f.owner.rows()).toEqual([])
    expect(f.owner.exportState().contracts).toHaveLength(2)
    expect(f.owner.exportState().contracts.every(row => row.migrationRetired)).toBe(true)
  }
  finally { f.db.close() }
})

it.each([53, 54])('sQLite v%s 同图已采用主体保冻结版本与目录全历史，目录后来更名不改原合同', async (version) => {
  const f = await fixture(version, true)
  try {
    expect(f.batch.issues.filter(isCoreMigrationBlockingIssue)).toEqual([])
    await f.core.importBatch(f.batchCommand, actor)
    await f.core.confirm({ ...f.batchCommand, commandId: 'confirm-signatories' }, actor)
    const main = f.owner.form('central-material_contracts-old-main', actor).draft
    const protocol = f.owner.form('central-contract_supplements-old-protocol', actor).draft
    expect(main).toMatchObject({ ourSignatoryId: 'native-our-party', ourSignatoryVersion: '1', ourSignatorySnapshot: { name: '原核实我方公司', taxNo: 'ORIGINAL-TAX', verificationNote: '旧文书核实原文' }, legacyPartyA: '  旧文书甲方原文（未猜映射）  ' })
    expect(protocol.ourSignatorySnapshot).toEqual(main.ourSignatorySnapshot)
    const evidence = f.owner.exportState().contracts.find(row => row.id === main.id)!.migrationEvidence!.sourceGraph!
    expect(evidence.ourSignatoryEvidence).toMatchObject({ record: { id: 'native-our-party', version: 2 }, history: [{ id: 'native-our-party-v1', actor_id: null }, { id: 'native-our-party-v2', actor_id: null }] })
    const cold = createMaterialContractCommandTestInstance()
    cold.importState(f.owner.exportState())
    expect(cold.form(main.id!, actor).draft.ourSignatorySnapshot).toEqual(main.ourSignatorySnapshot)
    expect(cold.form(protocol.id!, actor).draft.ourSignatorySnapshot).toEqual(main.ourSignatorySnapshot)
    await f.db.execute('PRAGMA foreign_keys=OFF')
    await f.db.execute('UPDATE contracts SET our_signatory_id=\'nonexistent-party\' WHERE id=\'old-main\'')
    await expect(readMaterialContractGraphs(sql => f.db.select(sql), version)).rejects.toThrow('同图真实目录')
  }
  finally { f.db.close() }
})

it.each(['contract_line_items', 'contract_supplement_line_items', 'contract_deductions'])('旧 SQLite %s 孤儿不被过滤丢失，接管停止并保留原行', async (table) => {
  const f = await fixture()
  try {
    await f.db.execute('PRAGMA foreign_keys=OFF')
    if (table === 'contract_line_items')
      await f.db.execute('INSERT INTO contract_line_items(id,contract_id,material_name) VALUES(\'orphan-line\',\'missing-contract\',\'孤儿原文\')')
    else if (table === 'contract_supplement_line_items')
      await f.db.execute('INSERT INTO contract_supplement_line_items(id,supplement_id,material_name) VALUES(\'orphan-line\',\'missing-protocol\',\'孤儿原文\')')
    else
      await f.db.execute('INSERT INTO contract_deductions(id,contract_id,name,amount) VALUES(\'orphan-line\',\'missing-contract\',\'孤儿原文\',10)')
    await expect(readMaterialContractGraphs(sql => f.db.select(sql), 52)).rejects.toThrow('孤儿')
    expect(await f.db.select(`SELECT id FROM ${table} WHERE id='orphan-line'`)).toEqual([{ id: 'orphan-line' }])
  }
  finally { f.db.close() }
})

it('材采已有后来写入时整体回滚被拒；原协议和原件、原编号及历史仍可恢复', async () => {
  const f = await fixture()
  try {
    await f.core.importBatch(f.batchCommand, actor)
    await f.core.confirm({ ...f.batchCommand, commandId: 'confirm' }, actor)
    const id = 'central-material_contracts-old-main'
    const form = f.owner.form(id, actor)
    const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'material-contract:write' as const, commandId: 'later-write', id, baseVersion: form.version, action: 'draft' as const, attachments: {}, draft: { ...form.draft, content: '后来修改，旧证据必须保留' } }
    const saved = await f.owner.execute(request, actor)
    await expect(f.core.rollback({ ...f.batchCommand, commandId: 'rollback' }, actor)).rejects.toThrow('不能回滚')
    expect(f.core.snapshot(actor).authority).toBe('central')
    expect(f.owner.resolve(request.commandId, actor)).toEqual({ outcome: 'applied', result: saved })
    expect(f.owner.history(id, actor)).toMatchObject([{ version: 1, draft: { amount: 4800 }, commandId: 'later-write' }])
    expect([...f.owner.file('central-contract_supplements-old-protocol', 'old-original', actor).bytes]).toEqual([...f.bytes])
  }
  finally { f.db.close() }
})
