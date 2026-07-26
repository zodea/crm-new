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
import {
  OWNER_DOCUMENT_META,
  ownerDocumentDefaults,
  ownerDocumentFormPath,
  ownerDocumentLineAmount,
  ownerDocumentStatusLabel,
  validateOwnerDocumentForm,
} from '~/lib/owner-document/page'
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
const pageFullPath = route.fullPath
const pageKey = deriveKey(pageFullPath)
const title = computed(() => `${isEditing.value ? '查看/编辑' : '新建'} · ${meta.value.label}`)
useTabTitle(title)

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
} = useOwnerDocumentFormAttachments()
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(false)
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = shallowRef(true)
const savedSnapshot = shallowRef('')
let allowLeave = false

const status = computed(() => String(draft.value.status ?? 'draft'))
const editable = computed(() => status.value === 'draft' || status.value === 'rejected')
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
})
const dirty = computed(() =>
  JSON.stringify(draft.value) !== savedSnapshot.value
  || attachmentsDirty.value,
)
const footerActions = computed<FormFooterAction[]>(() =>
  editable.value
    ? ['cancel', 'draft', 'saveSubmit']
    : ['cancel', 'save'],
)
const footerLabels = computed(() => ({
  saveSubmit: meta.value.postLabel,
  save: '保存附件',
}))

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
    if (props.kind === 'owner_report' && editable.value) {
      const current = draft.value.lines ?? []
      const byId = new Map(boqLines.value.map(line => [line.id, line]))
      const lines = current.length
        ? current.map((line) => {
            const boqLine = byId.get(String(line.boqLineId ?? ''))
            return boqLine ? { ...line, autoQty: boqLine.autoQty } : line
          })
        : boqLines.value
            .filter(line => line.autoQty > 0)
            .map(line => ({
              boqLineId: line.id,
              itemName: line.itemName,
              unit: line.unit,
              autoQty: line.autoQty,
              reportedQty: line.autoQty,
              auditedQty: null,
              unitPrice: line.unitPrice,
              note: '',
            }))
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
    const summary = await store.loadContractSummary(contractId)
    if (!summary)
      return
    const settlementAmount = Number(draft.value.settlementAmount) || 0
    draft.value = {
      ...draft.value,
      changedContractAmount: summary.contractAmount,
      receivedAmount: summary.receivedAmount,
      settlementReceiptGap: Math.round(
        (settlementAmount - summary.receivedAmount) * 100,
      ) / 100,
    }
  }
  if (props.kind === 'sub_settlement') {
    const summary = await store.loadContractSummary(contractId, routeId.value ?? '')
    if (!summary)
      return
    const totalAmount = Number(draft.value.totalAmount) || 0
    draft.value = {
      ...draft.value,
      contractAmount: summary.contractAmount,
      priorSettlementAmount: summary.priorSettlementAmount,
      settlementRatio: summary.contractAmount > 0
        ? `${(totalAmount / summary.contractAmount * 100).toFixed(2)}%`
        : '—',
    }
  }
}, 150)

async function initialize() {
  loading.value = true
  fieldErrors.value = {}
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
        await navigateTo(meta.value.listPath)
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
    updateDerivedAmounts()
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

function validateSubmit(): boolean {
  const errors = validateOwnerDocumentForm(props.kind, draft.value)
  fieldErrors.value = errors
  const messages = Object.values(errors)
  if (messages.length)
    warning(`${messages[0]}（共 ${messages.length} 处）`)
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
      await navigateTo(meta.value.listPath)
      return
    }
    allowLeave = true
    await navigateTo(ownerDocumentFormPath(props.kind, result.id), { replace: true })
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

async function saveFinalAttachments() {
  const id = routeId.value
  if (!id)
    return
  loadingAction.value = 'save'
  try {
    await store.saveAttachments(props.kind, id, attachmentChanges())
    success('附件已保存')
    await initialize()
  }
  catch (cause) {
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
  await navigateTo(meta.value.listPath)
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
  <div class="mx-auto flex w-full max-w-1340px items-start gap-4 pb-6">
    <aside
      v-if="meta.sections.length >= 3"
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
      <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" class="mb-1 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-12px text-brand-deep" @click="leaveToList">
            <span class="i-lucide-arrow-left" aria-hidden="true" />返回{{ meta.label }}
          </button>
          <h1 class="text-20px font-800 text-ink">
            {{ title }}
          </h1>
          <p class="mt-1 text-12px text-ink-faint">
            {{ meta.subtitle }}；关联对象均保存真实 ID，附件与业务单据同事务提交。
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="chip" :class="editable ? 'chip-brand' : 'chip-ok'">
            {{ ownerDocumentStatusLabel(status) }}
          </span>
          <KitButton
            v-if="canApproveChange"
            :loading="lifecycleLoading"
            @click="approveChange"
          >
            <span class="i-lucide-badge-check mr-1" aria-hidden="true" />确认签证
          </KitButton>
          <KitButton
            v-if="auditMode"
            :loading="lifecycleLoading"
            @click="auditReport"
          >
            <span class="i-lucide-stamp mr-1" aria-hidden="true" />确认审定
          </KitButton>
          <KitButton
            v-if="acceptanceAction"
            :loading="lifecycleLoading"
            @click="moveAcceptance"
          >
            <span class="i-lucide-shield-check mr-1" aria-hidden="true" />{{ acceptanceAction.label }}
          </KitButton>
        </div>
      </header>

      <div v-if="loading" class="panel grid min-h-56 place-items-center text-13px text-ink-faint">
        正在载入表单…
      </div>

      <form v-else class="flex flex-col gap-4" @submit.prevent>
        <OwnerDocumentFormFields
          :kind="kind"
          :draft="draft"
          :field-errors="fieldErrors"
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
          @update="patchLines"
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
          :attachments="attachments"
          :pending-attachments="pendingAttachments"
          :pending-remove-ids="pendingRemoveIds"
          :pending-restore-ids="pendingRestoreIds"
          :desktop-picker="desktopAttachmentPicker"
          :note="String(draft.note ?? '')"
          :note-readonly="!editable"
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
    </main>
  </div>
</template>
