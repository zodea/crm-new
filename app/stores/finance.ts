import type { CentralFinanceKind, FinanceContext } from '~/lib/finance/central-contract'
import type { FinanceFormSession } from '~/lib/finance/command-session'
import type {
  F3FormDraft,
  F3FormKind,
  F3SaveAction,
  FinanceFormRecordMap,
} from '~/lib/finance/forms'
import type { FileRefChanges } from '~/lib/forms/file-refs'
import type { LookupOption } from '~/lib/kit/lookup'
import type { DataOriginDTO } from '~/types/read-model'
import { defineStore } from 'pinia'
import { readonly, shallowRef, watch } from 'vue'
import { isConfirmedExpenditureSettlement } from '~/lib/contract/effective-status'
import { select, withTransaction } from '~/lib/db/connection'
import {
  hiddenCtesFor,
  selectVisibleSql,
  visibleCond,
} from '~/lib/db/soft-delete'
import { financeFailure } from '~/lib/finance/central-contract'
import { createFinanceCommandActions } from '~/lib/finance/command-session'
import { expenseContractMatchesPaymentType } from '~/lib/finance/domain'
import {
  listFinanceFormAttachments,
  loadFinanceForm,
  saveFinanceForm,
  unconfirmPaymentRecord,
} from '~/lib/finance/forms'
import { captureFinanceInput } from '~/lib/finance/input-snapshot'
import { loadPaymentApplicationDetail as nativePaymentApplicationDetail } from '~/lib/finance/payment-detail'
import { paymentApplicationDetailModel } from '~/lib/finance/payment-detail-repository'
import { verifiedFinanceNumber, verifiedFinanceSum } from '~/lib/finance/persistent-rows'
import { loadFileRefContent } from '~/lib/forms/file-refs'
import { readNativeOtherSettlementReference } from '~/lib/other-settlement/storage'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { toErrorMessage } from '~/lib/util/error'
import { useDataVisibilityStore } from '~/stores/data-visibility'

type FinanceRecord = FinanceFormRecordMap[F3FormKind]

export interface FinanceListRow {
  id: string
  no: string
  name: string
  projectName: string
  partyName: string
  amount: number
  date: string
  status: string
  customerId: string | null
  dataOrigin: DataOriginDTO | null
}

type FinanceLookupTable = 'projects' | 'customers' | 'suppliers' | 'workers'

function mapListRows(source: Array<Record<string, unknown>>): FinanceListRow[] {
  return source.map(row => ({
    id: String(row.id),
    no: String(row.no ?? ''),
    name: String(row.display_name ?? ''),
    projectName: String(row.project_name ?? ''),
    partyName: String(row.party_name ?? ''),
    amount: verifiedFinanceNumber(row.display_amount),
    date: String(row.display_date ?? ''),
    status: String(row.display_status ?? ''),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    dataOrigin: row.data_origin === 'real' || row.data_origin === 'demo' ? row.data_origin : null,
  }))
}

export const useFinanceStore = defineStore('finance', () => {
  const records = shallowRef<Partial<Record<F3FormKind, FinanceRecord[]>>>({})
  const listRows = shallowRef<Partial<Record<F3FormKind, FinanceListRow[]>>>({})
  const loading = shallowRef(false)
  const visibility = useDataVisibilityStore()
  let sourceGeneration = 0
  let sourceIdentity = ''
  bindReadAuthority(() => {
    ++sourceGeneration
    sourceIdentity = ''
    records.value = {}
    listRows.value = {}
  })
  const listGenerations = new Map<F3FormKind, number>()
  watch(() => visibility.includeDemo, () => {
    ++sourceGeneration
    sourceIdentity = ''
    records.value = {}
    listRows.value = {}
  })
  const centralCommands = new Map<CentralFinanceKind, ReturnType<typeof createFinanceCommandActions>>()
  const repository = () => {
    if (useDataVisibilityStore().includeDemo)
      financeFailure('forbidden', '当前为测试数据来源，不能使用正式财务记录或原提交；请恢复原来源后核对。')
    return useNuxtApp().$repositories.finance
  }
  const isCentral = (kind: F3FormKind): boolean => kind !== 'receipt' && 'window' in globalThis && !isDesktopRuntime()
  function centralKind<K extends F3FormKind>(kind: K): Exclude<K, 'receipt'>
  function centralKind(kind: F3FormKind): CentralFinanceKind {
    if (kind === 'receipt')
      financeFailure('unavailable', '收款使用既有收款业务来源。')
    return kind
  }
  const identity = (context: FinanceContext) => JSON.stringify([context.workspaceId, context.actorId, context.dataOrigin, [...context.capabilities].sort()])
  async function centralRead<T extends FinanceContext>(kind: F3FormKind, read: () => Promise<T>): Promise<T> {
    try {
      const generation = sourceGeneration
      const before = await repository().context(centralKind(kind))
      const value = await read()
      const current = await repository().context(centralKind(kind))
      if (generation !== sourceGeneration || identity(before) !== identity(value) || identity(value) !== identity(current) || value.sourceVersion !== current.sourceVersion)
        financeFailure('unavailable', '财务读取期间身份、权限或来源已变化；原输入继续保留，请重新核实来源。')
      const next = identity(current)
      if (sourceIdentity && sourceIdentity !== next) {
        records.value = {}
        listRows.value = {}
      }
      sourceIdentity = next
      return value
    }
    catch (cause) {
      records.value = {}
      listRows.value = {}
      throw cause
    }
  }
  function commands(input: F3FormKind) {
    const kind = centralKind(input)
    let owner = centralCommands.get(kind)
    if (!owner) {
      owner = createFinanceCommandActions(kind, repository)
      centralCommands.set(kind, owner)
    }
    return owner
  }
  function createFormSession(kind: F3FormKind) {
    return commands(kind).createSession()
  }
  async function paymentApplicationDetail(id: string) {
    if (!isCentral('payment_application'))
      return nativePaymentApplicationDetail(id)
    return paymentApplicationDetailModel(await centralRead('payment_application', () => repository().paymentDetail(id)))
  }
  async function paymentManagementDetails() {
    const read = await centralRead('payment_application', async () => {
      const list = await repository().list('payment_application')
      const items = []
      for (const row of list.items.filter(row => ['approved', '已审批', '已批复'].includes(row.status))) {
        const detail = await repository().paymentDetail(row.id)
        if (identity(detail) !== identity(list) || detail.sourceVersion !== list.sourceVersion)
          financeFailure('unavailable', '付款管理读取期间财务事实已变化，请重新读取完整清单。')
        if (detail.detail.paymentSourceState !== 'readable')
          financeFailure('forbidden', '当前身份无已确认实际支付读取权限，付款管理不能将已付显示为零。')
        items.push(paymentApplicationDetailModel(detail))
      }
      return { ...list, items }
    })
    return read.items
  }
  function invalidateForm(kind: F3FormKind, session: FinanceFormSession) {
    commands(kind).invalidate(session)
  }
  async function hydrateForm(kind: F3FormKind, id: string | null, session: FinanceFormSession) {
    return commands(kind).hydrate(session, id)
  }
  async function recoverForm(kind: F3FormKind, session: FinanceFormSession) {
    return commands(kind).recover(session)
  }
  async function revalidateForm(kind: F3FormKind, session: FinanceFormSession) {
    return commands(kind).revalidate(session)
  }
  async function formAttachments(kind: F3FormKind, id: string, includeDeleted = false) {
    if (!isCentral(kind))
      return listFinanceFormAttachments(kind, id, includeDeleted)
    const result = await centralRead(kind, () => repository().form(centralKind(kind), id))
    return result.attachments.filter(file => includeDeleted || !file.deletedAt)
  }
  async function originalContent(kind: F3FormKind, file: Parameters<typeof loadFileRefContent>[0]) {
    if (!isCentral(kind))
      return loadFileRefContent(file)
    return repository().original(centralKind(kind), file.ownerId, file.id)
  }

  function byId<K extends F3FormKind>(
    kind: K,
    id: string,
  ): FinanceFormRecordMap[K] | undefined {
    return records.value[kind]?.find(record => record.id === id) as
      | FinanceFormRecordMap[K]
      | undefined
  }

  async function loadOne<K extends F3FormKind>(
    kind: K,
    id: string,
  ): Promise<FinanceFormRecordMap[K] | null> {
    loading.value = true
    try {
      const record = isCentral(kind) ? (await centralRead(kind, () => repository().form(centralKind(kind), id))).draft : await loadFinanceForm(kind, id)
      if (!record)
        return null
      const current = records.value[kind] ?? []
      records.value = {
        ...records.value,
        [kind]: [
          record,
          ...current.filter(item => item.id !== id),
        ],
      }
      return record
    }
    finally {
      loading.value = false
    }
  }

  async function saveForm<K extends F3FormKind>(
    kind: K,
    draft: F3FormDraft,
    action: F3SaveAction,
    attachments: FileRefChanges = {},
    session?: FinanceFormSession,
  ) {
    loading.value = true
    try {
      if (isCentral(kind)) {
        if (!session)
          financeFailure('unavailable', '财务正式编辑会话尚未建立，请保留输入并重新核实来源。')
        try {
          const saved = await commands(kind).saveForm(session, captureFinanceInput(draft), action, captureFinanceInput(attachments))
          return { ...saved, readbackProblem: null }
        }
        catch (cause) {
          const applied = session.pending?.result
          if (applied)
            return { ...applied, logId: null, readbackConfirmed: false as const, readbackProblem: toErrorMessage(cause) }
          throw cause
        }
      }
      const result = await saveFinanceForm(kind, captureFinanceInput(draft), action, captureFinanceInput(attachments))
      try {
        const record = await loadOne(kind, result.id)
        if (!record || record.id !== result.id)
          throw new Error('已保存的同一财务记录尚未可靠读取')
        if (kind === 'receipt' && listRows.value.receipt)
          await loadList('receipt')
        return { ...result, readbackConfirmed: true as const, readbackProblem: null }
      }
      catch (cause) {
        return { ...result, readbackConfirmed: false as const, readbackProblem: toErrorMessage(cause) }
      }
    }
    finally {
      loading.value = false
    }
  }

  async function unconfirmPayment(id: string, session?: FinanceFormSession) {
    loading.value = true
    try {
      if (isCentral('payment_record')) {
        if (!session)
          financeFailure('unavailable', '实际支付正式编辑会话尚未建立。')
        try {
          const saved = await commands('payment_record').saveForm(session, { id }, 'unconfirm', {})
          return { ...saved, logId: null, readbackProblem: null }
        }
        catch (cause) {
          if (session.pending?.result)
            return { ...session.pending.result, logId: null, readbackConfirmed: false as const, readbackProblem: toErrorMessage(cause) }
          throw cause
        }
      }
      await unconfirmPaymentRecord(id)
      try {
        const record = await loadOne('payment_record', id)
        if (!record || record.id !== id)
          throw new Error('撤回确认已完成，同一支付记录尚未可靠读取')
        return { id, logId: null, attachmentIds: [] as string[], readbackConfirmed: true as const, readbackProblem: null }
      }
      catch (cause) {
        return { id, logId: null, attachmentIds: [] as string[], readbackConfirmed: false as const, readbackProblem: toErrorMessage(cause) }
      }
    }
    finally {
      loading.value = false
    }
  }

  async function loadList(kind: F3FormKind) {
    const generation = (listGenerations.get(kind) ?? 0) + 1
    const currentSourceGeneration = sourceGeneration
    listGenerations.set(kind, generation)
    loading.value = true
    listRows.value = { ...listRows.value, [kind]: undefined }
    try {
      if (isCentral(kind)) {
        const result = await centralRead(kind, () => repository().list(centralKind(kind)))
        if (listGenerations.get(kind) !== generation)
          financeFailure('unavailable', '已有新的财务列表读取，旧结果不能覆盖当前范围。')
        const rows = result.items.map(row => ({ ...row, amount: Number(row.amount) }))
        listRows.value = { ...listRows.value, [kind]: rows }
        return rows
      }
      const result = await withTransaction(async ({ select }) => {
        let result: Array<Record<string, unknown>>
        switch (kind) {
          case 'receipt':
            result = await select(`
            ${hiddenCtesFor('receipt_registrations')}
            SELECT receipt.id, receipt.no, receipt.customer_id,
                   COALESCE(customer.name, '待补充甲方客户') AS display_name,
                   COALESCE(project.name, '') AS project_name,
                   COALESCE(contract.name, '') AS party_name,
                   receipt.amount AS display_amount,
                   receipt.receipt_date AS display_date,
                   receipt.status AS display_status
            FROM receipt_registrations AS receipt
            LEFT JOIN projects AS project ON project.id = receipt.project_id
            LEFT JOIN customers AS customer ON customer.id = receipt.customer_id
            LEFT JOIN contracts AS contract ON contract.id = receipt.contract_id
            WHERE ${visibleCond('receipt_registrations', 'receipt')}
            ORDER BY receipt.created_at DESC
          `)
            break
          case 'invoice_application':
            result = await select(`
            ${hiddenCtesFor('invoice_applications')}
            SELECT application.id, application.no,
                   application.name AS display_name,
                   COALESCE(project.name, '') AS project_name,
                   application.buyer_name_snapshot AS party_name,
                   application.amount AS display_base_amount, application.tax_amount AS display_tax_amount,
                   application.application_date AS display_date,
                   application.status AS display_status
            FROM invoice_applications AS application
            LEFT JOIN projects AS project ON project.id = application.project_id
            WHERE ${visibleCond('invoice_applications', 'application')}
            ORDER BY application.created_at DESC
          `)
            break
          case 'current':
            result = await select(`
            ${hiddenCtesFor('current_transactions')}
            SELECT current_row.id, current_row.no,
                   COALESCE(current_row.counterparty_name_snapshot, current_row.counterparty) AS display_name,
                   COALESCE(project.name, '') AS project_name,
                   CASE current_row.direction WHEN 'receipt' THEN '收款' ELSE '付款' END AS party_name,
                   current_row.amount AS display_amount,
                   current_row.transaction_date AS display_date,
                   current_row.status AS display_status
            FROM current_transactions AS current_row
            LEFT JOIN projects AS project ON project.id = current_row.project_id
            WHERE ${visibleCond('current_transactions', 'current_row')}
            ORDER BY current_row.created_at DESC
          `)
            break
          case 'reimbursement':
            result = await select(`
            ${hiddenCtesFor('expense_reimbursements', 'expense_reimbursement_lines')}
            SELECT reimbursement.id, reimbursement.no,
                   COALESCE(reimbursement.applicant_name_snapshot, reimbursement.applicant) AS display_name,
                   COALESCE(project.name, '公司开支') AS project_name,
                   reimbursement.category AS party_name,
                   reimbursement.reimbursement_date AS display_date,
                   reimbursement.status AS display_status
            FROM expense_reimbursements AS reimbursement
            LEFT JOIN projects AS project ON project.id = reimbursement.project_id
            WHERE ${visibleCond('expense_reimbursements', 'reimbursement')}
            ORDER BY reimbursement.created_at DESC
          `)
            break
          case 'payment_application':
            result = await select(`
            ${hiddenCtesFor('payment_applications')}
            SELECT application.id, application.no,
                   application.name AS display_name,
                   COALESCE(project.name, '公司付款') AS project_name,
                   COALESCE(NULLIF(application.payee_name_snapshot,''), supplier.name, worker.name, application.biz_type) AS party_name,
                   application.apply_amount AS display_amount,
                   application.apply_date AS display_date,
                   application.status AS display_status
            FROM payment_applications AS application
            LEFT JOIN projects AS project ON project.id = application.project_id
            LEFT JOIN suppliers AS supplier ON supplier.id = application.supplier_id
            LEFT JOIN workers AS worker ON worker.id = application.worker_id
            WHERE ${visibleCond('payment_applications', 'application')}
            ORDER BY application.created_at DESC
          `)
            break
          case 'payment_record':
            result = await select(`
            ${hiddenCtesFor('payment_records')}
            SELECT payment.id, payment.no,
                   payment.payee_name AS display_name,
                   COALESCE(project.name, '公司付款') AS project_name,
                   payment.purpose AS party_name,
                   payment.amount AS display_amount,
                   payment.payment_date AS display_date,
                   CASE payment.confirmation_status
                     WHEN 'confirmed' THEN '已确认'
                     WHEN 'needs_review' THEN '待核对'
                     ELSE '草稿'
                   END AS display_status
            FROM payment_records AS payment
            LEFT JOIN projects AS project ON project.id = payment.project_id
            WHERE ${visibleCond('payment_records', 'payment')}
            ORDER BY payment.created_at DESC
          `)
            break
        }
        if (kind === 'invoice_application') {
          for (const row of result)
            row.display_amount = verifiedFinanceSum([row.display_base_amount, row.display_tax_amount])
        }
        if (kind === 'reimbursement') {
          for (const row of result) {
            const lines = await select<{ amount: unknown }>(`${hiddenCtesFor('expense_reimbursement_lines')} SELECT line.amount FROM expense_reimbursement_lines AS line WHERE line.reimbursement_id=? AND ${visibleCond('expense_reimbursement_lines', 'line')}`, [row.id])
            row.display_amount = verifiedFinanceSum(lines.map(line => line.amount))
          }
        }
        return result
      })
      if (listGenerations.get(kind) !== generation || sourceGeneration !== currentSourceGeneration)
        financeFailure('unavailable', '财务读取来源已变化，旧列表不能覆盖当前范围。')
      listRows.value = {
        ...listRows.value,
        [kind]: mapListRows(result),
      }
      return listRows.value[kind] ?? []
    }
    finally {
      loading.value = false
    }
  }

  async function searchLookup(
    table: FinanceLookupTable,
    keyword: string,
    kind: F3FormKind = 'current',
  ): Promise<LookupOption[]> {
    if (isCentral(kind))
      return (await centralRead(kind, () => repository().lookup(centralKind(kind), { kind: table, keyword }))).items
    const rows = await select<{ id: string, name: string }>(
      selectVisibleSql(table, 'AND name LIKE ? ORDER BY name, id'),
      [`%${keyword.trim()}%`],
    )
    return rows.map(row => ({ id: row.id, label: row.name }))
  }

  const searchProjects = (keyword: string, kind?: F3FormKind) => searchLookup('projects', keyword, kind)
  const searchCustomers = (keyword: string, kind?: F3FormKind) => searchLookup('customers', keyword, kind)
  const searchSuppliers = (keyword: string, kind?: F3FormKind) => searchLookup('suppliers', keyword, kind)
  const searchWorkers = (keyword: string, kind?: F3FormKind) => searchLookup('workers', keyword, kind)

  async function searchOriginalExpenses(projectId: string | null, currentId: string | undefined, keyword: string, kind: F3FormKind = 'reimbursement'): Promise<LookupOption[]> {
    if (isCentral(kind))
      return (await centralRead(kind, () => repository().lookup(centralKind(kind), { kind: 'original-expenses', projectId, excludeId: currentId, keyword }))).items
    const rows = await select<{ id: string, item: string, amount: number, applicant: string }>(`
      SELECT line.id, line.expense_item AS item, line.amount,
        COALESCE(owner.applicant_name_snapshot, owner.applicant) AS applicant
      FROM expense_reimbursement_lines AS line
      JOIN expense_reimbursements AS owner ON owner.id = line.reimbursement_id
      WHERE line.deleted_at IS NULL AND owner.deleted_at IS NULL AND owner.status = 'confirmed'
        AND owner.project_id IS ? AND owner.id <> ? AND line.original_expense_line_id IS NULL
        AND (line.expense_item LIKE ? OR owner.applicant LIKE ? OR owner.applicant_name_snapshot LIKE ?)
      ORDER BY line.created_at, line.id
    `, [projectId, currentId ?? '', ...Array.from({ length: 3 }, () => `%${keyword.trim()}%`)])
    return rows.map(row => ({ id: row.id, label: row.item, hint: `${row.applicant} · ¥${row.amount.toFixed(2)} · 原费用` }))
  }

  async function searchContracts(
    projectId: string | null,
    kinds: string[],
    keyword: string,
    kind: F3FormKind = 'payment_application',
    paymentBizType?: string,
    supplierId?: string | null,
  ): Promise<LookupOption[]> {
    if (isCentral(kind))
      return (await centralRead(kind, () => repository().lookup(centralKind(kind), { kind: 'contracts', projectId, contractKinds: kinds, keyword, ...(paymentBizType ? { paymentBizType, supplierId } : {}) }))).items
    if (!projectId)
      return []
    const pattern = `%${keyword.trim()}%`
    const placeholders = kinds.map(() => '?').join(', ')
    const rows = await select<{
      id: string
      no: string
      name: string
      amount: number
      kind: string
      sub_kind: string | null
      supplier_id: string | null
    }>(selectVisibleSql('contracts', `
      AND project_id = ?
      AND kind IN (${placeholders})
      AND (no LIKE ? OR name LIKE ?)
      ORDER BY sign_date DESC, created_at DESC
    `), [projectId, ...kinds, pattern, pattern])
    return rows.filter(row => !paymentBizType || (expenseContractMatchesPaymentType(paymentBizType, row) && (!supplierId || row.supplier_id === supplierId))).map(row => ({
      id: row.id,
      label: row.name,
      hint: `${row.no || '未编号'} · ¥${verifiedFinanceNumber(row.amount).toFixed(2)}`,
    }))
  }

  async function searchSettlements(
    projectId: string | null,
    contractId: string | null,
    keyword: string,
    kind: F3FormKind = 'payment_application',
    payee: { supplierId?: string | null, workerId?: string | null } = {},
  ): Promise<LookupOption[]> {
    if (isCentral(kind))
      return (await centralRead(kind, () => repository().lookup(centralKind(kind), { kind: 'settlements', projectId, contractId, ...payee, keyword }))).items
    return withTransaction(async ({ select }) => {
      const pattern = `%${keyword.trim()}%`
      const rows = await select<{
        id: string
      }>(selectVisibleSql('expenditure_settlements', `
      AND project_id IS ? AND contract_id IS ?
      AND (no LIKE ? OR name LIKE ?)
      ORDER BY settlement_date DESC, created_at DESC
    `), [projectId, contractId, pattern, pattern])
      const actual = await Promise.all(rows.map(row => readNativeOtherSettlementReference({ select }, row.id)))
      return actual.filter(row => row && !row.deleted_at && isConfirmedExpenditureSettlement(row.status) && (!payee.supplierId || row.supplier_id === payee.supplierId) && (!payee.workerId || row.worker_id === payee.workerId) && verifiedFinanceNumber(row.total_amount) > 0).flatMap(row => row
        ? [{
            id: row.id,
            label: row.name,
            hint: `${row.no || '未编号'} · 净额 ¥${verifiedFinanceNumber(row.total_amount).toFixed(2)}`,
          }]
        : [])
    })
  }

  async function searchInvoices(
    scope: {
      projectId: string | null
      supplierId: string | null
      excludePaymentApplicationId?: string
    },
    keyword: string,
    kind: F3FormKind = 'payment_application',
  ): Promise<LookupOption[]> {
    if (isCentral(kind))
      return (await centralRead(kind, () => repository().lookup(centralKind(kind), { kind: 'invoices', projectId: scope.projectId, supplierId: scope.supplierId, excludeId: scope.excludePaymentApplicationId, keyword }))).items
    return withTransaction(async ({ select }) => {
      const pattern = `%${keyword.trim()}%`
      const params: unknown[] = [pattern]
      const filters = ['invoice.invoice_number LIKE ?']
      if (scope.projectId) {
        filters.push('invoice.project_id = ?')
        params.push(scope.projectId)
      }
      if (scope.supplierId) {
        filters.push('invoice.supplier_id = ?')
        params.push(scope.supplierId)
      }
      const rows = await select<{
        id: string
        invoice_number: string
        invoice_date: string
        total_amount: number
      }>(`
      ${hiddenCtesFor('invoices', 'payment_application_invoice_allocations')}
      SELECT invoice.id, invoice.invoice_number, invoice.invoice_date,
             invoice.total_amount
      FROM invoices AS invoice
      WHERE ${visibleCond('invoices', 'invoice')}
        AND ${filters.join(' AND ')}
      ORDER BY invoice.invoice_date DESC, invoice.created_at DESC
      LIMIT 50
    `, params)
      const result: LookupOption[] = []
      for (const row of rows) {
        const allocations = await select<{ allocated_amount: unknown }>(`${hiddenCtesFor('payment_application_invoice_allocations')} SELECT allocation.allocated_amount FROM payment_application_invoice_allocations AS allocation WHERE allocation.invoice_id=? AND ${visibleCond('payment_application_invoice_allocations', 'allocation')} ${scope.excludePaymentApplicationId ? 'AND allocation.payment_application_id<>?' : ''}`, scope.excludePaymentApplicationId ? [row.id, scope.excludePaymentApplicationId] : [row.id])
        const remaining = Math.max(verifiedFinanceSum([row.total_amount]) - verifiedFinanceSum(allocations.map(line => line.allocated_amount)), 0)
        result.push({ id: row.id, label: row.invoice_number || '未编号发票', hint: `${row.invoice_date || '未填日期'} · 剩余 ¥${remaining.toFixed(2)}` })
      }
      return result
    })
  }

  async function searchPaymentApplications(
    scope: {
      projectId: string | null
      supplierId: string | null
      workerId?: string | null
    },
    keyword: string,
    kind: F3FormKind = 'payment_record',
  ): Promise<LookupOption[]> {
    if (isCentral(kind))
      return (await centralRead(kind, () => repository().lookup(centralKind(kind), { kind: 'payment-applications', ...scope, keyword }))).items
    return withTransaction(async ({ select }) => {
      const pattern = `%${keyword.trim()}%`
      const filters = ['(application.no LIKE ? OR application.name LIKE ?)']
      const params: unknown[] = [pattern, pattern]
      if (scope.projectId) {
        filters.push('application.project_id = ?')
        params.push(scope.projectId)
      }
      else {
        filters.push('application.project_id IS NULL')
      }
      filters.push('application.supplier_id IS ? AND application.worker_id IS ?')
      params.push(scope.supplierId, scope.workerId ?? null)
      const rows = await select<{
        id: string
        no: string
        name: string
        apply_amount: number
      }>(`
      ${hiddenCtesFor(
        'payment_applications',
        'payment_record_application_allocations',
        'payment_records',
      )}
      SELECT application.id, application.no, application.name,
             application.apply_amount
      FROM payment_applications AS application
      WHERE ${visibleCond('payment_applications', 'application')}
        AND ${filters.join(' AND ')}
      ORDER BY application.apply_date DESC, application.created_at DESC
    `, params)
      const result: LookupOption[] = []
      for (const row of rows) {
        const allocations = await select<{ allocated_amount: unknown, amount: unknown }>(`${hiddenCtesFor('payment_record_application_allocations', 'payment_records')} SELECT allocation.allocated_amount,payment.amount FROM payment_record_application_allocations AS allocation JOIN payment_records AS payment ON payment.id=allocation.payment_record_id WHERE allocation.payment_application_id=? AND ${visibleCond('payment_record_application_allocations', 'allocation')} AND ${visibleCond('payment_records', 'payment')} AND payment.confirmation_status='confirmed'`, [row.id])
        allocations.forEach(cash => verifiedFinanceSum([cash.amount]))
        const paid = verifiedFinanceSum(allocations.map(line => line.allocated_amount))
        result.push({ id: row.id, label: row.name, hint: `${row.no || '未编号'} · 申请 ¥${verifiedFinanceSum([row.apply_amount]).toFixed(2)} · 已付 ¥${paid.toFixed(2)}` })
      }
      return result
    })
  }

  async function loadCustomerSnapshot(id: string, kind: F3FormKind = 'invoice_application') {
    if (isCentral(kind))
      return (await centralRead(kind, () => repository().customer(centralKind(kind), id))).items[0] ?? null
    const [customer] = await select<{ name: string, tax_no: string }>(
      selectVisibleSql('customers', 'AND id = ? LIMIT 1'),
      [id],
    )
    return customer
      ? { name: customer.name, taxNo: customer.tax_no }
      : null
  }

  return {
    paymentManagementDetails,
    paymentApplicationDetail,
    records: readonly(records),
    listRows: readonly(listRows),
    loading: readonly(loading),
    isCentral,
    createFormSession,
    hydrateForm,
    recoverForm,
    revalidateForm,
    invalidateForm,
    formAttachments,
    originalContent,
    byId,
    loadOne,
    loadList,
    searchProjects,
    searchCustomers,
    searchSuppliers,
    searchWorkers,
    searchOriginalExpenses,
    searchContracts,
    searchSettlements,
    searchInvoices,
    searchPaymentApplications,
    loadCustomerSnapshot,
    saveForm,
    unconfirmPayment,
  }
})
