import type { SoftDb } from '~/lib/db/soft-delete'
import type { ProjectOperationSummary } from '~/lib/project/detail-summary'
import { hiddenCtes, visibleCond } from '~/lib/db/soft-delete'

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

/**
 * DATABASE §4.1/§4.2：明细求和交给 SQLite，应用层只派生公式字段。
 * 每个子查询都排除软删行；补充协议同时要求其施工合同仍可见。
 */
export async function loadProjectDetailAggregates(db: SoftDb): Promise<ProjectDetailAggregate[]> {
  const rows = await db.select<Record<string, unknown>>(`
    SELECT
      p.id AS project_id,
      COALESCE((SELECT SUM(c.amount) FROM construction_contracts c WHERE c.project_id=p.id AND c.deleted_at IS NULL), 0) AS main_contract_amount,
      COALESCE((SELECT SUM(s.amount) FROM supplement_agreements s JOIN construction_contracts c ON c.id=s.contract_id WHERE c.project_id=p.id AND c.deleted_at IS NULL AND s.deleted_at IS NULL), 0) AS supplement_amount,
      COALESCE((SELECT SUM(o.tax_inc_amount) FROM owner_change_orders o WHERE o.project_id=p.id AND o.deleted_at IS NULL), 0) AS owner_change_amount,
      COALESCE((SELECT SUM(r.amount) FROM receipt_registrations r WHERE r.project_id=p.id AND r.deleted_at IS NULL), 0) AS project_receipt,
      COALESCE((SELECT SUM(a.actual_payment) FROM payment_applications a WHERE a.project_id=p.id AND a.deleted_at IS NULL), 0) AS payment_amount,
      COALESCE((SELECT SUM(r.amount) FROM current_receipts r WHERE r.project_id=p.id AND r.deleted_at IS NULL), 0) AS current_receipt,
      COALESCE((SELECT SUM(pmt.amount) FROM current_payments pmt WHERE pmt.project_id=p.id AND pmt.deleted_at IS NULL), 0) AS current_payment,
      COALESCE((SELECT SUM(i.amount) FROM invoice_applications i WHERE i.project_id=p.id AND i.deleted_at IS NULL), 0) AS output_amount,
      COALESCE((SELECT SUM(i.tax_amount) FROM invoice_applications i WHERE i.project_id=p.id AND i.deleted_at IS NULL), 0) AS output_tax
    FROM projects p
    WHERE p.deleted_at IS NULL
  `)

  return rows.map((row) => {
    const mainContractAmount = number(row.main_contract_amount)
    const supplementAmount = number(row.supplement_amount)
    const ownerChangeAmount = number(row.owner_change_amount)
    const projectReceipt = number(row.project_receipt)
    const paymentAmount = number(row.payment_amount)
    const currentReceipt = number(row.current_receipt)
    const currentPayment = number(row.current_payment)
    const managementFee = 0
    return {
      projectId: row.project_id as string,
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
      outputAmount: number(row.output_amount),
      outputTax: number(row.output_tax),
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
