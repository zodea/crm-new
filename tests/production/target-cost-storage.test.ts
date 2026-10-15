import type { TargetCostAction, TargetCostCommand, TargetCostFormRead } from '../../app/lib/target-cost/central-contract'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { budgetBytesDigest } from '../../server/utils/production-target-cost-files'
import { createProductionBudgetMigration } from '../../server/utils/production-target-cost-migration'
import { createProductionTargetCostService } from '../../server/utils/production-target-cost-service'
import { runColdProcess } from '../helpers/cold-process'
import { createMigratedMemoryDb } from '../helpers/memory-db'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})
async function fixture() {
  const base = resolve('.tmp/opt-02/target-cost-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/budget-`)
  const options = { directory, workspaceId: 'budget-workspace', ownerId: 'budget-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  closers.push(() => storage.close())
  let actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['target-cost:read', 'target-cost:write', 'target-cost:import', 'project:list:read', 'project:write'] }
  const session = () => structuredClone(actor)
  const project = await createProductionProjectService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'budget-project-create', requiredCapability: 'project:write', baseVersion: null, action: 'draft', draft: { name: '正式预算项目', code: 'BP' }, attachments: {} }, session)
  const service = createProductionTargetCostService(storage)
  let sequence = 0
  const command = (read: TargetCostFormRead, action: TargetCostAction): TargetCostCommand => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, origin: 'real', requiredCapability: 'target-cost:write', commandId: `budget-command-${++sequence}`, targetCostId: read.targetCostId, draftKey: read.draftKey ?? undefined, sourceVersion: read.context.sourceVersion, action })
  const create = async (name: string, baseline = false) => service.execute(command(await service.form({ origin: 'real' }, null, `budget-draft-${++sequence}`, session), { kind: 'save-header', saveAction: 'draft', draft: { name, projectId: project.id, isBaseline: baseline, taxInclusiveTotal: null, taxAmount: 0 } }), session)
  return { storage, options, directory, actor, session, project, service, command, create, migration: createProductionBudgetMigration(storage), setActor: (next: typeof actor) => {
    actor = next
  } }
}
async function nativeSource(external = false) {
  const db = await createMigratedMemoryDb()
  await db.execute('INSERT INTO projects(id,name) VALUES (\'legacy-budget-project\',\'原预算项目\')')
  await db.execute('ALTER TABLE target_costs ADD COLUMN unknown_extension TEXT')
  await db.execute('ALTER TABLE target_costs ADD COLUMN integer_extension INTEGER')
  await db.execute('ALTER TABLE target_costs ADD COLUMN blob_extension BLOB')
  await db.execute('ALTER TABLE target_cost_items ADD COLUMN extension_json TEXT')
  for (const id of ['budget-source-a', 'budget-source-b']) {
    await db.execute('INSERT INTO target_costs(id,project_id,name,contract_revenue,tax_amount,unknown_extension) VALUES (?,\'legacy-budget-project\',?,NULL,0,?)', [id, id, '{"text":"legacy-budget-project","nested":{"keep":true}}'])
    await db.execute('INSERT INTO target_cost_items(id,target_cost_id,cost_category,item_name,qty,unit_price,amount,extension_json) VALUES (?,?,\'材料\',NULL,NULL,0,0,?)', [`${id}-item`, id, '{"future":7}'])
  }
  await db.execute('UPDATE target_costs SET integer_extension=CAST(\'9223372036854775807\' AS INTEGER),blob_extension=x\'0080FF\'')
  await db.execute('CREATE TABLE unrelated_private_domain(secret TEXT)')
  await db.execute('INSERT INTO unrelated_private_domain VALUES (\'DO_NOT_PERSIST_OTHER_DOMAIN_PRIVATE_FACT\')')
  await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES (\'budget-embedded\',\'target_cost\',\'budget-source-a\',\'原预算.txt\',\'\',3,\'text/plain\')')
  await db.execute('INSERT INTO file_payloads VALUES (\'budget-embedded\',\'base64\',\'YWJj\')')
  await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,uploaded_at) VALUES (\'budget-metadata-only\',\'target_cost\',\'budget-source-b\',NULL,\'\',NULL,NULL)')
  await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,after_data,operator) VALUES (\'budget-source-log\',\'target_cost_items\',\'budget-source-a-item\',\'update\',NULL,?,NULL)', [JSON.stringify({ id: 'budget-source-a-item', target_cost_id: 'budget-source-a', item_name: null, amount: 0, note: 'unknown JSON preserved' })])
  if (external)
    await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size) VALUES (\'budget-external-original\',\'target_cost\',\'budget-source-a\',\'外部原件.bin\',\'D:/原预算/外部原件.bin\',4)')
  const bytes = db.raw.export()
  db.close()
  return { bytes, source: { sha256: budgetBytesDigest(bytes), payloadBase64: Buffer.from(bytes).toString('base64') } }
}

it('预算头、科目、原件与原编号在独立进程冷恢复；GET不建表或修改事实', async () => {
  const f = await fixture()
  const initial = await f.service.form({ origin: 'real' }, null, 'cold-budget-draft', f.session)
  const request = f.command(initial, { kind: 'save-header', saveAction: 'draft', draft: { name: '原冷恢复预算', projectId: f.project.id, taxInclusiveTotal: null, taxAmount: 0 }, files: { add: [{ fileName: '预算原件.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] } })
  const saved = await f.service.execute(request, f.session)
  const items = f.command(await f.service.form({ origin: 'real' }, saved.id, undefined, f.session), { kind: 'save-items', items: [{ category: '材料', itemName: '真实零与未知', qty: null, unitPrice: 0, amount: 0 }] })
  await f.service.execute(items, f.session)
  expect(await f.service.execute(request, f.session)).toEqual(saved)
  await expect(f.service.execute({ ...request, action: { kind: 'delete' } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  const change = async () => (await f.storage.select<{ n: number }>('SELECT total_changes() AS n'))[0]!.n
  const before = await change()
  const detail = await f.service.detail({ origin: 'real' }, saved.id, f.session)
  expect(detail.view.header).toMatchObject({ taxInclusiveTotal: null, taxAmount: 0 })
  expect(detail.view.items).toMatchObject([{ qty: null, unitPrice: 0, amount: 0 }])
  expect(await change()).toBe(before)
  const absent = await f.service.resolve({ ...f.actor, commandId: 'budget-not-applied' }, f.session)
  expect(absent).toMatchObject({ outcome: 'not-applied' })
  await expect(f.service.execute({ ...request, commandId: 'budget-not-applied' }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  await f.storage.close()
  const output = resolve(f.directory, 'cold-result.json')
  await runColdProcess('production-target-cost-cold', [f.directory, saved.id, request.commandId, saved.attachmentIds[0]!, output])
  const restored = JSON.parse(await readFile(output, 'utf8'))
  expect(restored.header).toMatchObject({ name: '原冷恢复预算', taxInclusiveTotal: null, taxAmount: 0 })
  expect(restored.items).toMatchObject([{ qty: null, unitPrice: 0, amount: 0 }])
  expect(restored.resolution).toEqual({ outcome: 'applied', result: saved })
  expect(restored.file).toMatchObject({ payloadBase64: 'YWJj', sha256: budgetBytesDigest(Buffer.from('abc')) })
})

it('保存只核本预算和实际项目/基线；其他预算及无关项目变化不冲突，同目标变化仍拒绝', async () => {
  const f = await fixture()
  const a = await f.create('A')
  const old = await f.service.form({ origin: 'real' }, a.id, undefined, f.session)
  await f.create('B')
  const projectService = createProductionProjectService(f.storage)
  const currentProject = await projectService.form(f.project.id, f.session)
  const { id: _projectId, ...projectDraft } = currentProject.draft
  await projectService.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, id: f.project.id, commandId: 'budget-unrelated-project-display', requiredCapability: 'project:write', baseVersion: currentProject.version, action: 'draft', draft: { ...projectDraft, name: '只改显示名' }, attachments: {} }, f.session)
  await f.service.execute(f.command(old, { kind: 'save-items', items: [{ category: '材料', itemName: '不受无关变更影响', amount: 10 }] }), f.session)
  await expect(f.service.execute(f.command(old, { kind: 'save-items', items: [] }), f.session)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
  const baselineRead = await f.service.form({ origin: 'real' }, a.id, undefined, f.session)
  await f.create('后来基线', true)
  await expect(f.service.execute(f.command(baselineRead, { kind: 'save-header', saveAction: 'draft', draft: { ...baselineRead.draft, isBaseline: true } }), f.session)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
  await f.service.execute(f.command(baselineRead, { kind: 'save-items', items: [] }), f.session)
})

it('真实完整SQLite迁入保原ID、未知扩展、空元数据、原件、原JSON与审计；重复确认保后来更正并整批拒绝危险恢复', async () => {
  const f = await fixture()
  const native = await nativeSource()
  const command = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'budget-native-adopt', source: native.source, mappings: [{ legacyProjectId: 'legacy-budget-project', projectId: f.project.id, version: '1' }] }
  const preview = await f.migration.preflight(command, f.session)
  expect(preview.versions.map(row => row.id)).toEqual(['budget-source-a', 'budget-source-b'])
  const result = await f.migration.adopt(command, f.session)
  const details = await f.service.detail({ origin: 'real' }, 'budget-source-b', f.session)
  expect(details.files).toMatchObject([{ id: 'budget-metadata-only', fileSize: null, uploadedAt: null, payloadState: 'missing' }])
  expect(details.view.items).toMatchObject([{ id: 'budget-source-b-item', itemName: '', qty: null, unitPrice: 0, amount: 0 }])
  const stored = (await f.storage.select<{ source_sha256: string, evidence_json: string }>('SELECT source_sha256,evidence_json FROM target_cost_imports WHERE id=?', [result.importId]))[0]!
  expect(stored.source_sha256).toBe(budgetBytesDigest(native.bytes))
  expect(Buffer.from(command.source.payloadBase64, 'base64')).toEqual(Buffer.from(native.bytes))
  expect(await f.storage.select('SELECT name FROM pragma_table_info(\'target_cost_imports\') WHERE lower(type)=\'blob\'')).toEqual([])
  expect(stored.evidence_json).not.toContain('DO_NOT_PERSIST_OTHER_DOMAIN_PRIVATE_FACT')
  expect(stored.evidence_json).not.toContain(command.source.payloadBase64)
  expect(JSON.parse(stored.evidence_json).heads[0].unknown_extension).toBe('{"text":"legacy-budget-project","nested":{"keep":true}}')
  expect(JSON.parse(stored.evidence_json).items[0].extension_json).toBe('{"future":7}')
  expect(JSON.parse(stored.evidence_json).heads[0].integer_extension).toEqual({ sqliteType: 'integer', text: '9223372036854775807' })
  expect(JSON.parse(stored.evidence_json).heads[0].blob_extension).toEqual({ sqliteType: 'blob', hex: '0080FF' })
  expect(JSON.parse(stored.evidence_json).extensions.target_costs.rows['budget-source-a'].integer_extension).toEqual({ storage_type: 'integer', exact_value: '9223372036854775807' })
  expect((await f.service.detail({ origin: 'real' }, 'budget-source-a', f.session)).history).toMatchObject([{ id: 'budget-source-log', operator: null }])
  const old = await f.service.form({ origin: 'real' }, 'budget-source-a', undefined, f.session)
  await f.service.execute(f.command(old, { kind: 'save-header', saveAction: 'draft', draft: { ...old.draft, name: '后来正式更正' } }), f.session)
  expect(await f.migration.adopt({ ...command, commandId: 'budget-native-repeat' }, f.session)).toMatchObject({ importId: result.importId })
  expect((await f.service.form({ origin: 'real' }, 'budget-source-a', undefined, f.session)).draft.name).toBe('后来正式更正')
  await expect(f.migration.restore({ ...f.actor, commandId: 'budget-dangerous-restore', importId: result.importId }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  expect((await f.service.list({ origin: 'real' }, f.session)).rows.map(row => row.id).sort()).toEqual(result.ids)
  await f.storage.close()
  expect((await f.service.form({ origin: 'real' }, 'budget-source-a', undefined, f.session)).draft.name).toBe('后来正式更正')
  expect((await f.service.file({ origin: 'real' }, 'budget-source-a', 'budget-embedded', f.session)).content).toMatchObject({ payloadBase64: 'YWJj' })
}, 15000)

it('未变更迁入仅退役本批预算且保原库与唯一原件；坏字节、错映射、撤权及跨来源整批拒绝', async () => {
  const f = await fixture()
  const native = await nativeSource()
  const command = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'budget-clean-adopt', source: native.source, mappings: [{ legacyProjectId: 'legacy-budget-project', projectId: f.project.id, version: '1' }] }
  await expect(f.migration.adopt({ ...command, source: { ...native.source, sha256: '0'.repeat(64) } }, f.session)).rejects.toThrow('摘要')
  await expect(f.migration.adopt({ ...command, mappings: [{ ...command.mappings[0]!, version: '99' }] }, f.session)).rejects.toThrow('真实版本')
  expect((await f.service.list({ origin: 'real' }, f.session)).rows).toEqual([])
  const imported = await f.migration.adopt(command, f.session)
  const restored = await f.migration.restore({ ...f.actor, commandId: 'budget-clean-restore', importId: imported.importId }, f.session)
  expect(restored.restored).toBe(true)
  expect((await f.service.list({ origin: 'real' }, f.session)).rows).toEqual([])
  expect(await f.storage.select('SELECT id FROM target_cost_imports')).toMatchObject([{ id: imported.importId }])
  expect((await f.storage.select<{ content: Uint8Array }>('SELECT content FROM file_payloads WHERE file_ref_id=\'budget-embedded\''))[0]!.content).toEqual(new Uint8Array([97, 98, 99]))
  await expect(f.service.list({ origin: 'demo' }, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  f.setActor({ ...f.actor, capabilities: [] })
  await expect(f.service.list({ origin: 'real' }, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
})

it('真实外部原件必须补齐，失败整批回滚；安全恢复后唯一BLOB与原路径审计保留', async () => {
  const f = await fixture()
  const native = await nativeSource(true)
  const command = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'budget-external-adopt', source: native.source, mappings: [{ legacyProjectId: 'legacy-budget-project', projectId: f.project.id, version: '1' }] }
  expect((await f.migration.preflight(command, f.session)).requiredOriginals).toMatchObject([{ id: 'budget-external-original' }])
  await expect(f.migration.adopt(command, f.session)).rejects.toThrow('补齐真实原件')
  expect(await f.storage.select('SELECT id FROM target_costs')).toEqual([])
  const adopted = await f.migration.adopt({ ...command, commandId: 'budget-external-supplied', originals: [{ fileId: 'budget-external-original', payloadBase64: 'AAqA/w==' }] }, f.session)
  await f.migration.restore({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'budget-external-retire', importId: adopted.importId }, f.session)
  await f.storage.close()
  const row = (await f.storage.select<{ content: Uint8Array, original_metadata_json: string }>('SELECT p.content,b.original_metadata_json FROM file_payloads p JOIN target_cost_files b ON b.file_ref_id=p.file_ref_id WHERE p.file_ref_id=?', ['budget-external-original']))[0]!
  expect([...row.content]).toEqual([0, 10, 128, 255])
  expect(JSON.parse(row.original_metadata_json).file_path).toBe('D:/原预算/外部原件.bin')
  expect((await f.service.list({ origin: 'real' }, f.session)).rows).toEqual([])
}, 15000)

it('明确映射已删除正式项目只接续历史关系，不复制或复活主档', async () => {
  const f = await fixture()
  await createProductionProjectService(f.storage).executeLifecycle({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'budget-project-soft-delete', requiredCapability: 'project:write', id: f.project.id, baseVersion: '1', action: 'delete' }, f.session)
  const native = await nativeSource()
  const command = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'budget-history-project', source: native.source, mappings: [{ legacyProjectId: 'legacy-budget-project', projectId: f.project.id, version: '2' }] }
  expect((await f.migration.preflight(command, f.session)).projects).toMatchObject([{ id: f.project.id, deletedAt: expect.any(String) }])
  const adopted = await f.migration.adopt(command, f.session)
  expect((await f.storage.select<{ deleted_at: string | null }>('SELECT deleted_at FROM projects WHERE id=?', [f.project.id]))[0]!.deleted_at).not.toBeNull()
  expect(await f.storage.select('SELECT id,project_id FROM target_costs ORDER BY id')).toEqual(adopted.ids.map(id => ({ id, project_id: f.project.id })))
  expect((await f.service.list({ origin: 'real' }, f.session)).rows).toEqual([])
  await expect(f.service.detail({ origin: 'real' }, 'budget-source-a', f.session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
}, 15000)
