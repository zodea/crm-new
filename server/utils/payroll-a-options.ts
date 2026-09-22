import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollABlocker, PayrollAContext, PayrollAOptions, PayrollAQuantityFact } from '../../app/lib/payroll/central-a-contract'
import type { NavigationIntentDTO } from '../../app/types/read-model'
import type { PayrollIdentitySource } from './payroll-service'
import { hiddenCtesFor, visibleCond } from '../../app/lib/db/soft-delete'

export function payrollANavigation(context: PayrollAContext, projectId: string, entity: 'worker' | 'crew' | 'quantity-unit', id: string, label: string, filters: Record<string, string | null> = {}): NavigationIntentDTO | null {
  if (!context.capabilities.includes(entity === 'quantity-unit' ? 'quantity:read' : `${entity}:list:read`))
    return null
  return { kind: 'entity-detail', subject: { state: 'resolved', entity, id, label, no: null }, variant: 'detail', view: null, filters: { projectId, dataOrigin: context.origin, ...filters } }
}

/** 诊断可能没有任何可核算行。原同项目身份只读保留，跳转仍须按当前完整可见链与权限核实。 */
export async function loadPayrollABlockerLocation(db: TransactionDb, context: PayrollAContext, projectId: string, block: PayrollABlocker): Promise<Pick<PayrollABlocker, 'locationLabel' | 'sourceUnavailableReason' | 'source'>> {
  const unavailable = (reason: string, locationLabel: string | null = null) => ({ locationLabel, sourceUnavailableReason: reason, source: null })
  if (!block.unitId)
    return unavailable('原记录未保存可确认的户身份')
  // 此查询保留已停用的原位置作为诊断证据；current_visible 独立决定能否进入当前工程量页面。
  const [location] = await db.select<{ building_name: string | null, floor_name: string | null, unit_code: string | null, room_name: string | null, item_name: string | null, current_visible: number }>(`${hiddenCtesFor('units')}
    SELECT b.name AS building_name,f.name AS floor_name,u.code AS unit_code,r.name AS room_name,i.name AS item_name,
      CASE WHEN ${visibleCond('units', 'u')} AND t.id IS NOT NULL THEN 1 ELSE 0 END AS current_visible
    FROM units u JOIN floors f ON f.id=u.floor_id JOIN buildings b ON b.id=f.building_id
    LEFT JOIN house_type_templates t ON t.id=u.house_type_template_id AND t.project_id=?
    LEFT JOIN rooms r ON r.id=? AND r.template_id=t.id
    LEFT JOIN items i ON i.id=? AND i.project_id=b.project_id
    WHERE u.id=? AND b.project_id=?`, [projectId, block.roomId, block.itemId, block.unitId, projectId])
  if (!location)
    return unavailable('原户已缺失，或无法证明属于当前工资项目')
  const label = [location.building_name, location.floor_name, location.unit_code, location.room_name, location.item_name].filter(Boolean).join(' · ') || null
  if (!location.current_visible)
    return unavailable('原户或其所属楼层、楼栋、户型已停用或缺失', label)
  const source = payrollANavigation(context, projectId, 'quantity-unit', block.unitId, label ?? '原施工户')
  if (!source)
    return unavailable('当前身份无权打开工程量来源', label)
  // 细分行本身可能缺损，不携带未经当前关系复验的 room/item/阶段焦点把原户入口变成失效目标。
  return { locationLabel: label, sourceUnavailableReason: null, source }
}
/** 候选可来自尚未完成的有效责任；工资金额只消费独立的已完成 facts。 */
export async function loadPayrollAOptions(db: TransactionDb, source: PayrollIdentitySource, context: PayrollAContext, projectId: string, facts: PayrollAQuantityFact[]): Promise<PayrollAOptions> {
  const assignments = projectId
    ? await db.select<{ worker_id: string | null, crew_id: string | null }>(`${hiddenCtesFor('unit_assignments')}
    SELECT a.worker_id,a.crew_id FROM unit_assignments a JOIN units u ON u.id=a.unit_id JOIN floors f ON f.id=u.floor_id JOIN buildings b ON b.id=f.building_id
    WHERE b.project_id=? AND ${visibleCond('unit_assignments', 'a')}`, [projectId])
    : []
  const workerIds = new Set([...assignments.map(a => a.worker_id), ...facts.map(f => f.workerId)].filter(id => id !== null))
  const crewIds = new Set([...assignments.map(a => a.crew_id), ...facts.map(f => f.crewId), ...source.workers.filter(w => workerIds.has(w.id)).map(w => w.crewId)].filter(id => id !== null))
  const workers = source.workers.filter(w => workerIds.has(w.id) || (w.crewId !== null && crewIds.has(w.crewId)))
  return { projects: source.projects.map(p => ({ id: p.id, name: p.name, code: p.code })), crews: source.crews.filter(c => crewIds.has(c.id)).map(c => ({ id: c.id, name: c.name, eligible: true, reasons: [] })), workers: workers.map(w => ({ id: w.id, name: w.name, crewId: w.crewId, eligible: true, reasons: [], source: payrollANavigation(context, projectId, 'worker', w.id, w.name) })) }
}
