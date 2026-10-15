import { afterEach, describe, expect, it } from 'vitest'
import { LATEST_VERSION } from '~/lib/db/migrations'
import { CORE_MIGRATION_CAPABILITY } from '~/lib/migration/core-contract'
import { createCoreMigrationLocalSource } from '~/lib/migration/core-local-source'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createDeliveryCommandService } from '../../server/utils/delivery-command-service'
import { deliveryCommandTestInstance } from '../../server/utils/delivery-runtime'
import { createMigratedMemoryDb } from '../helpers/memory-db'

const session = resolveBusinessSession()
async function unused(): Promise<never> {
  throw new Error('本例仅读取显式内存 SQLite')
}
afterEach(async () => {
  deliveryCommandTestInstance.reset(session)
  await coreMigrationTestInstance.reset(session.workspaceId)
})

describe('送货完整受控迁移', () => {
  it('读取真实 SQLite 迁移源时明确拒绝没有单头的材料、原件和审计，不冒称零记录完成', async () => {
    const db = await createMigratedMemoryDb()
    try {
      await db.execute('PRAGMA foreign_keys = OFF')
      await db.execute('INSERT INTO delivery_lines(id,delivery_record_id,material_name,unit,qty) VALUES(\'orphan-line\',\'lost-head\',\'材料\',\'吨\',1)')
      await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category) VALUES(\'orphan-source\',\'delivery_record\',\'lost-head\',\'原件.pdf\',12,\'application/pdf\',\'source\')')
      await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action) VALUES(\'orphan-audit\',\'delivery_records\',\'lost-head\',\'update\')')
      const reader = createCoreMigrationLocalSource({
        isDemoActive: () => false,
        currentSchemaVersion: async () => LATEST_VERSION,
        select: (sql, params) => db.select(sql, params),
        closeDatabase: unused,
        loadProductionSnapshot: unused,
        readSnapshotSource: unused,
        createBackup: unused,
        loadBackup: unused,
        restoreBackup: unused,
        activateMigration: unused,
        clearMigration: unused,
        prepareMigration: unused,
        loadMigrationMarker: unused,
        loadPendingMigrationMarker: unused,
        now: () => '2026-09-11T00:00:00.000Z',
      })
      await expect(reader.readSource().then(() => undefined)).rejects.toThrow('送货迁移存在孤儿记录：材料行 1、原件引用 1、审计 1')
      expect(await db.select('SELECT id FROM delivery_lines')).toEqual([{ id: 'orphan-line' }])
      expect(await db.select('SELECT id FROM file_refs')).toEqual([{ id: 'orphan-source' }])
      expect(await db.select('SELECT id FROM operation_logs')).toEqual([{ id: 'orphan-audit' }])
    }
    finally { db.close() }
  })

  it('完整迁入原件、历史与打印状态；安全回滚可撤回，后续修订后回滚严格保全', async () => {
    const db = await createMigratedMemoryDb()
    try {
      await db.execute('INSERT INTO projects(id,name) VALUES(\'delivery-old-project\',\'迁入项目\')')
      await db.execute('INSERT INTO suppliers(id,name) VALUES(\'delivery-old-supplier\',\'迁入分供方\')')
      await db.execute('INSERT INTO delivery_records(id,project_id,supplier_id,order_no,delivery_date,archived,stored,ocr_status,print_batch_id,print_disposition) VALUES(\'delivery-old\',\'delivery-old-project\',\'delivery-old-supplier\',\'OLD-441\',\'2026-09-11\',1,1,\'reviewed\',\'physical-upload\',\'printed\')')
      await db.execute('INSERT INTO delivery_lines(id,delivery_record_id,material_name,unit,qty,unit_price,amount) VALUES(\'delivery-line-old\',\'delivery-old\',\'材料\',\'吨\',2,10,20)')
      await db.execute('UPDATE delivery_records SET ocr_status = \'unreviewed\' WHERE id = \'delivery-old\'')
      await db.execute('INSERT INTO delivery_records(id,project_id,order_no,delivery_date,archived,ocr_status) VALUES(\'delivery-unverified\',\'delivery-old-project\',\'OLD-MISSING\',\'2026-09-11\',1,\'reviewed\')')
      await db.execute('INSERT INTO delivery_lines(id,delivery_record_id,material_name,unit,qty,unit_price,amount) VALUES(\'delivery-unverified-line\',\'delivery-unverified\',\'材料\',\'吨\',2,10,20)')
      await db.execute('INSERT INTO delivery_lines(id,delivery_record_id,material_name,unit,qty,unit_price,amount,deleted_at) VALUES(\'delivery-line-before\',\'delivery-old\',\'材料\',\'吨\',1,10,10,\'2026-09-11\')')
      const [legacyHead] = await db.select<Record<string, unknown>>('SELECT * FROM delivery_records WHERE id = \'delivery-old\'')
      await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,after_data,operator) VALUES(\'delivery-valid-audit\',\'delivery_records\',\'delivery-old\',\'update\',?,?,\'旧核对人\')', [JSON.stringify({ ...legacyHead, __delivery_line_ids: ['delivery-line-before'] }), JSON.stringify({ ...legacyHead, __delivery_line_ids: ['delivery-line-old'] })])
      const payload = btoa('%PDF-1.7\noriginal migration bytes\n%%EOF')
      await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category) VALUES(\'delivery-file-old\',\'delivery_record\',\'delivery-old\',\'原件.pdf\',?,\'application/pdf\',\'source\')', [atob(payload).length])
      await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(\'delivery-file-old\',\'base64\',?)', [payload])
      await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,category,deleted_at) VALUES(\'delivery-file-retired\',\'delivery_record\',\'delivery-old\',\'历史原件.pdf\',?,\'application/pdf\',\'source\',\'2026-09-10 01:02:03\')', [atob(payload).length])
      await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(\'delivery-file-retired\',\'base64\',?)', [payload])
      await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,operator) VALUES(\'delivery-audit-old\',\'delivery_records\',\'delivery-old\',\'update\',\'unparseable legacy snapshot\',\'旧经办\')')
      const source = await createCoreMigrationLocalSource({
        isDemoActive: () => false,
        currentSchemaVersion: async () => LATEST_VERSION,
        select: (sql, params) => db.select(sql, params),
        closeDatabase: unused,
        loadProductionSnapshot: unused,
        readSnapshotSource: unused,
        createBackup: unused,
        loadBackup: unused,
        restoreBackup: unused,
        activateMigration: unused,
        clearMigration: unused,
        prepareMigration: unused,
        loadMigrationMarker: unused,
        loadPendingMigrationMarker: unused,
        now: () => '2026-09-11T00:00:00.000Z',
      }).readSource()
      expect(source.entities.delivery_records).toHaveLength(2)
      const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
      const hash = '4'.repeat(64)
      const parsed = parseCoreMigrationSourceCommand({ ...envelope('delivery-preflight'), source, backup: null })
      expect(parsed.source).toEqual(source)
      await coreMigrationTestInstance.preflight(parsed, session)
      const batch = await coreMigrationTestInstance.dryRun({ ...envelope('delivery-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: 441, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }, session)
      expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'delivery_records', metricKey: 'legacy-audit' }))
      expect(batch.issues).toContainEqual(expect.objectContaining({ reason: expect.stringContaining('1 份历史原件已有逻辑 owner') }))
      await coreMigrationTestInstance.importBatch({ ...envelope('delivery-import'), batchId: batch.batchId }, session)
      expect(deliveryCommandTestInstance.list(session).records).toEqual([])
      await coreMigrationTestInstance.confirm({ ...envelope('delivery-confirm'), batchId: batch.batchId }, session)
      const importedSnapshot = coreMigrationTestInstance.snapshot(session)
      const identities = (type: 'projects' | 'suppliers') => importedSnapshot.entities.filter(row => row.entityType === type).map(row => ({ id: row.id, name: row.name, dataOrigin: 'real' as const }))
      const safe = createDeliveryCommandService({ references: () => ({ projects: identities('projects'), suppliers: identities('suppliers') }) })
      safe.prepareMigrationSnapshot(importedSnapshot)()
      expect(safe.list(session).records).toHaveLength(2)
      safe.prepareMigrationSnapshot({ authority: 'local', activeBatchId: null, entities: [] })()
      expect(safe.list(session).records).toEqual([])
      const migrated = deliveryCommandTestInstance.list(session).records
      expect(migrated.find(row => row.orderNo === 'OLD-MISSING')).toMatchObject({ supplierId: null, ocrStatus: 'reviewed', currentValuesConfirmed: false, reviewStatus: 'unreviewed', lines: [{ currentValueConfirmed: false }] })
      const record = migrated.find(row => row.orderNo === 'OLD-441')!
      expect(record).toMatchObject({ orderNo: 'OLD-441', printDisposition: 'printed', lines: [{ qty: 2, amount: 20 }] })
      expect(record).toMatchObject({ currentValuesConfirmed: false, reviewStatus: 'unreviewed', lines: [{ currentValueConfirmed: false }] })
      expect(record.projectId).not.toBe('delivery-old-project')
      expect(deliveryCommandTestInstance.fileContent(record.id, record.assetId!, session).payloadBase64).toBe(payload)
      const importedSource = coreMigrationTestInstance.snapshot(session).entities.find(entity => entity.id === record.id)!
      const retired = JSON.parse(String(importedSource.attributes.legacyOriginalsJson))[0]
      expect(retired.asset.payloadBase64).toBe(payload)
      expect(() => deliveryCommandTestInstance.fileContent(record.id, `${record.migrationBatchId}:${retired.asset.id}`, session)).toThrow()
      expect(JSON.stringify(record)).not.toContain('历史原件.pdf')
      expect(record.legacyAudit).toContain('待核验')
      expect(JSON.stringify(record)).not.toContain('unparseable legacy snapshot')
      expect(JSON.stringify(deliveryCommandTestInstance.history(record.id, session))).not.toContain('unparseable legacy snapshot')
      expect(deliveryCommandTestInstance.history(record.id, session)[0]).toMatchObject({ actorId: '旧核对人', before: { lines: [{ qty: 1 }] }, after: { lines: [{ qty: 2 }], assetId: null } })
      deliveryCommandTestInstance.execute({ action: 'source', id: record.id, commandId: 'delivery-supplement', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'delivery:write', origin: 'real', baseVersion: record.version, reason: '核对后补传', source: { fileName: '补传.pdf', mimeType: 'application/pdf', fileSize: atob(payload).length, payloadBase64: payload } }, session)
      await coreMigrationTestInstance.confirm({ ...envelope('delivery-confirm-again'), batchId: batch.batchId }, session)
      expect(deliveryCommandTestInstance.detail(record.id, session).version).toBe('3')
      expect(deliveryCommandTestInstance.history(record.id, session)).toHaveLength(3)
      expect(deliveryCommandTestInstance.detail(record.id, session).currentValuesConfirmed).toBe(false)
      const verified = deliveryCommandTestInstance.execute({ action: 'revise', id: record.id, commandId: 'delivery-verify', workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'delivery:write', origin: 'real', baseVersion: '3', reason: '逐行对照原件完成核对', draft: { projectId: record.projectId, supplierId: record.supplierId, orderNo: record.orderNo, deliveryDate: record.deliveryDate, note: '', rawSiteText: record.rawSiteText, reviewFlag: '', confirmations: {}, lines: record.lines } }, session)
      expect(deliveryCommandTestInstance.detail(record.id, session)).toMatchObject({ version: verified.version, currentValuesConfirmed: true, reviewStatus: 'reviewed', ocrStatus: 'reviewed', lines: [{ currentValueConfirmed: true }] })
      expect(deliveryCommandTestInstance.history(record.id, session).at(-1)?.before?.currentValuesConfirmed).toBe(false)
      const beforeRollback = coreMigrationTestInstance.snapshot(session)
      const history = deliveryCommandTestInstance.history(record.id, session)
      await expect(coreMigrationTestInstance.rollback({ ...envelope('delivery-rollback'), batchId: batch.batchId }, session)).rejects.toThrow(/后来修改|仍引用迁入/)
      expect(coreMigrationTestInstance.snapshot(session)).toEqual(beforeRollback)
      expect(deliveryCommandTestInstance.detail(record.id, session)).toMatchObject({ version: verified.version, currentValuesConfirmed: true })
      expect(deliveryCommandTestInstance.history(record.id, session)).toEqual(history)
      expect(deliveryCommandTestInstance.fileContent(record.id, record.assetId!, session).payloadBase64).toBe(payload)
    }
    finally {
      db.close()
    }
  })
})
