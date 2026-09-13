import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAQuantityDiagnostic, PayrollAQuantityFact, PayrollAQuantityFacts, PayrollAQuantityQuery } from '../../app/lib/payroll/central-a-contract'
import { createHash } from 'node:crypto'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { isISODateDTO, isISODateTimeDTO } from '../../app/types/read-model'

type Row = Record<string, string | number | null>
const tableNames = ['projects', 'buildings', 'floors', 'house_type_templates', 'units', 'rooms', 'items', 'construction_stages', 'construction_stage_items', 'house_type_template_items', 'unit_assignments', 'unit_assignment_scopes', 'unit_stage_completions', 'workers', 'crews'] as const
type Table = typeof tableNames[number]
const parents: Partial<Record<Table, Array<[string, Table]>>> = {
  buildings: [['project_id', 'projects']],
  floors: [['building_id', 'buildings']],
  house_type_templates: [['project_id', 'projects']],
  units: [['floor_id', 'floors'], ['house_type_template_id', 'house_type_templates']],
  rooms: [['template_id', 'house_type_templates']],
  items: [['project_id', 'projects']],
  construction_stages: [['project_id', 'projects']],
  construction_stage_items: [['stage_id', 'construction_stages'], ['item_id', 'items']],
  house_type_template_items: [['room_id', 'rooms'], ['item_id', 'items']],
  unit_assignments: [['unit_id', 'units']],
  unit_assignment_scopes: [['assignment_id', 'unit_assignments'], ['room_id', 'rooms'], ['item_id', 'items']],
  unit_stage_completions: [['unit_id', 'units'], ['stage_id', 'construction_stages'], ['assignment_id', 'unit_assignments']],
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
function active(row: Row | undefined): row is Row {
  return !!row && row.deleted_at === null
}
function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function auditRow(value: unknown): Row | null {
  if (typeof value !== 'string')
    return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      && Object.values(parsed).every(field => field === null || typeof field === 'string' || typeof field === 'number')
      ? parsed as Row
      : null
  }
  catch { return null }
}

/** 工资调用方持有 workspace transaction；物理责任/范围先保全，再判断当前施工来源资格。 */
export async function loadPayrollAQuantityFacts(db: TransactionDb, query: PayrollAQuantityQuery): Promise<PayrollAQuantityFacts> {
  if (!query.projectId || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(query.month))
    throw payrollProblem('validation-failed', '工资来源必须指定真实项目和有效月份')
  const entries = await Promise.all(tableNames.map(async table => [table, await db.select<Row>(`SELECT * FROM ${table} ORDER BY id`)] as const))
  const tables = Object.fromEntries(entries) as Record<Table, Row[]>
  const maps = Object.fromEntries(entries.map(([table, rows]) => [table, new Map(rows.map(row => [row.id, row]))])) as Record<Table, Map<string | number | null, Row>>
  const get = (table: Table, id: unknown) => typeof id === 'string' ? maps[table].get(id) : undefined
  function projects(table: Table, row: Row | undefined): Set<string> {
    if (!row)
      return new Set()
    if (table === 'projects')
      return new Set([String(row.id)])
    return new Set((parents[table] ?? []).flatMap(([field, parent]) => [...projects(parent, get(parent, row[field]))]))
  }
  const relevant = Object.fromEntries(entries.map(([table, rows]) => [table, rows.filter(row => projects(table, row).has(query.projectId))])) as Record<Table, Row[]>
  const assignees = relevant.unit_assignments
  relevant.workers = tables.workers.filter(row => assignees.some(assignment => assignment.worker_id === row.id))
  relevant.crews = tables.crews.filter(row => assignees.some(assignment => assignment.crew_id === row.id))
  const rows: PayrollAQuantityFact[] = []
  const diagnostics: PayrollAQuantityDiagnostic[] = []
  // 只识别工程量领域已知 create 原行，不从任意 JSON 字段或当前责任猜历史身份。
  const logs = await db.select<Row>(`SELECT * FROM operation_logs WHERE action='create' AND table_name IN ('unit_assignments','unit_assignment_scopes') ORDER BY id`)
  const proof = logs.map(log => ({ log, row: auditRow(log.after_data) })).filter(entry => entry.row?.id === entry.log.record_id)
  const usedProof: Row[] = []
  for (const completion of relevant.unit_stage_completions) {
    if (!active(completion) || completion.status !== 'completed')
      continue
    const completedAt = text(completion.completed_at)
    const assignment = get('unit_assignments', completion.assignment_id)
    const unit = get('units', completion.unit_id)
    const floor = get('floors', unit?.floor_id)
    const building = get('buildings', floor?.building_id)
    const template = get('house_type_templates', unit?.house_type_template_id)
    const stage = get('construction_stages', completion.stage_id)
    const scopeRows = tables.unit_assignment_scopes.filter(scope => scope.assignment_id === assignment?.id)
    const assignmentProof = proof.filter(entry => entry.log.table_name === 'unit_assignments' && entry.log.record_id === completion.assignment_id && entry.row?.unit_id === completion.unit_id && entry.row?.trade === stage?.trade)
    const originalSubjects = new Set(assignmentProof.map(entry => JSON.stringify([entry.row!.worker_id, entry.row!.crew_id])))
    const diagnosticAssignment = assignment ?? (originalSubjects.size === 1 ? assignmentProof[0]?.row : null)
    usedProof.push(...assignmentProof.map(entry => entry.log))
    const workerId = text(diagnosticAssignment?.worker_id)
    const crewId = text(diagnosticAssignment?.crew_id)
    function diagnose(code: string, message: string, roomId: string | null = null, itemId: string | null = null) {
      diagnostics.push({ code, message, affects: (workerId === null) !== (crewId === null) ? 'subject' : 'project', completionId: text(completion.id), assignmentId: text(completion.assignment_id), workerId, crewId, unitId: text(completion.unit_id), roomId, itemId })
    }
    if (!isISODateDTO(completedAt) && !isISODateTimeDTO(completedAt)) {
      diagnose('completion-date-invalid', '已完成记录缺少可确认的施工完成日期')
      continue
    }
    if (completedAt.slice(0, 7) > query.month)
      continue
    if (!assignment || (workerId === null) === (crewId === null) || assignment.unit_id !== completion.unit_id || assignment.trade !== stage?.trade) {
      diagnose('assignment-unproven', '完成时的施工责任缺失或与户、工种不一致，不能使用当前责任替代')
      continue
    }
    const originalScopes = proof.filter(entry => entry.log.table_name === 'unit_assignment_scopes' && entry.row?.assignment_id === assignment.id)
    usedProof.push(...originalScopes.map(entry => entry.log))
    const missingScopes = originalScopes.filter(entry => !scopeRows.some(scope => scope.id === entry.row!.id))
    for (const entry of missingScopes)
      diagnose('assignment-scope-incomplete', '原审计保存的个人责任范围行已缺失，不能扩大成整户范围', text(entry.row!.room_id), text(entry.row!.item_id))
    if (missingScopes.length && !scopeRows.length)
      continue
    if (![unit, floor, building, template, stage].every(active) || !active(get('projects', query.projectId)) || building?.project_id !== query.projectId || template?.project_id !== query.projectId || stage?.project_id !== query.projectId || stage?.completion_mode !== 'unit') {
      diagnose('completion-scope-unavailable', '原完成记录的项目、楼栋、户、户型或施工阶段已缺失或停用，请先核对来源')
      continue
    }
    const stageItems = tables.construction_stage_items.filter(mapping => mapping.stage_id === stage!.id)
    if (!stageItems.length) {
      diagnose('reporting-stage-missing', '已完成阶段缺少原分项适用关系，不能按当前同名分项补接')
      continue
    }
    // 即使房间/分项不可见，原 scope 也不能在 JOIN 中消失后被解释为整户。
    for (const scope of scopeRows) {
      const room = get('rooms', scope.room_id)
      const item = get('items', scope.item_id)
      const quantityRows = tables.house_type_template_items.filter(line => line.room_id === scope.room_id && line.item_id === scope.item_id)
      if (!active(room) || room.template_id !== template!.id || !active(item) || item.project_id !== query.projectId || item.trade !== assignment.trade || !quantityRows.some(active))
        diagnose('assignment-scope-incomplete', '原个人细分责任的房间、分项或现场量明细缺失，不能扩大成整户范围', text(scope.room_id), text(scope.item_id))
    }
    for (const mapping of stageItems) {
      const item = get('items', mapping.item_id)
      if (!active(mapping) || mapping.is_reporting_stage !== 1) {
        const reporting = tables.construction_stage_items.some(other => active(other) && other.item_id === mapping.item_id && other.is_reporting_stage === 1 && active(get('construction_stages', other.stage_id)))
        if (!reporting)
          diagnose('reporting-stage-missing', '原施工分项没有有效报量阶段，不能生成工资数量', null, text(mapping.item_id))
        continue
      }
      if (!active(item) || item.project_id !== query.projectId || item.trade !== assignment.trade) {
        diagnose('item-unavailable', '报量阶段的原施工分项已缺失、停用或不属于原项目工种', null, text(mapping.item_id))
        continue
      }
      const quantityRows = tables.house_type_template_items.filter(line => line.item_id === item.id && get('rooms', line.room_id)?.template_id === template!.id)
      if (!quantityRows.length)
        diagnose('quantity-detail-missing', '原报量分项缺少户型现场量明细，不能按零数量处理', null, text(item.id))
      for (const line of quantityRows) {
        if (scopeRows.length && !scopeRows.some(scope => scope.room_id === line.room_id && scope.item_id === item.id))
          continue
        const room = get('rooms', line.room_id)
        if (!active(line) || !active(room)) {
          if (!scopeRows.length)
            diagnose('quantity-detail-missing', '原房间或现场量明细已停用，不能默默丢弃适用范围', text(line.room_id), text(item.id))
          continue
        }
        const fieldQty = typeof line.field_qty === 'number' && Number.isFinite(line.field_qty) ? line.field_qty : null
        const measurementUnit = text(item.unit)
        if (fieldQty === null)
          diagnose('field-quantity-missing', '原施工范围的现场复核量未记录，已知小计不能代表完整数量', text(room.id), text(item.id))
        if (measurementUnit === null)
          diagnose('quantity-unit-missing', '原施工分项未记录计量单位，不能从同名分项或合同清单补齐', text(room.id), text(item.id))
        const source = { completion, assignment, scopeRows, unit, floor, building, template, stage, mapping, item, room, line }
        rows.push({ ownershipKey: JSON.stringify([query.projectId, unit!.id, assignment.id, room.id, item.id]), completionId: String(completion.id), assignmentId: String(assignment.id), stageId: String(stage!.id), stageItemId: String(mapping.id), unitId: String(unit!.id), floorId: String(floor!.id), buildingId: String(building!.id), templateId: String(template!.id), templateLineId: String(line.id), roomId: String(room.id), itemId: String(item.id), completedAt, workerId, crewId, assignmentScopeIds: scopeRows.map(scope => String(scope.id)), scopeKind: scopeRows.length ? 'selected' : 'whole-trade', scopeRows: scopeRows.map(scope => ({ id: String(scope.id), roomId: String(scope.room_id), itemId: String(scope.item_id), deletedAt: text(scope.deleted_at) })), unit: measurementUnit, fieldQty, fieldFormula: text(line.field_formula), buildingName: text(building!.name), floorName: text(floor!.name), unitName: text(unit!.name) ?? text(unit!.code), templateName: text(template!.name), roomName: text(room.name), itemName: text(item.name), workerName: text(get('workers', workerId)?.name), crewName: text(get('crews', crewId)?.name), sourceFingerprint: fingerprint(source) })
      }
    }
  }
  return { sourceVersion: `payroll-a-quantity:${fingerprint({ query, relevant, usedProof, diagnostics })}`, rows, diagnostics }
}
