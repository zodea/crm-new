import type { QuantityBatchReadQuery, QuantityCommand, QuantityReadQuery, QuantityUnitReadQuery } from '../../app/lib/quantity/central-contract'
import type { QuantityPhotoIdentity } from '../../app/lib/quantity/central-photo'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { isQuantityHollowActionKind, parseQuantityHollowCommand } from '../../app/lib/quantity/central-hollow-validation'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseQuantityReadQuery(value: unknown): QuantityReadQuery {
  if (!object(value) || typeof value.projectId !== 'string' || !value.projectId.trim()
    || ![undefined, false, true, 'false', 'true'].includes(value.includeDemo as never)) {
    throw quantityProblem('invalid-query', '工程量查询需要有效项目和来源')
  }
  if (value.origin !== 'real')
    throw quantityProblem('forbidden', '正式工程量服务不接受其他数据来源')
  return { projectId: value.projectId, origin: 'real', includeDemo: value.includeDemo === true || value.includeDemo === 'true' }
}

function field(value: unknown, key: string): string {
  if (!object(value) || typeof value[key] !== 'string' || !String(value[key]).trim())
    throw quantityProblem('invalid-query', '工程量查询缺少有效户、工种或照片归属')
  return value[key] as string
}

export function parseQuantityUnitReadQuery(value: unknown): QuantityUnitReadQuery {
  return { ...parseQuantityReadQuery(value), unitId: field(value, 'unitId') }
}

export function parseQuantityBatchReadQuery(value: unknown): QuantityBatchReadQuery {
  const scope = parseQuantityReadQuery(value)
  const trade = field(value, 'trade')
  const raw = object(value) ? value.unitIds : undefined
  const unitIds = typeof raw === 'string' ? [raw] : raw
  if (!Array.isArray(unitIds) || !unitIds.length || !unitIds.every(id => typeof id === 'string' && id.trim())
    || new Set(unitIds).size !== unitIds.length) {
    throw quantityProblem('invalid-query', '批量工程量查询需要不重复的有效户')
  }
  return { ...scope, trade, unitIds: [...unitIds] }
}

export function parseQuantityPhotoReadQuery(value: unknown): QuantityReadQuery & QuantityPhotoIdentity {
  return { ...parseQuantityUnitReadQuery(value), completionId: field(value, 'completionId'), photoId: field(value, 'photoId') }
}

export function parseQuantityCommand(value: unknown): QuantityCommand {
  closedQuantityRequest(value, ['workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'origin', 'projectId', 'action'])
  if (object(value) && object(value.action) && isQuantityHollowActionKind(value.action.kind))
    return parseQuantityHollowCommand(value)
  if (!object(value) || !['workspaceId', 'actorId', 'commandId', 'projectId', 'baseVersion'].every(key => typeof value[key] === 'string' && String(value[key]).trim())
    || value.requiredCapability !== 'quantity:write' || value.origin !== 'real' || !object(value.action)) {
    throw quantityProblem('validation-failed', '工程量命令身份、版本或动作格式无效')
  }
  const action = value.action
  const draftKeys: Record<string, string[]> = {
    'create-building': ['code', 'name'],
    'create-floor': ['code', 'name'],
    'create-unit': ['code', 'name', 'templateId'],
    'save-template': ['id', 'projectId', 'code', 'name', 'copiedFromTemplateId', 'sortOrder', 'expectedUpdatedAt', 'rooms', 'newItems', 'lines', 'allowArchivedEdit'],
    'save-stage': ['id', 'code', 'name', 'trade', 'completionMode', 'sortOrder', 'itemIds'],
    'save-assignments': ['projectId', 'trade', 'assigneeKind', 'assigneeId', 'unitIds', 'expectedAssignments', 'scopes', 'note', 'allowReplacement', 'allowArchivedEdit'],
    'save-completion': ['projectId', 'unitId', 'stageId', 'status', 'completedAt', 'note', 'photos', 'expectedCompletionId', 'expectedCompletionFingerprint', 'expectedAssignmentId', 'allowArchivedEdit'],
    'save-completion-batch': ['projectId', 'trade', 'completedAt', 'note', 'items', 'allowArchivedEdit'],
  }
  const actionKeys: Record<string, string[]> = {
    'create-building': ['kind', 'draft'],
    'create-floor': ['kind', 'buildingId', 'draft'],
    'create-unit': ['kind', 'floorId', 'draft'],
    'save-template': ['kind', 'draft'],
    'delete-template': ['kind', 'templateId', 'allowArchivedEdit'],
    'undo-template': ['kind', 'logIds', 'allowArchivedEdit'],
    'save-stage': ['kind', 'draft', 'allowArchivedEdit'],
    'set-reporting-stage': ['kind', 'itemId', 'stageId', 'allowArchivedEdit'],
    'save-assignments': ['kind', 'draft'],
    'save-completion': ['kind', 'draft'],
    'save-completion-batch': ['kind', 'draft'],
    'set-archived': ['kind', 'archived'],
    'import-row': ['kind', 'target', 'row', 'unitId', 'assignee'],
  }
  const kind = String(action.kind)
  if (!Object.hasOwn(actionKeys, kind))
    throw quantityProblem('validation-failed', '工程量命令动作尚未定义')
  closedQuantityRequest(action, actionKeys[kind]!)
  if (Object.hasOwn(draftKeys, kind))
    closedQuantityRequest(action.draft, draftKeys[kind]!)
  if (object(action.draft)) {
    const draft = action.draft
    if (kind === 'save-template') {
      closedQuantityRows(draft.rooms, ['key', 'id', 'sourceRoomId', 'code', 'name', 'kind', 'sortOrder'])
      closedQuantityRows(draft.newItems, ['key', 'code', 'name', 'section', 'trade', 'unit', 'sortOrder'])
      closedQuantityRows(draft.lines, ['key', 'id', 'sourceLineId', 'sourceRoomId', 'sourceItemId', 'boqLineId', 'boqBindingVersion', 'roomKey', 'itemId', 'recognizedContractQty', 'contractQty', 'provisionalQty', 'fieldFormula', 'fieldQty', 'note', 'sortOrder'])
    }
    if (kind === 'save-assignments') {
      closedQuantityRows(draft.expectedAssignments, ['unitId', 'assignmentId', 'fingerprint'])
      closedQuantityRows(draft.scopes, ['unitId', 'roomId', 'itemId'])
    }
    if (kind === 'save-completion')
      closedQuantityRows(draft.photos, ['fileName', 'mimeType', 'fileSize', 'contentBase64'])
    if (kind === 'save-completion-batch')
      closedQuantityRows(draft.items, ['unitId', 'stageId', 'expectedCompletionId', 'expectedCompletionFingerprint', 'expectedAssignmentId'])
  }
  if (kind === 'import-row' && action.assignee !== null)
    closedQuantityRequest(action.assignee, ['kind', 'id'])
  // 各动作的完整草稿及当前父关系由中央服务在同一事务边界内验证。
  return structuredClone(value) as unknown as QuantityCommand
}

function closedQuantityRequest(value: unknown, keys: readonly string[]) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw quantityProblem('validation-failed', '工程量请求包含未定义字段，请保留原输入重新核对')
}
function closedQuantityRows(value: unknown, keys: readonly string[]) {
  if (!Array.isArray(value))
    throw quantityProblem('validation-failed', '工程量明细必须是已定义的记录集合')
  for (const row of value) closedQuantityRequest(row, keys)
}

export function parseQuantityHollowReadQuery(value: unknown): QuantityUnitReadQuery {
  if (!object(value) || Object.keys(value).some(key => !['projectId', 'unitId', 'origin', 'includeDemo'].includes(key)))
    throw quantityProblem('invalid-query', '空鼓查询包含不明确的来源字段')
  return parseQuantityUnitReadQuery(value)
}
