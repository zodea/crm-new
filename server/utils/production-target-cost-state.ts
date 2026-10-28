import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { ProjectRow } from './production-project-record'
import { decodeTargetCostResult } from '../../app/lib/target-cost/central-codec'
import { targetCostProblem } from '../../app/lib/target-cost/central-contract'
import { projectDraft } from './production-project-record'
import { budgetDigest, loadProductionBudgetFiles } from './production-target-cost-files'

/** Validates the existing project owner; returning these rows never grants directory permission. */
export async function productionBudgetProjectRows(tx: TransactionDb, id?: string) {
  const rows = await tx.select<ProjectRow>(`SELECT * FROM projects${id === undefined ? '' : ' WHERE id=?'} ORDER BY id`, id === undefined ? [] : [id])
  for (const row of rows)
    projectDraft(row)
  return rows
}

export async function productionBudgetGraph(tx: TransactionDb, id: string) {
  const head = (await tx.select<Record<string, unknown>>('SELECT * FROM target_costs WHERE id=?', [id]))[0]
  const items = await tx.select('SELECT * FROM target_cost_items WHERE target_cost_id=? ORDER BY id', [id])
  const files = await tx.select(`SELECT f.*,b.original_metadata_json,b.body_state,b.sha256 FROM target_cost_files b JOIN file_refs f ON f.id=b.file_ref_id WHERE b.target_cost_id=? ORDER BY f.id`, [id])
  return { head, items, files }
}
export async function advanceProductionBudgetVersion(tx: TransactionDb, id: string) {
  const fingerprint = budgetDigest(await productionBudgetGraph(tx, id))
  await tx.execute('INSERT INTO target_cost_versions(id,version,fingerprint) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET version=version+1,fingerprint=excluded.fingerprint', [id, fingerprint])
}
/** Public reads and backups verify the same durable graph, not a cached projection. */
export async function verifyProductionBudgetState(tx: TransactionDb) {
  const owner = (await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1'))[0]
  if (!owner)
    throw targetCostProblem('unavailable', '预算正式存储缺少可信工作区身份')
  const heads = await tx.select<{ id: string }>('SELECT id FROM target_costs ORDER BY id')
  const versions = await tx.select<{ id: string, version: number, fingerprint: string }>('SELECT * FROM target_cost_versions ORDER BY id')
  if (heads.length !== versions.length)
    throw targetCostProblem('unavailable', '预算版本图与持久修订不完整')
  for (const head of heads) {
    const version = versions.find(version => version.id === head.id)
    if (!version || !Number.isSafeInteger(version.version) || version.version < 1 || version.fingerprint !== budgetDigest(await productionBudgetGraph(tx, head.id)))
      throw targetCostProblem('unavailable', '预算事实与持久修订证据不一致')
    await loadProductionBudgetFiles(tx, head.id)
  }
  if ((await tx.select(`SELECT f.id FROM file_refs f LEFT JOIN target_cost_files b ON b.file_ref_id=f.id WHERE f.owner_type='target_cost' AND b.file_ref_id IS NULL`)).length)
    throw targetCostProblem('unavailable', '预算原件缺少完整归属与来源证据')
  const missingOriginalIds = new Set<string>()
  for (const row of await tx.select<{ source_sha256: string, evidence_sha256: string, evidence_json: string }>('SELECT source_sha256,evidence_sha256,evidence_json FROM target_cost_imports')) {
    let evidence
    try {
      evidence = JSON.parse(row.evidence_json)
    }
    catch { throw targetCostProblem('unavailable', '预算迁入完整来源证据损坏') }
    if (!evidence || evidence.sha256 !== row.source_sha256 || budgetDigest(evidence) !== row.evidence_sha256 || !Array.isArray(evidence.files) || !Array.isArray(evidence.heads) || !Array.isArray(evidence.items) || !Array.isArray(evidence.logs))
      throw targetCostProblem('unavailable', '预算迁入领域原图、来源摘要或原件清单不一致')
    for (const file of evidence.files) {
      if (file.bodyState === 'metadata-only' && (file.row.file_path == null || file.row.file_path === ''))
        missingOriginalIds.add(file.row.id)
    }
  }
  const missing = await tx.select<{ file_ref_id: string }>('SELECT file_ref_id FROM target_cost_files WHERE body_state=\'metadata-only\'')
  for (const file of missing) {
    if (!missingOriginalIds.has(file.file_ref_id))
      throw targetCostProblem('unavailable', '预算缺件没有可信原图证据，不能当作历史空原件')
  }
  for (const row of await tx.select<{ command_id: string, workspace_id: string, actor_id: string, target_cost_id: string, action: string, fingerprint: string, request_json: string, result_json: string }>('SELECT * FROM target_cost_commands')) {
    let request, result
    try {
      request = JSON.parse(row.request_json)
      result = JSON.parse(row.result_json)
    }
    catch { throw targetCostProblem('unavailable', '预算原命令或回执损坏') }
    decodeTargetCostResult(result, { commandId: row.command_id, targetCostId: row.target_cost_id })
    if (row.workspace_id !== owner.workspace_id || row.actor_id !== owner.owner_id || request.workspaceId !== row.workspace_id || request.actorId !== row.actor_id || request.commandId !== row.command_id || request.action?.kind !== row.action || budgetDigest(request) !== row.fingerprint || result.commandId !== row.command_id || result.id !== row.target_cost_id || !heads.some(head => head.id === row.target_cost_id))
      throw targetCostProblem('unavailable', '预算原命令、指纹与原回执不一致')
    for (const id of result.logIds) {
      if (!(await tx.select('SELECT id FROM operation_logs WHERE id=?', [id]))[0])
        throw targetCostProblem('unavailable', '预算原回执的审计引用丢失')
    }
    for (const id of result.attachmentIds) {
      if (!(await tx.select('SELECT id FROM file_refs WHERE id=? AND owner_type=\'target_cost\' AND owner_id=?', [id, row.target_cost_id]))[0])
        throw targetCostProblem('unavailable', '预算原回执的原件引用丢失')
    }
  }
  return { metadataOnlyFileIds: missing.map(file => file.file_ref_id).sort() }
}
