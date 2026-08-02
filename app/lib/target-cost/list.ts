import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'

export interface TargetCostListRow {
  id: string
  projectId: string
  projectName: string
  name: string
  isBaseline: boolean
  contractRevenue: number
  plannedProfit: number
  taxInclusiveTotal: number
  taxExclusiveTotal: number
  taxAmount: number
  signedContractSum: number
  profitRate: number | null
  status: string
  updatedAt: string
}

export interface TargetCostListFilters {
  search: string
  project: string
  baseline: 'all' | 'baseline' | 'history'
  status: string
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function loadTargetCostList(
  db: SoftDb,
): Promise<TargetCostListRow[]> {
  const rows = await db.select<Record<string, unknown>>(`
    ${hiddenCtesFor('target_costs', 'projects')}
    SELECT
      target.id,
      target.project_id,
      project.name AS project_name,
      target.name,
      target.is_baseline,
      target.contract_revenue,
      target.planned_profit,
      target.tax_inclusive_total,
      target.tax_exclusive_total,
      target.tax_amount,
      target.signed_contract_sum,
      target.status,
      target.updated_at
    FROM target_costs AS target
    LEFT JOIN projects AS project
      ON project.id = target.project_id
     AND ${visibleCond('projects', 'project')}
    WHERE ${visibleCond('target_costs', 'target')}
    ORDER BY target.updated_at DESC, target.created_at DESC, target.id
  `)

  return rows.map(row => ({
    id: text(row.id),
    projectId: text(row.project_id),
    projectName: text(row.project_name),
    name: text(row.name),
    isBaseline: row.is_baseline === 1,
    contractRevenue: number(row.contract_revenue),
    plannedProfit: number(row.planned_profit),
    taxInclusiveTotal: number(row.tax_inclusive_total),
    taxExclusiveTotal: number(row.tax_exclusive_total),
    taxAmount: number(row.tax_amount),
    signedContractSum: number(row.signed_contract_sum),
    profitRate: number(row.contract_revenue) > 0
      ? number(row.planned_profit) / number(row.contract_revenue)
      : null,
    status: text(row.status),
    updatedAt: text(row.updated_at),
  }))
}

export function filterTargetCostList(
  rows: readonly TargetCostListRow[],
  filters: TargetCostListFilters,
): TargetCostListRow[] {
  const keyword = filters.search.trim().toLocaleLowerCase('zh-CN')
  return rows.filter((row) => {
    if (filters.project !== 'all') {
      if (filters.project === 'unassigned' ? row.projectId : row.projectId !== filters.project)
        return false
    }
    if (filters.baseline === 'baseline' && !row.isBaseline)
      return false
    if (filters.baseline === 'history' && row.isBaseline)
      return false
    if (filters.status !== 'all' && row.status !== filters.status)
      return false
    if (!keyword)
      return true
    return [row.name, row.projectName]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(keyword))
  })
}
