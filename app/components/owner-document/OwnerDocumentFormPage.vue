<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { FormFooterAction } from '~/lib/master-data/page'
import type { OwnerCommercialDocumentFormReadDTO } from '~/lib/owner-document/central-command-contract'
import type {
  OwnerDocumentBoqLine,
  OwnerDocumentDraft,
  OwnerDocumentKind,
  OwnerDocumentSaveAction,
} from '~/lib/owner-document/forms'
import { useDebounceFn } from '@vueuse/core'
import KitButton from '~/components/ui/KitButton.vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { OwnerCommercialDocumentRepositoryProblem } from '~/lib/owner-document/central-repository'
import {
  ownerDocumentFormCanRebase,
  rebaseOwnerDocumentFormVersion,
  withOwnerDocumentFormVersion,
} from '~/lib/owner-document/form-version'
import { ownerDocumentStatusIsEditable } from '~/lib/owner-document/forms'
import {
  ownerDocumentStatusClass,
  ownerDocumentStatusLabelForList,
} from '~/lib/owner-document/list'
import {
  OWNER_DOCUMENT_META,
  ownerDocumentDefaults,
  ownerDocumentFormPath,
  ownerDocumentTotalAmount,
  validateOwnerDocumentForm,
} from '~/lib/owner-document/page'
import {
  validateOwnerDocumentDetailReturnTo,
  validateOwnerDocumentJourneyReturnTo,
} from '~/lib/owner-document/return-context'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { isQuantityBasis } from '~/lib/quantity/basis'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  kind: OwnerDocumentKind
}>()

const route = useRoute()
const router = useRouter()
const store = useOwnerDocumentStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()

const meta = computed(() => OWNER_DOCUMENT_META[props.kind])
const routeId = computed(() => {
  const value = route.params.id
  const id = Array.isArray(value) ? value[0] : value
  return id === 'new' ? undefined : id
})
const isEditing = computed(() => Boolean(routeId.value))
const hasReturnTarget = computed(() => Boolean(route.query?.returnTo))
const returnTarget = computed(() => {
  if (props.kind !== 'owner_change' && props.kind !== 'owner_report'
    && props.kind !== 'acceptance' && props.kind !== 'owner_penalty' && props.kind !== 'sub_change' && props.kind !== 'sub_settlement' && props.kind !== 'project_penalty') {
    return meta.value.listPath
  }
  return validateOwnerDocumentDetailReturnTo(route.query?.returnTo, 'real', props.kind)
    ?? validateOwnerDocumentJourneyReturnTo(route.query?.returnTo, props.kind, 'real')
    ?? meta.value.listPath
})
const pageFullPath = route.fullPath
const pageKey = deriveKey(pageFullPath)

const draft = ref<OwnerDocumentDraft>(ownerDocumentDefaults(props.kind))
const boqLines = shallowRef<OwnerDocumentBoqLine[]>([])
const {
  attachments,
  pendingAttachments,
  pendingRemoveIds,
  pendingRestoreIds,
  desktopAttachmentPicker,
  readingFiles,
  dirty: attachmentsDirty,
  reset: resetAttachments,
  clearPending: clearPendingAttachments,
  changes: attachmentChanges,
  capture: captureAttachments,
  acknowledge: acknowledgeAttachments,
  handleFiles,
  pickNativeFiles,
  toggleExisting: toggleExistingAttachment,
  removePending,
  patchPending,
} = useOwnerDocumentFormAttachments({
  defaultCategory: () => props.kind === 'acceptance'
    ? ['accepted', 'warranty', 'expired'].includes(String(draft.value.status ?? ''))
        ? 'warranty-confirmation'
        : 'acceptance-report'
    : '业务附件',
})
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(false)
const loadError = shallowRef('')
const eligibleContractCount = shallowRef<number | null>(null)
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = shallowRef(true)
const savedSnapshot = shallowRef('')
const conflictReadOnly = shallowRef(false)
const deletionVerification = shallowRef<OwnerCommercialDocumentFormReadDTO['deletionVerification'] | null>(null)
const sourceConflict = shallowRef('')
const commandPending = computed(() => store.pendingCommand(props.kind, routeId.value ?? null))
const recoveryBusy = shallowRef(false)
let submittedInput: string | null = null
let submittedFiles: ReturnType<typeof captureAttachments> | null = null
let pageReadGeneration = 0
let preserveOnReload = false
let hydratedOnce = false
const inputSnapshot = () => JSON.stringify({ draft: Object.fromEntries(Object.entries(draft.value).filter(([key]) => key !== 'id' && !key.startsWith('_central'))), attachments: attachmentChanges() })
let allowLeave = false
bindReadAuthority((problem) => {
  pageReadGeneration++
  preserveOnReload = hydratedOnce
  loadError.value = problem.message
  boqLines.value = []
  loading.value = false
})

async function completeCentralLifecycle() {
  allowLeave = true
  const failure = await router.push(returnTarget.value)
  if (!failure)
    tabsStore.close(pageKey)
}

async function recoverCentralConflict(cause: unknown): Promise<boolean> {
  if (!(cause instanceof OwnerCommercialDocumentRepositoryProblem) || cause.problem.code !== 'conflict')
    return false
  const id = routeId.value ?? draft.value.id
  if (!id)
    return false
  const localDraft = JSON.parse(JSON.stringify(draft.value)) as OwnerDocumentDraft
  const latestDraft = await store.loadOne(props.kind, id)
  if (!latestDraft)
    return false
  const canRebase = ownerDocumentFormCanRebase(localDraft, latestDraft)
  const keepLocal = await confirm({
    variant: 'simple',
    title: '单据已有新版本',
    message: canRebase
      ? '已读取中央最新版本。请选择保留本页内容并基于最新版重试，或改用服务器最新版。'
      : '中央最新版本已进入不可编辑阶段，本页旧明细不能用于后续签证或审定。可暂时保留为只读内容以便核对、复制，或改用服务器最新版。',
    confirmLabel: canRebase ? '保留我的内容' : '保留本页供复制',
    cancelLabel: '改用服务器最新版',
  })
  if (keepLocal) {
    if (!canRebase) {
      conflictReadOnly.value = true
      warning('当前仅保留冲突前的本页内容供核对、复制，所有保存与生命周期操作已停用')
      return true
    }
    const serverSnapshot = { ...ownerDocumentDefaults(props.kind), ...latestDraft }
    draft.value = rebaseOwnerDocumentFormVersion(localDraft, serverSnapshot)
    savedSnapshot.value = JSON.stringify(serverSnapshot)
    warning('已基于中央最新版本保留本页内容，请核对后重新操作')
  }
  else {
    await initialize()
    warning('已改用中央最新版本，请核对后重新操作')
  }
  return true
}

const status = computed(() => String(draft.value.status ?? 'draft'))
const acceptanceAttachmentCategory = computed(() => ['accepted', 'warranty', 'expired'].includes(status.value)
  ? 'warranty-confirmation'
  : 'acceptance-report')
const visibleAttachments = computed(() => props.kind === 'acceptance'
  ? attachments.value.filter(file => file.category === acceptanceAttachmentCategory.value)
  : attachments.value)
const editable = computed(() => !conflictReadOnly.value && !commandPending.value && ownerDocumentStatusIsEditable(status.value))
const title = computed(() =>
  `${isEditing.value ? (editable.value ? '编辑' : '查看') : '新建'} · ${meta.value.label}`,
)
useTabTitle(title)
const {
  loading: lifecycleLoading,
  penaltyDeductions,
  deductionSettlementId,
  deductionAmount,
  deductionNote,
  auditMode,
  canApproveChange,
  canDeductPenalty,
  acceptanceAction,
  refreshDeductions,
  fetchSettlements,
  approveChange,
  moveAcceptance,
  auditReport,
  deductPenalty,
} = useOwnerDocumentLifecycle({
  kind: () => props.kind,
  draft,
  routeId,
  label: computed(() => meta.value.label),
  refresh: initialize,
  complete: completeCentralLifecycle,
  recoverConflict: recoverCentralConflict,
  acceptanceAttachments: attachmentChanges,
  clearAcceptanceAttachments: clearPendingAttachments,
})
const dirty = computed(() =>
  JSON.stringify(draft.value) !== savedSnapshot.value
  || attachmentsDirty.value,
)
const footerActions = computed<FormFooterAction[]>(() =>
  conflictReadOnly.value
  || commandPending.value
    ? ['cancel']
    : editable.value
      ? ['cancel', 'draft', 'saveSubmit']
      : props.kind === 'acceptance'
        ? ['cancel']
        : ['cancel', 'save'],
)
const attachmentsReadonly = computed(() => conflictReadOnly.value
  || Boolean(commandPending.value)
  || (props.kind === 'acceptance' && status.value === 'expired'))
const footerLabels = computed(() => ({
  saveSubmit: meta.value.postLabel,
  save: '保存附件',
}))
const desktopPenaltyActions = isDesktopRuntime()
const sections = computed(() => {
  if (
    props.kind !== 'project_penalty'
    || !desktopPenaltyActions
    || (!canDeductPenalty.value && penaltyDeductions.value.length === 0)
  ) {
    return meta.value.sections
  }
  const attachments = meta.value.sections.find(section => section.key === 'attachments')
  return [
    ...meta.value.sections.filter(section => section.key !== 'attachments'),
    { key: 'deduction', label: '结算抵扣' },
    ...(attachments ? [attachments] : []),
  ]
})
const pageState = computed(() => {
  if (loading.value)
    return 'loading'
  return loadError.value ? 'error' : 'ready'
})

async function basicLookup(
  kind: 'crew' | 'project' | 'supplier',
  keyword: string,
): Promise<LookupOption[]> {
  return store.loadBasicOptions(kind, keyword, props.kind)
}

const fetchProjects = (keyword: string) => basicLookup('project', keyword)
const fetchSuppliers = (keyword: string) => basicLookup('supplier', keyword)
const fetchCrews = (keyword: string) => basicLookup('crew', keyword)

async function fetchContracts(keyword: string): Promise<LookupOption[]> {
  const projectId = typeof draft.value.projectId === 'string'
    ? draft.value.projectId
    : ''
  if (!projectId)
    return []
  const ownerSide = props.kind.startsWith('owner_')
    || props.kind === 'acceptance'
    || props.kind === 'final_settlement'
  const supplierId = typeof draft.value.supplierId === 'string'
    ? draft.value.supplierId
    : ''
  return store.loadContractOptions(
    projectId,
    ownerSide ? 'owner' : 'expenditure',
    supplierId,
    keyword,
  )
}

let contractAvailabilitySequence = 0
async function refreshContractAvailability() {
  if (conflictReadOnly.value || deletionVerification.value)
    return
  const sequence = ++contractAvailabilitySequence
  if (!draft.value.projectId) {
    eligibleContractCount.value = null
    return
  }
  eligibleContractCount.value = null
  try {
    const options = await fetchContracts('')
    if (sequence === contractAvailabilitySequence && !conflictReadOnly.value && !deletionVerification.value)
      eligibleContractCount.value = options.length
  }
  catch {
    if (sequence === contractAvailabilitySequence && !conflictReadOnly.value && !deletionVerification.value)
      eligibleContractCount.value = null
  }
}

let boqSequence = 0
let pageActive = true
const boqIdentity = () => JSON.stringify([route.fullPath, props.kind, draft.value.projectId, draft.value.contractId, draft.value.periodNo, draft.value.quantityBasis])
const refreshBoqLines = useDebounceFn(async () => {
  if (!pageActive || conflictReadOnly.value || deletionVerification.value || route.fullPath !== pageFullPath)
    return
  const sequence = ++boqSequence
  const identity = boqIdentity()
  const projectId = typeof draft.value.projectId === 'string' ? draft.value.projectId : ''
  const contractId = typeof draft.value.contractId === 'string' ? draft.value.contractId : ''
  if (!projectId || !contractId || !['owner_change', 'owner_report'].includes(props.kind)
    || (props.kind === 'owner_report' && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(draft.value.periodNo ?? '')))) {
    boqLines.value = []
    return
  }
  try {
    const rows = await store.loadBoqLines(
      projectId,
      contractId,
      props.kind === 'owner_report' ? String(draft.value.periodNo ?? '') : '',
      props.kind === 'owner_report' && !isDesktopRuntime() && isQuantityBasis(draft.value.quantityBasis) ? draft.value.quantityBasis : undefined,
    )
    if (!pageActive || conflictReadOnly.value || deletionVerification.value || sequence !== boqSequence || identity !== boqIdentity() || route.fullPath !== pageFullPath)
      return
    boqLines.value = rows
    if (editable.value) {
      if (props.kind === 'owner_report' && rows.length) {
        const evidence = rows[0]!
        if (rows.some(row => row.quantityConsumedVersion !== evidence.quantityConsumedVersion || row.quantitySourceVersion !== evidence.quantitySourceVersion))
          throw new Error('报量取数明细不属于同一次真实读取，请保留当前草稿')
        if (evidence.quantityConsumedVersion && evidence.quantitySourceVersion) {
          draft.value = { ...draft.value, quantityConsumedVersion: evidence.quantityConsumedVersion, quantitySourceVersion: evidence.quantitySourceVersion, quantitySourceUpdatedAt: evidence.quantitySourceUpdatedAt ?? null }
          sourceConflict.value = ''
        }
      }
      const current = draft.value.lines ?? []
      const byId = new Map(boqLines.value.map(line => [line.id, line]))
      const lines = props.kind === 'owner_report' && !current.length
        ? boqLines.value
            // 当前期次事实中的明确零和缺量行都保留，缺量不预填为已确认申报量。
            .map(line => ({
              boqLineId: line.id,
              itemName: line.itemName,
              unit: line.unit,
              autoQty: line.autoQty,
              reportedQty: line.missingQtyCount > 0 ? null : line.autoQty,
              auditedQty: null,
              qty: line.qty,
              unitPrice: line.unitPrice,
              note: '',
            }))
        : current.map((line) => {
            if (props.kind === 'owner_change' && line.operation === 'add')
              return line
            const boqLine = byId.get(String(line.boqLineId ?? ''))
            return boqLine
              ? {
                  ...line,
                  itemName: boqLine.itemName,
                  unit: boqLine.unit,
                  qty: boqLine.qty,
                  unitPrice: boqLine.unitPrice,
                  ...(props.kind === 'owner_report' ? { autoQty: boqLine.autoQty } : {}),
                }
              : line
          })
      if (lines.length)
        patchLines(lines)
    }
    return true
  }
  catch (cause) {
    if (!pageActive || conflictReadOnly.value || deletionVerification.value || sequence !== boqSequence || identity !== boqIdentity() || route.fullPath !== pageFullPath)
      return
    boqLines.value = []
    error(`载入合同清单失败：${toErrorMessage(cause)}`)
    return false
  }
}, 150)

let contractSummarySequence = 0
const contractSummaryIdentity = () => JSON.stringify([route.fullPath, props.kind, draft.value.id, draft.value.projectId, draft.value.supplierId, draft.value.contractId])
const refreshContractSummary = useDebounceFn(async () => {
  if (!pageActive || conflictReadOnly.value || deletionVerification.value || route.fullPath !== pageFullPath)
    return
  const sequence = ++contractSummarySequence
  const identity = contractSummaryIdentity()
  const isCurrent = () => pageActive && !conflictReadOnly.value && !deletionVerification.value && sequence === contractSummarySequence
    && identity === contractSummaryIdentity() && route.fullPath === pageFullPath
  const contractId = typeof draft.value.contractId === 'string'
    ? draft.value.contractId
    : ''
  if (!contractId) {
    if (props.kind === 'final_settlement') {
      draft.value = {
        ...draft.value,
        changedContractAmount: null,
        receivedAmount: null,
        settlementReceiptGap: null,
      }
    }
    if (props.kind === 'sub_settlement') {
      draft.value = {
        ...draft.value,
        contractAmount: null,
        priorSettlementAmount: null,
        settlementRatio: null,
      }
    }
    return
  }
  if (props.kind === 'final_settlement') {
    const summary = await store.loadContractSummary(contractId, '', 'central-owner')
    if (!isCurrent() || !summary)
      return
    const settlementAmount = Number(draft.value.settlementAmount) || 0
    draft.value = {
      ...draft.value,
      changedContractAmount: summary.contractAmount,
      receivedAmount: summary.receivedAmount,
      settlementReceiptGap: summary.receivedAmount == null
        ? null
        : Math.round((settlementAmount - summary.receivedAmount) * 100) / 100,
    }
  }
  if (props.kind === 'sub_settlement') {
    const summary = await store.loadContractSummary(contractId, routeId.value ?? '', 'central-subcontract')
    if (!isCurrent() || !summary)
      return
    const contractAmount = summary.contractAmount
    const totalAmount = Number(draft.value.totalAmount) || 0
    draft.value = {
      ...draft.value,
      contractAmount,
      priorSettlementAmount: summary.priorSettlementAmount,
      settlementRatio: contractAmount != null && contractAmount > 0
        ? `${(totalAmount / contractAmount * 100).toFixed(2)}%`
        : '—',
    }
  }
}, 150)

function retainDeletedRead(form: OwnerCommercialDocumentFormReadDTO): boolean {
  if (form.readOnly !== true)
    return false
  pageReadGeneration += 1
  boqSequence += 1
  contractSummarySequence += 1
  contractAvailabilitySequence += 1
  sourceConflict.value = ''
  boqLines.value = []
  eligibleContractCount.value = null
  loading.value = false
  deletionVerification.value = form.deletionVerification ?? null
  conflictReadOnly.value = true
  draft.value = { ...ownerDocumentDefaults(props.kind), ...form.draft }
  resetAttachments(form.attachments)
  savedSnapshot.value = JSON.stringify(draft.value)
  submittedInput = null
  submittedFiles = null
  hydratedOnce = true
  return true
}

async function initialize() {
  const generation = ++pageReadGeneration
  const preserve = preserveOnReload
  loading.value = true
  loadError.value = ''
  fieldErrors.value = {}
  eligibleContractCount.value = null
  try {
    const id = routeId.value
    const hydrated = await store.hydrateCommand(props.kind, id ?? null)
    if (generation !== pageReadGeneration || route.fullPath !== pageFullPath)
      return
    if (hydrated?.form && retainDeletedRead(hydrated.form))
      return
    deletionVerification.value = null
    if (preserve) {
      if (hydrated?.form && hydrated.recovered) {
        draft.value = withOwnerDocumentFormVersion({ ...draft.value, id: hydrated.form.id }, hydrated.form.version)
        if (!ownerDocumentStatusIsEditable(String(hydrated.form.draft.status ?? 'draft')))
          conflictReadOnly.value = true
        if (submittedFiles)
          acknowledgeAttachments(hydrated.form.attachments, submittedFiles)
        submittedInput = null
        submittedFiles = null
      }
      await refreshBoqLines()
      await refreshContractAvailability()
      preserveOnReload = false
      return
    }
    if (hydrated?.form) {
      draft.value = { ...ownerDocumentDefaults(props.kind), ...hydrated.form.draft }
      resetAttachments(hydrated.form.attachments)
      await refreshDeductions(hydrated.form.id)
    }
    else if (!id) {
      draft.value = ownerDocumentDefaults(props.kind)
      resetAttachments()
      await refreshDeductions()
    }
    else {
      const [record, files] = await Promise.all([
        store.loadOne(props.kind, id),
        store.loadAttachments(props.kind, id, true),
        refreshDeductions(id),
      ])
      if (generation !== pageReadGeneration || route.fullPath !== pageFullPath)
        return
      if (!record) {
        error(`${meta.value.label}不存在或已删除`)
        allowLeave = true
        await navigateTo(returnTarget.value)
        return
      }
      draft.value = {
        ...ownerDocumentDefaults(props.kind),
        ...record,
      }
      resetAttachments(files)
    }
    await refreshBoqLines()
    await refreshContractSummary()
    await refreshContractAvailability()
    if (generation !== pageReadGeneration || deletionVerification.value)
      return
    updateDerivedAmounts()
    await nextTick()
    if (generation !== pageReadGeneration || deletionVerification.value)
      return
    savedSnapshot.value = JSON.stringify(draft.value)
    hydratedOnce = true
    conflictReadOnly.value = false
  }
  catch (cause) {
    if (generation !== pageReadGeneration)
      return
    loadError.value = toErrorMessage(cause)
    error(`载入失败：${loadError.value}`)
  }
  finally {
    if (generation === pageReadGeneration)
      loading.value = false
  }
}

async function patchDraft(patch: Partial<OwnerDocumentDraft>) {
  if (deletionVerification.value || (props.kind === 'owner_report' && !editable.value))
    return
  const previous = draft.value
  const basisChanged = props.kind === 'owner_report'
    && 'quantityBasis' in patch && patch.quantityBasis !== previous.quantityBasis
  if (basisChanged && (previous.lines?.length ?? 0) > 0) {
    const accepted = await confirm({
      variant: 'simple',
      title: '更换报量基准',
      message: '更换基准将重新生成全部报量明细，并清除已有手工申报量。请核对后确认。',
      confirmLabel: '确认重算',
      cancelLabel: '保留原稿',
    })
    if (!accepted || draft.value !== previous || !editable.value || route.fullPath !== pageFullPath)
      return
  }
  const next = { ...previous, ...patch }
  const relationships = ['projectId', 'contractId', 'supplierId', 'crewId', 'customerId']
  const changed = relationships.filter(field => field in patch && patch[field] !== previous[field])
  if (changed.length && !isDesktopRuntime()) {
    let versions: Record<string, { id: string, version: string }> = {}
    if (typeof previous.relationshipVersionsJson === 'string') {
      try {
        versions = JSON.parse(previous.relationshipVersionsJson)
      }
      catch { throw new Error('原关系采用证据不能读取，请保留草稿重新核对') }
    }
    for (const field of changed) {
      const id = typeof patch[field] === 'string' ? patch[field] as string : null
      const selected = id ? store.lookupVersion(field, id) : null
      if (selected)
        versions[field] = selected
      else delete versions[field]
    }
    if ('projectId' in patch) {
      delete versions.contractId
      delete versions.customerId
      if (!next.projectId)
        delete versions.supplierId
    }
    if ('supplierId' in patch)
      delete versions.contractId
    next.relationshipVersionsJson = JSON.stringify(versions)
  }
  if (basisChanged)
    next.lines = []
  if ('projectId' in patch) {
    next.contractId = null
    if (!next.projectId)
      next.supplierId = null
  }
  if ('supplierId' in patch)
    next.contractId = null
  draft.value = next
  if (basisChanged)
    updateDerivedAmounts()
  if ('projectId' in patch || 'contractId' in patch || 'periodNo' in patch || 'quantityBasis' in patch) {
    delete draft.value.quantityConsumedVersion
    delete draft.value.quantitySourceVersion
    delete draft.value.quantitySourceUpdatedAt
    boqSequence += 1
    boqLines.value = []
    void refreshBoqLines()
  }
  if ('projectId' in patch || 'supplierId' in patch)
    void refreshContractAvailability()
  if (
    'projectId' in patch
    || 'contractId' in patch
    || 'totalAmount' in patch
    || 'settlementAmount' in patch
  ) {
    void refreshContractSummary()
  }
}

function patchLines(lines: Array<Record<string, unknown>>) {
  if (conflictReadOnly.value || deletionVerification.value)
    return
  draft.value = { ...draft.value, lines }
  clearFieldError('lines')
  updateDerivedAmounts()
}

function updateDerivedAmounts() {
  if (conflictReadOnly.value || deletionVerification.value)
    return
  const lines = draft.value.lines ?? []
  const amount = ownerDocumentTotalAmount(props.kind, lines)
  if (props.kind === 'owner_change')
    draft.value = { ...draft.value, totalAmount: amount }
  if (props.kind === 'owner_report')
    draft.value = { ...draft.value, reportedAmount: amount }
}

function clearFieldError(field: string) {
  if (!fieldErrors.value[field])
    return
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

function focusFirstFieldError(errors: Record<string, string>) {
  const firstField = Object.keys(errors)[0]
  if (!firstField)
    return
  void nextTick(() => {
    document
      .querySelector<HTMLElement>(`form [data-field="${firstField}"]`)
      ?.focus()
  })
}

function applyCentralFieldErrors(cause: unknown): boolean {
  if (!(cause instanceof OwnerCommercialDocumentRepositoryProblem))
    return false
  const errors: Record<string, string> = Object.fromEntries(
    Object.entries(cause.problem.fieldErrors)
      .map(([field, messages]) => [field, messages.filter(Boolean).join('；')])
      .filter(([, message]) => Boolean(message)),
  )
  if (!Object.keys(errors).length)
    return false
  fieldErrors.value = errors
  warning(cause.problem.message)
  focusFirstFieldError(errors)
  return true
}

function validateSubmit(): boolean {
  const errors = validateOwnerDocumentForm(props.kind, draft.value, boqLines.value)
  fieldErrors.value = errors
  const messages = Object.values(errors)
  if (messages.length) {
    warning(`${messages[0]}（共 ${messages.length} 处）`)
    focusFirstFieldError(errors)
  }
  return messages.length === 0
}

async function persist(action: OwnerDocumentSaveAction, footerAction: FormFooterAction) {
  if (conflictReadOnly.value || commandPending.value || readingFiles.value)
    return
  if (action === 'submit' && !validateSubmit())
    return
  if (action === 'submit') {
    const accepted = await confirm({
      variant: 'simple',
      title: meta.value.postLabel.replace('保存并', ''),
      message: meta.value.postMessage,
      confirmLabel: meta.value.postLabel.replace('保存并', ''),
    })
    if (!accepted)
      return
  }
  loadingAction.value = footerAction
  submittedInput = inputSnapshot()
  submittedFiles = captureAttachments()
  try {
    const result = await store.saveForm(
      props.kind,
      draft.value,
      action,
      attachmentChanges(),
    )
    success(action === 'submit' ? `${meta.value.postLabel.replace('保存并', '')}成功` : '草稿已保存')
    if (inputSnapshot() !== submittedInput || ('retainedInput' in result && result.retainedInput)) {
      if (result.form && submittedFiles)
        acknowledgeAttachments(result.form.attachments, submittedFiles)
      warning('原提交已保存并读回，保存期间的新输入保留在本页，请核对后继续')
      submittedInput = null
      submittedFiles = null
      return
    }
    submittedInput = null
    submittedFiles = null
    clearPendingAttachments()
    fieldErrors.value = {}
    if (action === 'submit' && closeAfterSave.value) {
      allowLeave = true
      tabsStore.close(pageKey)
      await navigateTo(returnTarget.value)
      return
    }
    allowLeave = true
    const sameRecord = routeId.value === result.id
    await navigateTo({
      path: ownerDocumentFormPath(props.kind, result.id),
      query: route.query?.returnTo ? { returnTo: String(route.query.returnTo) } : {},
    }, { replace: true })
    if (sameRecord)
      await initialize()
    allowLeave = false
  }
  catch (cause) {
    if (cause instanceof OwnerCommercialDocumentRepositoryProblem && cause.problem.code === 'stale-source') {
      sourceConflict.value = cause.problem.message
      warning('实际来源已变化；请重新读取依据并保留手工量后核对')
      return
    }
    if (await recoverCentralConflict(cause))
      return
    if (applyCentralFieldErrors(cause))
      return
    error(`保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
  }
}

async function recoverOriginalCommand() {
  recoveryBusy.value = true
  try {
    const result = await store.recoverCommand(props.kind, routeId.value ?? null)
    if (result.outcome === 'applied') {
      if (retainDeletedRead(result.form)) {
        loadError.value = ''
        return
      }
      const retain = submittedInput !== null && inputSnapshot() !== submittedInput
      if (retain) {
        draft.value = withOwnerDocumentFormVersion({ ...draft.value, id: result.form.id }, result.form.version)
        if (!ownerDocumentStatusIsEditable(String(result.form.draft.status ?? 'draft')))
          conflictReadOnly.value = true
        if (submittedFiles)
          acknowledgeAttachments(result.form.attachments, submittedFiles)
        warning('原提交已保存并读回，后来输入与附件保留在本页')
      }
      else {
        draft.value = { ...ownerDocumentDefaults(props.kind), ...result.form.draft }
        resetAttachments(result.form.attachments)
        savedSnapshot.value = JSON.stringify(draft.value)
        success('原提交已保存，已读取同一单据')
      }
    }
    else {
      warning('原编号已确认未应用并封存，当前输入保留，可重新核对后保存')
    }
    submittedInput = null
    submittedFiles = null
    loadError.value = ''
  }
  catch (cause) {
    error(toErrorMessage(cause))
  }
  finally {
    recoveryBusy.value = false
  }
}

async function refreshConsumedSources() {
  const original = draft.value
  const identity = boqIdentity()
  try {
    const versions = await store.refreshRelationshipVersions(props.kind, original)
    if (draft.value !== original || identity !== boqIdentity() || route.fullPath !== pageFullPath)
      return
    draft.value = { ...draft.value, relationshipVersionsJson: versions }
    if (props.kind === 'owner_report' && !await refreshBoqLines())
      throw new Error('报量依据未成功读取，旧采用版本与手工量保留')
    sourceConflict.value = ''
    warning('已读取当前关系与依据，手工输入保留；请核对后重新提交')
  }
  catch (cause) {
    sourceConflict.value = toErrorMessage(cause)
  }
}

async function saveFinalAttachments() {
  const id = routeId.value
  if (!id)
    return
  loadingAction.value = 'save'
  try {
    await store.saveAttachments(props.kind, id, attachmentChanges(), draft.value)
    success('附件已保存')
    await initialize()
  }
  catch (cause) {
    if (await recoverCentralConflict(cause))
      return
    if (applyCentralFieldErrors(cause))
      return
    error(`附件保存失败：${toErrorMessage(cause)}`)
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
  if (conflictReadOnly.value || commandPending.value || readingFiles.value)
    return
  if (!editable.value) {
    await saveFinalAttachments()
    return
  }
  await persist(action === 'saveSubmit' ? 'submit' : 'draft', action)
}

async function leaveToList() {
  if (dirty.value) {
    const leave = await confirm({
      variant: 'simple',
      title: '放弃修改',
      message: '当前表单还有未保存内容，确认放弃并返回列表？',
      confirmLabel: '放弃修改',
    })
    if (!leave)
      return
  }
  allowLeave = true
  tabsStore.close(pageKey)
  await navigateTo(returnTarget.value)
}

useTabCloseGuard(async () => {
  if (allowLeave || !dirty.value)
    return true
  const leave = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  return leave
})

onMounted(() => void initialize())
onDeactivated(() => {
  pageActive = false
  boqSequence += 1
  contractSummarySequence += 1
  boqLines.value = []
})
onActivated(() => {
  const returning = !pageActive
  pageActive = true
  if (returning) {
    void refreshBoqLines()
    void refreshContractSummary()
  }
})
</script>

<template>
  <EntityFormShell
    :title="title"
    :subtitle="kind === 'sub_settlement' ? '登记分包结算，核对合同、金额和附件后确认。' : `${meta.subtitle}；关联对象均保存真实 ID，附件与业务单据同事务提交。`"
    :back-label="hasReturnTarget ? '返回来源' : `返回${meta.label}`"
    :sections="sections"
    :state="pageState"
    :state-title="pageState === 'error' ? `${meta.label}载入失败` : `正在载入${meta.label}`"
    :state-description="loadError ? `无法载入${meta.label}：${loadError}` : ''"
    state-action-label="重新载入"
    @back="leaveToList"
    @state-action="initialize"
  >
    <template #status>
      <span v-if="deletionVerification" class="chip">已删除 · 只读核对</span>
      <span class="chip" :class="ownerDocumentStatusClass(kind, status)">
        {{ ownerDocumentStatusLabelForList(kind, status) }}
      </span>
    </template>

    <template #actions>
      <KitButton v-if="commandPending" :loading="recoveryBusy" @click="recoverOriginalCommand">
        {{ commandPending.result ? '重新读取已保存单据' : '核对原提交' }}
      </KitButton>
      <KitButton
        v-if="canApproveChange && !conflictReadOnly && !commandPending"
        :loading="lifecycleLoading"
        @click="approveChange"
      >
        <span class="i-lucide-badge-check mr-1" aria-hidden="true" />确认签证
      </KitButton>
      <KitButton
        v-if="auditMode && !conflictReadOnly && !commandPending"
        :loading="lifecycleLoading"
        @click="auditReport"
      >
        <span class="i-lucide-stamp mr-1" aria-hidden="true" />确认审定
      </KitButton>
      <KitButton
        v-if="acceptanceAction && !conflictReadOnly && !commandPending"
        :loading="lifecycleLoading"
        @click="moveAcceptance"
      >
        <span class="i-lucide-shield-check mr-1" aria-hidden="true" />{{ acceptanceAction.label }}
      </KitButton>
    </template>

    <form class="flex min-w-0 flex-col gap-4" @submit.prevent>
      <div v-if="sourceConflict" role="alert" class="flex flex-wrap items-center justify-between gap-3">
        <span>{{ sourceConflict }}</span>
        <KitButton @click="refreshConsumedSources">
          重新读取依据并保留手工量
        </KitButton>
      </div>
      <div v-if="commandPending" role="status" class="flex flex-wrap items-center justify-between gap-3">
        <span>{{ commandPending.result ? '已保存，等待重新读取同一单据。' : '原提交结果未知，请先核对原编号。' }}</span>
      </div>
      <div
        v-if="conflictReadOnly && !deletionVerification"
        role="status"
        class="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-warn/35 bg-warn-soft px-4 py-3 text-12px text-ink"
      >
        <span>中央最新版已进入不可编辑阶段；当前显示冲突前的本页内容，仅供核对和复制。</span>
        <KitButton size="sm" variant="secondary" @click="initialize">
          改用服务器最新版
        </KitButton>
      </div>

      <p v-if="deletionVerification" role="status" class="panel p-3 text-12px text-ink-soft">
        原单据已删除，当前仅供核对。可返回列表查看其他单据。
      </p>
      <OwnerDocumentFormFields
        :kind="kind"
        :draft="draft"
        :field-errors="fieldErrors"
        :eligible-contract-count="eligibleContractCount"
        :readonly="!editable"
        :quantity-basis-editable="!isDesktopRuntime() && kind === 'owner_report'"
        :fetch-projects="fetchProjects"
        :fetch-suppliers="fetchSuppliers"
        :fetch-contracts="fetchContracts"
        :fetch-crews="fetchCrews"
        @patch="patchDraft"
        @clear-error="clearFieldError"
      />

      <OwnerDocumentLineGrid
        v-if="kind === 'owner_change' || kind === 'owner_report'"
        :kind="kind"
        :lines="draft.lines ?? []"
        :boq-lines="boqLines"
        :readonly="!editable"
        :audit-mode="auditMode"
        :error="fieldErrors.lines"
        @update="patchLines"
        @clear-error="clearFieldError('lines')"
      />

      <section
        v-if="desktopPenaltyActions && kind === 'project_penalty' && (canDeductPenalty || penaltyDeductions.length)"
        id="section-deduction"
        class="panel scroll-mt-4 p-4"
      >
        <SectionHeader title="结算抵扣" />
        <div v-if="canDeductPenalty" class="form-fields-grid mt-3">
          <div class="field-block">
            <span class="field-label">分包结算 *</span>
            <LookupSelect
              v-model="deductionSettlementId"
              :fetch="fetchSettlements"
              recent-key="project-penalty-settlement"
              placeholder="检索可抵扣的分包结算"
            />
          </div>
          <label class="field-block">
            <span class="field-label">本次抵扣金额 *</span>
            <input v-model.number="deductionAmount" type="number" min="0.01" step="0.01" class="field-input w-full font-mono">
          </label>
          <label class="field-block form-span-full">
            <span class="field-label">抵扣说明</span>
            <textarea v-model="deductionNote" rows="2" class="field-input w-full" />
          </label>
          <div class="form-span-full flex justify-end">
            <KitButton :loading="lifecycleLoading" @click="deductPenalty">
              <span class="i-lucide-circle-minus mr-1" aria-hidden="true" />执行结算抵扣
            </KitButton>
          </div>
        </div>
        <div v-if="penaltyDeductions.length" class="mt-4 grid gap-2">
          <div
            v-for="item in penaltyDeductions"
            :key="item.id"
            class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2 text-12px"
          >
            <strong class="text-ink">{{ item.settlementNo }} · {{ item.settlementName }}</strong>
            <span class="font-mono font-700 text-danger">-¥{{ item.amount.toFixed(2) }}</span>
            <span class="text-ink-faint">{{ item.note || '无说明' }}</span>
            <span class="ml-auto text-ink-faint">{{ item.createdAt }}</span>
          </div>
        </div>
      </section>

      <FileRefAttachmentSection
        :attachments="visibleAttachments"
        :pending-attachments="pendingAttachments"
        :pending-remove-ids="pendingRemoveIds"
        :pending-restore-ids="pendingRestoreIds"
        :desktop-picker="desktopAttachmentPicker"
        picker-description="附件随当前单据保存，保存成功后可在详情中查看和下载"
        :note="String(draft.note ?? '')"
        :note-readonly="!editable"
        :category-readonly="kind === 'acceptance'"
        :readonly="attachmentsReadonly"
        @pick-native="pickNativeFiles"
        @files="handleFiles"
        @toggle-existing="toggleExistingAttachment"
        @remove-pending="removePending"
        @patch-pending="patchPending"
        @update-note="patchDraft({ note: $event })"
      />

      <FormFooter
        v-model="closeAfterSave"
        :actions="footerActions"
        :labels="footerLabels"
        :dirty="dirty"
        :close-after-save="editable"
        :loading-action="loadingAction"
        @action="handleFooterAction"
      />
    </form>
  </EntityFormShell>
</template>
