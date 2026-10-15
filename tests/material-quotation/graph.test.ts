import type { SQLInputValue } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { newQuotationDraft, quotationCommandKey } from '~/lib/material-quotation/contract'
import { exportQuotationGraph, quotationGraphHash, validateQuotationImportEvidence } from '~/lib/material-quotation/graph'
import { assertQuotationCoreMigrationGate } from '~/lib/material-quotation/migration-gate'
import { quotationPriceFacts } from '~/lib/material-quotation/price-facts'
import { ensureMaterialQuotationSchema } from '~/lib/material-quotation/schema-upgrade'
import { createQuotationOwner } from '~/lib/material-quotation/sqlite-owner'
import { createProductionMaterialQuotationOwner } from '../../server/utils/material-quotation-runtime'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'

async function fixture(related = false, sameIdentity = false) {
  const root = resolve('.tmp/a02-material-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'quotation-import-'))
  const raw = new DatabaseSync(join(directory, 'synthetic-source.sqlite'))
  raw.exec('PRAGMA foreign_keys=ON;CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);INSERT INTO schema_migrations VALUES(58);CREATE TABLE file_refs(id TEXT PRIMARY KEY,owner_type TEXT,owner_id TEXT,file_name TEXT,file_path TEXT,file_size INTEGER,mime_type TEXT,category TEXT,uploader TEXT,uploaded_at TEXT,deleted_at TEXT);CREATE TABLE file_payloads(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),encoding TEXT,content TEXT);')
  const source = createDbCoordinator(async () => ({ async execute(sql, params) {
    if (params)
      raw.prepare(sql).run(...params as SQLInputValue[])
    else
      raw.exec(sql)
  }, async select<T>(sql: string, params: unknown[] = []) {
    return raw.prepare(sql).all(...params as SQLInputValue[]) as T[]
  }, async close() {
    raw.close()
  } }))
  await source.withTransaction(ensureMaterialQuotationSchema)
  const sourceActor = { workspaceId: sameIdentity ? 'central-quote-workspace' : 'original-native-workspace', actorId: sameIdentity ? 'central-quote-owner' : 'original-native-actor', capabilities: ['material-quotation:read', 'material-quotation:write', 'project:list:read', 'supplier:list:read'] }
  const sourceOwner = createQuotationOwner({ ...source, identity: sourceActor, assertBusinessWrite() {
  } }, { payloadMode: 'native', references: async () => ({ projects: [{ id: 'native-project-id', name: '原项目' }], suppliers: [{ id: 'native-supplier-id', name: '原分供方' }] }) })
  const draft = { ...newQuotationDraft(), ...(related ? { scope: 'project' as const, projectId: 'native-project-id', supplierId: 'native-supplier-id' } : {}), partyName: '未建档原文', lines: [{ ...newQuotationDraft().lines[0]!, name: '原材料', unit: '米', unitPrice: 0, taxRate: null }] }
  const saved = await sourceOwner.execute({ workspaceId: sourceActor.workspaceId, actorId: sourceActor.actorId, requiredCapability: 'material-quotation:write', commandId: 'original-native-quote-command', baseVersion: null, action: 'save', draft, attachments: { add: [{ fileName: '原报价.txt', fileSize: 3, payloadBase64: 'YWJj' }] } }, () => sourceActor)
  if (sameIdentity)
    await source.execute('INSERT INTO quotation_imports VALUES(?,?,?,?,NULL,NULL,NULL,NULL,NULL,?)', [JSON.stringify([sourceActor.workspaceId, sourceActor.actorId, 'material-quotation-import', 'native-previous-import-key']), 'native-previous-import-key', sourceActor.workspaceId, sourceActor.actorId, '2026-10-05T00:00:00.000Z'])
  const graph = await source.withTransaction(tx => exportQuotationGraph(tx, 'native'))
  const graphHash = await quotationGraphHash(graph)
  const targetDirectory = join(directory, 'target')
  await mkdir(targetDirectory)
  const target = await createSeededProductionStorage({ directory: targetDirectory, workspaceId: 'central-quote-workspace', ownerId: 'central-quote-owner', purpose: 'verification' })
  const actor = { workspaceId: 'central-quote-workspace', actorId: 'central-quote-owner', capabilities: ['material-quotation:read', 'material-quotation:write', 'core:migration:write', 'project:list:read', 'supplier:list:read', 'project:write', 'supplier:write', 'customer:list:read', 'customer:write'] }
  const owner = createProductionMaterialQuotationOwner(target)
  const bytes = await readFile(join(directory, 'synthetic-source.sqlite'))
  const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'core:migration:write', commandId: 'quote-import-original', batchId: 'quote-batch-original', graphHash, graph, source: { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }, bindings: [] }
  return { directory, source, sourceActor, sourceOwner, target, owner, actor, request, saved, graph, graphHash }
}
it('完整图迁入保原ID/body/history/来源原键，实际同owner回执冷恢复；备份允许仅验证过的来源key', async () => {
  const f = await fixture()
  try {
    const result = await f.owner.importGraph(f.request, () => f.actor)
    expect(result.importedIds).toEqual([f.saved.id])
    expect(await f.owner.importGraph(f.request, () => f.actor)).toEqual(result)
    await f.target.close()
    expect(await f.owner.resolveImport(f.request.commandId, () => f.actor)).toEqual({ outcome: 'applied', result })
    const record = (await f.owner.read(() => f.actor)).records[0]!
    expect(record.id).toBe(f.saved.id)
    expect(record.history[0]!.actorId).toBe(f.sourceActor.actorId)
    expect(record.draft).toEqual(f.graph.tables.material_quotations[0] ? JSON.parse(String(f.graph.tables.material_quotations[0]!.draft_json)) : null)
    expect((await f.owner.original(f.saved.id, f.saved.attachmentIds[0]!, () => f.actor, '1')).payloadBase64).toBe('YWJj')
    const allowed = await f.target.withTransaction(tx => validateQuotationImportEvidence(tx, f.target.identity))
    expect([...allowed]).toEqual([quotationCommandKey('original-native-quote-command', f.sourceActor)])
    expect(await f.owner.resolve('original-native-quote-command', () => f.actor)).toEqual({ outcome: 'not-applied', commandId: 'original-native-quote-command' })
    const evidence = await f.target.select<{
      graph_json: string
    }>('SELECT graph_json FROM quotation_imports WHERE batch_id=?', [f.request.batchId])
    expect(JSON.parse(evidence[0]!.graph_json).graph.originals).toEqual([{ fileId: f.saved.attachmentIds[0], sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }])
    expect(JSON.parse(evidence[0]!.graph_json).sourceSnapshotSha256).toBe(f.request.source.sha256)
    const backup = join(f.directory, 'verified-copy.sqlite')
    await f.target.backupTo(backup)
    const inventory = await inspectProductionBackup(backup)
    expect(inventory.participants['material-quotations']?.tables).toContain('quotation_imports')
    expect(inventory.tables.material_quotation_history?.rows).toBe(1)
    expect(inventory.originals).toEqual({ files: 1, bytes: 3 })
  }
  finally {
    await f.source.close()
    await f.target.close()
  }
})
it('原Native actor/workspace字符串碰巧同中央仍只是来源证据，不授权新提交/恢复或清理当前输入', async () => {
  const f = await fixture(false, true)
  try {
    await f.owner.importGraph(f.request, () => f.actor)
    const original = JSON.parse(String(f.graph.tables.material_quotation_commands[0]!.request_json))
    await expect(f.owner.resolve(original.commandId, () => f.actor)).rejects.toThrow('迁入来源的历史命令')
    await expect(f.owner.execute(original, () => f.actor)).rejects.toThrow('迁入来源的历史命令')
    await expect(f.owner.resolveImport('native-previous-import-key', () => f.actor)).rejects.toThrow('原来源历史')
    await expect(f.owner.importGraph({ ...f.request, commandId: 'native-previous-import-key' }, () => f.actor)).rejects.toThrow('原来源历史')
    expect((await f.owner.read(() => f.actor)).records[0]!.history[0]!.commandId).toBe(original.commandId)
    const next = { ...original, commandId: 'actual-new-central-command', id: f.saved.id, baseVersion: '1', draft: { ...original.draft, note: '明确新的中央修订' }, attachments: {} }
    expect(await f.owner.execute(next, () => f.actor)).toMatchObject({ id: f.saved.id, commandId: next.commandId, version: '2' })
    expect(await f.owner.resolve(next.commandId, () => f.actor)).toMatchObject({ outcome: 'applied', result: { commandId: next.commandId, version: '2' } })
    expect((await f.sourceOwner.read(() => f.sourceActor)).records[0]!.history).toHaveLength(1)
  }
  finally {
    await f.source.close()
    await f.target.close()
  }
})
it('损坏body/关联身份/后迟到已封存图均原子拒绝，源图与目标原件完整保持', async () => {
  const f = await fixture()
  try {
    const bad = structuredClone(f.graph)
    bad.originals[0]!.payloadBase64 = 'eHl6'
    // 原断言保护原件正文摘要。现在完整 SQLite 与请求图独立对账先行拒绝，仍验证无任何行/原件写入。
    await expect(f.owner.importGraph({ ...f.request, graph: bad, graphHash: await quotationGraphHash(bad) }, () => f.actor)).rejects.toThrow('逐字段')
    expect((await f.owner.read(() => f.actor)).records).toEqual([])
    expect(await f.target.select('SELECT COUNT(*) AS n FROM file_refs')).toEqual([{ n: 0 }])
    expect((await f.sourceOwner.read(() => f.sourceActor)).records[0]!.id).toBe(f.saved.id)
    expect(await f.owner.resolveImport(f.request.commandId, () => f.actor)).toEqual({ outcome: 'not-applied', commandId: f.request.commandId })
    await expect(f.owner.importGraph(f.request, () => f.actor)).rejects.toThrow('迟到')
    const related = structuredClone(f.graph)
    related.tables.material_quotations[0]!.project_id = 'unverified-project'
    await expect(f.owner.importGraph({ ...f.request, commandId: 'quote-other-import', graph: related, graphHash: await quotationGraphHash(related) }, () => f.actor)).rejects.toThrow('逐字段')
    expect((await f.owner.read(() => f.actor)).records).toEqual([])
  }
  finally {
    await f.source.close()
    await f.target.close()
  }
})
it('明确选择真实跨ID对应并封存在同回执，冷开后只投影关联，原历史/回执/原件和真实零不改写', async () => {
  const f = await fixture(true)
  try {
    const session = () => f.actor
    const identity = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId }
    const customer = await createProductionCustomerService(f.target).execute({ ...identity, requiredCapability: 'customer:write', commandId: 'quote-map-customer', baseVersion: null, action: 'save', draft: { name: '映射真实客户', contact: '真实联系人' }, attachments: {} }, session)
    const common = { customerId: customer.id, manager: '真实经理' }
    const project = await createProductionProjectService(f.target).execute({ ...identity, requiredCapability: 'project:write', commandId: 'quote-map-project', baseVersion: null, action: 'save', draft: { ...common, name: '真实目标项目', code: 'MQ001' }, attachments: {} }, session)
    const supplier = await createProductionSupplierService(f.target).execute({ ...identity, requiredCapability: 'supplier:write', commandId: 'quote-map-supplier', baseVersion: null, action: 'save', draft: { name: '真实目标分供方', supplierCategory: '其他', contact: '实际联系人' }, attachments: {} }, session)
    const context = await f.owner.importContext(session)
    const bindings = context.references.map(row => ({ ...row, legacyId: row.entityType === 'projects' ? 'native-project-id' : 'native-supplier-id', confirmedBy: f.actor.actorId }))
    await expect(f.owner.importGraph(f.request, session)).rejects.toThrow('每个来源')
    await expect(f.owner.importGraph({ ...f.request, bindings: bindings.map(row => ({ ...row, confirmedBy: 'another-actor' })) }, session)).rejects.toThrow('每个来源')
    await expect(f.owner.importGraph({ ...f.request, bindings: bindings.map(row => ({ ...row, version: '999' })) }, session)).rejects.toThrow('目录版本已变化')
    await expect(f.owner.importGraph({ ...f.request, source: { ...f.request.source, sha256: 'f'.repeat(64) }, bindings }, session)).rejects.toThrow('摘要不一致')
    expect((await f.owner.read(session)).records).toEqual([])
    const result = await f.owner.importGraph({ ...f.request, bindings }, session)
    await f.target.close()
    const record = (await f.owner.read(session)).records[0]!
    expect(record.draft).toMatchObject({ projectId: 'native-project-id', supplierId: 'native-supplier-id' })
    expect(record.relations).toEqual([{ version: '1', projectId: project.id, supplierId: supplier.id, importBatchId: result.batchId, sourceSnapshotSha256: f.request.source.sha256 }])
    const meta = { records: [record] } as Parameters<typeof quotationPriceFacts>[0]
    expect(quotationPriceFacts(meta)[0]).toMatchObject({ projectId: project.id, supplierId: supplier.id, line: { unitPrice: 0, taxRate: null } })
    const rawDraft = structuredClone(record.draft)
    await f.owner.execute({ ...identity, requiredCapability: 'material-quotation:write', commandId: 'central-edit-adopt-binding', id: record.id, baseVersion: '1', action: 'save', draft: { ...rawDraft, projectId: project.id, supplierId: supplier.id, note: '明确采用当前关联' }, attachments: {} }, session)
    const changed = (await f.owner.read(session)).records[0]!
    expect(changed.history[0]!.draft).toEqual(rawDraft)
    expect(changed.history[1]!.draft).toMatchObject({ projectId: project.id, supplierId: supplier.id })
    expect(changed.relations).toHaveLength(1)
    expect((await f.owner.original(record.id, f.saved.attachmentIds[0]!, session, '1')).payloadBase64).toBe('YWJj')
    expect((await f.sourceOwner.read(() => f.sourceActor)).records[0]!.history).toHaveLength(1)
    const backup = join(f.directory, 'mapped-verified-copy.sqlite')
    await f.target.backupTo(backup)
    expect((await inspectProductionBackup(backup)).originals).toEqual({ files: 1, bytes: 3 })
  }
  finally {
    await f.source.close()
    await f.target.close()
  }
})
it('非空v58源在prepare/backup/switch门禁只认可实际完整图摘要，未知或不同摘要不算确认', async () => {
  const f = await fixture()
  try {
    await expect(assertQuotationCoreMigrationGate(58, f.source.select, async () => false)).rejects.toThrow('尚未完整迁入')
    const result = await f.owner.importGraph(f.request, () => f.actor)
    await assertQuotationCoreMigrationGate(58, f.source.select, async hash => (await f.owner.imports(() => f.actor)).some(row => row.graphHash === hash && row.batchId === result.batchId))
    await expect(assertQuotationCoreMigrationGate(58, f.source.select, async hash => hash === '0'.repeat(64))).rejects.toThrow('尚未完整迁入')
    expect((await f.sourceOwner.read(() => f.sourceActor)).records[0]!.id).toBe(f.saved.id)
  }
  finally {
    await f.source.close()
    await f.target.close()
  }
})
