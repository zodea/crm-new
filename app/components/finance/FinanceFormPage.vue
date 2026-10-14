<script setup lang="ts">
import type { ExpenseClearanceVerificationEdit } from '~/lib/finance/clearance-verification'
import type { FinanceFormSession } from '~/lib/finance/command-session'
import type {
  F3FormKind,
  F3SaveAction,
  F3SaveResult,
  FinanceFormRecordMap,
} from '~/lib/finance/forms'
import type { FinancePageDraft } from '~/lib/finance/page'
import type { PaymentVerificationEdit, PaymentVerificationInput } from '~/lib/finance/payment-verification'
import type {
  FormFooterAction,
} from '~/lib/master-data/page'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import ConstructionScopeSelector from '~/components/contract/ConstructionScopeSelector.vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { decodeConstructionMainSelection } from '~/lib/construction-scope/contract'
import { verifyFinanceAttachments } from '~/lib/finance/attachment-proof'
import { expenseContractKindsForPaymentType } from '~/lib/finance/domain'
import { financeDraftMoney, financeInputTextNumber } from '~/lib/finance/input-number'
import { applyFinanceLineIdentities, captureFinanceInput, captureFinanceLineIdentities } from '~/lib/finance/input-snapshot'
import {
  F3_FORM_META,
  f3FormDefaults,
  financeFormPath,
  PAYMENT_BIZ_TYPES,
  validateFinanceForm,
} from '~/lib/finance/page'
import { isPaymentVerificationEdit } from '~/lib/finance/payment-verification'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { emptyExpenseClearanceInput, expenseClearanceEdit } from './expense-clearance-input'
import FinanceExpenseClearanceVerificationSection from './FinanceExpenseClearanceVerificationSection.vue'
import FinancePaymentVerificationSection from './FinancePaymentVerificationSection.vue'

const props = defineProps<{
  kind: F3FormKind
}>()

const route = useRoute()
const financeStore = useFinanceStore()
const visibility = useDataVisibilityStore()
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
  capture: captureAttachments,
  acknowledge: acknowledgeAttachments,
  invalidatePreparation,
  readingFiles,
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
const savedSnapshot = shallowRef(JSON.stringify(draft.value))
const paymentTypeSelected = shallowRef(false)
let allowLeave = false
let viewGeneration = 0
let active = true
let mounted = false
let viewScope = ''
const savedReadPending = shallowRef<{
  result: Pick<F3SaveResult, 'id' | 'attachmentIds' | 'expenseLineIdentities'>
  kind: F3FormKind
  scope: string
  draft: FinancePageDraft
  files: ReturnType<typeof captureAttachments>
  lineIdentities?: symbol[]
} | null>(null)
const readbackError = shallowRef('')
const recovering = shallowRef(false)
const writeInFlight = shallowRef(false)
const centralSession = shallowRef<FinanceFormSession | null>(null)
const submittedInput = shallowRef<{ draft: FinancePageDraft, files: ReturnType<typeof captureAttachments>, lineIdentities?: symbol[] } | null>(null)
const sourceError = shallowRef('')
const emptyVerificationInput = () => ({ actualDueAmount: '', cumulativePayableAmount: '', basis: '', fileIds: [] as string[] })
const verificationInput = ref<PaymentVerificationInput>(emptyVerificationInput())
const submittedVerification = shallowRef<string | null>(null)
const verificationDirty = computed(() => JSON.stringify(verificationInput.value) !== JSON.stringify(emptyVerificationInput()))
const clearanceInput = ref(emptyExpenseClearanceInput())
const submittedClearance = shallowRef<string | null>(null)
const clearanceDirty = computed(() => JSON.stringify(clearanceInput.value) !== JSON.stringify(emptyExpenseClearanceInput()))
const centralPending = computed(() => centralSession.value?.pending ?? null)
const scopeKey = () => `${props.kind}:${routeId.value ?? 'new'}:${visibility.includeDemo ? 'demo' : 'real'}`
function isCurrent(generation: number, scope: string) {
  return active && generation === viewGeneration && scope === viewScope
}
function invalidateView() {
  ++viewGeneration
  active = false
  invalidatePreparation()
  loading.value = false
  loadingAction.value = null
  recovering.value = false
  if (financeStore.isCentral(props.kind) && centralSession.value)
    financeStore.invalidateForm(props.kind, centralSession.value)
}

function editableSnapshot(value: FinancePageDraft) {
  const copy = { ...value }
  delete copy.paymentVerification
  delete copy.clearanceVerification
  return JSON.stringify(copy)
}
function readVerificationFacts(record: FinanceFormRecordMap[F3FormKind]) {
  return {
    ...('status' in record ? { status: record.status } : {}),
    ...('paymentVerification' in record ? { paymentVerification: record.paymentVerification } : {}),
    ...('clearanceVerification' in record ? { clearanceVerification: record.clearanceVerification } : {}),
  }
}
function acknowledgeVerificationInputs() {
  if (submittedVerification.value === JSON.stringify(verificationInput.value))
    verificationInput.value = emptyVerificationInput()
  if (submittedClearance.value === JSON.stringify(clearanceInput.value))
    clearanceInput.value = emptyExpenseClearanceInput()
  submittedVerification.value = null
  submittedClearance.value = null
}
const ordinaryDirty = computed(() =>
  editableSnapshot(draft.value) !== editableSnapshot(JSON.parse(savedSnapshot.value))
  || attachmentDirty.value,
)
const dirty = computed(() => ordinaryDirty.value || verificationDirty.value || clearanceDirty.value)
const isConfirmedPayment = computed(() =>
  props.kind === 'payment_record' && draft.value.confirmationStatus === 'confirmed',
)
const confirmedExpenseSource = computed(() => props.kind === 'reimbursement' && Boolean(draft.value.clearanceVerification?.sources.length) && ['confirmed', '已确认'].includes(draft.value.status ?? ''))
const footerLoadingAction = computed<FormFooterAction | null>(() =>
  loadingAction.value === 'confirmPayment' || loadingAction.value === 'unconfirmPayment'
    ? null
    : loadingAction.value,
)
const showPaymentTypeStep = computed(() =>
  props.kind === 'payment_application' && !isEditing.value && !paymentTypeSelected.value && !centralPending.value && !sourceError.value,
)
const fetchProjects = (keyword: string) => financeStore.searchProjects(keyword, props.kind)
const fetchCustomers = (keyword: string) => financeStore.searchCustomers(keyword, props.kind)
const fetchSuppliers = (keyword: string) => financeStore.searchSuppliers(keyword, props.kind)
const fetchWorkers = (keyword: string) => financeStore.searchWorkers(keyword, props.kind)

function fetchOriginalExpenses(keyword: string) {
  return financeStore.searchOriginalExpenses(draft.value.projectId ?? null, draft.value.id, keyword, props.kind)
}

function fetchIncomeContracts(keyword: string) {
  return financeStore.searchContracts(
    draft.value.projectId ?? null,
    ['施工'],
    keyword,
    props.kind,
  )
}
async function fetchConstructionMains(keyword: string) {
  const generation = viewGeneration
  const scope = viewScope
  const options = await financeStore.searchConstructionMains(keyword)
  if (!isCurrent(generation, scope) || sourceError.value)
    throw new Error('工程读取期间当前单据或读取来源已变化，请保留输入并重新核对。')
  return options.map((option) => {
    if (!('constructionMain' in option))
      throw new Error('工程选项缺少真实施工主合同依据，请重新读取。')
    return { ...option, constructionMain: decodeConstructionMainSelection(option.constructionMain) }
  })
}

function fetchExpenseContracts(keyword: string) {
  return financeStore.searchContracts(
    draft.value.projectId ?? null,
    expenseContractKindsForPaymentType(draft.value.bizType ?? ''),
    keyword,
    props.kind,
    draft.value.bizType,
    draft.value.supplierId ?? null,
  )
}

function fetchSettlements(keyword: string) {
  return financeStore.searchSettlements(
    draft.value.projectId ?? null,
    draft.value.contractId ?? null,
    keyword,
    props.kind,
    { supplierId: draft.value.supplierId ?? null, workerId: draft.value.workerId ?? null },
  )
}

function fetchInvoices(keyword: string) {
  return financeStore.searchInvoices({
    projectId: draft.value.projectId ?? null,
    supplierId: draft.value.supplierId ?? null,
    excludePaymentApplicationId: draft.value.id,
  }, keyword, props.kind)
}

function fetchPaymentApplications(keyword: string) {
  return financeStore.searchPaymentApplications({
    projectId: draft.value.projectId ?? null,
    supplierId: draft.value.supplierId ?? null,
    workerId: draft.value.workerId ?? null,
  }, keyword, props.kind)
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
  const application = await financeStore.loadOne('payment_application', paymentApplicationId)
  if (!application)
    return base
  const amount = financeInputTextNumber(queryValue('amount'))
  return {
    ...base,
    projectId: application.projectId || null,
    supplierId: application.supplierId || null,
    workerId: application.workerId ?? null,
    payeeName: application.payeeNameSnapshot ?? base.payeeName ?? '',
    payeeNameSnapshot: application.payeeNameSnapshot ?? null,
    purpose: application.name || application.no || '',
    amount,
    applicationAllocations: amount > 0
      ? [{ paymentApplicationId, allocatedAmount: amount, note: '' }]
      : [],
  } as FinancePageDraft
}

async function initialize() {
  const generation = ++viewGeneration
  const scope = scopeKey()
  viewScope = scope
  const kind = props.kind
  verificationInput.value = emptyVerificationInput()
  clearanceInput.value = emptyExpenseClearanceInput()
  loadingAction.value = null
  loading.value = true
  resetAttachments()
  try {
    const id = routeId.value
    sourceError.value = ''
    if (financeStore.isCentral(kind)) {
      const session = financeStore.createFormSession(kind)
      centralSession.value = session
      const ready = await financeStore.hydrateForm(kind, id ?? null, session)
      if (!isCurrent(generation, scope))
        return
      draft.value = { ...f3FormDefaults(kind), ...(ready.form?.draft ?? {}) } as FinancePageDraft
      resetAttachments(ready.form?.attachments ?? [])
      paymentTypeSelected.value = kind !== 'payment_application' || Boolean(ready.form)
      if (!ready.form) {
        const prefilled = await applyPaymentRecordPrefill(draft.value)
        if (!isCurrent(generation, scope))
          return
        draft.value = prefilled
      }
      fieldErrors.value = {}
      savedSnapshot.value = JSON.stringify(draft.value)
      return
    }
    centralSession.value = null
    if (!id) {
      draft.value = f3FormDefaults(props.kind) as FinancePageDraft
      const prefilled = await applyPaymentRecordPrefill(draft.value)
      if (!isCurrent(generation, scope))
        return
      draft.value = prefilled
      paymentTypeSelected.value = props.kind !== 'payment_application'
    }
    else {
      const [record, files] = await Promise.all([
        financeStore.loadOne(kind, id),
        financeStore.formAttachments(kind, id, true),
      ])
      if (!isCurrent(generation, scope))
        return
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
    if (!isCurrent(generation, scope))
      return
    savedSnapshot.value = JSON.stringify(draft.value)
    verificationInput.value = emptyVerificationInput()
  }
  catch (cause) {
    if (isCurrent(generation, scope)) {
      sourceError.value = toErrorMessage(cause)
      error(`载入失败：${toErrorMessage(cause)}`)
    }
  }
  finally {
    if (isCurrent(generation, scope))
      loading.value = false
  }
}

function patchDraft(patch: Partial<FinancePageDraft>) {
  draft.value = { ...draft.value, ...patch }
  if (
    props.kind === 'invoice_application'
    && typeof patch.customerId === 'string'
  ) {
    const generation = viewGeneration
    const scope = viewScope
    void financeStore.loadCustomerSnapshot(patch.customerId, props.kind).then((customer) => {
      if (!isCurrent(generation, scope) || !customer || draft.value.customerId !== patch.customerId)
        return
      draft.value = {
        ...draft.value,
        buyerNameSnapshot: customer.name,
        buyerTaxNoSnapshot: customer.taxNo,
      }
    })
  }
}

async function settleSavedRead(pending: NonNullable<typeof savedReadPending.value>, generation: number) {
  if (financeStore.isCentral(pending.kind) && centralSession.value?.pending) {
    const resolved = await financeStore.recoverForm(pending.kind, centralSession.value)
    if (resolved.outcome !== 'applied' || resolved.result.id !== pending.result.id)
      throw new Error('已保存财务原提交与核对回执不一致')
  }
  const [record, files] = await Promise.all([
    financeStore.loadOne(pending.kind, pending.result.id),
    financeStore.formAttachments(pending.kind, pending.result.id, true),
  ])
  if (!isCurrent(generation, pending.scope))
    return false
  if (!record || record.id !== pending.result.id || files.some(file => file.ownerId !== pending.result.id))
    throw new Error('已保存的同一财务记录尚未可靠读取')
  await verifyFinanceAttachments(pending.result, attachmentChanges(pending.files), files, () => isCurrent(generation, pending.scope), file => financeStore.originalContent(pending.kind, file))
  if (!isCurrent(generation, pending.scope))
    return false
  const changed = editableSnapshot(draft.value) !== editableSnapshot(pending.draft)
  acknowledgeAttachments(files, pending.files, pending.result.attachmentIds)
  if (!changed) {
    draft.value = { ...f3FormDefaults(pending.kind), ...record } as FinancePageDraft
  }
  else {
    const lines = pending.kind === 'reimbursement' && pending.lineIdentities && pending.result.expenseLineIdentities
      ? applyFinanceLineIdentities(draft.value.lines ?? [], pending.lineIdentities, pending.result.expenseLineIdentities, 'lines' in record ? record.lines ?? [] : [])
      : draft.value.lines
    draft.value = { ...draft.value, id: pending.result.id, ...(lines ? { lines } : {}), ...readVerificationFacts(record) }
  }
  savedSnapshot.value = JSON.stringify({ ...f3FormDefaults(pending.kind), ...record })
  savedReadPending.value = null
  readbackError.value = ''
  acknowledgeVerificationInputs()
  return !changed && !attachmentDirty.value && !readingFiles.value && !verificationDirty.value && !clearanceDirty.value
}

async function recoverOriginalCommand() {
  if (!financeStore.isCentral(props.kind) || !centralSession.value || recovering.value || writeInFlight.value)
    return
  const generation = viewGeneration
  const scope = viewScope
  recovering.value = true
  try {
    const retained = captureFinanceInput(draft.value)
    const sent = submittedInput.value
    const resolved = await financeStore.recoverForm(props.kind, centralSession.value)
    if (!isCurrent(generation, scope))
      return
    sourceError.value = ''
    if (resolved.outcome === 'applied' && resolved.form) {
      const changed = sent ? editableSnapshot(retained) !== editableSnapshot(sent.draft) : editableSnapshot(retained) !== editableSnapshot(JSON.parse(savedSnapshot.value))
      if (sent) {
        await verifyFinanceAttachments(resolved.result, attachmentChanges(sent.files), resolved.form.attachments, () => isCurrent(generation, scope), file => financeStore.originalContent(props.kind, file))
        if (!isCurrent(generation, scope))
          return
        acknowledgeAttachments(resolved.form.attachments, sent.files, resolved.result.attachmentIds)
      }
      if (!changed) {
        draft.value = { ...f3FormDefaults(props.kind), ...resolved.form.draft } as FinancePageDraft
        if (!sent && !attachmentDirty.value && !readingFiles.value)
          resetAttachments(resolved.form.attachments)
      }
      else {
        const lines = props.kind === 'reimbursement' && sent?.lineIdentities && 'expenseLineIdentities' in resolved.result && Array.isArray(resolved.result.expenseLineIdentities)
          ? applyFinanceLineIdentities(draft.value.lines ?? [], sent.lineIdentities, resolved.result.expenseLineIdentities, 'lines' in resolved.form.draft ? resolved.form.draft.lines ?? [] : [])
          : draft.value.lines
        draft.value = { ...draft.value, id: resolved.result.id, ...(lines ? { lines } : {}), ...readVerificationFacts(resolved.form.draft) }
      }
      savedSnapshot.value = JSON.stringify({ ...f3FormDefaults(props.kind), ...resolved.form.draft })
      paymentTypeSelected.value = true
      submittedInput.value = null
      acknowledgeVerificationInputs()
      success('原提交已核对为保存，后来输入继续保留')
    }
    else {
      submittedInput.value = null
      success('原提交未保存，原编号已封存；保留输入后可重新提交')
    }
  }
  catch (cause) {
    if (isCurrent(generation, scope))
      sourceError.value = toErrorMessage(cause)
  }
  finally {
    if (isCurrent(generation, scope))
      recovering.value = false
  }
}

async function retrySourceRead() {
  if (!financeStore.isCentral(props.kind) || recovering.value || writeInFlight.value)
    return
  if (centralPending.value)
    return recoverOriginalCommand()
  const generation = viewGeneration
  const scope = viewScope
  recovering.value = true
  try {
    const session = centralSession.value ?? financeStore.createFormSession(props.kind)
    centralSession.value = session
    const ready = session.authority
      ? await financeStore.revalidateForm(props.kind, session)
      : await financeStore.hydrateForm(props.kind, routeId.value ?? null, session)
    if (!isCurrent(generation, scope))
      return
    if (!dirty.value && ready.form) {
      draft.value = { ...f3FormDefaults(props.kind), ...ready.form.draft } as FinancePageDraft
      resetAttachments(ready.form.attachments)
      savedSnapshot.value = JSON.stringify(draft.value)
    }
    else if (ready.form) {
      draft.value = { ...draft.value, ...readVerificationFacts(ready.form.draft) }
    }
    sourceError.value = ''
  }
  catch (cause) {
    if (isCurrent(generation, scope))
      sourceError.value = toErrorMessage(cause)
  }
  finally {
    if (isCurrent(generation, scope))
      recovering.value = false
  }
}

async function recoverSavedRead() {
  const pending = savedReadPending.value
  if (!pending || recovering.value || !active)
    return
  const generation = viewGeneration
  recovering.value = true
  try {
    await settleSavedRead(pending, generation)
    if (isCurrent(generation, pending.scope))
      success('已读取同一记录及本次原件；未提交的后来输入继续保留')
  }
  catch (cause) {
    if (isCurrent(generation, pending.scope))
      readbackError.value = toErrorMessage(cause)
  }
  finally {
    if (isCurrent(generation, pending.scope))
      recovering.value = false
  }
}

async function downloadFile(id: string, trigger: HTMLElement) {
  const generation = viewGeneration
  const scope = viewScope
  const file = attachments.value.find(file => file.id === id && !file.deletedAt && file.ownerId === (draft.value.id ?? routeId.value))
  if (!file || !active)
    return
  try {
    const content = await financeStore.originalContent(props.kind, file)
    if (!isCurrent(generation, scope))
      return
    if (!content) {
      warning('该历史附件仅有元数据，原件正文未知；保留原记录，请核实原件。')
      return
    }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(content.bytes).buffer], { type: content.mimeType }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = file.fileName
      link.click()
    }
    finally { URL.revokeObjectURL(url) }
    await nextTick()
    if (isCurrent(generation, scope) && trigger.isConnected)
      trigger.focus()
  }
  catch (cause) {
    if (isCurrent(generation, scope))
      error(`原件读取失败：${toErrorMessage(cause)}`)
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

async function persist(action: F3SaveAction, footerAction?: FormFooterAction, verificationEdit?: PaymentVerificationEdit, clearanceVerificationEdit?: ExpenseClearanceVerificationEdit, clearanceAttachmentsOnly = false) {
  if (!active || writeInFlight.value || loadingAction.value || savedReadPending.value || readingFiles.value || loading.value || centralPending.value || sourceError.value)
    return
  if (!verificationEdit && !clearanceVerificationEdit && !clearanceAttachmentsOnly && action !== 'draft' && !validateRequired(action))
    return
  loadingAction.value = footerAction
    ?? (action === 'confirm' ? 'confirmPayment' : action === 'draft' ? 'draft' : 'saveSubmit')
  const generation = viewGeneration
  const scope = viewScope
  const kind = props.kind
  const sentDraft = captureFinanceInput(clearanceAttachmentsOnly ? JSON.parse(savedSnapshot.value) : draft.value)
  if (verificationEdit)
    submittedVerification.value = JSON.stringify(verificationInput.value)
  if (clearanceVerificationEdit)
    submittedClearance.value = JSON.stringify(clearanceInput.value)
  const sentFiles = captureAttachments()
  const lineIdentities = kind === 'reimbursement' ? captureFinanceLineIdentities(draft.value.lines ?? []) : undefined
  submittedInput.value = { draft: sentDraft, files: sentFiles, lineIdentities }
  writeInFlight.value = true
  try {
    const result = await financeStore.saveForm(
      kind,
      verificationEdit ? { id: routeId.value, verificationEdit } : clearanceVerificationEdit ? { id: routeId.value, clearanceVerificationEdit } : clearanceAttachmentsOnly ? { id: routeId.value, clearanceAttachmentsOnly: true } : sentDraft,
      action,
      verificationEdit || clearanceVerificationEdit ? {} : clearanceAttachmentsOnly ? { add: attachmentChanges(sentFiles).add ?? [] } : attachmentChanges(sentFiles),
      centralSession.value ?? undefined,
    )
    if (scope !== viewScope)
      return
    const pending = { result, kind, scope, draft: sentDraft, files: sentFiles, lineIdentities }
    savedReadPending.value = pending
    if (!isCurrent(generation, scope))
      return
    if (!result.readbackConfirmed) {
      readbackError.value = result.readbackProblem || '已保存，尚未可靠读取同一记录'
      return
    }
    let mayClose: boolean
    try {
      mayClose = await settleSavedRead(pending, generation)
    }
    catch (cause) {
      if (isCurrent(generation, scope))
        readbackError.value = toErrorMessage(cause)
      return
    }
    if (!isCurrent(generation, scope))
      return
    submittedInput.value = null
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
    fieldErrors.value = {}
    if (!mayClose) {
      warning('本次已保存，后来输入或附件仍未提交，请继续核对。')
      return
    }
    loadingAction.value = null
    if (footerAction === 'saveNew') {
      allowLeave = true
      if (routeId.value) {
        await navigateTo(meta.value.newPath, { replace: true })
        return
      }
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
    if (isCurrent(generation, scope))
      error(`保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    writeInFlight.value = false
    if (isCurrent(generation, scope))
      loadingAction.value = null
  }
}

async function verifyPaymentBasis() {
  if (props.kind !== 'payment_application' || !routeId.value || ordinaryDirty.value || !financeStore.isCentral(props.kind))
    return
  const input = verificationInput.value
  if (!/^\d+(?:\.\d+)?$/.test(input.actualDueAmount) || !/^\d+(?:\.\d+)?$/.test(input.cumulativePayableAmount)) {
    warning('请明确填写两项非负累计金额，未知或空值不能作为零。')
    return
  }
  const edit = { actualDueAmount: Number(input.actualDueAmount), cumulativePayableAmount: Number(input.cumulativePayableAmount), basis: input.basis, fileIds: [...input.fileIds] }
  if (!isPaymentVerificationEdit(edit)) {
    warning('请核实累计可付不超过累计应付，并填写依据及选择实际已保存原件。')
    return
  }
  await persist('save', undefined, edit)
}
async function verifyExpenseClearance() {
  if (props.kind !== 'reimbursement' || !routeId.value || ordinaryDirty.value || !financeStore.isCentral(props.kind))
    return
  const edit = expenseClearanceEdit(clearanceInput.value)
  if (!edit) {
    warning('请明确选择原费用、逐项核定正金额和匹配依据，并采用实际已保存的替代原件；空值不能作为零。')
    return
  }
  await persist('save', undefined, undefined, edit)
}
async function saveClearanceOriginals() {
  if (!confirmedExpenseSource.value || !routeId.value || !pendingAttachments.value.length || pendingRemoveIds.value.length || pendingRestoreIds.value.length)
    return
  await persist('save', undefined, undefined, undefined, true)
}
function toggleAttachment(id: string) {
  if (confirmedExpenseSource.value) {
    warning('已确认原费用仅追加替代原件，原文件及缺件记录继续保留。')
    return
  }
  toggleExistingAttachment(id)
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
  if (!active || writeInFlight.value || loadingAction.value || savedReadPending.value || readingFiles.value || loading.value || recovering.value)
    return
  const generation = viewGeneration
  const scope = viewScope
  if (!validateRequired('confirm'))
    return
  const accepted = await confirm({
    variant: 'simple',
    title: '人工确认支付',
    message: '确认金额、日期、收款方、银行流水、回单和付款申请分摊均已人工核对？确认后将进入资金与合同已付汇总。',
    confirmLabel: '确认支付',
  })
  if (accepted && isCurrent(generation, scope))
    await persist('confirm')
}

async function unconfirmPayment() {
  const generation = viewGeneration
  const scope = viewScope
  if (!active || writeInFlight.value || loadingAction.value || savedReadPending.value || readingFiles.value || loading.value || recovering.value)
    return
  const id = routeId.value
  if (!id)
    return
  const accepted = await confirm({
    variant: 'simple',
    title: '撤回支付确认',
    message: '撤回后该笔支付立即退出项目资金、合同已付和付款申请累计已付。',
    confirmLabel: '撤回确认',
  })
  if (!accepted || !isCurrent(generation, scope))
    return
  loadingAction.value = 'unconfirmPayment'
  const sentDraft = captureFinanceInput(draft.value)
  writeInFlight.value = true
  try {
    const result = await financeStore.unconfirmPayment(id, centralSession.value ?? undefined)
    if (scope !== viewScope)
      return
    const pending = { result, kind: 'payment_record' as const, scope, draft: sentDraft, files: { add: [], removeIds: [], restoreIds: [] } }
    savedReadPending.value = pending
    if (!isCurrent(generation, scope))
      return
    if (!result.readbackConfirmed) {
      readbackError.value = result.readbackProblem || '撤回确认已完成，同一支付记录尚未可靠读取'
      return
    }
    try {
      await settleSavedRead(pending, generation)
    }
    catch (cause) {
      if (isCurrent(generation, scope))
        readbackError.value = toErrorMessage(cause)
      return
    }
    if (!isCurrent(generation, scope))
      return
    success('已撤回支付确认')
  }
  catch (cause) {
    if (isCurrent(generation, scope))
      error(`撤回失败：${toErrorMessage(cause)}`)
  }
  finally {
    writeInFlight.value = false
    if (isCurrent(generation, scope))
      loadingAction.value = null
  }
}

async function leaveToList() {
  const generation = viewGeneration
  const scope = viewScope
  if (writeInFlight.value || loadingAction.value || recovering.value) {
    warning('当前操作仍在处理中，请等待结果。')
    return
  }
  if (dirty.value) {
    const accepted = await confirm({
      variant: 'simple',
      title: '放弃修改',
      message: '当前表单还有未保存内容，确认放弃并返回列表？',
      confirmLabel: '放弃修改',
    })
    if (!accepted || !isCurrent(generation, scope))
      return
  }
  allowLeave = true
  invalidateView()
  tabsStore.close(pageKey)
  await navigateTo(meta.value.listPath)
}

async function canLeave() {
  if (allowLeave)
    return true
  if (writeInFlight.value || loadingAction.value || recovering.value) {
    warning('当前操作仍在处理中，请等待结果。')
    return false
  }
  if (!dirty.value)
    return true
  const generation = viewGeneration
  const scope = viewScope
  const accepted = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  return accepted && isCurrent(generation, scope)
}
useTabCloseGuard(canLeave)
onBeforeRouteLeave(async () => {
  const accepted = await canLeave()
  if (accepted)
    invalidateView()
  return accepted
})
onBeforeRouteUpdate(async () => {
  const accepted = await canLeave()
  if (accepted)
    invalidatePreparation()
  return accepted
})
onDeactivated(invalidateView)
onBeforeUnmount(invalidateView)
onActivated(() => {
  active = true
  if (mounted && savedReadPending.value)
    readbackError.value ||= '本次已保存，请只重试同一记录读取'
})
watch(() => [props.kind, routeId.value] as const, () => {
  if (active && scopeKey() !== viewScope) {
    savedReadPending.value = null
    readbackError.value = ''
    void initialize()
  }
})
function invalidateReadFacts(message: string) {
  ++viewGeneration
  viewScope = scopeKey()
  loading.value = false
  loadingAction.value = null
  invalidatePreparation()
  if (financeStore.isCentral(props.kind) && centralSession.value)
    financeStore.invalidateForm(props.kind, centralSession.value)
  sourceError.value = message
  draft.value = { ...draft.value, paymentVerification: undefined, clearanceVerification: undefined }
}
bindReadAuthority(problem => invalidateReadFacts(problem.message))
watch(() => visibility.includeDemo, () => invalidateReadFacts('数据来源已变化，原输入与附件继续保留；请恢复原来源后核对原提交或重试读取。'))

onMounted(() => {
  mounted = true
  void initialize()
})
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
      <section v-if="centralPending && !savedReadPending" class="mb-4 min-w-0 rounded-[var(--radius-card)] border border-warn/30 bg-warn-soft p-4" aria-label="财务原提交待核对">
        <p class="text-13px font-700">
          {{ centralPending.result ? '原提交已保存，待读取核对' : '原提交结果未知，请核对原编号' }}
        </p>
        <p class="mt-1 break-words text-12px">
          {{ sourceError || '原输入及附件继续保留，核对完成前不能再次保存。' }}
        </p>
        <KitButton class="mt-2" type="button" variant="secondary" :loading="recovering" :disabled="recovering || writeInFlight" @click="recoverOriginalCommand">
          核对原提交
        </KitButton>
      </section>
      <section v-else-if="sourceError && !savedReadPending" class="mb-4 min-w-0 rounded-[var(--radius-card)] border border-warn/30 bg-warn-soft p-4" aria-label="财务来源待核实">
        <p class="break-words text-12px">
          {{ sourceError }}
        </p>
        <KitButton class="mt-2" type="button" variant="secondary" :loading="recovering" :disabled="recovering || writeInFlight" @click="retrySourceRead">
          重试读取来源
        </KitButton>
      </section>
      <section v-if="savedReadPending" class="mb-4 min-w-0 rounded-[var(--radius-card)] border border-warn/30 bg-warn-soft p-4" aria-label="财务记录已保存待刷新">
        <p class="text-13px font-700">
          本次已保存，尚未完成读取核对
        </p>
        <p class="mt-1 break-words text-12px">
          {{ readbackError || '原输入及附件继续保留，请只重试读取。' }}
        </p>
        <KitButton class="mt-2" type="button" variant="secondary" :loading="recovering" :disabled="recovering" @click="recoverSavedRead">
          只重试读取
        </KitButton>
      </section>
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
          :disabled="writeInFlight || !!loadingAction || !!savedReadPending || !!centralPending || !!sourceError || readingFiles || loading || recovering"
          data-testid="unconfirm-payment"
          @click="unconfirmPayment"
        >
          撤回确认
        </KitButton>
        <KitButton
          v-else
          :loading="loadingAction === 'confirmPayment'"
          :disabled="writeInFlight || !!loadingAction || !!savedReadPending || !!centralPending || !!sourceError || readingFiles || loading || recovering"
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
          <strong class="mt-1 block font-mono text-16px text-ok-deep">+¥{{ financeDraftMoney(draft.amount) }}</strong>
        </div>
      </section>

      <form class="flex min-w-0 flex-col gap-4" data-testid="finance-form" @submit.prevent>
        <FinanceFormFields
          :kind="kind"
          :draft="draft"
          :field-errors="fieldErrors"
          :fetch-projects="fetchProjects"
          :fetch-construction-mains="kind === 'reimbursement' ? fetchConstructionMains : undefined"
          :fetch-customers="fetchCustomers"
          :fetch-suppliers="fetchSuppliers"
          :fetch-workers="fetchWorkers"
          :fetch-original-expenses="fetchOriginalExpenses"
          :fetch-income-contracts="fetchIncomeContracts"
          :fetch-expense-contracts="fetchExpenseContracts"
          :fetch-settlements="fetchSettlements"
          :fetch-invoices="fetchInvoices"
          :fetch-payment-applications="fetchPaymentApplications"
          @patch="patchDraft"
          @clear-error="clearFieldError"
        />

        <section v-if="kind === 'reimbursement' && draft.id && centralSession?.context?.capabilities.includes('construction-scope:read')" class="panel min-w-0 space-y-3 p-4" aria-label="原费用施工归属">
          <SectionHeader title="原费用施工归属" subtitle="新建费用与工程归属一起保存，每条只对应一份施工主合同；历史补充或后来改关联使用此处独立原编号，共用费用先拆原明细。" />
          <ConstructionScopeSelector v-for="line in (draft.lines ?? []).filter(row => row.id && !row.originalExpenseLineId)" :key="line.id" :source="{ domain: 'original-expense', id: line.id! }" :disabled-reason="ordinaryDirty || sourceError || loading || writeInFlight || savedReadPending || centralPending || recovering ? '先保存并可靠读取原费用，保留当前输入与原提交编号。' : undefined" />
          <p v-if="!(draft.lines ?? []).some(row => row.id && !row.originalExpenseLineId)" class="text-sm text-ink-soft">
            保存真实原费用明细后核对施工归属；清偿行沿原费用引用，不另建一笔费用。
          </p>
        </section>

        <FinancePaymentVerificationSection
          v-if="kind === 'payment_application' && draft.paymentVerification?.required"
          v-model="verificationInput"
          :state="sourceError ? undefined : draft.paymentVerification"
          :attachments="sourceError ? [] : attachments"
          :unsaved="ordinaryDirty"
          :disabled="!financeStore.isCentral(kind) || !!sourceError || loading || writeInFlight || !!loadingAction || !!savedReadPending || !!centralPending || recovering"
          @verify="verifyPaymentBasis"
        />

        <FinanceExpenseClearanceVerificationSection
          v-if="kind === 'reimbursement' && !sourceError && draft.clearanceVerification"
          v-model="clearanceInput"
          :state="draft.clearanceVerification"
          :attachments="attachments"
          :unsaved="ordinaryDirty"
          :disabled="!financeStore.isCentral(kind) || !!sourceError || loading || writeInFlight || !!loadingAction || !!savedReadPending || !!centralPending || recovering"
          @verify="verifyExpenseClearance"
        />

        <FileRefAttachmentSection
          :attachments="sourceError ? [] : attachments"
          :pending-attachments="pendingAttachments"
          :pending-remove-ids="pendingRemoveIds"
          :pending-restore-ids="pendingRestoreIds"
          :desktop-picker="desktopAttachmentPicker"
          can-download
          picker-description="读取真实文件正文，与本次资料一起保存；旧元数据不补造原件"
          :title="kind === 'payment_record' ? '付款回单与备注' : '附件与备注'"
          :note="draft.note ?? ''"
          @pick-native="pickNativeFiles"
          @files="handleFiles"
          @toggle-existing="toggleAttachment"
          @remove-pending="removePending"
          @patch-pending="patchPending"
          @update-note="patchDraft({ note: $event })"
          @download="downloadFile"
        />

        <KitButton
          v-if="confirmedExpenseSource"
          type="button"
          :disabled="!pendingAttachments.length || writeInFlight || !!savedReadPending || !!centralPending || !!sourceError || readingFiles || loading || recovering"
          @click="saveClearanceOriginals"
        >
          保存新增替代原件
        </KitButton>

        <FormFooter
          v-model="closeAfterSave"
          :dirty="ordinaryDirty"
          close-after-save
          :loading-action="footerLoadingAction"
          :write-disabled="writeInFlight || !!savedReadPending || !!centralPending || !!sourceError || readingFiles || loading || recovering"
          @action="handleFooterAction"
        />
      </form>
    </EntityFormShell>
  </div>
</template>
