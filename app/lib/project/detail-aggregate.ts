import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtes, visibleCond } from '~/lib/db/soft-delete'
import { verifiedFinanceNumber } from '~/lib/finance/persistent-rows'

export interface ArchivedInvoiceAggregate {
  projectId: string
  inputAmount: number | null
  inputTax: number | null
  archivedCount: number
}

/** Raw SQLite values retain absence and corruption; signed contract and red-letter amounts remain legal. */
export function projectAmount(value: unknown): number | null {
  try {
    return verifiedFinanceNumber(value)
  }
  catch {
    return null
  }
}

export function sumProjectAmounts(values: readonly unknown[]): number | null {
  let total = 0
  for (const value of values) {
    const amount = projectAmount(value)
    if (amount === null)
      return null
    total += amount
    if (!Number.isFinite(total))
      return null
  }
  return total
}

/** 已归档进项票按项目聚合；复用软删祖先过滤，避免隐藏项目/分供方的票继续入账。 */
export async function loadArchivedInvoiceAggregates(db: SoftDb): Promise<ArchivedInvoiceAggregate[]> {
  const rows = await db.select<Record<string, unknown>>(`
    ${hiddenCtes('invoices')}
    SELECT
      i.project_id,
      i.amount AS input_amount,
      i.tax_amount AS input_tax
    FROM invoices i
    WHERE ${visibleCond('invoices', 'i')}
      AND i.account_status='archived'
      AND i.project_id IS NOT NULL
  `)
  const projects = new Map<string, { amounts: unknown[], taxes: unknown[] }>()
  for (const row of rows) {
    const id = row.project_id as string
    const project = projects.get(id) ?? { amounts: [], taxes: [] }
    project.amounts.push(row.input_amount)
    project.taxes.push(row.input_tax)
    projects.set(id, project)
  }
  return [...projects].map(([projectId, project]) => ({
    projectId,
    inputAmount: sumProjectAmounts(project.amounts),
    inputTax: sumProjectAmounts(project.taxes),
    archivedCount: project.amounts.length,
  }))
}
