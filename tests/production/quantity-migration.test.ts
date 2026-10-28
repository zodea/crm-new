import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import { createProductionQuantityImport, readProductionQuantityImportedIdentities } from '../../server/utils/production-quantity-migration'
import { createProductionQuantityService } from '../../server/utils/production-quantity-service'
import { validateProductionQuantityState } from '../../server/utils/production-quantity-validation'
import { createProductionStorage } from '../../server/utils/production-storage'
import { runColdProcess } from '../helpers/cold-process'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { seedQuantityNativeRows } from '../helpers/quantity-migration-source'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('真实完整SQLite只读核验，本域原JSON/未知整数+BLOB/零与缺失及历史照片只存自身证据和共享原件', async () => {
  const source = await createMigratedMemoryDb()
  await seedQuantityNativeRows(source)
  await source.execute('ALTER TABLE items ADD COLUMN future_integer INTEGER')
  await source.execute('ALTER TABLE items ADD COLUMN future_binary BLOB')
  await source.execute('UPDATE items SET future_integer=9223372036854775807,future_binary=X\'00FF0011\' WHERE id=\'q-item\'')
  const [nativeAudit] = await source.select<{ id: string, after_data: string }>('SELECT id,after_data FROM operation_logs WHERE id=\'q-audit\'')
  const originalJson = `${nativeAudit!.after_data.slice(0, -1)},"futureExtension":{"count":9223372036854775807}}`
  await source.execute('UPDATE operation_logs SET after_data=? WHERE id=?', [originalJson, nativeAudit!.id])
  const bytes = source.raw.export()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const base = testTempRoot('opt02-quantity-migration')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'quantity-workspace', ownerId: 'quantity-owner', purpose: 'verification' })
  const actor = { workspaceId: 'quantity-workspace', actorId: 'quantity-owner', capabilities: ['quantity:read', 'quantity:write', 'worker:list:read', 'crew:list:read', 'worker:sensitive:read', 'project:list:read', 'core:migration:write'] }
  try {
    const now = '2026-10-07T08:00:00.000Z'
    await storage.withTransaction(async (db) => {
      await db.execute('INSERT INTO projects(id,name,code,draft_json,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)', ['quantity-project', '正式目标项目', 'TARGET', JSON.stringify({ name: '正式目标项目', code: 'TARGET' }), now, now])
      await db.execute('INSERT INTO crews(id,record_json) VALUES (?,?)', ['quantity-crew', JSON.stringify({ id: 'quantity-crew', version: 1, updatedAt: now, draft: { id: 'quantity-crew', name: '已确认正式班组', trade: '油漆工' } })])
    })
    const owner = createProductionQuantityImport(storage)
    const input = { commandId: 'quantity-source-adoption', workspaceId: actor.workspaceId, actorId: actor.actorId, action: 'adopt' as const, source: { sha256, payloadBase64: Buffer.from(bytes).toString('base64') }, projects: [{ legacyId: 'q-project', projectId: 'quantity-project', version: '1' }], people: [{ kind: 'crew' as const, legacyId: 'q-crew', id: 'quantity-crew', version: '1' }] }
    const result = await owner.execute(input, () => actor)
    expect(await owner.execute(input, () => actor)).toEqual(result)
    expect(source.raw.export()).toEqual(bytes)
    const identities = await storage.withTransaction(tx => readProductionQuantityImportedIdentities(tx, sha256, actor))
    const unit = identities.find(row => row.table === 'units' && row.legacyId === 'q-unit')!
    const completion = identities.find(row => row.table === 'unit_stage_completions' && row.legacyId === 'q-done')!
    const photo = identities.find(row => row.table === 'file_refs' && row.legacyId === 'q-photo')!
    const service = createProductionQuantityService(storage).forSession(() => actor)
    const query = { projectId: 'quantity-project', origin: 'real' as const, includeDemo: false }
    const image = await service.photo({ ...query, unitId: unit.id, completionId: completion.id, photoId: photo.id })
    expect(image.data.contentBase64).toBe('AQID')
    const templates = await service.templates(query)
    expect(templates.data.lines).toEqual(expect.arrayContaining([expect.objectContaining({ recognizedContractQty: 8, contractQty: 0, provisionalQty: 6, fieldQty: null })]))
    const actual = await service.completion({ ...query, unitId: unit.id })
    expect(actual.data.planWindow).toBeNull()
    expect(actual.data.stages).toEqual(expect.arrayContaining([expect.objectContaining({ quantities: expect.arrayContaining([expect.objectContaining({ recognizedContractQty: 8, contractQty: 0, provisionalQty: 6, fieldQty: null })]), photos: [expect.objectContaining({ id: photo.id })], completion: expect.objectContaining({ id: completion.id }) })]))
    await expect(service.boq(query)).rejects.toThrow()
    await storage.withTransaction(async (db) => {
      const columns = await db.select<{ name: string }>('PRAGMA table_info(quantity_source_imports)')
      expect(columns.map(row => row.name)).not.toContain('source_bytes')
      const [record] = await db.select<{ evidence_json: string }>('SELECT evidence_json FROM quantity_source_imports WHERE source_sha256=?', [sha256])
      expect(record!.evidence_json).not.toContain(input.source.payloadBase64)
      const evidence = JSON.parse(record!.evidence_json)
      const item = evidence.rawDomain.items.find((row: { legacyId: string }) => row.legacyId === 'q-item')
      expect(item.columns.future_integer).toMatchObject({ sqliteType: 'integer', exactValue: '9223372036854775807' })
      expect(item.columns.future_binary).toMatchObject({ sqliteType: 'blob', exactValue: '00FF0011' })
      expect(evidence.rawDomain.operation_logs.find((row: { legacyId: string }) => row.legacyId === nativeAudit!.id).columns.after_data.exactValue).toBe(originalJson)
      const body = evidence.rawDomain.file_payloads.find((row: { legacyId: string }) => row.legacyId === 'q-photo')
      expect(body.columns.content).toMatchObject({ sharedOriginal: photo.id, sha256: image.data.sha256 })
      const writes: string[] = []
      await validateProductionQuantityState({ select: db.select, execute: async (sql) => {
        writes.push(sql)
      } })
      expect(writes).toEqual([])
      const [intent] = await db.select<{ request_json: string }>('SELECT request_json FROM quantity_command_intents WHERE command_id=?', [input.commandId])
      expect(JSON.parse(intent!.request_json)).toMatchObject({ family: 'quantity-import', source: { sha256 }, projects: input.projects, people: input.people })
      expect(intent!.request_json).not.toContain(input.source.payloadBase64)
    })
    await storage.close()
    const child = await runColdProcess('production-quantity-import-cold-process', [], { env: { ...process.env, CRM_QUANTITY_COLD_DIRECTORY: directory, CRM_QUANTITY_IMPORT_SHA: sha256, CRM_QUANTITY_IMPORT_COMMAND: input.commandId } })
    expect(JSON.parse(child.stdout)).toMatchObject({ recovered: { outcome: 'applied', result }, identities: expect.arrayContaining([unit, completion, photo]), valid: true })
    const reopened = createProductionStorage({ directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
    try {
      const imported = createProductionQuantityImport(reopened)
      await reopened.withTransaction(async (tx) => {
        await tx.execute('CREATE TABLE schedule_fixture_history(id TEXT,snapshot_json TEXT,deleted_at TEXT)')
        await tx.execute('INSERT INTO schedule_fixture_history VALUES (?,?,?)', ['frozen-old-plan', JSON.stringify({ originalUnit: unit.id }), '2026-10-07T10:00:00.000Z'])
      })
      await expect(imported.restore({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'quantity-dangerous-restore', importId: result.importId }, () => actor)).rejects.toThrow('整批恢复')
      expect(await reopened.select('SELECT * FROM quantity_import_restores')).toEqual([])
      await reopened.execute('DROP TABLE schedule_fixture_history')
      const restored = await imported.restore({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'quantity-safe-restore', importId: result.importId }, () => actor)
      expect(restored).toMatchObject({ outcome: 'restored', preservedOriginals: true })
      expect(await imported.restore({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'quantity-safe-restore', importId: result.importId }, () => actor)).toEqual(restored)
      await expect(reopened.withTransaction(tx => readProductionQuantityImportedIdentities(tx, sha256, actor))).rejects.toThrow('恢复')
      expect(await reopened.select('SELECT id FROM operation_logs')).not.toEqual([])
      expect(await reopened.select('SELECT file_ref_id FROM file_payloads')).toEqual([expect.objectContaining({ file_ref_id: photo.id })])
      await reopened.withTransaction(validateProductionQuantityState)
    }
    finally { await reopened.close() }
  }
  finally {
    source.close()
    await storage.close()
  }
}, 30_000)
