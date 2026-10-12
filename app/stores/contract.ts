import type {
  ContractAuxListKind,
  ContractAuxRow,
} from '~/lib/contract/aux-list'
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
import { deleteF2Form, saveF2Form, undoF2Form } from '~/lib/contract/forms'
import { select } from '~/lib/db/connection'
import {
  hiddenCtesFor,
  selectVisibleSql,
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
  projectName: string
  customerId: string | null
  customerName: string
  /** 施工合同(乙方=我方)为 null */
  supplierId: string | null
  supplierName: string
  /** 含税合同金额 */
  amount: number | null
  /** 变更后合同金额 */
  changed: number | null
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
    projectName: (row.project_name ?? '') as string,
    customerId: (row.customer_id ?? null) as string | null,
    customerName: (row.customer_name ?? '') as string,
    supplierId: (row.supplier_id ?? null) as string | null,
    supplierName: (row.supplier_name ?? '') as string,
    amount: row.amount == null ? null : toMoney(row.amount),
    changed: row.changed == null ? null : toMoney(row.changed),
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
  const auxLoading = shallowRef<Partial<Record<ContractAuxListKind, boolean>>>({})
  const auxErrors = shallowRef<Partial<Record<ContractAuxListKind, string>>>({})
  const auxLoadSequence: Partial<Record<ContractAuxListKind, number>> = {}
  const loading = shallowRef(false)
  const loadError = shallowRef('')

  async function load() {
    loading.value = true
    loadError.value = ''
    try {
      const rows = await select<Record<string, unknown>>(`
        ${hiddenCtesFor(
          'contracts',
          'contract_supplements',
          'expenditure_settlements',
          'monthly_statements',
          'invoices',
          'invoice_applications',
          'receipt_registrations',
          'owner_change_orders',
          'payment_applications',
          'payment_records',
          'payment_record_application_allocations',
        )}
        SELECT contract.*,
               project.name AS project_name,
               COALESCE(customer.name, '') AS customer_name,
               COALESCE(supplier.name, '') AS supplier_name,
               CASE WHEN contract.amount IS NULL OR EXISTS (
                 SELECT 1 FROM contract_supplements supplement
                 WHERE supplement.contract_id=contract.id AND ${visibleCond('contract_supplements', 'supplement')}
                 AND supplement.status NOT IN ('draft','草稿') AND supplement.amount IS NULL
               ) THEN NULL ELSE contract.amount
               + COALESCE((
                   SELECT SUM(supplement.amount)
                   FROM contract_supplements AS supplement
                   WHERE supplement.contract_id = contract.id
                     AND ${visibleCond('contract_supplements', 'supplement')}
                     AND supplement.status NOT IN ('draft', '草稿')
                 ), 0)
               + CASE WHEN contract.kind = '施工'
                   THEN COALESCE((
                     SELECT SUM(change_order.tax_inc_amount)
                     FROM owner_change_orders AS change_order
                     WHERE change_order.contract_id = contract.id
                       AND ${visibleCond('owner_change_orders', 'change_order')}
                       AND (
                         change_order.source_locked = 1
                         OR change_order.status = 'approved'
                         OR trim(change_order.approval_date) <> ''
                       )
                   ), 0)
                   ELSE 0
                 END END AS changed,
               CASE WHEN contract.kind = '施工'
                 THEN COALESCE((
                   SELECT SUM(COALESCE(
                     statement.audited_amount,
                     statement.reported_amount,
                     statement.total_amount
                   ))
                   FROM monthly_statements AS statement
                   WHERE statement.contract_id = contract.id
                     AND ${visibleCond('monthly_statements', 'statement')}
                     AND statement.status <> 'draft'
                 ), 0)
                 ELSE COALESCE((
                   SELECT SUM(settlement.total_amount)
                   FROM expenditure_settlements AS settlement
                   WHERE settlement.contract_id = contract.id
                     AND ${visibleCond('expenditure_settlements', 'settlement')}
                     AND settlement.status NOT IN ('draft', '草稿')
                 ), 0)
               END AS settled,
               CASE WHEN contract.kind = '施工'
                 THEN COALESCE((
                   SELECT SUM(application.amount)
                   FROM invoice_applications AS application
                   WHERE application.contract_id = contract.id
                     AND ${visibleCond('invoice_applications', 'application')}
                     AND application.status NOT IN ('draft', '草稿')
                 ), 0)
                 ELSE COALESCE((
                   SELECT SUM(invoice.total_amount)
                   FROM invoices AS invoice
                   WHERE invoice.contract_id = contract.id
                     AND ${visibleCond('invoices', 'invoice')}
                     AND invoice.account_status = 'archived'
                 ), 0)
               END AS invoiced,
               CASE WHEN contract.kind = '施工'
                 THEN COALESCE((
                   SELECT SUM(receipt.amount)
                   FROM receipt_registrations AS receipt
                   WHERE receipt.contract_id = contract.id
                     AND ${visibleCond('receipt_registrations', 'receipt')}
                     AND receipt.status NOT IN ('draft', '草稿')
                 ), 0)
                 ELSE COALESCE((
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
                 ), 0)
               END AS paid
        FROM contracts AS contract
        JOIN projects AS project ON project.id = contract.project_id
        LEFT JOIN customers AS customer ON customer.id = contract.customer_id
        LEFT JOIN suppliers AS supplier ON supplier.id = contract.supplier_id
        WHERE ${visibleCond('contracts', 'contract')}
        ORDER BY contract.created_at DESC
      `)
      list.value = rows.map(rowToContract)
    }
    catch (cause) {
      loadError.value = cause instanceof Error ? cause.message : '合同列表载入失败'
      throw cause
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(c => c.id === id)
  }

  function auxByKind(kind: ContractAuxListKind) {
    return auxLists.value[kind] ?? []
  }

  function auxLoadingFor(kind: ContractAuxListKind) {
    return auxLoading.value[kind] ?? false
  }

  function auxError(kind: ContractAuxListKind) {
    return auxErrors.value[kind] ?? ''
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
    kind: 'other_settlement' | 'material_settlement',
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
      amount: number | null
    }>(selectVisibleSql('contracts', `
      AND kind = ?
      AND project_id = ?
      AND status NOT IN ('draft', '草稿')
      AND (name LIKE ? OR no LIKE ?)
      ORDER BY sign_date DESC, created_at DESC
      LIMIT 50
    `), [
      kind === 'material_settlement' ? '材采' : '其他支出',
      projectId,
      pattern,
      pattern,
    ])
    return rows.map(row => ({
      id: row.id,
      label: row.name,
      hint: `${row.no} · ${row.amount === null ? '金额未知' : Number(row.amount).toFixed(2)}`,
    }))
  }

  async function loadAux(
    kind: ContractAuxListKind,
  ) {
    const sequence = (auxLoadSequence[kind] ?? 0) + 1
    auxLoadSequence[kind] = sequence
    auxLoading.value = { ...auxLoading.value, [kind]: true }
    auxErrors.value = { ...auxErrors.value, [kind]: '' }
    try {
      let rows: ContractAuxRow[]
      if ((kind === 'other_expense' || kind === 'company_expense') && typeof window !== 'undefined')
        throw new Error('浏览器辅助合同只从中央 Repository 读取')
      if (kind === 'other_expense') {
        rows = await select<ContractAuxRow>(`
        ${hiddenCtesFor('contracts')}
        SELECT contract.id, contract.no, contract.name,
               COALESCE(contract.project_id, '') AS projectId,
               COALESCE(project.name, '') AS projectName,
               COALESCE(contract.supplier_id, '') AS supplierId,
               COALESCE(supplier.name, '') AS supplierName,
               '' AS contractId, '' AS contractName,
               COALESCE(contract.other_expense_kind, '') AS category,
               COALESCE(supplier.name, '') AS counterparty,
               COALESCE(contract.service_period, '') AS period,
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
          category: string
          counterparty: string
          service_period: string
          amount: number | null
          sign_date: string
          status: string
        }>(selectVisibleSql('company_expense_contracts', 'ORDER BY created_at DESC'))
        rows = companyRows.map(row => ({
          id: row.id,
          no: row.no,
          name: row.name,
          projectId: '',
          projectName: '',
          supplierId: '',
          supplierName: '',
          contractId: '',
          contractName: '',
          category: row.category,
          counterparty: row.counterparty,
          period: row.service_period,
          amount: row.amount === null ? null : Number(row.amount),
          date: row.sign_date,
          status: row.status,
        }))
      }
      else {
        rows = await select<ContractAuxRow>(`
        ${hiddenCtesFor('expenditure_settlements')}
        SELECT settlement.id, settlement.no, settlement.name,
               COALESCE(settlement.project_id, '') AS projectId,
               COALESCE(project.name, '') AS projectName,
               COALESCE(settlement.supplier_id, '') AS supplierId,
               COALESCE(supplier.name, '') AS supplierName,
               COALESCE(settlement.contract_id, '') AS contractId,
               COALESCE(contract.name, '') AS contractName,
               COALESCE(settlement.biz_type, '') AS category,
               '' AS counterparty,
               COALESCE(settlement.settlement_period, '') AS period,
               settlement.total_amount AS amount,
               settlement.settlement_date AS date, settlement.status
        FROM expenditure_settlements AS settlement
        LEFT JOIN projects AS project
          ON project.id = settlement.project_id AND project.deleted_at IS NULL
        LEFT JOIN contracts AS contract
          ON contract.id = settlement.contract_id AND contract.deleted_at IS NULL
        LEFT JOIN suppliers AS supplier
          ON supplier.id = settlement.supplier_id AND supplier.deleted_at IS NULL
        WHERE ${visibleCond('expenditure_settlements', 'settlement')}
          AND settlement.biz_type ${kind === 'material_settlement'
            ? `IN ('材料', '材采')`
            : `IN ('机械', '其他')`}
        ORDER BY settlement.created_at DESC
        `)
      }
      if (auxLoadSequence[kind] === sequence)
        auxLists.value = { ...auxLists.value, [kind]: rows }
    }
    catch (cause) {
      if (auxLoadSequence[kind] === sequence) {
        auxErrors.value = {
          ...auxErrors.value,
          [kind]: cause instanceof Error ? cause.message : '列表载入失败',
        }
      }
      throw cause
    }
    finally {
      if (auxLoadSequence[kind] === sequence)
        auxLoading.value = { ...auxLoading.value, [kind]: false }
    }
  }

  async function saveForm(
    kind: F2FormKind,
    draft: F2FormDraft,
    action: F2SaveAction,
    attachments?: ContractFormAttachmentChanges,
  ) {
    const result = await saveF2Form(kind, draft, action, attachments)
    await refreshAfterMutation(kind)
    return result
  }

  function isAuxKind(kind: F2FormKind): kind is ContractAuxListKind {
    return kind === 'company_expense'
      || kind === 'other_settlement'
      || kind === 'material_settlement'
      || kind === 'other_expense'
  }

  async function refreshAfterMutation(kind: F2FormKind) {
    const refreshes: Promise<unknown>[] = []
    if (isAuxKind(kind))
      refreshes.push(loadAux(kind))
    if (kind !== 'company_expense' && kind !== 'other_settlement' && kind !== 'material_settlement')
      refreshes.push(load())
    await Promise.all(refreshes.map(refresh => refresh.catch(() => undefined)))
  }

  async function removeForm(kind: F2FormKind, id: string) {
    const logId = await deleteF2Form(kind, id)
    await refreshAfterMutation(kind)
    return logId
  }

  async function undoForm(kind: F2FormKind, logId: string) {
    const restored = await undoF2Form(kind, logId)
    await refreshAfterMutation(kind)
    return restored
  }

  return {
    list: readonly(list),
    auxLists: readonly(auxLists),
    auxLoading: readonly(auxLoading),
    auxErrors: readonly(auxErrors),
    loading: readonly(loading),
    loadError: readonly(loadError),
    load,
    loadAux,
    byId,
    auxByKind,
    auxLoadingFor,
    auxError,
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
