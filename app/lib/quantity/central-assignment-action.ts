import type { TransactionDb } from '../db/coordinator'
import type { QuantityAssignmentBatchDraft } from './assignment'
import type { QuantityAssignmentAction } from './central-contract'
import { loadQuantityAssignmentWorkspace, persistQuantityAssignments } from './assignment'
import { quantityProblem } from './central-contract'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function id(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function nullableId(value: unknown) {
  return value === null || id(value)
}

export function parseQuantityAssignmentAction(value: unknown): QuantityAssignmentAction | null {
  if (!object(value) || value.kind !== 'save-assignments')
    return null
  const draft = value.draft
  if (!object(draft) || !id(draft.projectId) || !id(draft.trade) || !id(draft.assigneeId)
    || !['crew', 'worker'].includes(String(draft.assigneeKind))
    || !Array.isArray(draft.unitIds) || !draft.unitIds.length || !draft.unitIds.every(id)
    || !Array.isArray(draft.expectedAssignments) || !draft.expectedAssignments.every(row => object(row)
      && id(row.unitId) && nullableId(row.assignmentId) && nullableId(row.fingerprint))
    || !Array.isArray(draft.scopes) || !draft.scopes.every(row => object(row) && id(row.unitId) && id(row.roomId) && id(row.itemId))
    || (draft.note !== undefined && typeof draft.note !== 'string') || typeof draft.allowReplacement !== 'boolean'
    || (draft.allowArchivedEdit !== undefined && typeof draft.allowArchivedEdit !== 'boolean')) {
    throw quantityProblem('validation-failed', '工程量责任草稿格式无效，请重新核对输入')
  }
  return { kind: value.kind, draft: structuredClone(draft) as unknown as QuantityAssignmentBatchDraft }
}

export async function validateQuantityAssignmentParent(db: TransactionDb, projectId: string, action: QuantityAssignmentAction) {
  if (action.draft.projectId !== projectId)
    throw quantityProblem('relationship-mismatch', '责任草稿不属于当前项目')
  const workspace = await loadQuantityAssignmentWorkspace(db, projectId)
  if (action.draft.unitIds.some(id => !workspace.units.some(unit => unit.id === id)))
    throw quantityProblem('relationship-mismatch', '责任目标户不存在或不属于当前项目')
  if (!workspace.assignees.some(row => row.id === action.draft.assigneeId && row.kind === action.draft.assigneeKind))
    throw quantityProblem('relationship-mismatch', '责任人不在当前可读的正式主数据中')
}

export async function persistQuantityAssignmentAction(db: TransactionDb, action: QuantityAssignmentAction) {
  const assignments = await persistQuantityAssignments(db, action.draft)
  return { id: action.draft.projectId, logIds: assignments.logIds, assignments }
}
