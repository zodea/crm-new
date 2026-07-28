import type { SoftDb } from '~/lib/db/soft-delete'
import type { ProjectOperationSummary } from '~/lib/project/detail-summary'
import {
  hiddenCtes,
  hiddenCtesFor,
  selectVisibleSql,
  visibleCond,
} from '~/lib/db/soft-delete'
import {
  formalOwnerChangeSql,
  nonDraftStatusSql,
} from '~/lib/project/formal-facts'

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

async function loadNonDraftProjectSums(
  db: SoftDb,
  table: 'invoice_applications' | 'receipt_registrations',
  valueColumn: string,
): Promise<Map<string, number>> {
  const rows = await db.select<ProjectSumRow>(`
    ${hiddenCtes(table)}
    SELECT r.project_id, COALESCE(SUM(r."${valueColumn}"), 0) AS total
    FROM "${table}" r
    WHERE ${visibleCond(table, 'r')}
      AND ${nonDraftStatusSql('r.status')}
    GROUP BY r.project_id
  `)
  return new Map(rows.map(row => [row.project_id, number(row.total)]))
}

async function loadConstructionContractSums(db: SoftDb): Promise<Map<string, number>> {
  const rows = await db.select<ProjectSumRow>(`
    ${hiddenCtes('contracts')}
    SELECT contract.project_id, COALESCE(SUM(contract.amount), 0) AS total
    FROM contracts AS contract
    WHERE ${visibleCond('contracts', 'contract')}
      AND contract.kind = '施工'
      AND contract.project_id IS NOT NULL
      AND ${nonDraftStatusSql('contract.status')}
    GROUP BY contract.project_id
  `)
  return new Map(rows.map(row => [row.project_id, number(row.total)]))
}

async function loadConfirmedPaymentSums(db: SoftDb): Promise<Map<string, number>> {
  const rows = await db.select<ProjectSumRow>(`
    ${hiddenCtes('payment_records')}
    SELECT payment.project_id, COALESCE(SUM(payment.amount), 0) AS total
    FROM payment_records AS payment
    WHERE ${visibleCond('payment_records', 'payment')}
      AND payment.confirmation_status = 'confirmed'
      AND payment.project_id IS NOT NULL
    GROUP BY payment.project_id
  `)
  return new Map(rows.map(row => [row.project_id, number(row.total)]))
}

async function loadConstructionSupplementSums(db: SoftDb): Promise<Map<string, number>> {
  const rows = await db.select<ProjectSumRow>(`
    ${hiddenCtesFor('contracts', 'contract_supplements')}
    SELECT contract.project_id, COALESCE(SUM(supplement.amount), 0) AS total
    FROM contract_supplements AS supplement
    JOIN contracts AS contract ON contract.id = supplement.contract_id
    WHERE ${visibleCond('contract_supplements', 'supplement')}
      AND ${visibleCond('contracts', 'contract')}
      AND contract.kind = '施工'
      AND ${nonDraftStatusSql('contract.status')}
      AND ${nonDraftStatusSql('supplement.status')}
      AND contract.project_id IS NOT NULL
    GROUP BY contract.project_id
  `)
  return new Map(rows.map(row => [row.project_id, number(row.total)]))
}

async function loadFormalOwnerChangeSums(db: SoftDb): Promise<Map<string, number>> {
  const rows = await db.select<ProjectSumRow>(`
    ${hiddenCtes('owner_change_orders')}
    SELECT change.project_id, COALESCE(SUM(change.tax_inc_amount), 0) AS total
    FROM owner_change_orders AS change
    WHERE ${visibleCond('owner_change_orders', 'change')}
      AND ${formalOwnerChangeSql('change')}
    GROUP BY change.project_id
  `)
  return new Map(rows.map(row => [row.project_id, number(row.total)]))
}

async function loadCurrentSums(
  db: SoftDb,
  direction: 'receipt' | 'payment',
): Promise<Map<string, number>> {
  const rows = await db.select<ProjectSumRow>(`
    ${hiddenCtes('current_transactions')}
    SELECT current.project_id, COALESCE(SUM(current.amount), 0) AS total
    FROM current_transactions AS current
    WHERE ${visibleCond('current_transactions', 'current')}
      AND current.direction = ?
      AND current.status NOT IN ('draft', '草稿')
    GROUP BY current.project_id
  `, [direction])
  return new Map(rows.map(row => [row.project_id, number(row.total)]))
}

/** DATABASE §4.1/§4.2：明细求和交给 SQLite，且所有表统一走祖先软删过滤。 */
export async function loadProjectDetailAggregates(db: SoftDb): Promise<ProjectDetailAggregate[]> {
  const [projects, mainContracts, supplements, changes, receipts, payments, currentIn, currentOut, outputAmounts, outputTaxes] = await Promise.all([
    db.select<{ id: string }>(selectVisibleSql('projects', 'ORDER BY id')),
    loadConstructionContractSums(db),
    loadConstructionSupplementSums(db),
    loadFormalOwnerChangeSums(db),
    loadNonDraftProjectSums(db, 'receipt_registrations', 'amount'),
    loadConfirmedPaymentSums(db),
    loadCurrentSums(db, 'receipt'),
    loadCurrentSums(db, 'payment'),
    loadNonDraftProjectSums(db, 'invoice_applications', 'amount'),
    loadNonDraftProjectSums(db, 'invoice_applications', 'tax_amount'),
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
      availableBalance: projectReceipt + currentReceipt - paymentAmount - currentPayment,
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
