import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { ProcessLibraryCommandResult, ProcessLibraryVersion } from '../../app/lib/schedule/process-library-contract'
import type { ProcessLibraryState } from './process-library-service'
import { createHash } from 'node:crypto'
import { processLibraryProblem } from '../../app/lib/schedule/process-library-contract'
import { normalizeProcessLibraryDraft } from '../../app/lib/schedule/process-library-domain'
import { decodeProcessLibraryVersion } from '../../app/lib/schedule/process-library-repository'
import { parseProcessLibraryCommand } from './process-library-request'
import { processLibraryCanonical } from './process-library-service'

interface VersionRow { id: string, code: string, version: number, source_version_id: string | null, snapshot_json: string, created_at: string, actor_id: string, command_id: string }
interface ReceiptRow { command_id: string, workspace_id: string, actor_id: string, version_id: string, fingerprint: string, command_json: string, result_json: string, created_at: string }
interface AuditRow { version_id: string, command_id: string, actor_id: string, after_json: string, created_at: string, action: string }
export const processLibraryDigest = (value: string) => createHash('sha256').update(value).digest('hex')
function invalid(): never {
  throw processLibraryProblem('unavailable', '已保存工序库的完整版本、原命令或审计无法核对；停止读取和保存。')
}
function draftOf(record: ProcessLibraryVersion) {
  return { sourceLibraryId: record.sourceVersionId, code: record.code, name: record.name, description: record.description, tasks: record.tasks.map(task => ({ key: task.key, name: task.name, durationDays: task.durationDays, trade: task.trade, color: task.color, stageCode: task.stageCode, itemCodes: task.itemCodes, predecessorKey: task.predecessorKey, predecessorDisabled: task.predecessorDisabled })) }
}

/** Validate persisted relationships before exposing a complete graph; broken rows are never dropped. */
export async function readProductionProcessLibraryState(tx: TransactionDb, identity: { workspaceId: string, actorId: string }): Promise<ProcessLibraryState> {
  const rows = await tx.select<VersionRow>('SELECT * FROM process_library_versions ORDER BY code,version')
  const receipts = await tx.select<ReceiptRow>('SELECT * FROM process_library_command_receipts')
  const audits = await tx.select<AuditRow>('SELECT * FROM process_library_audits')
  const revisions = await tx.select<{ revision: number }>('SELECT revision FROM process_library_revision WHERE singleton=1')
  const revision = revisions[0]?.revision
  if (revisions.length !== 1 || !Number.isSafeInteger(revision) || revision !== rows.length || receipts.length !== rows.length || audits.length !== rows.length)
    invalid()
  const state: ProcessLibraryState = { revision: revision!, versions: [], commands: new Map() }
  try {
    for (const row of rows) {
      const value = decodeProcessLibraryVersion(JSON.parse(row.snapshot_json), row.id, 'real')
      const receipt = receipts.find(entry => entry.command_id === row.command_id)
      const audit = audits.find(entry => entry.command_id === row.command_id && entry.version_id === row.id)
      if (!receipt || !audit || receipt.workspace_id !== identity.workspaceId || receipt.actor_id !== identity.actorId
        || row.actor_id !== identity.actorId || value.createdBy !== identity.actorId || value.createdAt !== row.created_at || value.updatedAt !== row.created_at
        || value.code !== row.code || value.version !== row.version || value.sourceVersion !== String(row.version) || value.sourceVersionId !== row.source_version_id
        || value.isDefault || value.usageCount !== null || value.migrationBatchId !== null || value.legacyId !== null || value.deletedAt !== null
        || !Number.isFinite(Date.parse(row.created_at)) || processLibraryCanonical(value) !== row.snapshot_json
        || receipt.version_id !== row.id || receipt.created_at !== row.created_at || processLibraryDigest(receipt.command_json) !== receipt.fingerprint
        || audit.action !== 'create-version' || audit.actor_id !== row.actor_id || audit.created_at !== row.created_at || audit.after_json !== row.snapshot_json) {
        invalid()
      }
      const command = parseProcessLibraryCommand(JSON.parse(receipt.command_json))
      const result: ProcessLibraryCommandResult = { id: row.id, commandId: row.command_id, version: row.version, sourceVersion: value.sourceVersion }
      if (processLibraryCanonical(command) !== receipt.command_json || command.commandId !== row.command_id || command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId
        || command.origin !== 'real' || command.baseVersion + 1 !== row.version || processLibraryCanonical(result) !== receipt.result_json
        || processLibraryCanonical(normalizeProcessLibraryDraft(command.draft)) !== processLibraryCanonical(draftOf(value))) {
        invalid()
      }
      const prior = state.versions.filter(version => version.code === row.code)
      const source = row.source_version_id ? prior.find(version => version.id === row.source_version_id) : null
      if (row.version !== prior.length + 1 || (row.version === 1 ? row.source_version_id !== null || command.sourceVersion !== null : !source || command.sourceVersion !== source.sourceVersion))
        invalid()
      state.versions.push(value)
      state.commands.set(row.command_id, { fingerprint: receipt.command_json, result })
    }
  }
  catch { return invalid() }
  return state
}
