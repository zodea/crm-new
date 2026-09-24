<script setup lang="ts">
import type {
  F3FormKind,
  F3SaveAction,
} from '~/lib/finance/forms'
import type { FinancePageDraft } from '~/lib/finance/page'
import type {
  FormFooterAction,
} from '~/lib/master-data/page'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import {
  listFinanceFormAttachments,
  loadFinanceForm,
} from '~/lib/finance/forms'
import {
  F3_FORM_META,
  f3FormDefaults,
  financeFormPath,
  PAYMENT_BIZ_TYPES,
  validateFinanceForm,
} from '~/lib/finance/page'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  kind: F3FormKind
}>()

const route = useRoute()
const financeStore = useFinanceStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()
const {
  attachments,
  pendingAttachments,
  pendingRemoveIds,
  pendingRestoreIds,
  desktopAttachmentPicker,
  dirty: attachmentDirty,
  reset: resetAttachments,
  clearPending: clearPendingAttachments,
  changes: attachmentChanges,
  handleFiles,
  pickNativeFiles,
  toggleExisting: toggleExistingAttachment,
  removePending,
  patchPending,
} = useFinanceFormAttachments(toRef(props, 'kind'))

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

const draft = ref<FinancePageDraft>(f3FormDefaults(props.kind) as FinancePageDraft)
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(false)
const loadingAction = shallowRef<FormFooterAction | 'confirmPayment' | 'unconfirmPayment' | null>(null)
const closeAfterSave = shallowRef(true)
const savedSnapshot = shallowRef('')
const paymentTypeSelected = shallowRef(false)
let allowLeave = false

const dirty = computed(() =>
  JSON.stringify(draft.value) !== savedSnapshot.value
  || attachmentDirty.value,
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
const fetchProjects = financeStore.searchProjects
const fetchCustomers = financeStore.searchCustomers
const fetchSuppliers = financeStore.searchSuppliers

function fetchIncomeContracts(keyword: string) {
  return financeStore.searchContracts(
    draft.value.projectId ?? null,
    ['施工'],
    keyword,
  )
}

function fetchExpenseContracts(keyword: string) {
  return financeStore.searchContracts(
    draft.value.projectId ?? null,
    ['分包', '材采', '其他支出'],
    keyword,
  )
}

function fetchSettlements(keyword: string) {
  return financeStore.searchSettlements(
    draft.value.projectId ?? null,
    draft.value.contractId ?? null,
    keyword,
  )
}

function fetchInvoices(keyword: string) {
  return financeStore.searchInvoices({
    projectId: draft.value.projectId ?? null,
    supplierId: draft.value.supplierId ?? null,
    excludePaymentApplicationId: draft.value.id,
  }, keyword)
}

function fetchPaymentApplications(keyword: string) {
  return financeStore.searchPaymentApplications({
    projectId: draft.value.projectId ?? null,
    supplierId: draft.value.supplierId ?? null,
  }, keyword)
}

function queryValue(key: string): string {
  const value = route.query[key]
  return Array.isArray(value) ? value[0] ?? '' : String(value ?? '')
}

async function applyPaymentRecordPrefill(base: FinancePageDraft): Promise<FinancePageDraft> {
  if (props.kind !== 'payment_record')
    return base
  const paymentApplicationId = queryValue('paymentApplicationId')
  if (!paymentApplicationId)
    return base
  const application = await loadFinanceForm('payment_application', paymentApplicationId)
  if (!application)
    return base
  const amount = Number(queryValue('amount')) || 0
  return {
    ...base,
    projectId: queryValue('projectId') || application.projectId || null,
    supplierId: queryValue('supplierId') || application.supplierId || null,
    purpose: application.name || application.no || '',
    amount,
    applicationAllocations: amount > 0
      ? [{ paymentApplicationId, allocatedAmount: amount, note: '' }]
      : [],
  } as FinancePageDraft
}

async function initialize() {
  loading.value = true
  resetAttachments()
  try {
    const id = routeId.value
    if (!id) {
      draft.value = f3FormDefaults(props.kind) as FinancePageDraft
      draft.value = await applyPaymentRecordPrefill(draft.value)
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
      } as FinancePageDraft
      resetAttachments(files)
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

function patchDraft(patch: Partial<FinancePageDraft>) {
  draft.value = { ...draft.value, ...patch }
  if (
    props.kind === 'invoice_application'
    && typeof patch.customerId === 'string'
  ) {
    void financeStore.loadCustomerSnapshot(patch.customerId).then((customer) => {
      if (!customer || draft.value.customerId !== patch.customerId)
        return
      draft.value = {
        ...draft.value,
        buyerNameSnapshot: customer.name,
        buyerTaxNoSnapshot: customer.taxNo,
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
  const errors = validateFinanceForm(props.kind, draft.value, action)
  fieldErrors.value = errors
  const messages = Object.values(errors)
  if (messages.length)
    warning(`${messages[0]}（共 ${messages.length} 处）`)
  return messages.length === 0
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
    clearPendingAttachments()
    fieldErrors.value = {}
    if (footerAction === 'saveNew') {
      allowLeave = true
      if (routeId.value)
        await navigateTo(meta.value.newPath, { replace: true })
      draft.value = f3FormDefaults(props.kind) as FinancePageDraft
      resetAttachments()
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

useTabCloseGuard(async () => {
  if (allowLeave || !dirty.value)
    return true
  const accepted = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  return accepted
})

onMounted(() => void initialize())
</script>

<template>
  <div class="min-w-0">
    <FinancePaymentTypeStep
      v-if="showPaymentTypeStep"
      :biz-types="PAYMENT_BIZ_TYPES"
      @back="leaveToList"
      @select="selectPaymentType"
    />

    <EntityFormShell
      v-else
      :title="title"
      :subtitle="meta.subtitle"
      :back-label="`返回${meta.label}`"
      :sections="meta.sections"
      :state="loading ? 'loading' : 'ready'"
      @back="leaveToList"
    >
      <template v-if="kind === 'payment_record'" #status>
        <span class="chip" :class="isConfirmedPayment ? 'chip-ok' : 'chip-brand'">
          {{ isConfirmedPayment ? '已人工确认' : draft.confirmationStatus === 'needs_review' ? '待核对' : '草稿' }}
        </span>
      </template>
      <template v-if="kind === 'payment_record'" #actions>
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
      </template>

      <section
        v-if="kind === 'receipt'"
        class="mb-4 grid min-w-0 gap-3 rounded-[var(--radius-card)] border border-ok/25 bg-ok-soft px-4 py-3 sm:grid-cols-4"
        aria-label="收款方向"
        data-testid="receipt-direction-summary"
      >
        <div>
          <span class="text-11px text-ink-faint">资金方向</span>
          <strong class="mt-1 block text-14px text-ok-deep">收入</strong>
        </div>
        <div>
          <span class="text-11px text-ink-faint">付款方</span>
          <strong class="mt-1 block text-14px text-ink">甲方客户</strong>
        </div>
        <div>
          <span class="text-11px text-ink-faint">收款方</span>
          <strong class="mt-1 block text-14px text-ink">我方乙方</strong>
        </div>
        <div class="sm:text-right">
          <span class="text-11px text-ink-faint">本次收款事实</span>
          <strong class="mt-1 block font-mono text-16px text-ok-deep">+¥{{ Number(draft.amount || 0).toFixed(2) }}</strong>
        </div>
      </section>

      <form class="flex min-w-0 flex-col gap-4" data-testid="finance-form" @submit.prevent>
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
          @remove-pending="removePending"
          @patch-pending="patchPending"
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
    </EntityFormShell>
  </div>
</template>
