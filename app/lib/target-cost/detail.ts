import type { SoftDb } from '~/lib/db/soft-delete'
import type { CostCategory } from '~/lib/project/cost-control'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'
import { COST_CATEGORIES, loadProjectCostControl } from '~/lib/project/cost-control'
import { round2 } from '~/lib/util/number'

export interface TargetCostDetailHeader {
  id: string
  projectId: string | null
  projectCode: string
  projectName: string
  name: string
  isBaseline: boolean
  contractRevenue: number | null
  plannedProfit: number | null
  signedContractSum: number | null
  taxInclusiveTotal: number | null
  taxExclusiveTotal: number | null
  taxAmount: number | null
  status: string
  note: string
  createdAt: string
  updatedAt: string
}

export interface TargetCostDetailItem {
  id: string
  category: CostCategory
  itemName: string
  unit: string
  qty: number | null
  unitPrice: number | null
  amount: number
  note: string
  sortOrder: number
}

export interface TargetCostDetailCategory {
  id: string
  category: CostCategory
  targetAmount: number
  signedAmount: number
  settledAmount: number
  paidAmount: number
  remainingAmount: number
  targetLineCount: number
  contractCount: number
  settlementCount: number
  paymentCount: number
  reimbursementCount: number
  contractPath: string
  settlementPath: string
  paymentPath: string
  reimbursementPath: string
}

export interface TargetCostDetailSummary {
  itemTotal: number
  signedAmount: number
  settledAmount: number
  paidAmount: number
  remainingAmount: number
}

export interface TargetCostDetail {
  header: TargetCostDetailHeader
  items: TargetCostDetailItem[]
  categories: TargetCostDetailCategory[]
  summary: TargetCostDetailSummary
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableNumber(value: unknown): number | null {
  return value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null
}

export function targetCostHeaderFromRow(row: Record<string, unknown>): TargetCostDetailHeader {
  return {
    id: text(row.id),
    projectId: row.project_id == null ? null : text(row.project_id),
    projectCode: text(row.project_code),
    projectName: text(row.project_name),
    name: text(row.name),
    isBaseline: row.is_baseline === 1,
    contractRevenue: nullableNumber(row.contract_revenue),
    plannedProfit: nullableNumber(row.planned_profit),
    signedContractSum: nullableNumber(row.signed_contract_sum),
    taxInclusiveTotal: nullableNumber(row.tax_inclusive_total),
    taxExclusiveTotal: nullableNumber(row.tax_exclusive_total),
    taxAmount: nullableNumber(row.tax_amount),
    status: text(row.status),
    note: text(row.note),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  }
}

export function targetCostItemFromRow(row: Record<string, unknown>): TargetCostDetailItem {
  return {
    id: text(row.id),
    category: text(row.cost_category) as CostCategory,
    itemName: text(row.item_name),
    unit: text(row.unit),
    qty: nullableNumber(row.qty),
    unitPrice: nullableNumber(row.unit_price),
    amount: number(row.amount),
    note: text(row.note),
    sortOrder: number(row.sort_order),
  }
}

function categoryKey(category: CostCategory): number {
  const order = [...COST_CATEGORIES, '未分类'].indexOf(category)
  return order < 0 ? 99 : order
}

export async function loadTargetCostDetail(
  db: SoftDb,
  targetCostId: string,
): Promise<TargetCostDetail | null> {
  const [headerRows, itemRows, control] = await Promise.all([
    db.select<Record<string, unknown>>(
      `
        ${hiddenCtesFor('target_costs')}
        SELECT target.*, project.code AS project_code, project.name AS project_name
        FROM target_costs AS target
        LEFT JOIN projects AS project ON project.id = target.project_id
        WHERE ${visibleCond('target_costs', 'target')}
          AND target.id = ?
        LIMIT 1
      `,
      [targetCostId],
    ),
    db.select<Record<string, unknown>>(
      `
        ${hiddenCtesFor('target_cost_items')}
        SELECT item.*
        FROM target_cost_items AS item
        WHERE ${visibleCond('target_cost_items', 'item')}
          AND item.target_cost_id = ?
        ORDER BY item.sort_order, item.created_at, item.id
      `,
      [targetCostId],
    ),
    loadProjectCostControl(db),
  ])

  const headerRow = headerRows[0]
  if (!headerRow)
    return null

  const header = targetCostHeaderFromRow(headerRow)
  const items = itemRows.map(targetCostItemFromRow)
  const itemFacts = new Map<CostCategory, { amount: number, count: number }>()
  for (const item of items) {
    const current = itemFacts.get(item.category) ?? { amount: 0, count: 0 }
    current.amount = round2(current.amount + item.amount)
    current.count += 1
    itemFacts.set(item.category, current)
  }

  const actualFacts = new Map(
    control.categories
      .filter(row => row.projectId === header.projectId)
      .map(row => [row.category, row] as const),
  )
  const categories = [...new Set<CostCategory>([
    ...COST_CATEGORIES,
    ...items.map(item => item.category),
    ...actualFacts.keys(),
  ])]
    .map<TargetCostDetailCategory>((category) => {
      const item = itemFacts.get(category) ?? { amount: 0, count: 0 }
      const actual = actualFacts.get(category)
      return {
        id: `${targetCostId}\u0000${category}`,
        category,
        targetAmount: item.amount,
        signedAmount: actual?.signedAmount ?? 0,
        settledAmount: actual?.settledAmount ?? 0,
        paidAmount: actual?.paidAmount ?? 0,
        remainingAmount: round2(item.amount - (actual?.settledAmount ?? 0)),
        targetLineCount: item.count,
        contractCount: actual?.contractCount ?? 0,
        settlementCount: actual?.settlementCount ?? 0,
        paymentCount: actual?.paymentCount ?? 0,
        reimbursementCount: actual?.reimbursementCount ?? 0,
        contractPath: actual?.contractPath ?? '/contract/other-expense',
        settlementPath: actual?.settlementPath ?? '/contract/other-settlement',
        paymentPath: actual?.paymentPath ?? '/finance/records',
        reimbursementPath: actual?.reimbursementPath ?? '/finance/reimbursement',
      }
    })
    .sort((left, right) => categoryKey(left.category) - categoryKey(right.category))

  const summary = categories.reduce<TargetCostDetailSummary>(
    (total, category) => ({
      itemTotal: round2(total.itemTotal + category.targetAmount),
      signedAmount: round2(total.signedAmount + category.signedAmount),
      settledAmount: round2(total.settledAmount + category.settledAmount),
      paidAmount: round2(total.paidAmount + category.paidAmount),
      remainingAmount: round2(total.remainingAmount + category.remainingAmount),
    }),
    {
      itemTotal: 0,
      signedAmount: 0,
      settledAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
    },
  )

  return { header, items, categories, summary }
}
