import type { MigrationDb } from '~/lib/db/migrations'
import { hiddenCtes, selectVisibleSql, visibleCond } from '~/lib/db/soft-delete'
import { isDraftStatus, nonDraftStatusSql } from '~/lib/project/formal-facts'
import { parseJsonColumn } from '~/lib/util/json'
import { subtractKnownMoney, sumKnownMoney } from '~/lib/util/number'

export interface CustomerDetailMaster {
  id: string
  name: string
  aliases: readonly string[]
  taxNo: string
  legalRep: string
  registeredAddress: string
  invoiceName: string
  bank: string
  bankAccount: string
  contact: string
  contactPhone: string
  status: string
  note: string
  updatedAt: string
}

export interface CustomerProjectSummary {
  id: string
  name: string
  code: string
  relationRole: '主客户' | '次客户'
  status: string
  startDate: string
  plannedEnd: string
  manager: string
  contractCount: number
  effectiveContractAmount: number | null
  receiptCount: number
  effectiveReceiptAmount: number | null
}

export interface CustomerContractSummary {
  id: string
  no: string
  name: string
  projectId: string | null
  projectName: string
  amount: number | null
  changed: number | null
  effectiveAmount: number | null
  receiptAmount: number | null
  outstandingAmount: number | null
  signDate: string
  status: string
  isDraft: boolean
}

export interface CustomerReceiptSummary {
  id: string
  no: string
  receiptDate: string
  projectId: string | null
  projectName: string
  contractId: string | null
  contractName: string
  payerAccount: string
  amount: number | null
  effectiveAmount: number | null
  paymentMethod: string
  status: string
  isDraft: boolean
}

export interface CustomerDetailSummary {
  projectCount: number
  contractCount: number
  effectiveContractAmount: number | null
  receiptCount: number
  effectiveReceiptAmount: number | null
  outstandingAmount: number | null
  draftReceiptCount: number
}

export interface CustomerDetailSnapshot {
  customer: CustomerDetailMaster
  projects: readonly CustomerProjectSummary[]
  contracts: readonly CustomerContractSummary[]
  receipts: readonly CustomerReceiptSummary[]
  summary: CustomerDetailSummary
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

function nullableText(value: unknown): string | null {
  const result = text(value)
  return result || null
}

function numberValue(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim()))
    return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function toCustomer(row: Record<string, unknown>): CustomerDetailMaster {
  return {
    id: text(row.id),
    name: text(row.name),
    aliases: parseJsonColumn<string[]>(row.aliases, []),
    taxNo: text(row.tax_no),
    legalRep: text(row.legal_rep),
    registeredAddress: text(row.registered_address),
    invoiceName: text(row.invoice_name),
    bank: text(row.bank),
    bankAccount: text(row.bank_account),
    contact: text(row.contact),
    contactPhone: text(row.contact_phone),
    status: text(row.status),
    note: text(row.note),
    updatedAt: text(row.updated_at),
  }
}

export async function loadCustomerDetail(
  db: MigrationDb,
  customerId: string,
): Promise<CustomerDetailSnapshot | null> {
  const [customerRow] = await db.select<Record<string, unknown>>(
    selectVisibleSql('customers', 'AND id = ? LIMIT 1'),
    [customerId],
  )
  if (!customerRow)
    return null

  const [projectRows, contractRows, receiptRows, supplementRows] = await Promise.all([
    db.select<Record<string, unknown>>(
      `${hiddenCtes('projects')}
       SELECT project.*
       FROM projects AS project
       WHERE ${visibleCond('projects', 'project')}
         AND (project.customer_id = ? OR project.secondary_customer_id = ?)
       ORDER BY NULLIF(project.start_date, '') DESC, project.name`,
      [customerId, customerId],
    ),
    db.select<Record<string, unknown>>(
      `${hiddenCtes('contracts')}
       SELECT contract.*, project.name AS project_name
       FROM contracts AS contract
       LEFT JOIN projects AS project ON project.id = contract.project_id
       WHERE ${visibleCond('contracts', 'contract')}
         AND (
           contract.customer_id = ?
           OR (contract.customer_id IS NULL AND project.customer_id = ?)
         )
         AND contract.kind = '施工'
       ORDER BY NULLIF(contract.sign_date, '') DESC, contract.name`,
      [customerId, customerId],
    ),
    db.select<Record<string, unknown>>(
      `${hiddenCtes('receipt_registrations')}
       SELECT
         receipt.*,
         project.name AS project_name,
         contract.name AS contract_name
       FROM receipt_registrations AS receipt
       LEFT JOIN projects AS project ON project.id = receipt.project_id
       LEFT JOIN contracts AS contract ON contract.id = receipt.contract_id
       WHERE ${visibleCond('receipt_registrations', 'receipt')}
         AND receipt.customer_id = ?
       ORDER BY NULLIF(receipt.receipt_date, '') DESC, receipt.created_at DESC`,
      [customerId],
    ),
    db.select<{ contract_id: string, amount: unknown }>(
      `${hiddenCtes('contract_supplements')}
       SELECT
         supplement.contract_id,
         supplement.amount
       FROM contract_supplements AS supplement
       JOIN contracts AS contract ON contract.id = supplement.contract_id
       LEFT JOIN projects AS project ON project.id = contract.project_id
       WHERE ${visibleCond('contract_supplements', 'supplement')}
         AND contract.kind = '施工'
         AND ${nonDraftStatusSql('contract.status')}
         AND ${nonDraftStatusSql('supplement.status')}
         AND (
           contract.customer_id = ?
           OR (contract.customer_id IS NULL AND project.customer_id = ?)
         )
       ORDER BY supplement.contract_id, supplement.id`,
      [customerId, customerId],
    ),
  ])

  const receipts: CustomerReceiptSummary[] = receiptRows.map((row) => {
    const status = text(row.status)
    const amount = numberValue(row.amount)
    return {
      id: text(row.id),
      no: text(row.no),
      receiptDate: text(row.receipt_date),
      projectId: nullableText(row.project_id),
      projectName: text(row.project_name),
      contractId: nullableText(row.contract_id),
      contractName: text(row.contract_name),
      payerAccount: text(row.payer_account),
      amount,
      effectiveAmount: isDraftStatus(status) ? 0 : amount,
      paymentMethod: text(row.payment_method),
      status,
      isDraft: isDraftStatus(status),
    }
  })

  const receiptsByContract = new Map<string, Array<number | null>>()
  const supplementsByContract = new Map<string, Array<number | null>>()
  for (const row of supplementRows)
    supplementsByContract.set(row.contract_id, [...(supplementsByContract.get(row.contract_id) ?? []), numberValue(row.amount)])
  const receiptFactsByProject = new Map<string, { count: number, amounts: Array<number | null> }>()
  for (const receipt of receipts) {
    if (receipt.contractId) {
      receiptsByContract.set(
        receipt.contractId,
        [...(receiptsByContract.get(receipt.contractId) ?? []), receipt.effectiveAmount],
      )
    }
    if (receipt.projectId) {
      const fact = receiptFactsByProject.get(receipt.projectId) ?? { count: 0, amounts: [] }
      fact.count += 1
      fact.amounts.push(receipt.effectiveAmount)
      receiptFactsByProject.set(receipt.projectId, fact)
    }
  }

  const contracts: CustomerContractSummary[] = contractRows.map((row) => {
    const status = text(row.status)
    const amount = numberValue(row.amount)
    const changed = numberValue(row.changed)
    const formalAmount = isDraftStatus(status) ? 0 : sumKnownMoney([amount, ...(supplementsByContract.get(text(row.id)) ?? [])])
    const receiptAmount = sumKnownMoney(receiptsByContract.get(text(row.id)) ?? [])
    return {
      id: text(row.id),
      no: text(row.no),
      name: text(row.name),
      projectId: nullableText(row.project_id),
      projectName: text(row.project_name),
      amount,
      changed,
      effectiveAmount: formalAmount,
      receiptAmount,
      outstandingAmount: subtractKnownMoney(formalAmount, receiptAmount),
      signDate: text(row.sign_date),
      status,
      isDraft: isDraftStatus(status),
    }
  })

  const contractFactsByProject = new Map<string, { count: number, amounts: Array<number | null> }>()
  for (const contract of contracts) {
    if (!contract.projectId)
      continue
    const fact = contractFactsByProject.get(contract.projectId) ?? { count: 0, amounts: [] }
    fact.count += 1
    fact.amounts.push(contract.effectiveAmount)
    contractFactsByProject.set(contract.projectId, fact)
  }

  const projects: CustomerProjectSummary[] = projectRows.map((row) => {
    const id = text(row.id)
    const contractFact = contractFactsByProject.get(id) ?? { count: 0, amounts: [] }
    const receiptFact = receiptFactsByProject.get(id) ?? { count: 0, amounts: [] }
    return {
      id,
      name: text(row.name),
      code: text(row.code),
      relationRole: row.customer_id === customerId ? '主客户' : '次客户',
      status: text(row.status),
      startDate: text(row.start_date),
      plannedEnd: text(row.planned_end),
      manager: text(row.manager),
      contractCount: contractFact.count,
      effectiveContractAmount: sumKnownMoney(contractFact.amounts),
      receiptCount: receiptFact.count,
      effectiveReceiptAmount: sumKnownMoney(receiptFact.amounts),
    }
  })

  const effectiveContractAmount = sumKnownMoney(contracts.map(row => row.effectiveAmount))
  const effectiveReceiptAmount = sumKnownMoney(receipts.map(row => row.effectiveAmount))

  return {
    customer: toCustomer(customerRow),
    projects,
    contracts,
    receipts,
    summary: {
      projectCount: projects.length,
      contractCount: contracts.length,
      effectiveContractAmount,
      receiptCount: receipts.length,
      effectiveReceiptAmount,
      outstandingAmount: subtractKnownMoney(effectiveContractAmount, effectiveReceiptAmount),
      draftReceiptCount: receipts.filter(row => row.isDraft).length,
    },
  }
}
