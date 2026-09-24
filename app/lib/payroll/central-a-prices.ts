import type { TransactionDb } from '../db/coordinator'
import type { PayrollAConfigScope, PayrollAPriceDraft, PayrollAPriceRevision, PayrollASubjectConfig } from './central-a-contract'
import { hiddenCtes, logOperation, visibleCond } from '../db/soft-delete'
import { generateId } from '../util/id'
import { payrollACanonical, payrollAEffectivePrices } from './central-a-calculation'
import { payrollProblem } from './central-contract'

export type PayrollAPriceProjectionLoader = (db: TransactionDb, projectId: string) => Promise<ReadonlyMap<string, PayrollAPriceRevision>>

export async function loadPayrollAPrices(db: TransactionDb, projectId: string, projection?: PayrollAPriceProjectionLoader): Promise<PayrollAPriceRevision[]> {
  // 先核迁入物理原件，再读取 SQL；原 scope_json 只通过显式已证 DTO 映射消费。
  const mapped = await projection?.(db, projectId)
  return (await db.select<Record<string, unknown>>('SELECT * FROM payroll_a_price_revisions WHERE project_id = ? ORDER BY revision, id', [projectId])).map((row) => {
    const projected = mapped?.get(String(row.id))
    return projected ?? { id: String(row.id), priceId: String(row.price_id), projectId: String(row.project_id), crewId: row.crew_id == null ? null : String(row.crew_id), leaderWorkerId: String(row.leader_worker_id), itemId: String(row.item_id), itemName: null, unit: row.unit == null ? null : String(row.unit), mode: row.mode as PayrollAPriceRevision['mode'], workerId: row.worker_id == null ? null : String(row.worker_id), workerName: null, effectiveMonth: String(row.effective_month), unitPrice: row.unit_price == null ? null : Number(row.unit_price), scope: JSON.parse(String(row.scope_json)) as PayrollAPriceRevision['scope'], revision: Number(row.revision), operatorId: String(row.operator_id), createdAt: String(row.created_at), editable: true, readonlyReasons: [] }
  })
}
export async function loadPayrollASubjectConfig(db: TransactionDb, projectId: string, leaderWorkerId: string): Promise<PayrollASubjectConfig | null> {
  // A 配置与现配置同一项目/班组/负责人祖先契约；中央专表不注册到 Native 物理迁移表集。
  const [row] = await db.select<Record<string, unknown>>(`${hiddenCtes('payroll_subject_configs')} SELECT a.* FROM payroll_a_subject_configs a WHERE a.project_id = ? AND a.leader_worker_id = ? AND ${visibleCond('payroll_subject_configs', 'a')}`, [projectId, leaderWorkerId])
  return row ? { id: String(row.id), projectId, crewId: row.crew_id == null ? null : String(row.crew_id), leaderWorkerId, initialPayRatio: row.initial_pay_ratio == null ? null : Number(row.initial_pay_ratio), revision: Number(row.revision) } : null
}
export function assertPayrollAMonth(month: unknown): asserts month is string {
  if (typeof month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))
    throw payrollProblem('validation-failed', '工资月份无效', { month: ['请选择有效工资月份'] })
}
export function assertPayrollARatio(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw payrollProblem('validation-failed', '发放比例必须明确填写且在 0% 至 100% 之间', { payRatio: ['请填写有效发放比例'] })
}
export async function savePayrollAPrices(db: TransactionDb, scope: PayrollAConfigScope, drafts: PayrollAPriceDraft[], actor: string, projection?: PayrollAPriceProjectionLoader): Promise<string[]> {
  if (!scope.leaderWorkerId || !drafts.length)
    throw payrollProblem('validation-failed', '请先选择请款主体及需要保存的工资配置')
  const previous = await loadPayrollAPrices(db, scope.projectId, projection)
  const ids: string[] = []
  const seen = new Set<string>()
  for (const [index, draft] of drafts.entries()) {
    const fail = (field: string, message: string): never => {
      throw payrollProblem('validation-failed', message, { [`prices.${index}.${field}`]: [message] })
    }
    assertPayrollAMonth(draft.effectiveMonth)
    if (draft.effectiveMonth < scope.month)
      fail('effectiveMonth', '工资改价从所选月份起生效，不能倒改此前月份')
    if (draft.unitPrice === null || !Number.isFinite(draft.unitPrice) || draft.unitPrice < 0 || !Number.isSafeInteger(Math.round(draft.unitPrice * 100)) || Math.abs(draft.unitPrice * 100 - Math.round(draft.unitPrice * 100)) > 1e-8)
      fail('unitPrice', '请明确填写非负工资单价；未配置不能当成零价')
    if (!draft.unit)
      fail('unit', '缺少计价单位，请先核实工程量来源')
    if ((draft.mode === 'baseline' && draft.workerId !== null) || (draft.mode === 'worker-exception' && !draft.workerId))
      fail('workerId', '统一基准与个人例外的适用工人不一致')
    if (draft.scope.kind === 'cells' && (!draft.scope.cells.length || draft.scope.cells.some(cell => cell.itemId !== draft.itemId)))
      fail('scope', '请明确选择同一分项的非空计价范围')
    const key = payrollACanonical([draft.itemId, draft.unit, draft.mode, draft.workerId, draft.effectiveMonth, draft.scope])
    if (seen.has(key))
      fail('itemId', '同一工资配置不能在本次保存中重复')
    seen.add(key)
    const old = draft.priceId ? previous.filter(price => price.priceId === draft.priceId).at(-1) : undefined
    if (draft.priceId && (!old || old.crewId !== scope.crewId || old.leaderWorkerId !== scope.leaderWorkerId || old.itemId !== draft.itemId || old.mode !== draft.mode || old.workerId !== draft.workerId || old.unit !== draft.unit))
      fail('priceId', '工资配置身份或归属不匹配')
    const id = generateId('payroll_price_revision')
    const priceId = draft.priceId ?? generateId('payroll_price')
    const row = { id, price_id: priceId, project_id: scope.projectId, crew_id: scope.crewId, leader_worker_id: scope.leaderWorkerId, item_id: draft.itemId, unit: draft.unit, mode: draft.mode, worker_id: draft.workerId, effective_month: draft.effectiveMonth, unit_price: draft.unitPrice, scope_json: JSON.stringify(draft.scope), revision: (old?.revision ?? 0) + 1, operator_id: actor, created_at: new Date().toISOString() }
    await db.execute(`INSERT INTO payroll_a_price_revisions(${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, Object.values(row))
    await logOperation(db, { table: 'payroll_a_price_revisions', recordId: id, action: 'create', after: row, operator: actor })
    ids.push(id)
  }
  const next = await loadPayrollAPrices(db, scope.projectId, projection)
  for (const month of new Set(next.map(price => price.effectiveMonth).filter(month => month >= scope.month))) {
    const effective = payrollAEffectivePrices(next, month).filter(price => price.crewId === scope.crewId && price.leaderWorkerId === scope.leaderWorkerId)
    for (const [index, left] of effective.entries()) {
      for (const right of effective.slice(index + 1)) {
        if (left.itemId !== right.itemId || left.unit !== right.unit || left.mode !== right.mode || left.workerId !== right.workerId)
          continue
        const rightScope = right.scope
        const overlap = left.scope.kind === 'project' || rightScope.kind === 'project' || left.scope.cells.some(cell => rightScope.cells.some(other => cell.unitId === other.unitId && cell.roomId === other.roomId && cell.itemId === other.itemId))
        if (overlap)
          throw payrollProblem('validation-failed', '同一主体、分项与单位存在重叠工资价格，请修订原价格或明确互不重叠的范围', { prices: ['价格适用范围不能重叠'] })
      }
    }
  }
  return ids
}
