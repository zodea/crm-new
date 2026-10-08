import type { BoqBuildingCommand, BoqBuildingQuery } from './central-building-contract'
import { ownerCommercialDocumentProblem, OwnerCommercialDocumentRepositoryProblem } from '../owner-document/central-repository'

function invalid(message: string): never {
  throw new OwnerCommercialDocumentRepositoryProblem(ownerCommercialDocumentProblem('validation-failed', message))
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('清单楼栋请求格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000)
    invalid(`${label}不能为空或超长`)
  return value.trim()
}
export function parseBoqBuildingQuery(value: unknown): BoqBuildingQuery {
  const raw = object(value)
  if (!['real', 'demo'].includes(String(raw.origin)))
    invalid('请选择明确的数据来源')
  return { projectId: text(raw.projectId, '项目'), contractId: text(raw.contractId, '施工合同'), origin: raw.origin as BoqBuildingQuery['origin'] }
}
export function parseBoqBuildingCommand(value: unknown): BoqBuildingCommand {
  const raw = object(value)
  const allowed = new Set(['projectId', 'contractId', 'origin', 'commandId', 'workspaceId', 'actorId', 'requiredCapability', 'sourceVersion', 'lineId', 'buildingId', 'reason', 'lineVersion', 'buildingVersion', 'contractVersion'])
  if (Object.keys(raw).some(key => !allowed.has(key)) || raw.requiredCapability !== 'owner-document:write')
    invalid('本命令只允许更正清单楼栋，不能修改量价或来源资格')
  return { ...parseBoqBuildingQuery(raw), requiredCapability: 'owner-document:write', commandId: text(raw.commandId, '提交编号'), workspaceId: text(raw.workspaceId, '工作区'), actorId: text(raw.actorId, '操作人'), sourceVersion: text(raw.sourceVersion, '原始版本'), lineId: text(raw.lineId, '清单行'), buildingId: text(raw.buildingId, '楼栋'), reason: text(raw.reason, '更正依据'), ...(raw.lineVersion !== undefined ? { lineVersion: text(raw.lineVersion, '原行消费版本'), buildingVersion: text(raw.buildingVersion, '所选楼栋版本'), contractVersion: text(raw.contractVersion, '实际施工资格版本') } : {}) }
}
