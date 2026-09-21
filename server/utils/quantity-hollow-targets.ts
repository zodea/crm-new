import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityHollowDiagnostic, QuantityHollowTarget } from '../../app/lib/quantity/central-hollow-contract'
import type { QuantityHollowResponsibilityProof } from '../../app/lib/quantity/central-hollow-proof-contract'
import type { QuantityHollowResponsibilityRows, QuantityHollowResponsibilityTable, QuantityHollowRow } from '../../app/lib/quantity/central-hollow-schema'
import { hollowId, hollowJson } from '../../app/lib/quantity/central-hollow-primitives'
import { parseQuantityHollowResponsibility } from '../../app/lib/quantity/central-hollow-responsibility'
import { QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS } from '../../app/lib/quantity/central-hollow-schema'

const active = (row: QuantityHollowRow | undefined): row is QuantityHollowRow => !!row && row.deleted_at === null

/** 当前候选只用于新建，历史证明不重新套用当前目录。 */
export async function loadQuantityHollowTargets(db: TransactionDb, projectId: string, unitId: string) {
  const source = {} as QuantityHollowResponsibilityRows
  for (const table of Object.keys(QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS) as QuantityHollowResponsibilityTable[]) source[table] = await db.select<QuantityHollowRow>(`SELECT ${QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS[table].join(',')} FROM ${table} ORDER BY id`)
  const find = (table: QuantityHollowResponsibilityTable, id: unknown) => source[table].find(row => row.id === id)
  const unit = find('units', unitId)
  const floor = find('floors', unit?.floor_id)
  const building = find('buildings', floor?.building_id)
  const template = find('house_type_templates', unit?.house_type_template_id)
  const project = find('projects', projectId)
  const visible = [project, unit, floor, building, template].every(active) && building?.project_id === projectId && template?.project_id === projectId
  const proofs: QuantityHollowResponsibilityProof[] = []
  const unavailable: QuantityHollowDiagnostic[] = []
  if (!visible) {
    unavailable.push({ code: 'target-unavailable', message: '原户或所属项目、楼栋、楼层、户型已缺失或停用', recordId: null, target: null })
    return { proofs, unavailable, visible, fingerprintSource: [project, unit, floor, building, template] }
  }
  const relevant: unknown[] = []
  for (const assignment of source.unit_assignments.filter(row => row.unit_id === unitId && active(row))) {
    const scopes = source.unit_assignment_scopes.filter(row => row.assignment_id === assignment.id)
    const logs = source.operation_logs.filter((log) => {
      if (log.action !== 'create')
        return false
      if (log.table_name === 'unit_assignments')
        return log.record_id === assignment.id
      if (log.table_name !== 'unit_assignment_scopes')
        return false
      try {
        const row = hollowJson(log.after_data)
        return row !== null && typeof row === 'object' && 'assignment_id' in row && row.assignment_id === assignment.id
      }
      catch { return scopes.some(scope => scope.id === log.record_id) }
    })
    const available = source.house_type_template_items.filter(line => active(line) && active(find('rooms', line.room_id)) && find('rooms', line.room_id)?.template_id === template!.id && active(find('items', line.item_id)) && find('items', line.item_id)?.project_id === projectId && find('items', line.item_id)?.trade === assignment.trade)
    const selected = available.filter(line => !scopes.length || scopes.some(scope => scope.room_id === line.room_id && scope.item_id === line.item_id))
    relevant.push({ assignment, scopes, logs, available, subject: find(assignment.worker_id ? 'workers' : 'crews', assignment.worker_id ?? assignment.crew_id) })
    if (!selected.length)
      unavailable.push({ code: 'scope-incomplete', message: '原施工责任没有可确认的房间分项，不能视为已排查零处', recordId: null, target: null })
    for (const line of selected) {
      const target: QuantityHollowTarget = { unitId, assignmentId: String(assignment.id), roomId: String(line.room_id), itemId: String(line.item_id) }
      try {
        const cells = new Set([JSON.stringify([line.room_id, line.item_id]), ...scopes.map(scope => JSON.stringify([scope.room_id, scope.item_id]))])
        const lines = source.house_type_template_items.filter(row => cells.has(JSON.stringify([row.room_id, row.item_id])))
        const rows: QuantityHollowResponsibilityRows = { projects: [project!], buildings: [building!], floors: [floor!], units: [unit!], house_type_templates: [template!], rooms: source.rooms.filter(row => lines.some(cell => cell.room_id === row.id)), items: source.items.filter(row => lines.some(cell => cell.item_id === row.id)), house_type_template_items: lines, unit_assignments: [assignment], unit_assignment_scopes: scopes, workers: source.workers.filter(row => row.id === assignment.worker_id), crews: source.crews.filter(row => row.id === assignment.crew_id), operation_logs: logs }
        const room = find('rooms', line.room_id)!
        const item = find('items', line.item_id)!
        const labels = [building!.name, floor!.name, unit!.name || unit!.code, room.name, item.name]
        const location = { projectId, buildingId: building!.id, floorId: floor!.id, unitId, templateId: template!.id, templateLineId: line.id, roomId: room.id, itemId: item.id, buildingName: building!.name, floorName: floor!.name, unitName: unit!.name || unit!.code, roomName: room.name, itemName: item.name, locationLabel: labels.join(' / ') }
        const originalParty = hollowId(assignment.worker_id) ? { kind: 'worker', workerId: assignment.worker_id } : { kind: 'crew', crewId: assignment.crew_id }
        proofs.push(parseQuantityHollowResponsibility({ schemaVersion: 1, target, ownershipKey: JSON.stringify([projectId, unitId, assignment.id, line.room_id, line.item_id]), originalParty, location, scopeKind: scopes.length ? 'selected' : 'whole-trade', rows }))
      }
      catch (cause) { unavailable.push({ code: 'scope-incomplete', message: cause instanceof Error ? cause.message : '原责任范围不能证明', recordId: null, target }) }
    }
  }
  return { proofs, unavailable, visible, fingerprintSource: [project, unit, floor, building, template, relevant] }
}
