import type { SoftDb } from '~/lib/db/soft-delete'
import type { CostCategory } from '~/lib/project/cost-control'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'
import { costCategoryFromContract } from '~/lib/project/cost-control'

export interface ExpenditureContractRow {
  id: string
  projectId: string
  contractNo: string
  name: string
  category: CostCategory
  originalCategory: string
  classificationState: string
  status: string
  amount: number
  supplementAmount: number
  supplier: string
  effectiveDate: string
  settledAmount: number
  paidAmount: number
  sourcePath: string
}

export interface ExpenditureSupplementRow {
  id: string
  projectId: string
  contractId: string
  agreementNo: string
  name: string
  contractName: string
  amount: number
  effectiveAmount: number
  signDate: string
  status: string
  sourcePath: string
}

export interface SubcontractChangeRow {
  id: string
  projectId: string
  contractId: string
  changeNo: string
  changeType: string
  supplier: string
  contractName: string
  approvedAmount: number
  effectiveApprovedAmount: number
  changedArea: number
  actualApprovedPrice: number
  status: string
  sourcePath: string
}

export interface ExpenditureSettlementRow {
  id: string
  projectId: string
  contractId: string
  settlementNo: string
  name: string
  contractName: string
  settlementDate: string
  settlementType: string
  amount: number
  effectiveAmount: number
  status: string
  sourcePath: string
}

export interface ProjectExpenditureRelations {
  contracts: ExpenditureContractRow[]
  supplements: ExpenditureSupplementRow[]
  changes: SubcontractChangeRow[]
  settlements: ExpenditureSettlementRow[]
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

function isDraft(status: unknown): boolean {
  return ['draft', '草稿'].includes(text(status))
}

function isConfirmed(status: unknown): boolean {
  return ['confirmed', 'approved', '已确认', '已审批'].includes(text(status))
}

function originalCategory(row: Record<string, unknown>): string {
  return text(row.sub_kind || row.other_expense_kind || row.legacy_type || row.kind)
}

function contractSourcePath(row: Record<string, unknown>): string {
  return row.kind === '其他支出'
    ? `/contract/other-expense/form/${text(row.id)}`
    : `/contract/${text(row.id)}`
}

function settlementSourcePath(row: Record<string, unknown>): string {
  const bizType = text(row.biz_type)
  if (bizType === '分包' || bizType === '专业分包' || bizType === '合同劳务')
    return `/subcontract/settlement/${text(row.id)}`
  if (bizType === '材料' || bizType === '材采')
    return `/material/settlement/form/${text(row.id)}`
  return `/contract/other-settlement/form/${text(row.id)}`
}

export async function loadProjectExpenditureRelations(
  db: SoftDb,
): Promise<ProjectExpenditureRelations> {
  const [contractRows, supplementRows, changeRows, settlementRows, paymentRows] = await Promise.all([
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('contracts', 'suppliers')}
      SELECT contract.*, COALESCE(supplier.name, '') AS supplier_name
      FROM contracts AS contract
      LEFT JOIN suppliers AS supplier
        ON supplier.id = contract.supplier_id
       AND ${visibleCond('suppliers', 'supplier')}
      WHERE ${visibleCond('contracts', 'contract')}
        AND contract.kind <> '施工'
        AND contract.status NOT IN ('draft', '草稿')
        AND contract.project_id IS NOT NULL
      ORDER BY contract.created_at DESC, contract.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('contract_supplements', 'contracts')}
      SELECT supplement.*, contract.project_id, contract.name AS contract_name,
             contract.kind
      FROM contract_supplements AS supplement
      JOIN contracts AS contract ON contract.id = supplement.contract_id
      WHERE ${visibleCond('contract_supplements', 'supplement')}
        AND ${visibleCond('contracts', 'contract')}
        AND contract.kind <> '施工'
        AND contract.status NOT IN ('draft', '草稿')
      ORDER BY supplement.created_at DESC, supplement.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('subcontract_change_orders', 'contracts', 'suppliers')}
      SELECT change.*, contract.name AS contract_name,
             COALESCE(supplier.name, '') AS supplier_name
      FROM subcontract_change_orders AS change
      JOIN contracts AS contract
        ON contract.id = change.contract_id
       AND contract.project_id = change.project_id
      LEFT JOIN suppliers AS supplier
        ON supplier.id = change.supplier_id
       AND ${visibleCond('suppliers', 'supplier')}
      WHERE ${visibleCond('subcontract_change_orders', 'change')}
        AND ${visibleCond('contracts', 'contract')}
        AND contract.kind = '分包'
        AND contract.status NOT IN ('draft', '草稿')
      ORDER BY change.created_at DESC, change.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('expenditure_settlements', 'contracts')}
      SELECT settlement.*, contract.name AS contract_name, contract.kind
      FROM expenditure_settlements AS settlement
      JOIN contracts AS contract
        ON contract.id = settlement.contract_id
       AND contract.project_id = settlement.project_id
      WHERE ${visibleCond('expenditure_settlements', 'settlement')}
        AND ${visibleCond('contracts', 'contract')}
        AND contract.kind <> '施工'
        AND contract.status NOT IN ('draft', '草稿')
      ORDER BY settlement.created_at DESC, settlement.id
    `),
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor(
        'payment_record_application_allocations',
        'payment_records',
        'payment_applications',
        'contracts',
      )}
      SELECT application.contract_id,
             SUM(allocation.allocated_amount) AS paid_amount
      FROM payment_record_application_allocations AS allocation
      JOIN payment_records AS payment
        ON payment.id = allocation.payment_record_id
      JOIN payment_applications AS application
        ON application.id = allocation.payment_application_id
      JOIN contracts AS contract
        ON contract.id = application.contract_id
       AND contract.project_id = payment.project_id
      WHERE ${visibleCond('payment_record_application_allocations', 'allocation')}
        AND ${visibleCond('payment_records', 'payment')}
        AND ${visibleCond('payment_applications', 'application')}
        AND ${visibleCond('contracts', 'contract')}
        AND payment.confirmation_status = 'confirmed'
      GROUP BY application.contract_id
    `),
  ])

  const supplementsByContract = new Map<string, number>()
  for (const row of supplementRows) {
    if (isDraft(row.status))
      continue
    const contractId = text(row.contract_id)
    supplementsByContract.set(
      contractId,
      (supplementsByContract.get(contractId) ?? 0) + number(row.amount),
    )
  }

  const settlementsByContract = new Map<string, number>()
  for (const row of settlementRows) {
    if (!isConfirmed(row.status))
      continue
    const contractId = text(row.contract_id)
    settlementsByContract.set(
      contractId,
      (settlementsByContract.get(contractId) ?? 0) + number(row.total_amount),
    )
  }

  const paymentsByContract = new Map(
    paymentRows.map(row => [text(row.contract_id), number(row.paid_amount)]),
  )

  return {
    contracts: contractRows.map(row => ({
      id: text(row.id),
      projectId: text(row.project_id),
      contractNo: text(row.no),
      name: text(row.name),
      category: costCategoryFromContract(row),
      originalCategory: originalCategory(row),
      classificationState: text(row.classification_state) || 'classified',
      status: text(row.status),
      amount: number(row.amount),
      supplementAmount: supplementsByContract.get(text(row.id)) ?? 0,
      supplier: text(row.supplier_name),
      effectiveDate: text(row.sign_date),
      settledAmount: settlementsByContract.get(text(row.id)) ?? 0,
      paidAmount: paymentsByContract.get(text(row.id)) ?? 0,
      sourcePath: contractSourcePath(row),
    })),
    supplements: supplementRows.map(row => ({
      id: text(row.id),
      projectId: text(row.project_id),
      contractId: text(row.contract_id),
      agreementNo: text(row.no),
      name: text(row.name),
      contractName: text(row.contract_name),
      amount: number(row.amount),
      effectiveAmount: isDraft(row.status) ? 0 : number(row.amount),
      signDate: text(row.sign_date),
      status: text(row.status),
      sourcePath: `/contract/${text(row.contract_id)}`,
    })),
    changes: changeRows.map(row => ({
      id: text(row.id),
      projectId: text(row.project_id),
      contractId: text(row.contract_id),
      changeNo: text(row.no),
      changeType: text(row.change_type),
      supplier: text(row.supplier_name),
      contractName: text(row.contract_name),
      approvedAmount: number(row.approved_amount),
      effectiveApprovedAmount: isConfirmed(row.status) ? number(row.approved_amount) : 0,
      changedArea: number(row.changed_area),
      actualApprovedPrice: number(row.actual_approved_price),
      status: text(row.status),
      sourcePath: `/subcontract/change/${text(row.id)}`,
    })),
    settlements: settlementRows.map(row => ({
      id: text(row.id),
      projectId: text(row.project_id),
      contractId: text(row.contract_id),
      settlementNo: text(row.no),
      name: text(row.name),
      contractName: text(row.contract_name),
      settlementDate: text(row.settlement_date),
      settlementType: text(row.settlement_type || row.biz_type),
      amount: number(row.total_amount),
      effectiveAmount: isConfirmed(row.status) ? number(row.total_amount) : 0,
      status: text(row.status),
      sourcePath: settlementSourcePath(row),
    })),
  }
}
