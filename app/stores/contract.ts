import type {
  ContractFormAttachmentChanges,
  F2FormDraft,
  F2FormKind,
  F2SaveAction,
} from '~/lib/contract/forms'
import type { ContractKind } from '~/lib/contract/status'
import type { LookupOption } from '~/lib/kit/lookup'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { deleteF2Form, saveF2Form } from '~/lib/contract/forms'
import { db } from '~/lib/db/client'
import { select } from '~/lib/db/connection'
import {
  hiddenCtesFor,
  selectVisibleSql,
  undoOperation,
  visibleCond,
} from '~/lib/db/soft-delete'

export interface Contract {
  id: string
  no: string
  name: string
  kind: ContractKind
  /** 劳务|专业,仅 kind=分包 */
  subKind: string
  projectId: string
  customerId: string | null
  /** 施工合同(乙方=我方)为 null */
  supplierId: string | null
  /** 含税合同金额 */
  amount: number
  /** 变更后合同金额 */
  changed: number
  /** 累计结算 */
  settled: number
  /** 累计收票(施工=累计开票) */
  invoiced: number
  /** 累计支付(施工=累计收款) */
  paid: number
  content: string
  invoiceType: string
  contactName: string
  contactPhone: string
  taxRate: number | null
  signDate: string
  mainTerms: string
  paymentTerms: string
  brandQualityTerms: string
  scheduleTerms: string
  warrantyTerms: string
  specialTerms: string
  retentionRatio: number | null
  retentionAmount: number | null
  retentionDays: number | null
  invoiceName: string
  invoiceTaxNo: string
  invoiceAddressPhone: string
  invoiceBank: string
  invoiceBankAccount: string
  otherExpenseKind: string
  servicePeriod: string
  paymentCycle: string
  status: string
  note: string
  createdAt: string
  updatedAt: string
}

export interface ContractAuxRow {
  id: string
  no: string
  name: string
  projectName: string
  partyName: string
  amount: number
  date: string
  status: string
}

type ContractLookupTable = 'projects' | 'customers' | 'suppliers'

/** 金额字段归一:空串 / NaN / nullish → 0(四级金额链默认 0,与 schema DEFAULT 0 一致) */
function toMoney(v: unknown): number {
  if (v === '' || v == null)
    return 0
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

function rowToContract(row: Record<string, unknown>): Contract {
  return {
    id: row.id as string,
    no: (row.no ?? '') as string,
    name: row.name as string,
    kind: (row.kind ?? '施工') as ContractKind,
    subKind: (row.sub_kind ?? '') as string,
    projectId: (row.project_id ?? '') as string,
    customerId: (row.customer_id ?? null) as string | null,
    supplierId: (row.supplier_id ?? null) as string | null,
    amount: toMoney(row.amount),
    changed: toMoney(row.changed),
    settled: toMoney(row.settled),
    invoiced: toMoney(row.invoiced),
    paid: toMoney(row.paid),
    content: (row.content ?? '') as string,
    invoiceType: (row.invoice_type ?? '') as string,
    contactName: (row.contact_name ?? '') as string,
    contactPhone: (row.contact_phone ?? '') as string,
    taxRate: row.tax_rate == null ? null : toMoney(row.tax_rate),
    signDate: (row.sign_date ?? '') as string,
    mainTerms: (row.main_terms ?? '') as string,
    paymentTerms: (row.payment_terms ?? '') as string,
    brandQualityTerms: (row.brand_quality_terms ?? '') as string,
    scheduleTerms: (row.schedule_terms ?? '') as string,
    warrantyTerms: (row.warranty_terms ?? '') as string,
    specialTerms: (row.special_terms ?? '') as string,
    retentionRatio: row.retention_ratio == null ? null : toMoney(row.retention_ratio),
    retentionAmount: row.retention_amount == null ? null : toMoney(row.retention_amount),
    retentionDays: row.retention_days == null ? null : toMoney(row.retention_days),
    invoiceName: (row.invoice_name ?? '') as string,
    invoiceTaxNo: (row.invoice_tax_no ?? '') as string,
    invoiceAddressPhone: (row.invoice_address_phone ?? '') as string,
    invoiceBank: (row.invoice_bank ?? '') as string,
    invoiceBankAccount: (row.invoice_bank_account ?? '') as string,
    otherExpenseKind: (row.other_expense_kind ?? '') as string,
    servicePeriod: (row.service_period ?? '') as string,
    paymentCycle: (row.payment_cycle ?? '') as string,
    status: (row.status ?? '履约中') as string,
    note: (row.note ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
    updatedAt: (row.updated_at ?? '') as string,
  }
}

export const useContractStore = defineStore('contract', () => {
  const list = shallowRef<Contract[]>([])
  const auxLists = shallowRef<Record<string, ContractAuxRow[]>>({})
  const loading = shallowRef(false)

  async function load() {
    loading.value = true
    try {
      const rows = await select<Record<string, unknown>>(`
        ${hiddenCtesFor(
          'contracts',
          'contract_supplements',
          'expenditure_settlements',
          'invoices',
          'payment_applications',
          'payment_records',
          'payment_record_application_allocations',
        )}
        SELECT contract.*,
               contract.amount + COALESCE((
                 SELECT SUM(supplement.amount)
                 FROM contract_supplements AS supplement
                 WHERE supplement.contract_id = contract.id
                   AND ${visibleCond('contract_supplements', 'supplement')}
                   AND supplement.status NOT IN ('draft', '草稿')
               ), 0) AS changed,
               COALESCE((
                 SELECT SUM(settlement.total_amount)
                 FROM expenditure_settlements AS settlement
                 WHERE settlement.contract_id = contract.id
                   AND ${visibleCond('expenditure_settlements', 'settlement')}
                   AND settlement.status NOT IN ('draft', '草稿')
               ), 0) AS settled,
               COALESCE((
                 SELECT SUM(invoice.total_amount)
                 FROM invoices AS invoice
                 WHERE invoice.contract_id = contract.id
                   AND ${visibleCond('invoices', 'invoice')}
                   AND invoice.account_status = 'archived'
               ), 0) AS invoiced,
               COALESCE((
                 SELECT SUM(allocation.allocated_amount)
                 FROM payment_record_application_allocations AS allocation
                 JOIN payment_records AS payment
                   ON payment.id = allocation.payment_record_id
                 JOIN payment_applications AS application
                   ON application.id = allocation.payment_application_id
                 WHERE application.contract_id = contract.id
                   AND ${visibleCond('payment_record_application_allocations', 'allocation')}
                   AND ${visibleCond('payment_records', 'payment')}
                   AND ${visibleCond('payment_applications', 'application')}
                   AND payment.confirmation_status = 'confirmed'
               ), 0) AS paid
        FROM contracts AS contract
        WHERE ${visibleCond('contracts', 'contract')}
        ORDER BY contract.created_at DESC
      `)
      list.value = rows.map(rowToContract)
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(c => c.id === id)
  }

  /** kind 切片(三列表/项目详情子表共用):施工 | 分包 | 材采 */
  function byKind(kind: ContractKind) {
    return list.value.filter(c => c.kind === kind)
  }

  function auxByKind(kind: F2FormKind) {
    return auxLists.value[kind] ?? []
  }

  async function searchLookup(
    table: ContractLookupTable,
    keyword: string,
  ): Promise<LookupOption[]> {
    const rows = await select<{ id: string, name: string }>(
      selectVisibleSql(table, 'AND name LIKE ? ORDER BY name LIMIT 50'),
      [`%${keyword.trim()}%`],
    )
    return rows.map(row => ({ id: row.id, label: row.name }))
  }

  const searchProjects = (keyword: string) => searchLookup('projects', keyword)
  const searchCustomers = (keyword: string) => searchLookup('customers', keyword)
  const searchSuppliers = (keyword: string) => searchLookup('suppliers', keyword)

  async function searchOriginalContracts(
    kind: F2FormKind,
    keyword: string,
  ): Promise<LookupOption[]> {
    const contractKind: Partial<Record<F2FormKind, string>> = {
      construction: '施工',
      subcontract: '分包',
      material: '材采',
      other_expense: '其他支出',
    }
    const canonicalKind = contractKind[kind]
    if (!canonicalKind)
      return []
    const pattern = `%${keyword.trim()}%`
    const rows = await select<{
      id: string
      name: string
      no: string
    }>(selectVisibleSql('contracts', `
      AND kind = ?
      AND (name LIKE ? OR no LIKE ?)
      ORDER BY sign_date DESC, created_at DESC
      LIMIT 50
    `), [canonicalKind, pattern, pattern])
    return rows.map(row => ({
      id: row.id,
      label: row.name,
      hint: row.no,
    }))
  }

  async function searchSettlementContracts(
    projectId: string | null,
    keyword: string,
  ): Promise<LookupOption[]> {
    if (!projectId)
      return []
    const pattern = `%${keyword.trim()}%`
    const rows = await select<{
      id: string
      name: string
      no: string
      amount: number
    }>(selectVisibleSql('contracts', `
      AND kind = '其他支出'
      AND project_id = ?
      AND (name LIKE ? OR no LIKE ?)
      ORDER BY sign_date DESC, created_at DESC
      LIMIT 50
    `), [
      projectId,
      pattern,
      pattern,
    ])
    return rows.map(row => ({
      id: row.id,
      label: row.name,
      hint: `${row.no} · ${Number(row.amount).toFixed(2)}`,
    }))
  }

  async function loadAux(
    kind: 'other_expense' | 'company_expense' | 'other_settlement',
  ) {
    loading.value = true
    try {
      let rows: ContractAuxRow[]
      if (kind === 'other_expense') {
        rows = await select<ContractAuxRow>(`
        ${hiddenCtesFor('contracts')}
        SELECT contract.id, contract.no, contract.name,
               COALESCE(project.name, '') AS projectName,
               COALESCE(supplier.name, '') AS partyName,
               contract.amount, contract.sign_date AS date, contract.status
        FROM contracts AS contract
        LEFT JOIN projects AS project
          ON project.id = contract.project_id AND project.deleted_at IS NULL
        LEFT JOIN suppliers AS supplier
          ON supplier.id = contract.supplier_id AND supplier.deleted_at IS NULL
        WHERE ${visibleCond('contracts', 'contract')}
          AND contract.kind = '其他支出'
        ORDER BY contract.created_at DESC
        `)
      }
      else if (kind === 'company_expense') {
        const companyRows = await select<{
          id: string
          no: string
          name: string
          counterparty: string
          amount: number
          sign_date: string
          status: string
        }>(selectVisibleSql('company_expense_contracts', 'ORDER BY created_at DESC'))
        rows = companyRows.map(row => ({
          id: row.id,
          no: row.no,
          name: row.name,
          projectName: '',
          partyName: row.counterparty,
          amount: Number(row.amount),
          date: row.sign_date,
          status: row.status,
        }))
      }
      else {
        rows = await select<ContractAuxRow>(`
        ${hiddenCtesFor('expenditure_settlements')}
        SELECT settlement.id, settlement.no, settlement.name,
               COALESCE(project.name, '') AS projectName,
               COALESCE(contract.name, '') AS partyName,
               settlement.total_amount AS amount,
               settlement.settlement_date AS date, settlement.status
        FROM expenditure_settlements AS settlement
        LEFT JOIN projects AS project
          ON project.id = settlement.project_id AND project.deleted_at IS NULL
        LEFT JOIN contracts AS contract
          ON contract.id = settlement.contract_id AND contract.deleted_at IS NULL
        WHERE ${visibleCond('expenditure_settlements', 'settlement')}
          AND settlement.biz_type IN ('机械', '其他')
        ORDER BY settlement.created_at DESC
        `)
      }
      auxLists.value = { ...auxLists.value, [kind]: rows }
    }
    finally {
      loading.value = false
    }
  }

  async function saveForm(
    kind: F2FormKind,
    draft: F2FormDraft,
    action: F2SaveAction,
    attachments?: ContractFormAttachmentChanges,
  ) {
    const result = await saveF2Form(kind, draft, action, attachments)
    await load()
    return result
  }

  async function removeForm(kind: F2FormKind, id: string) {
    const logId = await deleteF2Form(kind, id)
    if (kind === 'company_expense' || kind === 'other_settlement' || kind === 'other_expense')
      await loadAux(kind)
    if (kind !== 'company_expense' && kind !== 'other_settlement')
      await load()
    return logId
  }

  async function undoForm(kind: F2FormKind, logId: string) {
    const restored = await undoOperation(db, logId)
    if (kind === 'company_expense' || kind === 'other_settlement' || kind === 'other_expense')
      await loadAux(kind)
    if (kind !== 'company_expense' && kind !== 'other_settlement')
      await load()
    return restored
  }

  return {
    list: readonly(list),
    auxLists: readonly(auxLists),
    loading: readonly(loading),
    load,
    loadAux,
    byId,
    byKind,
    auxByKind,
    searchProjects,
    searchCustomers,
    searchSuppliers,
    searchOriginalContracts,
    searchSettlementContracts,
    saveForm,
    removeForm,
    undoForm,
  }
})
