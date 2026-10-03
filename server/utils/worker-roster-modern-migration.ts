import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CoreMigrationServerEntityDTO } from '../../app/lib/migration/core-contract'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import { parseWorkerModernGraph, WORKER_MODERN_COLUMNS } from '../../app/lib/migration/worker-roster-modern-source'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { parsePrivateValues } from '../../app/lib/worker-roster/validation'
import { rosterHash } from './worker-roster-storage'

export const importedWorkerPhotoId = (workerId: string, fileId: string) => `worker-photo-import-${rosterHash({ workerId, legacyFileId: fileId })}`
const receiptId = (workerId: string, row: Record<string, unknown>) => `worker-roster-import-${rosterHash({ workerId, commandId: row.command_id, workspaceId: row.workspace_id, actorId: row.actor_id })}`
const logId = (workerId: string, id: unknown) => `worker-roster-log-import-${rosterHash({ workerId, id })}`
export function workerModernAssetMappings(entity: CoreMigrationServerEntityDTO): PayrollIdentityMapping[] {
  if (entity.attributes.workerRosterGraphJson === undefined)
    return []
  const graph = parseWorkerModernGraph(JSON.parse(String(entity.attributes.workerRosterGraphJson)), entity.legacyId)
  return graph.tables.worker_roster_assets.flatMap(asset => [
    { tableName: 'worker_roster_assets', legacyId: String(asset.id), centralId: importedWorkerPhotoId(entity.id, String(asset.file_ref_id)) },
    { tableName: 'file_refs', legacyId: String(asset.file_ref_id), centralId: importedWorkerPhotoId(entity.id, String(asset.file_ref_id)) },
  ])
}

/** Original command/result text remains in worker_roster_migration_evidence.source_json. */
export async function insertWorkerModernVersions(db: TransactionDb, entity: CoreMigrationServerEntityDTO, batchId: string): Promise<boolean> {
  if (entity.attributes.workerRosterGraphJson === undefined)
    return false
  const graph = parseWorkerModernGraph(JSON.parse(String(entity.attributes.workerRosterGraphJson)), entity.legacyId)
  const mappings = workerModernAssetMappings(entity)
  const mapAsset = (value: string | null) => {
    if (value === null)
      return null
    const mapped = mappings.find(row => row.tableName === 'worker_roster_assets' && row.legacyId === value)?.centralId
    if (!mapped)
      throw payrollProblem('conflict', '工人现代照片缺少完整明确的原件映射')
    return mapped
  }
  for (const asset of graph.tables.worker_roster_assets) {
    const id = mapAsset(String(asset.id))!
    const [physical] = await db.select<Record<string, unknown>>('SELECT * FROM worker_roster_assets WHERE id=? AND worker_id=?', [id, entity.id])
    if (!physical || physical.sha256 !== asset.sha256 || physical.legacy_deleted_at !== asset.legacy_deleted_at)
      throw payrollProblem('conflict', '现代工人照片正文、摘要或删除状态与原件清单不一致')
    await db.execute('UPDATE worker_roster_assets SET created_at=?,legacy_category=? WHERE id=?', [asset.created_at, asset.legacy_category, id])
  }
  for (const row of graph.tables.worker_roster_profile_versions) {
    const values = parsePrivateValues(JSON.parse(String(row.values_json)))
    await db.execute('INSERT INTO worker_roster_profile_versions(worker_id,revision,values_json,created_at,actor_id,migration_batch_id) VALUES (?,?,?,?,?,?)', [entity.id, row.revision, JSON.stringify({ ...values, portraitId: mapAsset(values.portraitId), bankCardId: mapAsset(values.bankCardId) }), row.created_at, row.actor_id, batchId])
  }
  await db.execute('CREATE TABLE IF NOT EXISTS worker_roster_migration_receipts(command_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,worker_id TEXT NOT NULL,batch_id TEXT NOT NULL,PRIMARY KEY(workspace_id,actor_id,command_id))')
  for (const row of graph.tables.worker_roster_receipts) {
    const commandId = receiptId(entity.id, row)
    const result = JSON.parse(String(row.result_json))
    await db.execute('INSERT INTO worker_roster_receipts(command_id,workspace_id,actor_id,fingerprint,result_json,worker_id,archive_id) VALUES (?,?,?,?,?,?,NULL)', [commandId, row.workspace_id, row.actor_id, row.fingerprint, JSON.stringify({ ...result, commandId, workerId: entity.id }), entity.id])
    await db.execute('INSERT INTO worker_roster_migration_receipts VALUES (?,?,?,?,?)', [commandId, row.workspace_id, row.actor_id, entity.id, batchId])
  }
  for (const row of graph.tables.operation_logs) {
    const mapped = { ...row, id: logId(entity.id, row.id), record_id: entity.id }
    const columns = WORKER_MODERN_COLUMNS.operation_logs
    await db.execute(`INSERT INTO operation_logs(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map(column => mapped[column as keyof typeof mapped]))
  }
  return true
}

/** Only receipts exactly reproduced from the owner's retained source can leave with its batch. */
export async function prepareWorkerModernRemoval(db: TransactionDb, removals: readonly { worker_id: string, batch_id: string, fingerprint: string }[]) {
  for (const removal of removals) {
    const [evidence] = await db.select<{ source_json: string }>('SELECT source_json FROM worker_roster_migration_evidence WHERE worker_id=? AND batch_id=?', [removal.worker_id, removal.batch_id])
    const entity = evidence ? JSON.parse(evidence.source_json) as CoreMigrationServerEntityDTO : null
    if (!entity || rosterHash(entity) !== removal.fingerprint)
      throw payrollProblem('conflict', '工人原件迁入证据已变化，不能恢复删除')
    const files = JSON.parse(String(entity.attributes.workerFilesJson ?? '[]')) as Array<Record<string, unknown>>
    const physicalFiles = await db.select<Record<string, unknown>>('SELECT f.id,f.owner_type AS ownerType,f.owner_id AS ownerId,f.file_name AS fileName,f.file_path AS filePath,f.file_size AS fileSize,f.mime_type AS mimeType,f.category,f.uploader,f.uploaded_at AS uploadedAt,f.deleted_at AS deletedAt,p.encoding AS payloadEncoding,p.content AS payloadContent FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.owner_type=\'worker\' AND f.owner_id=? ORDER BY f.id', [entity.id])
    const expectedFiles = files.map(file => ({ ...file, id: importedWorkerPhotoId(entity.id, String(file.id)), ownerId: entity.id })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
    if (rosterHash(physicalFiles) !== rosterHash(expectedFiles))
      throw payrollProblem('conflict', '工人原件正文或元数据已有变更，不能恢复删除')
    if (entity.attributes.workerRosterGraphJson === undefined)
      continue
    const graph = parseWorkerModernGraph(JSON.parse(String(entity.attributes.workerRosterGraphJson)), entity.legacyId)
    for (const row of graph.tables.operation_logs) {
      const expected = { ...row, id: logId(entity.id, row.id), record_id: entity.id }
      const [actual] = await db.select<Record<string, unknown>>(`SELECT ${WORKER_MODERN_COLUMNS.operation_logs.join(',')} FROM operation_logs WHERE id=?`, [expected.id])
      if (!actual || rosterHash(actual) !== rosterHash(expected))
        throw payrollProblem('conflict', '工人迁入审计已有改写，不能恢复删除')
      await db.execute('DELETE FROM operation_logs WHERE id=?', [expected.id])
    }
    const mappings = workerModernAssetMappings(entity)
    const photo = (value: string | null) => value === null ? null : mappings.find(row => row.tableName === 'worker_roster_assets' && row.legacyId === value)?.centralId
    const versions = await db.select<Record<string, unknown>>('SELECT worker_id,revision,values_json,created_at,actor_id FROM worker_roster_profile_versions WHERE worker_id=? AND migration_batch_id=? ORDER BY revision', [entity.id, removal.batch_id])
    const expected = graph.tables.worker_roster_profile_versions.map((row) => {
      const values = parsePrivateValues(JSON.parse(String(row.values_json)))
      return { ...row, revision: row.revision, worker_id: entity.id, values_json: JSON.stringify({ ...values, portraitId: photo(values.portraitId), bankCardId: photo(values.bankCardId) }) }
    }).sort((a, b) => Number(a.revision) - Number(b.revision))
    if (rosterHash(versions) !== rosterHash(expected))
      throw payrollProblem('conflict', '迁入工人资料版本已被改写，不能恢复删除')
    for (const row of graph.tables.worker_roster_receipts) {
      const commandId = receiptId(entity.id, row)
      const result = { ...JSON.parse(String(row.result_json)), commandId, workerId: entity.id }
      const [actual] = await db.select<Record<string, unknown>>('SELECT command_id,workspace_id,actor_id,fingerprint,result_json,worker_id,archive_id FROM worker_roster_receipts WHERE command_id=? AND workspace_id=? AND actor_id=?', [commandId, row.workspace_id, row.actor_id])
      if (!actual || rosterHash(actual) !== rosterHash({ ...row, command_id: commandId, worker_id: entity.id, result_json: JSON.stringify(result) }))
        throw payrollProblem('conflict', '迁入工人回执已被改写，不能恢复删除')
      await db.execute('DELETE FROM worker_roster_receipts WHERE command_id=? AND workspace_id=? AND actor_id=?', [commandId, row.workspace_id, row.actor_id])
      await db.execute('DELETE FROM worker_roster_migration_receipts WHERE command_id=? AND workspace_id=? AND actor_id=?', [commandId, row.workspace_id, row.actor_id])
    }
  }
}
