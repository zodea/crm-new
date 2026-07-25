<script setup lang="ts">
import type {
  CurrentTransactionFormDraft,
  ExpenseReimbursementFormDraft,
  F3FormKind,
  F3SaveAction,
  InvoiceApplicationFormDraft,
  PaymentApplicationFormDraft,
  PaymentRecordFormDraft,
  ReceiptFormDraft,
} from '~/lib/finance/forms'
import type {
  FileRefChanges,
  FileRefDraft,
  FileRefRecord,
} from '~/lib/forms/file-refs'
import type { LookupOption } from '~/lib/kit/lookup'
import type { FormFooterAction } from '~/lib/master-data/page'
import { isTauri } from '@tauri-apps/api/core'
import { onBeforeRouteLeave } from 'vue-router'
import { select } from '~/lib/db/connection'
import {
  hiddenCtesFor,
  selectVisibleSql,
  visibleCond,
} from '~/lib/db/soft-delete'
import {
  listFinanceFormAttachments,
  loadFinanceForm,
} from '~/lib/finance/forms'
import {
  F3_FORM_META,
  f3FormDefaults,
  financeFormPath,
} from '~/lib/finance/page'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'

type PageDraft
  = ReceiptFormDraft
    & InvoiceApplicationFormDraft
    & CurrentTransactionFormDraft
    & ExpenseReimbursementFormDraft
    & PaymentApplicationFormDraft
    & PaymentRecordFormDraft

type PendingFileRef = FileRefDraft & { localId: string }

const props = defineProps<{
  kind: F3FormKind
}>()

const route = useRoute()
const financeStore = useFinanceStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()

const meta = computed(() => F3_FORM_META[props.kind])
const routeId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] : value
})
const isEditing = computed(() => Boolean(routeId.value))
const pageFullPath = route.fullPath
const pageKey = deriveKey(pageFullPath)
const title = computed(() => `${isEditing.value ? '编辑' : '新建'} · ${meta.value.label}`)
useTabTitle(title)

const draft = ref<PageDraft>(f3FormDefaults(props.kind) as PageDraft)
const attachments = shallowRef<FileRefRecord[]>([])
const pendingAttachments = shallowRef<PendingFileRef[]>([])
const pendingRemoveIds = shallowRef<string[]>([])
const pendingRestoreIds = shallowRef<string[]>([])
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(false)
const loadingAction = shallowRef<FormFooterAction | 'confirmPayment' | 'unconfirmPayment' | null>(null)
const closeAfterSave = shallowRef(true)
const desktopAttachmentPicker = shallowRef(false)
const savedSnapshot = shallowRef('')
const paymentTypeSelected = shallowRef(false)
let allowLeave = false

const dirty = computed(() =>
  JSON.stringify(draft.value) !== savedSnapshot.value
  || pendingAttachments.value.length > 0
  || pendingRemoveIds.value.length > 0
  || pendingRestoreIds.value.length > 0,
)
const isConfirmedPayment = computed(() =>
  props.kind === 'payment_record' && draft.value.confirmationStatus === 'confirmed',
)
const footerLoadingAction = computed<FormFooterAction | null>(() =>
  loadingAction.value === 'confirmPayment' || loadingAction.value === 'unconfirmPayment'
    ? null
    : loadingAction.value,
)
const showPaymentTypeStep = computed(() =>
  props.kind === 'payment_application' && !isEditing.value && !paymentTypeSelected.value,
)
const PAYMENT_BIZ_TYPES = [
  '有合同-合同劳务',
  '有合同-材料',
  '有合同-专业分包',
  '有合同-机械',
  '有合同-其他',
  '无合同-零星采购',
  '预付款',
  '管理费',
  '项目费用',
  '公司付款',
]

async function basicLookup(
  table: 'projects' | 'customers' | 'suppliers',
  keyword: string,
): Promise<LookupOption[]> {
  const pattern = `%${keyword.trim()}%`
  const rows = await select<{ id: string, name: string }>(
    selectVisibleSql(table, 'AND name LIKE ? ORDER BY name LIMIT 50'),
    [pattern],
  )
  return rows.map(row => ({ id: row.id, label: row.name }))
}

const fetchProjects = (keyword: string) => basicLookup('projects', keyword)
const fetchCustomers = (keyword: string) => basicLookup('customers', keyword)
const fetchSuppliers = (keyword: string) => basicLookup('suppliers', keyword)

async function fetchContracts(
  keyword: string,
  kinds: string[],
): Promise<LookupOption[]> {
  if (!draft.value.projectId)
    return []
  const pattern = `%${keyword.trim()}%`
  const placeholders = kinds.map(() => '?').join(', ')
  const rows = await select<{
    id: string
    no: string
    name: string
    amount: number
  }>(selectVisibleSql('contracts', `
    AND project_id = ?
    AND kind IN (${placeholders})
    AND (no LIKE ? OR name LIKE ?)
    ORDER BY sign_date DESC, created_at DESC
    LIMIT 50
  `), [draft.value.projectId, ...kinds, pattern, pattern])
  return rows.map(row => ({
    id: row.id,
    label: row.name,
    hint: `${row.no || '未编号'} · ¥${Number(row.amount).toFixed(2)}`,
  }))
}

function fetchIncomeContracts(keyword: string) {
  return fetchContracts(keyword, ['施工'])
}
function fetchExpenseContracts(keyword: string) {
  return fetchContracts(keyword, ['分包', '材采', '其他支出'])
}

async function fetchSettlements(keyword: string): Promise<LookupOption[]> {
  if (!draft.value.projectId || !draft.value.contractId)
    return []
  const pattern = `%${keyword.trim()}%`
  const rows = await select<{
    id: string
    no: string
    name: string
    total_amount: number
  }>(selectVisibleSql('expenditure_settlements', `
    AND project_id = ? AND contract_id = ?
    AND (no LIKE ? OR name LIKE ?)
    ORDER BY settlement_date DESC, created_at DESC
    LIMIT 50
  `), [draft.value.projectId, draft.value.contractId, pattern, pattern])
  return rows.map(row => ({
    id: row.id,
    label: row.name,
    hint: `${row.no || '未编号'} · 含税 ¥${Number(row.total_amount).toFixed(2)}`,
  }))
}

async function fetchInvoices(keyword: string): Promise<LookupOption[]> {
  const pattern = `%${keyword.trim()}%`
  const params: unknown[] = [pattern]
  const filters = [`invoice.invoice_number LIKE ?`]
  if (draft.value.projectId) {
    filters.push('invoice.project_id = ?')
    params.push(draft.value.projectId)
  }
  if (draft.value.supplierId) {
    filters.push('invoice.supplier_id = ?')
    params.push(draft.value.supplierId)
  }
  const rows = await select<{
    id: string
    invoice_number: string
    invoice_date: string
    total_amount: number
    used_amount: number
  }>(`
    ${hiddenCtesFor('invoices', 'payment_application_invoice_allocations')}
    SELECT invoice.id, invoice.invoice_number, invoice.invoice_date,
           invoice.total_amount,
           COALESCE((
             SELECT SUM(allocation.allocated_amount)
             FROM payment_application_invoice_allocations AS allocation
             WHERE allocation.invoice_id = invoice.id
               AND ${visibleCond('payment_application_invoice_allocations', 'allocation')}
               ${draft.value.id ? 'AND allocation.payment_application_id <> ?' : ''}
           ), 0) AS used_amount
    FROM invoices AS invoice
    WHERE ${visibleCond('invoices', 'invoice')}
      AND ${filters.join(' AND ')}
    ORDER BY invoice.invoice_date DESC, invoice.created_at DESC
    LIMIT 50
  `, draft.value.id ? [draft.value.id, ...params] : params)
  return rows.map(row => ({
    id: row.id,
    label: row.invoice_number || '未编号发票',
    hint: `${row.invoice_date || '未填日期'} · 剩余 ¥${Math.max(Number(row.total_amount) - Number(row.used_amount), 0).toFixed(2)}`,
  }))
}

async function fetchPaymentApplications(keyword: string): Promise<LookupOption[]> {
  const pattern = `%${keyword.trim()}%`
  const filters = ['(application.no LIKE ? OR application.name LIKE ?)']
  const params: unknown[] = [pattern, pattern]
  if (draft.value.projectId) {
    filters.push('application.project_id = ?')
    params.push(draft.value.projectId)
  }
  else {
    filters.push('application.project_id IS NULL')
  }
  if (draft.value.supplierId) {
    filters.push('application.supplier_id = ?')
    params.push(draft.value.supplierId)
  }
  const rows = await select<{
    id: string
    no: string
    name: string
    apply_amount: number
    paid_amount: number
  }>(`
    ${hiddenCtesFor(
      'payment_applications',
      'payment_record_application_allocations',
      'payment_records',
    )}
    SELECT application.id, application.no, application.name,
           application.apply_amount,
           COALESCE((
             SELECT SUM(allocation.allocated_amount)
             FROM payment_record_application_allocations AS allocation
             JOIN payment_records AS payment
               ON payment.id = allocation.payment_record_id
             WHERE allocation.payment_application_id = application.id
               AND ${visibleCond('payment_record_application_allocations', 'allocation')}
               AND ${visibleCond('payment_records', 'payment')}
               AND payment.confirmation_status = 'confirmed'
           ), 0) AS paid_amount
    FROM payment_applications AS application
    WHERE ${visibleCond('payment_applications', 'application')}
      AND ${filters.join(' AND ')}
    ORDER BY application.apply_date DESC, application.created_at DESC
    LIMIT 50
  `, params)
  return rows.map(row => ({
    id: row.id,
    label: row.name,
    hint: `${row.no || '未编号'} · 申请 ¥${Number(row.apply_amount).toFixed(2)} · 已付 ¥${Number(row.paid_amount).toFixed(2)}`,
  }))
}

async function initialize() {
  loading.value = true
  pendingAttachments.value = []
  pendingRemoveIds.value = []
  pendingRestoreIds.value = []
  try {
    const id = routeId.value
    if (!id) {
      draft.value = f3FormDefaults(props.kind) as PageDraft
      attachments.value = []
      paymentTypeSelected.value = props.kind !== 'payment_application'
    }
    else {
      const [record, files] = await Promise.all([
        loadFinanceForm(props.kind, id),
        listFinanceFormAttachments(props.kind, id, true),
      ])
      if (!record) {
        error(`${meta.value.label}不存在或已删除`)
        allowLeave = true
        await navigateTo(meta.value.listPath)
        return
      }
      draft.value = {
        ...f3FormDefaults(props.kind),
        ...record,
      } as PageDraft
      attachments.value = files
      paymentTypeSelected.value = true
    }
    fieldErrors.value = {}
    await nextTick()
    savedSnapshot.value = JSON.stringify(draft.value)
  }
  catch (cause) {
    error(`载入失败：${toErrorMessage(cause)}`)
  }
  finally {
    loading.value = false
  }
}

function patchDraft(patch: Partial<PageDraft>) {
  draft.value = { ...draft.value, ...patch }
  if (
    props.kind === 'invoice_application'
    && typeof patch.customerId === 'string'
  ) {
    void select<{ name: string, tax_no: string }>(`
      SELECT name, tax_no FROM customers
      WHERE id = ? AND deleted_at IS NULL
    `, [patch.customerId]).then(([customer]) => {
      if (!customer || draft.value.customerId !== patch.customerId)
        return
      draft.value = {
        ...draft.value,
        buyerNameSnapshot: customer.name,
        buyerTaxNoSnapshot: customer.tax_no,
      }
    })
  }
}

function selectPaymentType(bizType: string) {
  patchDraft({
    bizType,
    ...(bizType === '公司付款'
      ? { projectId: null, contractId: null, settlementAllocations: [] }
      : {}),
  })
  paymentTypeSelected.value = true
}

function clearFieldError(field: string) {
  if (!fieldErrors.value[field])
    return
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

function validateRequired(action: F3SaveAction): boolean {
  const errors: Record<string, string> = {}
  const require = (field: keyof PageDraft, label: string, positive = false) => {
    const value = draft.value[field]
    const missing = positive
      ? !(Number(value) > 0)
      : typeof value === 'string'
        ? !value.trim()
        : value == null
    if (missing)
      errors[String(field)] = `${label}为必填项`
  }

  switch (props.kind) {
    case 'receipt':
      require('receiptDate', '收款日期')
      require('projectId', '项目')
      require('customerId', '客户')
      require('amount', '收款金额', true)
      break
    case 'invoice_application':
      require('name', '开票申请名称')
      require('projectId', '项目')
      require('customerId', '客户')
      require('buyerNameSnapshot', '购方名称')
      require('buyerTaxNoSnapshot', '购方税号')
      require('applicationDate', '申请日期')
      require('amount', '申请金额', true)
      break
    case 'current':
      require('direction', '收付方向')
      require('projectId', '项目')
      require('counterparty', '往来单位')
      require('transactionDate', '发生日期')
      require('amount', '发生金额', true)
      break
    case 'reimbursement':
      require('applicant', '报销人')
      require('reimbursementDate', '报销日期')
      if (!(draft.value.lines?.length)
        || draft.value.lines.some(line => !line.expenseItem?.trim() || !(Number(line.amount) > 0))) {
        errors.lines = '费用明细项目和金额为必填项'
      }
      break
    case 'payment_application':
      require('name', '付款申请名称')
      require('bizType', '业务类型')
      require('applyAmount', '申请金额', true)
      require('applyDate', '申请日期')
      require('applicant', '申请人')
      require('invoiceState', '回票类型')
      if (draft.value.bizType !== '公司付款')
        require('projectId', '项目')
      if (draft.value.bizType?.startsWith('有合同-') || draft.value.bizType === '预付款') {
        require('supplierId', '收款单位')
        require('contractId', '关联合同')
      }
      break
    case 'payment_record':
      require('payeeName', '收款方名称')
      require('paymentDate', '支付日期')
      require('amount', '支付金额', true)
      require('voucherNo', '付款凭证号')
      require('bankSerialNo', '银行流水号')
      if (action === 'confirm')
        require('confirmedBy', '确认人')
      break
  }

  fieldErrors.value = errors
  const messages = Object.values(errors)
  if (messages.length)
    warning(`${messages[0]}（共 ${messages.length} 处）`)
  return messages.length === 0
}

function attachmentChanges(): FileRefChanges {
  return {
    add: pendingAttachments.value.map(({ localId: _localId, ...file }) => file),
    removeIds: pendingRemoveIds.value,
    restoreIds: pendingRestoreIds.value,
  }
}

async function persist(action: F3SaveAction, footerAction?: FormFooterAction) {
  if (action !== 'draft' && !validateRequired(action))
    return
  loadingAction.value = footerAction
    ?? (action === 'confirm' ? 'confirmPayment' : action === 'draft' ? 'draft' : 'saveSubmit')
  try {
    const result = await financeStore.saveForm(
      props.kind,
      draft.value,
      action,
      attachmentChanges(),
    )
    success(
      action === 'draft'
        ? '草稿已保存'
        : action === 'confirm'
          ? '支付已人工确认并计入资金汇总'
          : action === 'save'
            ? '保存成功'
            : props.kind === 'payment_record'
              ? '已保存，等待人工核对'
              : '已保存并提交',
    )
    pendingAttachments.value = []
    pendingRemoveIds.value = []
    pendingRestoreIds.value = []
    fieldErrors.value = {}
    if (footerAction === 'saveNew') {
      allowLeave = true
      if (routeId.value)
        await navigateTo(meta.value.newPath, { replace: true })
      draft.value = f3FormDefaults(props.kind) as PageDraft
      attachments.value = []
      paymentTypeSelected.value = props.kind !== 'payment_application'
      await nextTick()
      savedSnapshot.value = JSON.stringify(draft.value)
      allowLeave = false
      return
    }
    if (closeAfterSave.value && (footerAction === 'save' || footerAction === 'saveSubmit')) {
      allowLeave = true
      tabsStore.close(pageKey)
      await navigateTo(meta.value.listPath)
      return
    }
    allowLeave = true
    await navigateTo(financeFormPath(props.kind, result.id), { replace: true })
    await initialize()
    allowLeave = false
  }
  catch (cause) {
    error(`保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
  }
}

async function handleFooterAction(action: FormFooterAction) {
  if (action === 'cancel') {
    await leaveToList()
    return
  }
  const saveAction: F3SaveAction = action === 'draft'
    ? 'draft'
    : action === 'saveSubmit'
      ? 'submit'
      : 'save'
  await persist(saveAction, action)
}

async function confirmPayment() {
  if (!validateRequired('confirm'))
    return
  const accepted = await confirm({
    variant: 'simple',
    title: '人工确认支付',
    message: '确认金额、日期、收款方、银行流水、回单和付款申请分摊均已人工核对？确认后将进入资金与合同已付汇总。',
    confirmLabel: '确认支付',
  })
  if (accepted)
    await persist('confirm')
}

async function unconfirmPayment() {
  const id = routeId.value
  if (!id)
    return
  const accepted = await confirm({
    variant: 'simple',
    title: '撤回支付确认',
    message: '撤回后该笔支付立即退出项目资金、合同已付和付款申请累计已付。',
    confirmLabel: '撤回确认',
  })
  if (!accepted)
    return
  loadingAction.value = 'unconfirmPayment'
  try {
    await financeStore.unconfirmPayment(id)
    success('已撤回支付确认')
    await initialize()
  }
  catch (cause) {
    error(`撤回失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
  }
}

function appendPendingAttachments(files: FileRefDraft[]) {
  const existingCount = attachments.value.filter(file => !file.deletedAt).length
    - pendingRemoveIds.value.length
    + pendingRestoreIds.value.length
  const max = props.kind === 'payment_application' ? 15 : 30
  const available = Math.max(max - existingCount - pendingAttachments.value.length, 0)
  if (files.length > available)
    warning(`最多保留 ${max} 份附件，本次只加入前 ${available} 份`)
  pendingAttachments.value = [
    ...pendingAttachments.value,
    ...files.slice(0, available).map((file, index) => ({
      ...file,
      localId: `${file.filePath || file.fileName}-${Date.now()}-${index}`,
      category: file.category || (props.kind === 'payment_record' ? '付款回单' : '业务附件'),
    })),
  ]
}

function handleFiles(files: File[]) {
  appendPendingAttachments(files.map(file => ({
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  })))
}

async function pickNativeFiles() {
  try {
    const [{ open }, { stat }, { basename }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
      import('@tauri-apps/api/path'),
    ])
    const selected = await open({ multiple: true, directory: false })
    const paths = selected == null ? [] : Array.isArray(selected) ? selected : [selected]
    const files = await Promise.all(paths.map(async filePath => ({
      fileName: await basename(filePath),
      filePath,
      fileSize: (await stat(filePath)).size,
    })))
    appendPendingAttachments(files)
  }
  catch (cause) {
    error(`选择附件失败：${toErrorMessage(cause)}`)
  }
}

function toggleExistingAttachment(id: string) {
  const attachment = attachments.value.find(file => file.id === id)
  if (attachment?.deletedAt) {
    pendingRestoreIds.value = pendingRestoreIds.value.includes(id)
      ? pendingRestoreIds.value.filter(item => item !== id)
      : [...pendingRestoreIds.value, id]
    return
  }
  pendingRemoveIds.value = pendingRemoveIds.value.includes(id)
    ? pendingRemoveIds.value.filter(item => item !== id)
    : [...pendingRemoveIds.value, id]
}

async function leaveToList() {
  if (dirty.value) {
    const accepted = await confirm({
      variant: 'simple',
      title: '放弃修改',
      message: '当前表单还有未保存内容，确认放弃并返回列表？',
      confirmLabel: '放弃修改',
    })
    if (!accepted)
      return
  }
  allowLeave = true
  tabsStore.close(pageKey)
  await navigateTo(meta.value.listPath)
}

onBeforeRouteLeave(async () => {
  if (allowLeave || !dirty.value)
    return true
  if (tabsStore.tabs.some(tab => tab.key === pageKey))
    return true
  const accepted = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  return accepted
})

onMounted(() => {
  desktopAttachmentPicker.value = isTauri()
  void initialize()
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-1340px items-start gap-4 pb-6">
    <aside
      class="sticky top-4 hidden w-44 shrink-0 rounded-[var(--radius-card)] border border-line bg-panel p-2 xl:block"
      aria-label="表单分区"
    >
      <a
        v-for="section in meta.sections"
        :key="section.key"
        :href="`#section-${section.key}`"
        class="block rounded-[var(--radius-control)] px-3 py-2 text-12px text-ink-soft transition-colors hover:bg-brand-soft hover:text-brand-deep"
      >
        {{ section.label }}
      </a>
    </aside>

    <main class="min-w-0 flex-1">
      <section
        v-if="showPaymentTypeStep"
        class="panel mx-auto max-w-920px p-5"
        data-testid="payment-type-step"
      >
        <button type="button" class="mb-3 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-12px text-brand-deep" @click="leaveToList">
          <span class="i-lucide-arrow-left" aria-hidden="true" />
          返回付款申请
        </button>
        <h1 class="text-20px font-800 text-ink">
          选择付款业务类型
        </h1>
        <p class="mt-2 text-13px text-ink-soft">
          业务类型决定项目、合同、结算与回票校验规则，进入表单后仍可调整。
        </p>
        <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            v-for="bizType in PAYMENT_BIZ_TYPES"
            :key="bizType"
            type="button"
            class="rounded-[var(--radius-card)] border border-line bg-panel p-4 text-left text-13px font-700 text-ink transition-colors hover:border-brand hover:bg-brand-soft"
            @click="selectPaymentType(bizType)"
          >
            {{ bizType }}
          </button>
        </div>
      </section>

      <header v-if="!showPaymentTypeStep" class="mb-4 flex flex-wrap items-start gap-3">
        <div>
          <button type="button" class="mb-1 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-12px text-brand-deep" @click="leaveToList">
            <span class="i-lucide-arrow-left" aria-hidden="true" />
            返回{{ meta.label }}
          </button>
          <h1 class="text-20px font-800 text-ink">
            {{ title }}
          </h1>
          <p class="mt-1 text-12px text-ink-faint">
            {{ meta.subtitle }}；草稿允许缺项，提交时由领域 action 校验真实关联。
          </p>
        </div>
        <div v-if="kind === 'payment_record'" class="ml-auto flex items-center gap-2">
          <span class="chip" :class="isConfirmedPayment ? 'chip-ok' : 'chip-brand'">
            {{ isConfirmedPayment ? '已人工确认' : draft.confirmationStatus === 'needs_review' ? '待核对' : '草稿' }}
          </span>
          <KitButton
            v-if="isConfirmedPayment"
            variant="secondary"
            :loading="loadingAction === 'unconfirmPayment'"
            data-testid="unconfirm-payment"
            @click="unconfirmPayment"
          >
            撤回确认
          </KitButton>
          <KitButton
            v-else
            :loading="loadingAction === 'confirmPayment'"
            data-testid="confirm-payment"
            @click="confirmPayment"
          >
            人工确认支付
          </KitButton>
        </div>
      </header>

      <div v-if="!showPaymentTypeStep && loading" class="panel grid min-h-56 place-items-center text-13px text-ink-faint">
        正在载入表单…
      </div>
      <form v-else-if="!showPaymentTypeStep" class="flex flex-col gap-4" data-testid="finance-form" @submit.prevent>
        <FinanceFormFields
          :kind="kind"
          :draft="draft"
          :field-errors="fieldErrors"
          :fetch-projects="fetchProjects"
          :fetch-customers="fetchCustomers"
          :fetch-suppliers="fetchSuppliers"
          :fetch-income-contracts="fetchIncomeContracts"
          :fetch-expense-contracts="fetchExpenseContracts"
          :fetch-settlements="fetchSettlements"
          :fetch-invoices="fetchInvoices"
          :fetch-payment-applications="fetchPaymentApplications"
          @patch="patchDraft"
          @clear-error="clearFieldError"
        />

        <FileRefAttachmentSection
          :attachments="attachments"
          :pending-attachments="pendingAttachments"
          :pending-remove-ids="pendingRemoveIds"
          :pending-restore-ids="pendingRestoreIds"
          :desktop-picker="desktopAttachmentPicker"
          :title="kind === 'payment_record' ? '付款回单与备注' : '附件与备注'"
          :note="draft.note ?? ''"
          @pick-native="pickNativeFiles"
          @files="handleFiles"
          @toggle-existing="toggleExistingAttachment"
          @remove-pending="pendingAttachments = pendingAttachments.filter(file => file.localId !== $event)"
          @patch-pending="(id, patch) => pendingAttachments = pendingAttachments.map(file => file.localId === id ? { ...file, ...patch } : file)"
          @update-note="patchDraft({ note: $event })"
        />

        <FormFooter
          v-model="closeAfterSave"
          :dirty="dirty"
          close-after-save
          :loading-action="footerLoadingAction"
          @action="handleFooterAction"
        />
      </form>
    </main>
  </div>
</template>
