import type { CostAmountMetrics } from './cost-amounts'
import type { SoftDb } from '~/lib/db/soft-delete'
import { CONFIRMED_SETTLEMENT_SQL_VALUES } from '~/lib/contract/effective-status'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'
import { missingCostAmount, remainingCostAmount, sumCostAmounts, sumCostMetrics } from './cost-amounts'

export const COST_CATEGORIES = [
  '专业分包',
  '合同劳务',
  '材料',
  '机械',
  '工人工资',
  '费用报销',
  '其他',
] as const

export type CostCategory = typeof COST_CATEGORIES[number] | '未分类'

export interface TargetCostVersionRow {
  id: string
  projectId: string
  name: string
  status: string
  targetAmount: number | null
  signedAmount: number | null
  settledAmount: number | null
  paidAmount: number | null
  remainingAmount: number | null
  metrics: CostAmountMetrics
  sourcePath: string
}

export interface TargetCostCategoryRow {
  id: string
  projectId: string
  targetCostId: string
  category: CostCategory
  targetAmount: number | null
  signedAmount: number | null
  settledAmount: number | null
  paidAmount: number | null
  remainingAmount: number | null
  metrics: CostAmountMetrics
  targetLineCount: number
  contractCount: number
  settlementCount: number
  paymentCount: number | null
  reimbursementCount: number
  targetPath: string
  contractPath: string
  settlementPath: string
  paymentPath: string
  reimbursementPath: string
}

export interface ProjectCostControl {
  versions: TargetCostVersionRow[]
  categories: TargetCostCategoryRow[]
}

interface CostFact {
  projectId: string
  category: CostCategory
  targetCostId: string
  targetAmounts: unknown[]
  signedAmounts: unknown[]
  settledAmounts: unknown[]
  paidAmounts: unknown[]
  targetLineIds: Set<string>
  contractIds: Set<string>
  settlementIds: Set<string>
  paymentIds: Set<string>
  reimbursementIds: Set<string>
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

export function costCategoryFromContract(row: Record<string, unknown>): CostCategory {
  const canonical = text(row.cost_category)
  if ((COST_CATEGORIES as readonly string[]).includes(canonical))
    return canonical as CostCategory

  // 兼容迁移前及演示种子：只按合同域的结构化类别映射，不从名称/用途文本猜测。
  if (row.kind === '分包')
    return row.sub_kind === '专业' ? '专业分包' : row.sub_kind === '劳务' ? '合同劳务' : '未分类'
  if (row.kind === '材采')
    return '材料'
  if (row.kind === '其他支出') {
    const originalKind = text(row.other_expense_kind)
    return /机械|租赁/.test(originalKind) ? '机械' : originalKind ? '其他' : '未分类'
  }
  return '未分类'
}

function contractPath(category: CostCategory): string {
  if (category === '专业分包' || category === '合同劳务')
    return '/contract/subcontract'
  if (category === '材料')
    return '/contract/material'
  return '/contract/other-expense'
}

function settlementPath(category: CostCategory): string {
  if (category === '工人工资')
    return '/subcontract/payroll'
  return category === '材料' ? '/material/settlement' : '/contract/other-settlement'
}

function paymentPath(category: CostCategory): string {
  return category === '工人工资' ? '/subcontract/payroll' : '/finance/records'
}

function factKey(projectId: string, category: CostCategory): string {
  return `${projectId}\u0000${category}`
}

function createFact(projectId: string, category: CostCategory): CostFact {
  return {
    projectId,
    category,
    targetCostId: '',
    targetAmounts: [],
    signedAmounts: [],
    settledAmounts: [],
    paidAmounts: [],
    targetLineIds: new Set(),
    contractIds: new Set(),
    settlementIds: new Set(),
    paymentIds: new Set(),
    reimbursementIds: new Set(),
  }
}

export async function loadProjectCostControl(db: SoftDb): Promise<ProjectCostControl> {
  const [
    targetRows,
    targetItemRows,
    contractRows,
    supplementRows,
    settlementRows,
    paymentRows,
    reimbursementRows,
  ] = await Promise.all([
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('target_costs')}
      SELECT target.*
      FROM target_costs AS target
      WHERE ${visibleCond('target_costs', 'target')}
        AND target.project_id IS NOT NULL
      ORDER BY target.is_baseline DESC, target.created_at DESC, target.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('target_cost_items', 'target_costs')}
      SELECT item.id, item.cost_category, item.amount,
             target.id AS target_cost_id, target.project_id
      FROM target_cost_items AS item
      JOIN target_costs AS target ON target.id = item.target_cost_id
      WHERE ${visibleCond('target_cost_items', 'item')}
        AND ${visibleCond('target_costs', 'target')}
        AND target.is_baseline = 1
        AND target.status = 'submitted'
        AND target.project_id IS NOT NULL
      ORDER BY target.project_id, item.sort_order, item.created_at, item.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('contracts')}
      SELECT contract.*
      FROM contracts AS contract
      WHERE ${visibleCond('contracts', 'contract')}
        AND contract.kind <> '施工'
        AND contract.status NOT IN ('draft', '草稿')
        AND contract.project_id IS NOT NULL
      ORDER BY contract.created_at, contract.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('contract_supplements', 'contracts')}
      SELECT supplement.id, supplement.contract_id, supplement.amount
      FROM contract_supplements AS supplement
      JOIN contracts AS contract ON contract.id = supplement.contract_id
      WHERE ${visibleCond('contract_supplements', 'supplement')}
        AND ${visibleCond('contracts', 'contract')}
        AND contract.kind <> '施工'
        AND contract.status NOT IN ('draft', '草稿')
        AND supplement.status NOT IN ('draft', '草稿')
      ORDER BY supplement.created_at, supplement.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('expenditure_settlements', 'contracts')}
      SELECT settlement.id, settlement.project_id, settlement.total_amount,
             contract.cost_category, contract.kind, contract.sub_kind,
             contract.other_expense_kind
      FROM expenditure_settlements AS settlement
      JOIN contracts AS contract ON contract.id = settlement.contract_id
      WHERE ${visibleCond('expenditure_settlements', 'settlement')}
        AND ${visibleCond('contracts', 'contract')}
        AND settlement.status IN (${CONFIRMED_SETTLEMENT_SQL_VALUES})
        AND contract.status NOT IN ('draft', '草稿')
        ORDER BY settlement.created_at, settlement.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor(
        'payment_record_application_allocations',
        'payment_records',
        'payment_applications',
        'contracts',
      )}
      SELECT allocation.id, allocation.allocated_amount,
             payment.id AS payment_id, payment.project_id,
             contract.cost_category, contract.kind, contract.sub_kind,
             contract.other_expense_kind
      FROM payment_record_application_allocations AS allocation
      JOIN payment_records AS payment
        ON payment.id = allocation.payment_record_id
      JOIN payment_applications AS application
        ON application.id = allocation.payment_application_id
      JOIN contracts AS contract
        ON contract.id = application.contract_id
      WHERE ${visibleCond('payment_record_application_allocations', 'allocation')}
        AND ${visibleCond('payment_records', 'payment')}
        AND ${visibleCond('payment_applications', 'application')}
        AND ${visibleCond('contracts', 'contract')}
        AND payment.confirmation_status = 'confirmed'
        AND payment.project_id = contract.project_id
      ORDER BY payment.payment_date, payment.id, allocation.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('expense_reimbursement_lines', 'expense_reimbursements')}
      SELECT reimbursement.id, reimbursement.project_id, line.id AS line_id, line.amount
      FROM expense_reimbursement_lines AS line
      JOIN expense_reimbursements AS reimbursement
        ON reimbursement.id = line.reimbursement_id
      WHERE ${visibleCond('expense_reimbursement_lines', 'line')}
        AND ${visibleCond('expense_reimbursements', 'reimbursement')}
        AND reimbursement.status = 'confirmed'
        AND line.original_expense_line_id IS NULL
        AND reimbursement.project_id IS NOT NULL
      ORDER BY reimbursement.project_id, reimbursement.id, line.sort_order, line.id
    `),
  ])

  const facts = new Map<string, CostFact>()
  const getFact = (projectId: string, category: CostCategory) => {
    const key = factKey(projectId, category)
    const existing = facts.get(key)
    if (existing)
      return existing
    const created = createFact(projectId, category)
    facts.set(key, created)
    return created
  }

  for (const row of targetItemRows) {
    const projectId = text(row.project_id)
    const category = text(row.cost_category) as CostCategory
    if (!projectId || !(COST_CATEGORIES as readonly string[]).includes(category))
      continue
    const current = getFact(projectId, category)
    current.targetCostId = text(row.target_cost_id)
    current.targetAmounts.push(row.amount)
    current.targetLineIds.add(text(row.id))
  }

  const supplementsByContract = new Map<string, unknown[]>()
  for (const row of supplementRows) {
    const id = text(row.contract_id)
    supplementsByContract.set(id, [...(supplementsByContract.get(id) ?? []), row.amount])
  }
  for (const row of contractRows) {
    const projectId = text(row.project_id)
    if (!projectId)
      continue
    const current = getFact(projectId, costCategoryFromContract(row))
    current.signedAmounts.push(row.amount, ...(supplementsByContract.get(text(row.id)) ?? []))
    current.contractIds.add(text(row.id))
  }

  for (const row of settlementRows) {
    const projectId = text(row.project_id)
    if (!projectId)
      continue
    const current = getFact(projectId, costCategoryFromContract(row))
    current.settledAmounts.push(row.total_amount)
    current.settlementIds.add(text(row.id))
  }

  for (const row of paymentRows) {
    const projectId = text(row.project_id)
    if (!projectId)
      continue
    const current = getFact(projectId, costCategoryFromContract(row))
    current.paidAmounts.push(row.allocated_amount)
    current.paymentIds.add(text(row.payment_id))
  }

  for (const row of reimbursementRows) {
    const projectId = text(row.project_id)
    if (!projectId)
      continue
    const current = getFact(projectId, '费用报销')
    current.settledAmounts.push(row.amount)
    current.reimbursementIds.add(text(row.id))
  }

  const baselineProjects = new Map(
    targetRows
      .filter(row => row.is_baseline === 1 && row.status === 'submitted')
      .map(row => [text(row.project_id), text(row.id)]),
  )
  for (const [projectId, id] of baselineProjects) {
    for (const category of COST_CATEGORIES)
      getFact(projectId, category).targetCostId = id
  }
  // P4 has no verified complete actual-cost/payment feed in this Native reader.
  // A released wage header is preserved at its owner and does not prove this aggregate.
  for (const projectId of new Set([...targetRows.map(row => text(row.project_id)), ...[...facts.values()].map(row => row.projectId)]))
    getFact(projectId, '工人工资')

  const categoryOrder = new Map<string, number>(
    [...COST_CATEGORIES, '未分类'].map((category, index) => [category, index]),
  )
  const categories = [...facts.values()]
    .map<TargetCostCategoryRow>((row) => {
      const targetAmount = row.targetCostId ? sumCostAmounts(row.targetAmounts, '目标成本明细:pending') : missingCostAmount('当前基线:pending')
      const signedAmount = sumCostAmounts(row.signedAmounts, '合同及补充协议金额:pending')
      const settledAmount = row.category === '工人工资' ? missingCostAmount('P4实际工资源:unavailable') : sumCostAmounts(row.settledAmounts, '已确认结算及原费用金额:pending')
      const paidAmount = row.category === '工人工资' ? missingCostAmount('P4实际支付源:unavailable') : sumCostAmounts(row.paidAmounts, '已确认支付分摊金额:pending')
      const metrics = { targetAmount, signedAmount, settledAmount, paidAmount, remainingAmount: remainingCostAmount(targetAmount, settledAmount) }
      return {
        id: factKey(row.projectId, row.category),
        projectId: row.projectId,
        targetCostId: row.targetCostId,
        category: row.category,
        targetAmount: targetAmount.value,
        signedAmount: signedAmount.value,
        settledAmount: settledAmount.value,
        paidAmount: paidAmount.value,
        remainingAmount: metrics.remainingAmount.value,
        metrics,
        targetLineCount: row.targetLineIds.size,
        contractCount: row.contractIds.size,
        settlementCount: row.settlementIds.size,
        paymentCount: row.category === '工人工资' ? null : row.paymentIds.size,
        reimbursementCount: row.reimbursementIds.size,
        targetPath: row.targetCostId
          ? `/project/target-cost/${row.targetCostId}`
          : '/project/target-cost',
        contractPath: contractPath(row.category),
        settlementPath: settlementPath(row.category),
        paymentPath: paymentPath(row.category),
        reimbursementPath: '/finance/reimbursement',
      }
    })
    .sort((left, right) =>
      left.projectId.localeCompare(right.projectId, 'zh-CN')
      || (categoryOrder.get(left.category) ?? 99) - (categoryOrder.get(right.category) ?? 99),
    )

  const versions = targetRows.map<TargetCostVersionRow>((row) => {
    const projectId = text(row.project_id)
    const actualRows = categories.filter(category => category.projectId === projectId)
    const targetAmount = sumCostAmounts([row.tax_inclusive_total], '预算基准金额:pending')
    const signedAmount = sumCostMetrics(actualRows.map(row => row.metrics.signedAmount))
    const settledAmount = sumCostMetrics(actualRows.map(row => row.metrics.settledAmount))
    const paidAmount = sumCostMetrics(actualRows.map(row => row.metrics.paidAmount))
    const metrics = { targetAmount, signedAmount, settledAmount, paidAmount, remainingAmount: remainingCostAmount(targetAmount, settledAmount) }
    const rawStatus = text(row.status)
    const status = rawStatus === 'draft'
      ? '草稿（不入控制）'
      : row.is_baseline === 1
        ? '当前基线'
        : '历史版本'
    return {
      id: text(row.id),
      projectId,
      name: text(row.name),
      status,
      targetAmount: targetAmount.value,
      signedAmount: signedAmount.value,
      settledAmount: settledAmount.value,
      paidAmount: paidAmount.value,
      remainingAmount: metrics.remainingAmount.value,
      metrics,
      sourcePath: `/project/target-cost/${text(row.id)}`,
    }
  })

  return { versions, categories }
}
