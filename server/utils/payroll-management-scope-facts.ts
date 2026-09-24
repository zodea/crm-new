import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAContext } from '../../app/lib/payroll/central-a-contract'
import type { PayrollAManagementScopeFacts } from '../../app/lib/payroll/central-a-fees-contract'
import { createHash } from 'node:crypto'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollANavigation } from './payroll-a-options'

type Row = Record<string, string | number | null>
const tables = ['projects', 'buildings', 'floors', 'units', 'house_type_templates', 'rooms', 'items', 'house_type_template_items', 'unit_assignments', 'unit_assignment_scopes', 'workers', 'crews'] as const
const active = (row: Row | undefined): row is Row => !!row && row.deleted_at === null
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null

/** 只读取明确责任及物理格子；配置范围无需完成记录，也不生成任何完成事实。 */
export async function loadPayrollAManagementScopeFacts(db: TransactionDb, query: { projectId: string }, context: PayrollAContext): Promise<PayrollAManagementScopeFacts> {
  if (context.origin !== 'real' || !context.capabilities.includes('payroll:read'))
    throw payrollProblem('forbidden', '没有正式工资责任范围读取权限')
  if (!query.projectId)
    throw payrollProblem('validation-failed', '责任范围必须指定项目')
  const entries = await Promise.all(tables.map(async table => [table, await db.select<Row>(`SELECT * FROM ${table} ORDER BY id`)] as const))
  const rows = Object.fromEntries(entries) as Record<typeof tables[number], Row[]>
  const scopeLogs = await db.select<Row>('SELECT * FROM operation_logs WHERE table_name=\'unit_assignment_scopes\' AND action=\'create\' ORDER BY id')
  const originalScopes = scopeLogs.flatMap((log) => {
    try {
      const row: unknown = JSON.parse(String(log.after_data))
      return row !== null && typeof row === 'object' && !Array.isArray(row) && 'id' in row && row.id === log.record_id ? [{ log, row: row as Row }] : []
    }
    catch { return [] }
  })
  const find = (table: typeof tables[number], id: unknown) => rows[table].find(row => row.id === id)
  const responsibilityOptions: PayrollAManagementScopeFacts['responsibilityOptions'] = []
  const cells = new Map<string, PayrollAManagementScopeFacts['cellOptions'][number]>()
  const evidence: unknown[] = []
  const project = find('projects', query.projectId)
  if (!active(project))
    return { sourceVersion: `payroll-management-scope:${createHash('sha256').update(JSON.stringify(project ?? null)).digest('hex')}`, responsibilityOptions, cellOptions: [], reasons: ['项目不存在或已停用'] }
  for (const assignment of rows.unit_assignments.filter(active)) {
    const unit = find('units', assignment.unit_id)
    const floor = find('floors', unit?.floor_id)
    const building = find('buildings', floor?.building_id)
    if (building?.project_id !== query.projectId)
      continue
    const template = find('house_type_templates', unit?.house_type_template_id)
    const scopes = rows.unit_assignment_scopes.filter(row => row.assignment_id === assignment.id)
    const workerId = text(assignment.worker_id)
    const crewId = text(assignment.crew_id)
    const subject = workerId ? find('workers', workerId) : find('crews', crewId)
    const reasons: string[] = []
    const original = originalScopes.filter(proof => proof.row.assignment_id === assignment.id)
    if (original.some(proof => !scopes.some(scope => scope.id === proof.row.id)))
      reasons.push('原审计保存的细分责任行已缺失，不能扩大成整户范围')
    if (![unit, floor, building, template].every(active) || template?.project_id !== query.projectId)
      reasons.push('原户、楼层、楼栋或户型已缺失或停用')
    if ((workerId === null) === (crewId === null) || !active(subject))
      reasons.push('原施工责任人或班组无法确认')
    const available = rows.house_type_template_items.filter((line) => {
      const room = find('rooms', line.room_id)
      const item = find('items', line.item_id)
      return active(line) && active(room) && room.template_id === template?.id && active(item) && item.project_id === query.projectId && item.trade === assignment.trade
    })
    if (scopes.some(scope => !active(scope) || !available.some(line => line.room_id === scope.room_id && line.item_id === scope.item_id)))
      reasons.push('原细分范围已缺失、停用或不属于原户型工种，不能扩大为整户')
    const selected = available.filter(line => !scopes.length || scopes.some(scope => active(scope) && scope.room_id === line.room_id && scope.item_id === line.item_id))
    if (!selected.length)
      reasons.push('原责任没有可确认的房间与分项格子')
    const selectedCells = selected.map(line => ({ unitId: String(unit!.id), roomId: String(line.room_id), itemId: String(line.item_id) }))
    if (new Set(selectedCells.map(cell => JSON.stringify(cell))).size !== selectedCells.length)
      reasons.push('原户型格子存在重复明细，需先核对')
    const label = [building?.name, floor?.name, unit?.name ?? unit?.code, subject?.name].map(text).filter(Boolean).join(' / ')
    const eligible = reasons.length === 0
    const sources = [
      [unit, floor, building, template].every(active) && template?.project_id === query.projectId ? payrollANavigation(context, query.projectId, 'quantity-unit', String(unit!.id), label) : null,
      active(subject) && workerId ? payrollANavigation(context, query.projectId, 'worker', workerId, text(subject.name) ?? workerId) : null,
      active(subject) && crewId ? payrollANavigation(context, query.projectId, 'crew', crewId, text(subject.name) ?? crewId) : null,
    ].filter(source => source !== null)
    responsibilityOptions.push({ assignmentId: String(assignment.id), workerId, crewId, scopeIds: scopes.map(scope => String(scope.id)), cells: eligible ? selectedCells : [], label, eligible, reasons, sources })
    if (eligible) {
      for (const cell of selectedCells) {
        const room = find('rooms', cell.roomId)
        const item = find('items', cell.itemId)
        cells.set(JSON.stringify(cell), { ...cell, locationLabel: [building?.name, floor?.name, unit?.name ?? unit?.code, room?.name, item?.name].map(text).filter(Boolean).join(' / ') })
      }
    }
    evidence.push({ assignment, scopes, original, unit, floor, building, template, subject, available: available.map(line => ({ line, room: find('rooms', line.room_id), item: find('items', line.item_id) })) })
  }
  return { sourceVersion: `payroll-management-scope:${createHash('sha256').update(JSON.stringify([project, evidence])).digest('hex')}`, responsibilityOptions, cellOptions: [...cells.values()], reasons: [] }
}
