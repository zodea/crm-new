import type { ConstructionScopeSpendingRead, ConstructionScopeSpendingRow } from '../../app/lib/construction-scope/contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import { isEffectiveExpenditureContract } from '../../app/lib/contract/effective-status'
import { financeFailure } from '../../app/lib/finance/central-contract'
import { loadPayrollActualFacts } from './payroll-actual-facts'
import { readAuxiliaryContractScopeFacts } from './production-auxiliary-contract-record'
import { readProductionConstructionContractReference } from './production-construction-contract-sources'
import { assertProductionConstructionScope, validateProductionConstructionScopeState } from './production-construction-scope-record'
import { listOriginalExpenseReferences } from './production-finance-expense-references'
import { validateFinanceJournal } from './production-finance-journal'
import { readMaterialContractScopeFacts } from './production-material-contract-record'
import { listProductionOtherSettlementReferences } from './production-other-settlement-service'
import { readSubcontractContractScopeFacts } from './production-subcontract-contract-sources'

type Row = Record<string, unknown>
/** Consistent original-owner projection. No expense, wage accrual or cash row is created here. */
export async function readProductionConstructionSpending(tx: TransactionDb, actor: BusinessSession, projectId: string, mainId: string | null = null): Promise<ConstructionScopeSpendingRead> {
  await assertProductionConstructionScope(tx, actor)
  await validateProductionConstructionScopeState(tx)
  if (!actor.capabilities.includes('construction-scope:read') || !actor.capabilities.includes('project:list:read'))
    return financeFailure('forbidden', '无当前项目施工开支读取权限。')
  if (!(await tx.select('SELECT id FROM projects WHERE id=?', [projectId]))[0])
    return financeFailure('not-found', '施工开支所属真实项目不存在。')
  if (mainId) {
    const main = await readProductionConstructionContractReference(tx, actor, mainId, { includeDeleted: true })
    if (main.projectId !== projectId)
      return financeFailure('conflict', '施工主合同不属于所选项目。')
  }
  const links = await tx.select<{ source_domain: string, source_id: string, main_id: string, project_id: string }>('SELECT source_domain,source_id,main_id,project_id FROM construction_scope_links WHERE deleted_at IS NULL AND project_id=?', [projectId])
  const bound = (domain: string, id: string) => links.find(row => row.source_domain === domain && row.source_id === id)?.main_id ?? null
  const rows: ConstructionScopeSpendingRow[] = []
  const sources: ConstructionScopeSpendingRead['sources'] = []
  const state = (cause: unknown) => cause && typeof cause === 'object' && 'problem' in cause && cause.problem && typeof cause.problem === 'object' && 'code' in cause.problem && cause.problem.code === 'forbidden' ? 'forbidden' as const : 'unavailable' as const
  const materialIds = new Set<string>()
  try {
    const facts = await readMaterialContractScopeFacts(tx, actor)
    for (const fact of facts.filter(row => row.projectId === projectId && row.eligible && !row.retired && !row.deletedAt && isEffectiveExpenditureContract(row.status))) {
      materialIds.add(fact.id)
      rows.push({ identity: `material:${fact.id}`, sourceId: fact.id, name: fact.name, metric: 'committed', projectId, mainId: bound('material-contract', fact.id), amount: fact.amount === null || fact.supplementAmount === null ? null : fact.amount + fact.supplementAmount, reason: fact.amount === null || fact.supplementAmount === null ? '原合同或有效协议金额未知。' : null })
    }
    sources.push({ key: 'material-contract', state: 'readable', reason: null })
  }
  catch (cause) { sources.push({ key: 'material-contract', state: state(cause), reason: '材采原合同及有效协议来源无法可靠读取。' }) }
  try {
    const facts = await readSubcontractContractScopeFacts(tx, actor)
    for (const fact of facts.filter(row => row.projectId === projectId && row.eligible && !row.retired && !row.deletedAt && isEffectiveExpenditureContract(row.status))) {
      rows.push({ identity: `subcontract:${fact.id}`, sourceId: fact.id, name: fact.name, metric: 'committed', projectId, mainId: bound('subcontract-contract', fact.id), amount: fact.amount === null || fact.supplementAmount === null ? null : fact.amount + fact.supplementAmount, reason: fact.amount === null || fact.supplementAmount === null ? '原分包合同或有效协议金额未知。' : null })
    }
    sources.push({ key: 'subcontract-contract', state: 'readable', reason: null })
  }
  catch (cause) { sources.push({ key: 'subcontract-contract', state: state(cause), reason: '分包合同及有效协议暂不可可靠读取。' }) }
  try {
    const facts = await readAuxiliaryContractScopeFacts(tx, actor)
    for (const fact of facts.filter(row => row.projectId === projectId && row.eligible && !row.retired && !row.deletedAt && isEffectiveExpenditureContract(row.status))) {
      rows.push({ identity: `auxiliary:${fact.id}`, sourceId: fact.id, name: fact.name, metric: 'committed', projectId, mainId: bound('auxiliary-contract', fact.id), amount: fact.amount === null || fact.supplementAmount === null ? null : fact.amount + fact.supplementAmount, reason: fact.amount === null || fact.supplementAmount === null ? '原其他支出合同或有效协议金额未知。' : null })
    }
    sources.push({ key: 'auxiliary-contract', state: 'readable', reason: null })
  }
  catch (cause) { sources.push({ key: 'auxiliary-contract', state: state(cause), reason: '其他支出合同及有效协议暂不可可靠读取。' }) }
  const expenseIds = new Set<string>()
  try {
    await validateFinanceJournal(tx, actor)
    for (const fact of await listOriginalExpenseReferences(tx, actor, projectId)) {
      expenseIds.add(fact.id)
      rows.push({ identity: `expense:${fact.id}`, sourceId: fact.id, name: fact.expenseItem, metric: 'incurred', projectId, mainId: bound('original-expense', fact.id), amount: fact.amount, reason: null })
    }
    sources.push({ key: 'original-expense', state: 'readable', reason: null })
  }
  catch (cause) { sources.push({ key: 'original-expense', state: state(cause), reason: '原费用来源无法可靠读取；清偿与 Other 采用不另记一份费用。' }) }
  try {
    if (!['finance-payment-record:read', 'finance-payment-application:read'].every(capability => actor.capabilities.includes(capability)))
      return financeFailure('forbidden', '无真实付款及其精确采用来源读取权限。')
    await validateFinanceJournal(tx, actor)
    const payments = await tx.select<Row>(`SELECT pay.id AS payment_id,pay.project_id AS cash_project,alloc.id AS allocation_id,alloc.allocated_amount,
      app.id AS application_id,app.name,app.contract_id,app.project_id,app.status FROM payment_records pay
      LEFT JOIN payment_record_application_allocations alloc ON alloc.payment_record_id=pay.id AND alloc.deleted_at IS NULL
      LEFT JOIN payment_applications app ON app.id=alloc.payment_application_id AND app.deleted_at IS NULL
      WHERE pay.project_id=? AND pay.deleted_at IS NULL AND pay.confirmation_status='confirmed' ORDER BY pay.id,alloc.id`, [projectId])
    let settlements: Awaited<ReturnType<typeof listProductionOtherSettlementReferences>> | null = null
    const consumed = new Set<string>()
    for (const payment of payments) {
      const identity = payment.allocation_id ? `payment:${payment.payment_id}:${payment.allocation_id}` : `payment-unknown:${payment.payment_id}`
      if (consumed.has(identity))
        return financeFailure('unavailable', '实际支付分摊身份重复，停止汇总。')
      consumed.add(identity)
      let target: string | null = null
      const projectProven = Boolean(payment.allocation_id && payment.application_id && payment.project_id === projectId && ['submitted', 'approved', 'paying', 'paid'].includes(String(payment.status)) && typeof payment.allocated_amount === 'number' && Number.isFinite(payment.allocated_amount))
      let qualified = projectProven
      if (qualified && materialIds.has(String(payment.contract_id))) {
        target = bound('material-contract', String(payment.contract_id))
      }
      else if (qualified) {
        const adopted = await tx.select<{ settlement_id: string }>('SELECT settlement_id FROM payment_application_settlement_allocations WHERE payment_application_id=? AND deleted_at IS NULL ORDER BY id', [payment.application_id])
        if (adopted.length) {
          settlements ??= await listProductionOtherSettlementReferences(tx, actor)
          const originals: string[] = []
          for (const adoptedRow of adopted) {
            const settlement = settlements.find(row => row.id === adoptedRow.settlement_id)
            if (!settlement || settlement.deleted_at || settlement.project_id !== projectId || !['confirmed', '已确认'].includes(settlement.status) || settlement.unavailable_reason || !settlement.original_expense_line_ids.length) {
              qualified = false
              break
            }
            originals.push(...settlement.original_expense_line_ids)
          }
          const targets = new Set(originals.map(id => expenseIds.has(id) ? bound('original-expense', id) : null))
          if (qualified && targets.size === 1 && !targets.has(null))
            target = [...targets][0]!
          else
            qualified = false
        }
        else {
          qualified = false
        }
      }
      rows.push({ identity, sourceId: String(payment.payment_id), name: String(payment.name ?? '真实付款待核来源'), metric: 'paid', projectId, mainId: target, amount: projectProven && typeof payment.allocated_amount === 'number' ? payment.allocated_amount : null, reason: !projectProven ? '原付款缺少可核实的项目或精确分摊，不能用申请或结算金额替代实际支付。' : !qualified || target === null ? '实际项目支付金额已核实，施工主合同归属仍待核；涉及多份主合同不能推定均摊。' : null })
    }
    sources.push({ key: 'payment-allocation', state: 'readable', reason: null })
  }
  catch (cause) { sources.push({ key: 'payment-allocation', state: state(cause), reason: '实际付款或原采用链尚未可靠接通，不能以费用计提或申请金额补零。' }) }
  const companyState = sources.find(source => source.key === 'auxiliary-contract')?.state ?? 'unavailable'
  sources.push({ key: 'company-expense-contract', state: companyState, reason: companyState === 'readable' ? '公司合同头独立核对；项目业务开支沿原费用明细，不将公司合同总额计入本施工合同。' : companyState === 'forbidden' ? '当前无公司合同资料读取权限，项目业务费用仍按原明细核对。' : '公司合同资料暂不可读取，项目业务费用仍按原明细核对。' })
  let projectPayroll: ConstructionScopeSpendingRead['projectPayroll'] = { scope: 'project', knownPaidAmount: null, complete: false }
  if (actor.capabilities.includes('payroll:read')) {
    try {
      const payroll = await loadPayrollActualFacts(tx, { projectId })
      projectPayroll = { scope: 'project', knownPaidAmount: payroll.netAmount.knownValue, complete: payroll.netAmount.state === 'known' }
    }
    catch { /* Failed actual wage reads stay unknown; no names or recipient allocations leave this projection. */ }
  }
  const visible = mainId ? rows.filter(row => row.mainId === mainId) : rows
  const unassigned = rows.filter(row => row.mainId === null)
  if (actor.capabilities.includes('construction-contract:read')) {
    const labels = new Map<string, string>()
    for (const id of [...new Set(rows.flatMap(row => row.mainId ? [row.mainId] : []))]) {
      const head = await readProductionConstructionContractReference(tx, actor, id, { includeDeleted: true })
      if (head.projectId === projectId)
        labels.set(id, head.name)
    }
    rows.forEach(row => row.mainLabel = row.mainId ? labels.get(row.mainId) ?? null : null)
  }
  const metrics = Object.fromEntries((['committed', 'incurred', 'paid'] as const).map((metric) => {
    const matching = visible.filter(row => row.metric === metric)
    const knownAmount = matching.reduce((sum, row) => sum + (row.amount === null ? 0 : Math.round(row.amount * 100)), 0) / 100
    const key = metric === 'committed' ? 'material-contract' : metric === 'incurred' ? 'original-expense' : 'payment-allocation'
    const required = metric === 'committed' ? [key, 'subcontract-contract', 'auxiliary-contract'] : [key]
    const complete = required.every(key => sources.find(source => source.key === key)?.state === 'readable') && matching.every(row => row.amount !== null) && !(mainId && unassigned.some(row => row.metric === metric))
    return [metric, { knownAmount, amount: complete ? knownAmount : null, complete }]
  })) as ConstructionScopeSpendingRead['metrics']
  return { workspaceId: actor.workspaceId, actorId: actor.actorId, dataOrigin: 'real', projectId, mainId, rows: visible, unassigned, metrics, sources, projectPayroll }
}
