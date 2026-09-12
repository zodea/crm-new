import type { QuantityCommand, QuantityCommandResult } from './central-contract'
import { invalidQuantityResponse, quantityObject, quantityStrings } from './central-decoder'

function ids(value: unknown): value is string[] {
  return quantityStrings(value) && value.every(id => id.trim()) && new Set(value).size === value.length
}

function sameIds(left: unknown, right: readonly string[]) {
  return ids(left) && left.length === right.length && left.every(id => right.includes(id))
}

/** 请求动作决定可采纳结果；响应不能把其他户的完成或附件混入当前操作。 */
export function decodeQuantityCommand(value: unknown, command: QuantityCommand): QuantityCommandResult {
  if (!quantityObject(value) || value.commandId !== command.commandId || typeof value.id !== 'string' || !value.id.trim()
    || typeof value.sourceVersion !== 'string' || !value.sourceVersion.trim() || !ids(value.logIds)) {
    invalidQuantityResponse()
  }
  const action = command.action
  if (action.kind === 'save-completion' || (action.kind === 'import-row' && action.target === 'completion')) {
    const expectedId = action.kind === 'save-completion' ? action.draft.expectedCompletionId : null
    const status = action.kind === 'save-completion' ? action.draft.status : ['draft', '草稿'].includes(action.row.status ?? '') ? 'draft' : 'completed'
    const photoCount = action.kind === 'save-completion' ? action.draft.photos.length : 0
    const result = value.completion
    if (!quantityObject(result) || result.completionId !== value.id
      || (expectedId !== null && result.completionId !== expectedId)
      || result.status !== status || typeof result.created !== 'boolean' || typeof result.changed !== 'boolean'
      || !ids(result.photoIds) || result.photoIds.length !== photoCount || !sameIds(result.logIds, value.logIds)) {
      invalidQuantityResponse()
    }
  }
  else if (action.kind === 'save-assignments' || (action.kind === 'import-row' && action.target === 'assignment')) {
    const unitIds = action.kind === 'save-assignments' ? action.draft.unitIds : [action.unitId!]
    const result = value.assignments
    if (value.id !== command.projectId || !quantityObject(result)
      || !ids(result.changedUnitIds) || !ids(result.unchangedUnitIds) || !ids(result.replacedUnitIds) || !ids(result.assignmentIds)
      || !sameIds([...result.changedUnitIds, ...result.unchangedUnitIds], unitIds)
      || !result.replacedUnitIds.every(id => (result.changedUnitIds as string[]).includes(id))
      || !sameIds(result.logIds, value.logIds)) {
      invalidQuantityResponse()
    }
  }
  else if (action.kind === 'save-completion-batch') {
    const result = value.batch
    if (value.id !== command.projectId || !quantityObject(result)
      || !Array.isArray(result.completed) || !Array.isArray(result.drafted) || !Array.isArray(result.unchanged)
      || !sameIds(result.logIds, value.logIds)) {
      invalidQuantityResponse()
    }
    const rows: unknown[] = [...result.completed, ...result.drafted, ...result.unchanged]
    const expected = action.draft.items.map(row => JSON.stringify([row.unitId, row.stageId]))
    const received: string[] = []
    for (const row of rows) {
      if (!quantityObject(row) || !['unitId', 'unitName', 'stageId', 'stageName', 'completionId'].every(key => typeof row[key] === 'string' && String(row[key]).trim())
        || ![null, 'missing-photo', 'missing-assignment'].includes(row.reason as never)) {
        invalidQuantityResponse()
      }
      received.push(JSON.stringify([row.unitId, row.stageId]))
    }
    if (!sameIds(received, expected))
      invalidQuantityResponse()
  }
  else {
    const expectedId = action.kind === 'save-template' || action.kind === 'save-stage'
      ? action.draft.id
      : action.kind === 'delete-template'
        ? action.templateId
        : action.kind === 'set-reporting-stage'
          ? action.itemId
          : ['undo-template', 'set-archived'].includes(action.kind) ? command.projectId : null
    if (expectedId && value.id !== expectedId)
      invalidQuantityResponse()
  }
  return value as unknown as QuantityCommandResult
}
