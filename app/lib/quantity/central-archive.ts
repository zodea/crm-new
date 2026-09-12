import type { TransactionDb } from '../db/coordinator'
import { selectVisibleSql, withUpdateLog } from '../db/soft-delete'
import { quantityProblem } from './central-contract'

export interface QuantityArchiveAction { kind: 'set-archived', archived: boolean }

export function parseQuantityArchiveAction(value: unknown): QuantityArchiveAction | null {
  if (!value || typeof value !== 'object' || !('kind' in value) || value.kind !== 'set-archived')
    return null
  if (!('archived' in value) || typeof value.archived !== 'boolean')
    throw quantityProblem('validation-failed', '矩阵归档状态无效')
  return { kind: 'set-archived', archived: value.archived }
}

export async function persistQuantityArchive(db: TransactionDb, projectId: string, action: QuantityArchiveAction) {
  const [project] = await db.select<{ matrix_archived_at: string | null }>(selectVisibleSql('projects', 'AND id = ?'), [projectId])
  if (!project)
    throw quantityProblem('not-found', '工程量项目不存在或已删除')
  if ((project.matrix_archived_at !== null) === action.archived)
    return { id: projectId, logIds: [] }
  const logId = await withUpdateLog(db, 'projects', projectId, () => db.execute('UPDATE projects SET matrix_archived_at = ? WHERE id = ?', [action.archived ? new Date().toISOString() : null, projectId]))
  if (!logId)
    throw quantityProblem('internal-error', '矩阵归档未生成审计记录')
  return { id: projectId, logIds: [logId] }
}
