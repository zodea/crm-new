import type { BusinessSession } from '../../server/utils/business-session'
import { expect, it } from 'vitest'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { decodeTargetCostRead, encodeTargetCostWire } from '~/lib/target-cost/central-codec'
import { targetCostSourceContext } from '~/lib/target-cost/navigation'
import { loadPayrollBudgetActual } from '../../server/utils/payroll-actual-budget'
import { aggregateTargetCostActual, buildTargetCostComparison } from '../../server/utils/target-cost-actual'
import { createTargetCostService } from '../../server/utils/target-cost-service'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

it('预算在工资同一队列事务内读取真实1000→退40→后月940，只计1900且保留其他科目缺口', async () => {
  const f = await createPayrollAdjustmentFixture()
  let session: BusinessSession = { workspaceId: 'work', actorId: 'actor', capabilities: ['target-cost:read', 'target-cost:write', 'payroll:read'] }
  let changeAfterRead = false
  const budget = createTargetCostService({ session: () => session, projects: () => ({ projects: [{ id: 'p', name: '工资实际项目', code: 'P' }], status: 'available', version: 'budget-project' }), transaction: work => f.withTransaction(tx => work(tx, session)), actual: async (projectId, _sessionId, read) => {
    const sources = await loadPayrollBudgetActual(read.db, projectId!, read.context)
    if (changeAfterRead)
      session = { ...session, capabilities: ['target-cost:read', 'target-cost:write'] }
    return aggregateTargetCostActual(projectId, sources)
  } })
  try {
    const form = await budget.form({ origin: 'real' }, null, 'budget-draft')
    const saved = await budget.execute({ commandId: 'budget-save', ...form.context, requiredCapability: 'target-cost:write', targetCostId: null, draftKey: 'budget-draft', action: { kind: 'save-header', saveAction: 'draft', draft: { projectId: 'p', name: '工资对账' } } })
    const wage = async () => (await budget.detail({ origin: 'real' }, saved.id)).view.categories.find(c => c.category === '工人工资')!
    expect(await wage()).toMatchObject({ settledAmount: { value: 1000, status: 'complete' }, paidAmount: { value: 1000, status: 'complete' }, signedAmount: { status: 'not-applicable' } })
    const correction = await f.correct()
    expect((await wage()).settledAmount.value).toBe(1000)
    await f.refund(correction.adjustment.id, 40)
    expect((await wage()).settledAmount.value).toBe(960)
    await f.daywork({ workDate: '2026-09-01', status: 'confirmed', witness: '现场证明', confirmedOn: '2026-09-02' })
    const created = await f.service.executeC2(f.c2Command(await f.c2Form({ month: '2026-09' }, 'budget-next'), { kind: 'save-c2-draft', draft: { ...f.draft, month: '2026-09' } }))
    const next = () => f.service.c2Form({ origin: 'real' }, { statementId: created.statementId! })
    await f.service.executeC2(f.c2Command(await next(), { kind: 'check-c2' }))
    const [candidate] = (await f.service.releaseAdjustmentPreview({ origin: 'real' }, { statementId: created.statementId! })).candidates
    await f.service.executeC2(f.c2Command(await next(), { kind: 'release-c2', release: { actualAmount: 940, allocations: [{ workerId: 'w', amount: 940 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }], adjustmentApplications: [{ adjustmentId: candidate!.adjustmentId, amount: -60, balanceVersion: candidate!.balanceVersion, coverageVersion: candidate!.coverageVersion }] } }))
    const detail = await budget.detail({ origin: 'real' }, saved.id)
    expect(detail.view.categories.find(c => c.category === '工人工资')).toMatchObject({ settledAmount: { value: 1900 }, paidAmount: { value: 1900 } })
    expect(detail.view.summary.settledAmount).toMatchObject({ value: null, knownValue: 1900, status: 'partial' })
    expect(detail.view.summary.remainingAmount.value).toBeNull()
    const decoded = decodeTargetCostRead<typeof detail>(encodeTargetCostWire(detail), 'detail', { origin: 'real' }, saved.id)
    const paymentSource = decoded.view.categories.find(c => c.category === '工人工资')!.sources.payment
    expect(paymentSource).toMatchObject({ kind: 'entity-list', entity: 'wage-statement', variant: 'actual-ledger', filters: { projectId: 'p', dataOrigin: 'real', costCategory: '工人工资' } })
    const budgetReturn = `/project/target-cost/${saved.id}?origin=real&tab=comparison`
    const destination = resolveNavigationTarget(paymentSource!, { returnTo: budgetReturn })
    expect(destination.state).toBe('resolved')
    if (destination.state !== 'resolved')
      throw new Error('工资实际来源必须可进入')
    const url = new URL(destination.to, 'https://test.invalid')
    expect(url.pathname).toBe('/subcontract/payroll/payments')
    expect(url.searchParams.get('project')).toBe('p')
    expect(targetCostSourceContext(url.pathname, Object.fromEntries(url.searchParams))).toMatchObject({ id: saved.id, projectId: 'p', returnTo: budgetReturn })
    const sources = await f.withTransaction(tx => loadPayrollBudgetActual(tx, 'p', session))
    expect(sources[0]!.rows).toHaveLength(3)
    expect(aggregateTargetCostActual('p', [...sources, ...sources]).categories.find(c => c.category === '工人工资')?.paidAmount.value).toBe(1900)
    changeAfterRead = true
    await expect(budget.detail({ origin: 'real' }, saved.id)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    changeAfterRead = false
    expect(await wage()).toMatchObject({ settledAmount: { value: null, knownValue: null, missingSources: expect.arrayContaining(['工资实际收付:forbidden']) } })
  }
  finally { await f.close() }
}, 30_000)

it.each(Array.from([[], ['payroll:read'], ['target-cost:read']]).map(input1 => ({ input1 })))('工资资金读取需同时具备目的权限和工资来源权限，不能只凭内部读取入口取得金额：输入案例 %#', async ({ input1: capabilities }) => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const sources = await f.withTransaction(tx => loadPayrollBudgetActual(tx, 'p', { workspaceId: 'work', actorId: 'actor', capabilities }))
    expect(sources.every(s => s.status === 'forbidden' && !s.rows.length)).toBe(true)
    expect(buildTargetCostComparison('budget', [], aggregateTargetCostActual('p', sources)).summary.settledAmount.knownValue).toBeNull()
  }
  finally { await f.close() }
})
