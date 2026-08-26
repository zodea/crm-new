<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type { FormFooterAction } from '~/lib/master-data/page'
import type {
  OwnerDocumentBoqLine,
  OwnerDocumentDraft,
  OwnerDocumentKind,
  OwnerDocumentSaveAction,
} from '~/lib/owner-document/forms'
import { useDebounceFn } from '@vueuse/core'
import { onBeforeRouteLeave } from 'vue-router'
import { OwnerCommercialDocumentRepositoryProblem } from '~/lib/owner-document/central-repository'
import {
  ownerDocumentFormCanRebase,
  rebaseOwnerDocumentFormVersion,
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
  ownerDocumentLineAmount,
  validateOwnerDocumentForm,
} from '~/lib/owner-document/page'
import {
  validateOwnerDocumentDetailReturnTo,
  validateOwnerDocumentJourneyReturnTo,
} from '~/lib/owner-document/return-context'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  kind: OwnerDocumentKind
}>()

const route = useRoute()
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
    && props.kind !== 'acceptance' && props.kind !== 'owner_penalty') {
    return meta.value.listPath
  }
  return validateOwnerDocumentDetailReturnTo(route.query?.returnTo, 'real')
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
  dirty: attachmentsDirty,
  reset: resetAttachments,
  clearPending: clearPendingAttachments,
  changes: attachmentChanges,
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
let allowLeave = false

async function completeCentralLifecycle() {
  allowLeave = true
  tabsStore.close(pageKey)
  await navigateTo(returnTarget.value)
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
const editable = computed(() => !conflictReadOnly.value && ownerDocumentStatusIsEditable(status.value))
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
    ? ['cancel']
    : editable.value
      ? ['cancel', 'draft', 'saveSubmit']
      : props.kind === 'acceptance'
        ? ['cancel']
        : ['cancel', 'save'],
)
const attachmentsReadonly = computed(() => conflictReadOnly.value
  || (props.kind === 'acceptance' && status.value === 'expired'))
const footerLabels = computed(() => ({
  saveSubmit: meta.value.postLabel,
  save: '保存附件',
}))
const sections = computed(() => {
  if (
    props.kind !== 'project_penalty'
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
  return store.loadBasicOptions(kind, keyword)
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
  const sequence = ++contractAvailabilitySequence
  if (!draft.value.projectId) {
    eligibleContractCount.value = null
    return
  }
  eligibleContractCount.value = null
  try {
    const options = await fetchContracts('')
    if (sequence === contractAvailabilitySequence)
      eligibleContractCount.value = options.length
  }
  catch {
    if (sequence === contractAvailabilitySequence)
      eligibleContractCount.value = null
  }
}

const refreshBoqLines = useDebounceFn(async () => {
  const projectId = typeof draft.value.projectId === 'string' ? draft.value.projectId : ''
  const contractId = typeof draft.value.contractId === 'string' ? draft.value.contractId : ''
  if (!projectId || !contractId || !['owner_change', 'owner_report'].includes(props.kind)) {
    boqLines.value = []
    return
  }
  try {
    boqLines.value = await store.loadBoqLines(
      projectId,
      contractId,
      props.kind === 'owner_report' ? String(draft.value.periodNo ?? '') : '',
    )
    if (editable.value) {
      const current = draft.value.lines ?? []
      const byId = new Map(boqLines.value.map(line => [line.id, line]))
      const lines = props.kind === 'owner_report' && !current.length
        ? boqLines.value
            // 缺量行自动量为 0，仍要带入并在网格标注，否则缺数会被悄悄漏报。
            .filter(line => line.autoQty > 0 || line.missingQtyCount > 0)
            .map(line => ({
              boqLineId: line.id,
              itemName: line.itemName,
              unit: line.unit,
              autoQty: line.autoQty,
              reportedQty: line.autoQty,
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
  }
  catch (cause) {
    boqLines.value = []
    error(`载入合同清单失败：${toErrorMessage(cause)}`)
  }
}, 150)

const refreshContractSummary = useDebounceFn(async () => {
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
    if (!summary)
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
    const summary = await store.loadContractSummary(contractId, routeId.value ?? '')
    if (!summary)
      return
    const contractAmount = summary.contractAmount ?? 0
    const totalAmount = Number(draft.value.totalAmount) || 0
    draft.value = {
      ...draft.value,
      contractAmount,
      priorSettlementAmount: summary.priorSettlementAmount,
      settlementRatio: contractAmount > 0
        ? `${(totalAmount / contractAmount * 100).toFixed(2)}%`
        : '—',
    }
  }
}, 150)

async function initialize() {
  loading.value = true
  loadError.value = ''
  fieldErrors.value = {}
  eligibleContractCount.value = null
  clearPendingAttachments()
  try {
    const id = routeId.value
    if (!id) {
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
    updateDerivedAmounts()
    await nextTick()
    savedSnapshot.value = JSON.stringify(draft.value)
    conflictReadOnly.value = false
  }
  catch (cause) {
    loadError.value = toErrorMessage(cause)
    error(`载入失败：${loadError.value}`)
  }
  finally {
    loading.value = false
  }
}

function patchDraft(patch: Partial<OwnerDocumentDraft>) {
  const next = { ...draft.value, ...patch }
  if ('projectId' in patch) {
    next.contractId = null
    if (!next.projectId)
      next.supplierId = null
  }
  if ('supplierId' in patch)
    next.contractId = null
  draft.value = next
  if ('projectId' in patch || 'contractId' in patch || 'periodNo' in patch)
    void refreshBoqLines()
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
  draft.value = { ...draft.value, lines }
  clearFieldError('lines')
  updateDerivedAmounts()
}

function updateDerivedAmounts() {
  const lines = draft.value.lines ?? []
  const amount = lines.reduce(
    (sum, line) => sum + ownerDocumentLineAmount(props.kind, line),
    0,
  )
  if (props.kind === 'owner_change')
    draft.value = { ...draft.value, totalAmount: Math.round(amount * 100) / 100 }
  if (props.kind === 'owner_report')
    draft.value = { ...draft.value, reportedAmount: Math.round(amount * 100) / 100 }
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
  try {
    const result = await store.saveForm(
      props.kind,
      draft.value,
      action,
      attachmentChanges(),
    )
    success(action === 'submit' ? `${meta.value.postLabel.replace('保存并', '')}成功` : '草稿已保存')
    clearPendingAttachments()
    fieldErrors.value = {}
    if (action === 'submit' && closeAfterSave.value) {
      allowLeave = true
      tabsStore.close(pageKey)
      await navigateTo(returnTarget.value)
      return
    }
    allowLeave = true
    await navigateTo({
      path: ownerDocumentFormPath(props.kind, result.id),
      query: route.query?.returnTo ? { returnTo: String(route.query.returnTo) } : {},
    }, { replace: true })
    await initialize()
    allowLeave = false
  }
  catch (cause) {
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
  if (conflictReadOnly.value)
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

onBeforeRouteLeave(async () => {
  if (allowLeave || !dirty.value)
    return true
  if (tabsStore.tabs.some(tab => tab.key === pageKey))
    return true
  const leave = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  if (!leave)
    tabsStore.open({ fullPath: pageFullPath, title: title.value })
  return leave
})

onMounted(() => void initialize())
</script>

<template>
  <EntityFormShell
    :title="title"
    :subtitle="`${meta.subtitle}；关联对象均保存真实 ID，附件与业务单据同事务提交。`"
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
      <span class="chip" :class="ownerDocumentStatusClass(kind, status)">
        {{ ownerDocumentStatusLabelForList(kind, status) }}
      </span>
    </template>

    <template #actions>
      <KitButton
        v-if="canApproveChange && !conflictReadOnly"
        :loading="lifecycleLoading"
        @click="approveChange"
      >
        <span class="i-lucide-badge-check mr-1" aria-hidden="true" />确认签证
      </KitButton>
      <KitButton
        v-if="auditMode && !conflictReadOnly"
        :loading="lifecycleLoading"
        @click="auditReport"
      >
        <span class="i-lucide-stamp mr-1" aria-hidden="true" />确认审定
      </KitButton>
      <KitButton
        v-if="acceptanceAction && !conflictReadOnly"
        :loading="lifecycleLoading"
        @click="moveAcceptance"
      >
        <span class="i-lucide-shield-check mr-1" aria-hidden="true" />{{ acceptanceAction.label }}
      </KitButton>
    </template>

    <form class="flex min-w-0 flex-col gap-4" @submit.prevent>
      <div
        v-if="conflictReadOnly"
        role="status"
        class="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-warn/35 bg-warn-soft px-4 py-3 text-12px text-ink"
      >
        <span>中央最新版已进入不可编辑阶段；当前显示冲突前的本页内容，仅供核对和复制。</span>
        <KitButton size="sm" variant="secondary" @click="initialize">
          改用服务器最新版
        </KitButton>
      </div>

      <OwnerDocumentFormFields
        :kind="kind"
        :draft="draft"
        :field-errors="fieldErrors"
        :eligible-contract-count="eligibleContractCount"
        :readonly="!editable"
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
        v-if="kind === 'project_penalty' && (canDeductPenalty || penaltyDeductions.length)"
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
