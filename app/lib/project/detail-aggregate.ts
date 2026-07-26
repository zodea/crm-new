import type { SoftDb } from '~/lib/db/soft-delete'
import type { ProjectOperationSummary } from '~/lib/project/detail-summary'
import {
  hiddenCtes,
  hiddenCtesFor,
  selectVisibleSql,
  visibleCond,
} from '~/lib/db/soft-delete'

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

async function loadConstructionContractSums(db: SoftDb): Promise<Map<string, number>> {
  const rows = await db.select<ProjectSumRow>(`
    ${hiddenCtes('contracts')}
    SELECT contract.project_id, COALESCE(SUM(contract.amount), 0) AS total
    FROM contracts AS contract
    WHERE ${visibleCond('contracts', 'contract')}
      AND contract.kind = '施工'
      AND contract.project_id IS NOT NULL
    GROUP BY contract.project_id
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
      AND supplement.status NOT IN ('draft', '草稿')
      AND contract.project_id IS NOT NULL
    GROUP BY contract.project_id
  `)
  return new Map(rows.map(row => [row.project_id, number(row.total)]))
}

/** DATABASE §4.1/§4.2：明细求和交给 SQLite，且所有表统一走祖先软删过滤。 */
export async function loadProjectDetailAggregates(db: SoftDb): Promise<ProjectDetailAggregate[]> {
  const [projects, mainContracts, supplements, changes, receipts, payments, currentIn, currentOut, outputAmounts, outputTaxes] = await Promise.all([
    db.select<{ id: string }>(selectVisibleSql('projects', 'ORDER BY id')),
    loadConstructionContractSums(db),
    loadConstructionSupplementSums(db),
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
