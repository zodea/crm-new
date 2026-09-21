import type { QuantityHollowLocation, QuantityHollowParty } from './central-hollow-contract'
import type { QuantityHollowResponsibilityProof } from './central-hollow-proof-contract'
import type { QuantityHollowResponsibilityRows, QuantityHollowRow } from './central-hollow-schema'
import { hollowEqual, hollowId, hollowInvalid, hollowJson, hollowKeys } from './central-hollow-primitives'
import { QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS } from './central-hollow-schema'
import { isQuantityHollowTarget } from './central-hollow-validation'

export function isQuantityHollowParty(value: unknown): value is QuantityHollowParty {
  return (hollowKeys(value, ['kind', 'workerId']) && value.kind === 'worker' && hollowId(value.workerId)) || (hollowKeys(value, ['kind', 'crewId']) && value.kind === 'crew' && hollowId(value.crewId))
}
const locationKeys = ['projectId', 'buildingId', 'floorId', 'unitId', 'templateId', 'templateLineId', 'roomId', 'itemId', 'buildingName', 'floorName', 'unitName', 'roomName', 'itemName', 'locationLabel'] as const
export function isQuantityHollowLocation(value: unknown): value is QuantityHollowLocation {
  return hollowKeys(value, locationKeys) && Object.values(value).every(hollowId)
}

/** 冻结原责任内部自洽；不要求后来当前姓名、归属或软删状态仍相同。 */
export function parseQuantityHollowResponsibility(value: unknown): QuantityHollowResponsibilityProof {
  if (!hollowKeys(value, ['schemaVersion', 'target', 'ownershipKey', 'originalParty', 'location', 'scopeKind', 'rows']) || value.schemaVersion !== 1 || !isQuantityHollowTarget(value.target) || !isQuantityHollowParty(value.originalParty) || !isQuantityHollowLocation(value.location) || !['selected', 'whole-trade'].includes(String(value.scopeKind)) || !hollowKeys(value.rows, Object.keys(QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS)))
    return hollowInvalid('原施工责任证明结构不完整')
  const rows = {} as QuantityHollowResponsibilityRows
  for (const table of Object.keys(QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS) as (keyof typeof QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS)[]) {
    const source = value.rows[table]
    const columns = QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS[table]
    if (!Array.isArray(source) || source.some(row => !hollowKeys(row, columns) || !hollowId(row.id) || Object.values(row).some(field => field !== null && typeof field !== 'string')) || new Set(source.map(row => row.id)).size !== source.length)
      return hollowInvalid('原责任行字段或身份无效')
    rows[table] = source as QuantityHollowRow[]
  }
  const one = (table: keyof QuantityHollowResponsibilityRows): QuantityHollowRow => rows[table].length === 1 ? rows[table][0]! : hollowInvalid('原责任祖先不唯一')
  const project = one('projects')
  const building = one('buildings')
  const floor = one('floors')
  const unit = one('units')
  const template = one('house_type_templates')
  const assignment = one('unit_assignments')
  const target = value.target
  const party = value.originalParty
  const person = party.kind === 'worker' ? one('workers') : one('crews')
  if (rows[party.kind === 'worker' ? 'crews' : 'workers'].length || person.id !== (party.kind === 'worker' ? party.workerId : party.crewId) || assignment.worker_id !== (party.kind === 'worker' ? party.workerId : null) || assignment.crew_id !== (party.kind === 'crew' ? party.crewId : null))
    return hollowInvalid('原施工责任主体与原指派不一致')
  if (project.id !== value.location.projectId || building.project_id !== project.id || floor.building_id !== building.id || unit.floor_id !== floor.id || template.project_id !== project.id || unit.house_type_template_id !== template.id || assignment.unit_id !== unit.id || assignment.id !== target.assignmentId || unit.id !== target.unitId || !hollowId(assignment.trade))
    return hollowInvalid('原施工责任项目或部位关系不一致')
  const scopes = rows.unit_assignment_scopes
  if ((value.scopeKind === 'selected') !== (scopes.length > 0) || scopes.some(scope => scope.assignment_id !== assignment.id) || (scopes.length && !scopes.some(scope => scope.room_id === target.roomId && scope.item_id === target.itemId)))
    return hollowInvalid('原个人细分范围不完整，不能扩大为整户')
  const cells = new Set([JSON.stringify([target.roomId, target.itemId]), ...scopes.map(scope => JSON.stringify([scope.room_id, scope.item_id]))])
  if (new Set(scopes.map(scope => JSON.stringify([scope.room_id, scope.item_id]))).size !== scopes.length)
    return hollowInvalid('原细分范围存在重复格子')
  if (rows.house_type_template_items.length !== cells.size || rows.house_type_template_items.some(line => !cells.has(JSON.stringify([line.room_id, line.item_id]))) || new Set(rows.house_type_template_items.map(line => JSON.stringify([line.room_id, line.item_id]))).size !== cells.size)
    return hollowInvalid('原房间分项缺少唯一适用明细')
  if (rows.rooms.length !== new Set(rows.house_type_template_items.map(line => line.room_id)).size || rows.items.length !== new Set(rows.house_type_template_items.map(line => line.item_id)).size || rows.rooms.some(room => room.template_id !== template.id) || rows.items.some(item => item.project_id !== project.id || item.trade !== assignment.trade) || rows.house_type_template_items.some(line => !rows.rooms.some(room => room.id === line.room_id) || !rows.items.some(item => item.id === line.item_id)))
    return hollowInvalid('原房间分项不属于原户型工种')
  for (const [table, entries] of Object.entries(rows)) {
    if (table !== 'operation_logs' && entries.some(row => row.deleted_at !== null))
      return hollowInvalid('初建原责任包含当时不可用的祖先或细分范围')
  }
  const audited = new Set(rows.operation_logs.map(log => JSON.stringify([log.table_name, log.record_id])))
  const expectedAudits = [['unit_assignments', assignment.id], ...scopes.map(scope => ['unit_assignment_scopes', scope.id])]
  if (rows.operation_logs.length !== expectedAudits.length || audited.size !== expectedAudits.length || expectedAudits.some(identity => !audited.has(JSON.stringify(identity))))
    return hollowInvalid('原指派或个人细分范围缺少唯一创建审计')
  for (const log of rows.operation_logs) {
    if (log.action !== 'create' || !['unit_assignments', 'unit_assignment_scopes'].includes(String(log.table_name)))
      return hollowInvalid('原责任审计种类不明确')
    const raw = hollowJson(log.after_data)
    const original = rows[log.table_name as 'unit_assignments' | 'unit_assignment_scopes'].find(row => row.id === log.record_id)
    if (!original || !raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.entries(original).filter(([key]) => key !== 'deleted_at').every(([key, field]) => (raw as Record<string, unknown>)[key] === field))
      return hollowInvalid('原责任审计与所保存的主体或范围不一致')
  }
  const room = rows.rooms.find(row => row.id === target.roomId)!
  const item = rows.items.find(row => row.id === target.itemId)!
  const line = rows.house_type_template_items.find(row => row.room_id === target.roomId && row.item_id === target.itemId)!
  const labels = [building.name, floor.name, unit.name || unit.code, room.name, item.name]
  if (!labels.every(hollowId) || !hollowId(person.name))
    return hollowInvalid('原责任姓名或位置标签不完整')
  const location = { projectId: String(project.id), buildingId: String(building.id), floorId: String(floor.id), unitId: String(unit.id), templateId: String(template.id), templateLineId: String(line.id), roomId: target.roomId, itemId: target.itemId, buildingName: String(building.name), floorName: String(floor.name), unitName: String(unit.name || unit.code), roomName: String(room.name), itemName: String(item.name), locationLabel: labels.join(' / ') }
  if (!hollowEqual(location, value.location) || value.ownershipKey !== JSON.stringify([project.id, unit.id, assignment.id, room.id, item.id]))
    return hollowInvalid('原责任位置或归属键与原件不一致')
  return { schemaVersion: 1, target, ownershipKey: value.ownershipKey as string, originalParty: party, location, scopeKind: value.scopeKind as QuantityHollowResponsibilityProof['scopeKind'], rows }
}
