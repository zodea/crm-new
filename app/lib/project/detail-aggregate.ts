import type { SoftDb } from '~/lib/db/soft-delete'
import type { ProjectOperationSummary } from '~/lib/project/detail-summary'
import { hiddenCtes, selectVisibleSql, visibleCond } from '~/lib/db/soft-delete'

export interface ProjectDetailAggregate extends ProjectOperationSummary {
  projectId: string
  outputAmount: number
  outputTax: number
}

export interface ArchivedInvoiceAggregate {
  projectId: string
  inputAmount: number
  inputTax: number
  archivedCount: number
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

interface ProjectSumRow {
  project_id: string
  total: number
}

async function loadProjectSums(db: SoftDb, table: string, valueColumn: string): Promise<Map<string, number>> {
  const rows = await db.select<ProjectSumRow>(`
    ${hiddenCtes(table)}
    SELECT r.project_id, COALESCE(SUM(r."${valueColumn}"), 0) AS total
    FROM "${table}" r
    WHERE ${visibleCond(table, 'r')}
    GROUP BY r.project_id
  `)
  return new Map(rows.map(row => [row.project_id, number(row.total)]))
}

/** DATABASE §4.1/§4.2：明细求和交给 SQLite，且所有表统一走祖先软删过滤。 */
export async function loadProjectDetailAggregates(db: SoftDb): Promise<ProjectDetailAggregate[]> {
  const [projects, mainContracts, supplements, changes, receipts, payments, currentIn, currentOut, outputAmounts, outputTaxes] = await Promise.all([
    db.select<{ id: string }>(selectVisibleSql('projects', 'ORDER BY id')),
    loadProjectSums(db, 'construction_contracts', 'amount'),
    db.select<ProjectSumRow>(`
      ${hiddenCtes('supplement_agreements')}
      SELECT c.project_id, COALESCE(SUM(s.amount), 0) AS total
      FROM supplement_agreements s
      JOIN construction_contracts c ON c.id=s.contract_id
      WHERE ${visibleCond('supplement_agreements', 's')}
      GROUP BY c.project_id
    `).then(rows => new Map(rows.map(row => [row.project_id, number(row.total)]))),
    loadProjectSums(db, 'owner_change_orders', 'tax_inc_amount'),
    loadProjectSums(db, 'receipt_registrations', 'amount'),
    loadProjectSums(db, 'payment_applications', 'actual_payment'),
    loadProjectSums(db, 'current_receipts', 'amount'),
    loadProjectSums(db, 'current_payments', 'amount'),
    loadProjectSums(db, 'invoice_applications', 'amount'),
    loadProjectSums(db, 'invoice_applications', 'tax_amount'),
  ])

  return projects.map(({ id: projectId }) => {
    const mainContractAmount = mainContracts.get(projectId) ?? 0
    const supplementAmount = supplements.get(projectId) ?? 0
    const ownerChangeAmount = changes.get(projectId) ?? 0
    const projectReceipt = receipts.get(projectId) ?? 0
    const paymentAmount = payments.get(projectId) ?? 0
    const currentReceipt = currentIn.get(projectId) ?? 0
    const currentPayment = currentOut.get(projectId) ?? 0
    const managementFee = 0
    return {
      projectId,
      mainContractAmount,
      supplementAmount,
      ownerChangeAmount,
      changedContractAmount: mainContractAmount + supplementAmount + ownerChangeAmount,
      projectReceipt,
      paymentAmount,
      currentReceipt,
      currentPayment,
      managementFee,
      availableBalance: projectReceipt + currentReceipt - paymentAmount - currentPayment - managementFee,
      outputAmount: outputAmounts.get(projectId) ?? 0,
      outputTax: outputTaxes.get(projectId) ?? 0,
    }
  })
}

/** 已归档进项票按项目聚合；复用软删祖先过滤，避免隐藏项目/分供方的票继续入账。 */
export async function loadArchivedInvoiceAggregates(db: SoftDb): Promise<ArchivedInvoiceAggregate[]> {
  const rows = await db.select<Record<string, unknown>>(`
    ${hiddenCtes('invoices')}
    SELECT
      i.project_id,
      COALESCE(SUM(i.amount), 0) AS input_amount,
      COALESCE(SUM(i.tax_amount), 0) AS input_tax,
      COUNT(*) AS archived_count
    FROM invoices i
    WHERE ${visibleCond('invoices', 'i')}
      AND i.account_status='archived'
      AND i.project_id IS NOT NULL
    GROUP BY i.project_id
  `)
  return rows.map(row => ({
    projectId: row.project_id as string,
    inputAmount: number(row.input_amount),
    inputTax: number(row.input_tax),
    archivedCount: number(row.archived_count),
  }))
}
