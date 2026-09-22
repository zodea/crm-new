import type { TransactionDb } from '../db/coordinator'
import type { QuantityBatchCompletionDraft } from './batch-completion'
import type { QuantityCompletionDraft } from './completion'
import { isISODateDTO } from '../../types/read-model'
import { loadQuantityBatchCompletionPlan, persistQuantityBatchCompletion } from './batch-completion'
import { quantityProblem } from './central-contract'
import { validateQuantityPhoto } from './central-photo'
import { loadQuantityCompletionWorkspace, persistQuantityStageCompletion } from './completion'

export type QuantityCompletionAction = { kind: 'save-completion', draft: Omit<QuantityCompletionDraft, 'allowMissingPhotos'> }
  | { kind: 'save-completion-batch', draft: QuantityBatchCompletionDraft }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function id(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function expected(row: Record<string, unknown>) {
  return ['expectedCompletionId', 'expectedCompletionFingerprint', 'expectedAssignmentId'].every(key => row[key] === null || id(row[key]))
}

function invalid(): never {
  throw quantityProblem('validation-failed', '阶段完成草稿格式无效，请核对户、阶段、日期和照片')
}

export function parseQuantityCompletionAction(value: unknown): QuantityCompletionAction | null {
  if (!object(value) || !['save-completion', 'save-completion-batch'].includes(String(value.kind)))
    return null
  const draft = value.draft
  if (!object(draft) || !id(draft.projectId) || typeof draft.note !== 'string'
    || Object.hasOwn(draft, 'allowMissingPhotos')
    || (draft.allowArchivedEdit !== undefined && typeof draft.allowArchivedEdit !== 'boolean')) {
    return invalid()
  }
  if (value.kind === 'save-completion') {
    if (!id(draft.unitId) || !id(draft.stageId) || !expected(draft)
      || !['draft', 'completed'].includes(String(draft.status))
      || !(draft.completedAt === null || isISODateDTO(draft.completedAt)) || !Array.isArray(draft.photos)) {
      return invalid()
    }
    for (const photo of draft.photos)
      validateQuantityPhoto(photo)
    return { kind: value.kind, draft: structuredClone(draft) as unknown as QuantityCompletionDraft }
  }
  if (!id(draft.trade) || !isISODateDTO(draft.completedAt) || !Array.isArray(draft.items) || !draft.items.length
    || !draft.items.every(row => object(row) && id(row.unitId) && id(row.stageId) && expected(row))) {
    return invalid()
  }
  return { kind: 'save-completion-batch', draft: structuredClone(draft) as unknown as QuantityBatchCompletionDraft }
}

export async function validateQuantityCompletionParent(db: TransactionDb, projectId: string, action: QuantityCompletionAction) {
  if (action.draft.projectId !== projectId)
    throw quantityProblem('relationship-mismatch', '完成草稿不属于当前项目')
  if (action.kind === 'save-completion') {
    const workspace = await loadQuantityCompletionWorkspace(db, projectId, action.draft.unitId)
    if (!workspace.stages.some(row => row.id === action.draft.stageId))
      throw quantityProblem('relationship-mismatch', '该阶段不是当前户的适用或历史阶段')
  }
  else {
    const plan = await loadQuantityBatchCompletionPlan(db, projectId, { trade: action.draft.trade, unitIds: [...new Set(action.draft.items.map(row => row.unitId))] })
    if (action.draft.items.some(item => !plan.items.some(row => row.unitId === item.unitId && row.stageId === item.stageId)))
      throw quantityProblem('relationship-mismatch', '批量完成包含不属于当前户和工种的阶段')
  }
}

export async function persistQuantityCompletionAction(db: TransactionDb, action: QuantityCompletionAction, actorId: string) {
  if (action.kind === 'save-completion') {
    const completion = await persistQuantityStageCompletion(db, action.draft, { uploader: actorId })
    return { id: completion.completionId, logIds: completion.logIds, completion }
  }
  const batch = await persistQuantityBatchCompletion(db, action.draft)
  return { id: action.draft.projectId, logIds: batch.logIds, batch }
}
