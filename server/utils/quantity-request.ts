import type { QuantityBatchReadQuery, QuantityCommand, QuantityReadQuery, QuantityUnitReadQuery } from '../../app/lib/quantity/central-contract'
import type { QuantityPhotoIdentity } from '../../app/lib/quantity/central-photo'
import { quantityProblem } from '../../app/lib/quantity/central-contract'

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
  if (!object(value) || !['workspaceId', 'actorId', 'commandId', 'projectId', 'baseVersion'].every(key => typeof value[key] === 'string' && String(value[key]).trim())
    || value.requiredCapability !== 'quantity:write' || value.origin !== 'real' || !object(value.action)) {
    throw quantityProblem('validation-failed', '工程量命令身份、版本或动作格式无效')
  }
  // 各动作的完整草稿及当前父关系由中央服务在同一事务边界内验证。
  return structuredClone(value) as unknown as QuantityCommand
}
