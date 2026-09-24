import type { QuantityAssignmentAssignee } from './assignment'
import type { QuantityRegionWorkspace } from './region'
import { quantityProblem } from './central-contract'
import { QUANTITY_ASSIGNMENT_IMPORT_FIELDS, QUANTITY_COMPLETION_IMPORT_FIELDS, QUANTITY_TEMPLATE_IMPORT_FIELDS } from './import'

export type QuantityImportTarget = 'template' | 'assignment' | 'completion'
export interface QuantityImportAction {
  kind: 'import-row'
  target: QuantityImportTarget
  row: Record<string, string>
  unitId: string | null
  assignee: { kind: 'crew' | 'worker', id: string } | null
}

const fields = { template: QUANTITY_TEMPLATE_IMPORT_FIELDS, assignment: QUANTITY_ASSIGNMENT_IMPORT_FIELDS, completion: QUANTITY_COMPLETION_IMPORT_FIELDS }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 文件只描述日常业务字段；迁移放宽选项、照片正文和任意数据库字段均不可进入命令。 */
export function normalizeQuantityImportRow(target: QuantityImportTarget, input: Record<string, unknown>): Record<string, string> {
  if (!Object.hasOwn(fields, target))
    throw quantityProblem('validation-failed', '工程量导入目标无效')
  const definitions = fields[target]
  const allowed = new Set(definitions.map(field => field.key))
  if (Object.keys(input).some(key => !allowed.has(key)))
    throw quantityProblem('validation-failed', '工程量导入包含该目标不支持的字段')
  const row: Record<string, string> = {}
  for (const field of definitions) {
    const value = input[field.key]
    if (value !== null && value !== undefined && !['string', 'number', 'boolean'].includes(typeof value))
      throw quantityProblem('validation-failed', `「${field.label}」必须是单个文本或数字`)
    row[field.key] = value == null ? '' : String(value).trim()
    if (field.required && !row[field.key])
      throw quantityProblem('validation-failed', `缺少${field.label}`)
  }
  return row
}

export function parseQuantityImportAction(value: unknown): QuantityImportAction | null {
  if (!object(value) || value.kind !== 'import-row')
    return null
  if (!['template', 'assignment', 'completion'].includes(String(value.target)) || !object(value.row))
    throw quantityProblem('validation-failed', '工程量导入请求无效')
  const target = value.target as QuantityImportTarget
  if (target === 'template' ? value.unitId !== null : typeof value.unitId !== 'string' || !value.unitId.trim())
    throw quantityProblem('validation-failed', '工程量导入缺少明确的目标户身份')
  let assignee: QuantityImportAction['assignee'] = null
  if (target === 'assignment') {
    const identity = value.assignee
    if (!object(identity) || !['crew', 'worker'].includes(String(identity.kind)) || typeof identity.id !== 'string' || !identity.id.trim())
      throw quantityProblem('validation-failed', '工程量导入责任身份无效')
    assignee = { kind: identity.kind as 'crew' | 'worker', id: identity.id }
  }
  else if (value.assignee !== null) {
    throw quantityProblem('validation-failed', '工程量导入责任身份无效')
  }
  return { kind: 'import-row', target, row: normalizeQuantityImportRow(target, value.row), unitId: value.unitId as string | null, assignee }
}

export function resolveQuantityImportUnit(workspace: QuantityRegionWorkspace, row: Record<string, string>): string {
  const buildings = workspace.buildings.filter(item => item.code === row.buildingCode)
  const floors = workspace.floors.filter(item => item.code === row.floorCode && buildings.some(building => building.id === item.buildingId))
  const units = workspace.units.filter(item => item.code === row.unitCode && floors.some(floor => floor.id === item.floorId))
  if (units.length !== 1)
    throw quantityProblem('validation-failed', `户「${row.buildingCode}-${row.floorCode}-${row.unitCode}」${units.length ? '不唯一' : '不存在'}，请核对完整区域编码`)
  return units[0]!.id
}

export function resolveQuantityImportAssignee(assignees: readonly Pick<QuantityAssignmentAssignee, 'id' | 'kind' | 'name'>[], row: Record<string, string>): NonNullable<QuantityImportAction['assignee']> {
  if (Boolean(row.crewName) === Boolean(row.workerName))
    throw quantityProblem('validation-failed', '班组名称与工人姓名必须二选一')
  const kind = row.crewName ? 'crew' : 'worker'
  const name = row.crewName || row.workerName
  const matches = assignees.filter(item => item.kind === kind && item.name === name)
  if (matches.length !== 1)
    throw quantityProblem('validation-failed', `${kind === 'crew' ? '班组' : '工人'}「${name}」${matches.length ? '不唯一，请先核对主数据名称' : '不在当前可读主数据中'}`)
  return { kind, id: matches[0]!.id }
}
