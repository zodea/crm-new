import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollAAmount } from '../../app/lib/payroll/central-a-contract'
import type { PayrollWritableContext } from '../../app/lib/payroll/central-contract'
import type { PayrollHollowPolicy, PayrollHollowRead, PayrollHollowRow, PayrollHollowScope, PayrollHollowSnapshot, PayrollHollowTarget } from '../../app/lib/payroll/central-hollow-deduction-contract'
import type { QuantityHollowFact } from '../../app/lib/quantity/central-hollow-contract'
import type { PayrollIdentitySource, PayrollServiceOptions } from './payroll-service'
import { hiddenCtesFor, visibleCond } from '../../app/lib/db/soft-delete'
import { payrollAAmount, payrollAMoney } from '../../app/lib/payroll/central-a-calculation'
import { calculatePayrollHollowTotals } from '../../app/lib/payroll/central-hollow-deduction-calculation'
import { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { effectivePayrollHollowPolicies, loadPayrollHollowPolicyRevisions, payrollHollowHash, samePayrollHollowScope, samePayrollHollowValue } from './payroll-hollow-data'
import { loadPayrollHollowProcessed } from './payroll-hollow-processed'
import { loadPayrollHollowAdoptions, loadPayrollHollowStarts } from './payroll-hollow-starts'
import { quantityHollowSource } from './quantity-hollow-read'

export interface PayrollHollowFormBasis {
  target: PayrollHollowTarget
  scope: PayrollHollowScope | null
  month: string | null
  memberWorkerIds: readonly string[]
  /** 管理簿必须给原管理责任闭包；普通/C不靠当前姓名扩责任。 */
  managementOwnershipKeys?: readonly string[]
  claimSubtotal: PayrollAAmount
  status: 'new' | 'draft' | 'checked' | 'released'
  /** 已发伴随视图取同一主体最新生效配置，不改原冻结金额。 */
  currentPolicy?: boolean
}
export function payrollHollowFactInScope(fact: QuantityHollowFact, scope: PayrollHollowScope, members: readonly string[], managementKeys?: readonly string[]): boolean {
  return fact.location.projectId === scope.projectId && (scope.formatFamily === 'A' && scope.book.bookPurpose === 'management'
    ? !!managementKeys?.includes(fact.ownershipKey)
    : fact.originalParty.kind === 'worker' ? members.includes(fact.originalParty.workerId) : fact.originalParty.crewId === scope.crewId)
}

/** 同工资事务消费真实来源与原采用集合；只读没有启动副作用。 */
export async function readPayrollHollowInTransaction(db: TransactionDb, base: PayrollWritableContext, source: PayrollIdentitySource, basis: PayrollHollowFormBasis, options: PayrollServiceOptions): Promise<PayrollHollowRead> {
  const context = { ...base, readonly: !base.capabilities.includes('payroll:write') }
  const { scope, month, target } = basis
  const unavailable = (reasons: string[]): PayrollHollowRead => ({ context, target, scope, month, state: 'unavailable', rows: [], starts: [], snapshot: null, current: null, totals: calculatePayrollHollowTotals({ formatFamily: scope?.formatFamily ?? 'A', claimSubtotal: basis.claimSubtotal, previousProcessed: payrollAAmount([null], reasons), currentDeduction: payrollAAmount([null], reasons) }), departureNotice: null, eligibility: { canStart: false, reasons }, reasons })
  if (!scope || !month || !source.projects.some(project => project.id === scope.projectId))
    return unavailable(['请先选择有效的工资主体、项目与月份'])
  if (!options.hollowFacts)
    return unavailable(['中央户级空鼓来源尚未连接'])
  try {
    const all = await options.hollowFacts(db, { projectId: scope.projectId, selection: { kind: 'current' } })
    const revisions = await loadPayrollHollowPolicyRevisions(db, scope.projectId, options.hollowProjection)
    const policyMonth = basis.currentPolicy
      ? revisions.filter(revision => samePayrollHollowScope(revision.scope, scope)).reduce((latest, revision) => revision.effectiveMonth > latest ? revision.effectiveMonth : latest, month)
      : month
    const policies = effectivePayrollHollowPolicies(revisions, scope, policyMonth)
    const starts = await loadPayrollHollowStarts(db, scope.projectId, options.hollowProjection)
    const adoptions = await loadPayrollHollowAdoptions(db, scope.projectId, starts, options.hollowProjection)
    const facts = all.records.filter(fact => payrollHollowFactInScope(fact, scope, basis.memberWorkerIds, basis.managementOwnershipKeys) && fact.revisions[0]!.input.inspectedOn.slice(0, 7) <= month)
    const scopedStarts = starts.filter(start => start.statementId === target.statementId)
    const start = scopedStarts.find(start => !scopedStarts.some(next => next.previousStartId === start.id)) ?? null
    const rows: PayrollHollowRow[] = []
    for (const fact of facts) {
      const revision = policies.find(policy => policy.itemId === fact.target.itemId)
      const policy: PayrollHollowPolicy = revision ? { itemId: revision.itemId, itemName: fact.location.itemName, enabled: revision.enabled, unitAmount: revision.unitAmount, source: 'configured', revisionId: revision.id, sourceVersion: payrollHollowHash(revision) } : { itemId: fact.target.itemId, itemName: fact.location.itemName, enabled: true, unitAmount: 30, source: 'default', revisionId: null, sourceVersion: 'hollow-default-30-v1' }
      const adopted = adoptions.find(adoption => adoption.line.recordId === fact.recordId) ?? null
      // 同一记录新增或改量后的部分处理尚未获业务规则；不倒推已处理处数。
      const changedAfterAdoption = adopted && fact.inspection.revisionId !== adopted.line.fact.inspection.revisionId
      const reasons = changedAfterAdoption ? ['原记录已处理后又修订了排查数量，请按独立更正核实新增范围'] : policy.enabled === null || (policy.enabled && policy.unitAmount === null) ? ['本分项空鼓扣款配置缺失，不能按零继续'] : []
      const state = reasons.length ? changedAfterAdoption ? 'needs-decision' : 'unknown' : adopted ? 'already-processed' : !policy.enabled ? 'disabled' : fact.remainingCount === 0 ? 'rectified' : 'ready'
      const [visible] = await db.select<{ id: string }>(`${hiddenCtesFor('units')} SELECT u.id FROM units u JOIN floors f ON f.id=u.floor_id JOIN buildings b ON b.id=f.building_id WHERE u.id=? AND b.project_id=? AND ${visibleCond('units', 'u')}`, [fact.target.unitId, scope.projectId])
      const navigation = quantityHollowSource(base, scope.projectId, fact.target.unitId, fact.location.locationLabel, !!visible, fact.recordId, fact.inspection.revisionId)
      rows.push({ fact, policy, state, amount: state === 'unknown' || state === 'needs-decision' ? payrollAAmount([null], reasons) : payrollAAmount([state === 'ready' ? payrollAMoney(fact.remainingCount * policy.unitAmount!) : 0]), adoption: adopted, source: navigation.navigation, sourceUnavailableReasons: navigation.reasons, reasons })
    }
    // 补录旧月份只能引用截至该月的处理额；上方仍用完整采用集合防止跨月重扣原记录。
    const previousProcessed = await loadPayrollHollowProcessed(db, adoptions.filter(adoption => adoption.statementId !== target.statementId && adoption.month <= month && samePayrollHollowScope(adoption.scope, scope)))
    const sourceReasons = all.unavailable.map(diagnostic => diagnostic.message)
    const reasons = [...sourceReasons]
    if (start && (!samePayrollHollowScope(start.scope, scope) || start.month !== month || start.lines.some(line => !rows.some(row => row.state === 'ready' && samePayrollHollowValue(row.fact, line.fact) && samePayrollHollowValue(row.policy, line.policy)))))
      reasons.push('启动后原空鼓、整改、配置或已处理范围变化，请重新核对并明确启动')
    const totals = calculatePayrollHollowTotals({ formatFamily: scope.formatFamily, claimSubtotal: basis.claimSubtotal, previousProcessed: payrollAAmount(previousProcessed.map(value => value.effectiveAmount.value)), currentDeduction: reasons.length ? payrollAAmount([null], reasons) : payrollAAmount([start?.amount ?? 0]) })
    const state = reasons.length || totals.reasons.length ? 'unavailable' : 'available'
    const version = payrollHollowHash({ scope, month, facts, policies, starts: scopedStarts, previousProcessed, totals })
    const updatedContext = { ...context, sourceVersion: `${base.sourceVersion}+hollow:${version}` }
    const startReasons = [...sourceReasons, ...rows.flatMap(row => row.reasons), ...(!target.statementId ? ['请先保存本张工资草稿'] : []), ...(!['draft', 'checked'].includes(basis.status) ? ['仅未发工资可以明确开始扣款'] : []), ...(context.readonly ? ['当前身份只能阅读工资'] : []), ...(!rows.some(row => row.state === 'ready') ? ['没有可启动的未处理空鼓'] : [])]
    const workerIds = source.workers.filter(worker => worker.currentProjectId !== undefined && worker.currentProjectId !== scope.projectId && rows.some(row => row.state === 'ready' && row.fact.originalParty.kind === 'worker' && row.fact.originalParty.workerId === worker.id)).map(worker => worker.id)
    return { context: updatedContext, target, scope, month, state, rows, starts: scopedStarts, snapshot: { schemaVersion: 1, scope, month, sourceVersion: version, state, facts, policies: [...new Map(rows.map(row => [row.policy.itemId, row.policy])).values()], start, previousProcessed, adoptions: [], totals, reasons: [...new Set([...reasons, ...totals.reasons])] }, current: null, totals, departureNotice: workerIds.length ? { workerIds, message: '这些工人已不在本项目且仍有未整改空鼓，可由经办人核实后明确开始扣款' } : null, eligibility: { canStart: !startReasons.length, reasons: [...new Set(startReasons)] }, reasons: [...new Set([...reasons, ...totals.reasons])] }
  }
  catch (cause) {
    if (cause instanceof ProjectRepositoryProblem && cause.problem.code === 'unavailable')
      return unavailable([cause.message])
    throw cause
  }
}

export function readPayrollHollowCurrentForSnapshot(db: TransactionDb, base: PayrollWritableContext, source: PayrollIdentitySource, statementId: string, snapshot: PayrollHollowSnapshot, memberWorkerIds: readonly string[], options: PayrollServiceOptions) {
  return readPayrollHollowInTransaction(db, base, source, { target: { statementId, draftKey: null }, scope: snapshot.scope, month: snapshot.month, memberWorkerIds, ...(snapshot.scope.formatFamily === 'A' && snapshot.scope.book.bookPurpose === 'management' ? { managementOwnershipKeys: snapshot.facts.map(fact => fact.ownershipKey) } : {}), claimSubtotal: snapshot.totals.claimSubtotal, status: 'released', currentPolicy: true }, options)
}
