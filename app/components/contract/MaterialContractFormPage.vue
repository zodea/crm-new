<script setup lang="ts">
import type { ConstructionMainSelection } from '~/lib/construction-scope/contract'
import type { ContractFormAttachmentDraft, ContractLineItemDraft, F2SaveAction, ProjectContractFormDraft } from '~/lib/contract/forms'
import type { LookupOption } from '~/lib/kit/lookup'
import type { FormFooterAction } from '~/lib/master-data/page'
import ConstructionScopeSelector from '~/components/contract/ConstructionScopeSelector.vue'
import ContractAttachmentSection from '~/components/contract/ContractAttachmentSection.vue'
import ContractDeductionsEditor from '~/components/contract/ContractDeductionsEditor.vue'
import ContractFormFields from '~/components/contract/ContractFormFields.vue'
import ContractLineItemsEditor from '~/components/contract/ContractLineItemsEditor.vue'
import MaterialContractLineImport from '~/components/contract/MaterialContractLineImport.vue'
import { useContractFormNavigation } from '~/composables/useContractFormNavigation'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { contractSupplierSelectionPatch, F2_FORM_META, f2FormDefaults } from '~/lib/contract/page'
import { materialContractTotal, reconcileMaterialDraftIdentities } from '~/lib/material-contract/line-model'
import { materialContractProblemFromUnknown } from '~/lib/material-contract/repository'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { yuan } from '~/lib/util/money'
import { MaterialContractCommandConflictError, useMaterialContractCommandStore } from '~/stores/material-contract-command'

const route = useRoute()
const store = useMaterialContractCommandStore()
const commandSession = store.createSession()
const { closeCurrent, openNew } = useContractFormNavigation('material')
const { confirm, success, warning, error } = useKitUI()
const {
  attachments,
  pendingAttachments,
  pendingRemoveIds,
  pendingRestoreIds,
  readingFiles,
  invalidatePreparation,
  appendDrafts: appendAttachmentDrafts,
  dirty: attachmentDirty,
  reset: resetAttachments,
  capture: captureAttachments,
  acknowledge: acknowledgeAttachments,
  clearPending: clearPendingAttachments,
  changes: attachmentChanges,
  handleFiles,
  removePending,
  patchPending,
  toggleExisting: toggleExistingAttachment,
} = useContractFormAttachments()

const routeId = computed(() => Array.isArray(route.params.id) ? route.params.id[0] ?? null : typeof route.params.id === 'string' ? route.params.id : null)
const isEditing = computed(() => Boolean(routeId.value))
const title = computed(() => `${isEditing.value ? '编辑' : '新建'} · 材料采购合同`)
const draft = ref<ProjectContractFormDraft>(f2FormDefaults('material') as ProjectContractFormDraft)
const constructionMain = shallowRef<ConstructionMainSelection | null>(null)
const savedConstructionMain = shallowRef('null')
const total = computed(() => materialContractTotal(draft.value.lineItems ?? [], draft.value.deductions ?? [], draft.value.isSupplement === true))
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(true)
const loadError = shallowRef('')
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = ref(true)
const savedSnapshot = shallowRef('')
const context = shallowRef<Awaited<ReturnType<typeof store.hydrate>>['context'] | null>(null)
const lineItemsEditor = useTemplateRef<{ validate: () => { row: number, key: string }[], $el: HTMLElement }>('lineItemsEditor')

const dirty = computed(() => JSON.stringify(draft.value) !== savedSnapshot.value || JSON.stringify(constructionMain.value) !== savedConstructionMain.value || attachmentDirty.value)
const pageState = computed(() => loading.value ? 'loading' : loadError.value ? 'error' : 'ready')
const returnTo = computed(() => typeof route.query.returnTo === 'string' && route.query.returnTo.startsWith('/contract/')
  ? route.query.returnTo
  : '/contract/material')

function lookup(rows: readonly { id: string, label: string }[], keyword: string): LookupOption[] {
  const needle = keyword.trim().toLocaleLowerCase('zh-CN')
  return rows.filter(row => !needle || row.label.toLocaleLowerCase('zh-CN').includes(needle))
}
const fetchProjects = async (keyword: string) => lookup(context.value?.projects ?? [], keyword)
const fetchSuppliers = async (keyword: string) => lookup(context.value?.suppliers ?? [], keyword)
const emptyLookup = async (): Promise<LookupOption[]> => []
const fetchOriginalContracts = async (keyword: string) => lookup(context.value?.originalContracts ?? [], keyword)
const originalContract = computed(() => context.value?.originalContracts?.find(row => row.id === draft.value.originalContractId) ?? null)
let active = true
let pendingInputSnapshot: string | null = null
let pendingSubmittedDraft: ProjectContractFormDraft | null = null
let pendingAttachmentInput: ReturnType<typeof captureAttachments> | null = null
const inputSnapshot = () => JSON.stringify({ draft: draft.value, constructionMain: constructionMain.value, attachments: attachmentChanges() })
async function fetchEngineering(keyword: string): Promise<LookupOption[]> {
  const needle = keyword.trim().toLocaleLowerCase('zh-CN')
  const options = (context.value?.constructionMains ?? [])
    .filter(row => !draft.value.isSupplement || !originalContract.value || row.projectId === originalContract.value.projectId)
    .map(row => ({ id: row.id, label: [row.projectName, row.no, row.name].filter(Boolean).join(' · ') }))
  return options.filter(row => !needle || row.id === keyword || row.label.toLocaleLowerCase('zh-CN').includes(needle))
}
function selectEngineering(id: string | null) {
  if (!active || loading.value || loadError.value || !context.value || commandSession.pending)
    return
  const selected = context.value?.constructionMains?.find(row => row.id === id)
  if (id && !selected)
    return
  if (draft.value.isSupplement && originalContract.value && selected?.projectId !== originalContract.value.projectId)
    return
  constructionMain.value = selected ? { id: selected.id, projectId: selected.projectId, basis: selected.basis } : null
  patchDraft({ projectId: selected?.projectId ?? null })
}

let initializeRequest = 0
let authorityInvalidated = false

function invalidate(message: string) {
  initializeRequest++
  authorityInvalidated = true
  store.invalidate(commandSession)
  context.value = null
  acknowledgeAttachments([], { add: [], removeIds: [], restoreIds: [] })
  invalidatePreparation()
  loading.value = false
  loadingAction.value = null
  loadError.value = message
}
bindReadAuthority(problem => invalidate(problem.message))
onDeactivated(() => {
  active = false
  invalidate('页面已停用，请按当前身份重新核对合同。')
})
onBeforeUnmount(() => {
  active = false
  invalidate('页面已关闭。')
})
onActivated(() => {
  if (!active) {
    active = true
    void initialize(routeId.value, true)
  }
})

async function initialize(targetId = routeId.value, retainEditing = false) {
  const request = ++initializeRequest
  const preserveInput = targetId === routeId.value && (retainEditing || (authorityInvalidated && (dirty.value || commandSession.pending !== null)))
  loading.value = true
  loadError.value = ''
  fieldErrors.value = {}
  if (!preserveInput)
    resetAttachments()
  try {
    const hydrated = preserveInput ? await store.revalidate(commandSession) : await store.hydrate(commandSession, targetId)
    if (request !== initializeRequest)
      return
    context.value = hydrated.context
    if (preserveInput) {
      acknowledgeAttachments(hydrated.form?.attachments ?? [], { add: [], removeIds: [], restoreIds: [] })
    }
    else {
      draft.value = hydrated.form?.draft ?? { ...(f2FormDefaults('material') as ProjectContractFormDraft), isSupplement: route.query.supplement === '1' }
      constructionMain.value = hydrated.form?.constructionMain ?? null
      if (!hydrated.form && draft.value.isSupplement && typeof route.query.originalContractId === 'string')
        patchDraft({ originalContractId: route.query.originalContractId })
      resetAttachments(hydrated.form?.attachments ?? [])
    }
    authorityInvalidated = false
    await nextTick()
    if (!preserveInput)
      savedSnapshot.value = JSON.stringify(draft.value)
    if (!preserveInput)
      savedConstructionMain.value = JSON.stringify(constructionMain.value)
  }
  catch (cause) {
    if (request !== initializeRequest)
      return
    loadError.value = materialContractProblemFromUnknown(cause).problem.message
  }
  finally {
    if (request === initializeRequest)
      loading.value = false
  }
}

function patchDraft(patch: Partial<ProjectContractFormDraft>) {
  if (patch.lineItems)
    patch = { ...patch, lineItems: patch.lineItems.map(row => ({ ...row, id: row.id ?? `draft-${crypto.randomUUID()}` })) }
  if (patch.deductions)
    patch = { ...patch, deductions: patch.deductions.map(row => ({ ...row, id: row.id ?? `draft-${crypto.randomUUID()}` })) }
  if (patch.originalContractId !== undefined) {
    const parent = context.value?.originalContracts?.find(row => row.id === patch.originalContractId)
    constructionMain.value = parent?.constructionMain ?? null
    const frozen = parent?.ourSignatorySnapshot ?? null
    patch = { ...patch, projectId: parent?.projectId ?? null, supplierId: parent?.supplierId ?? null, ourSignatoryId: frozen?.id ?? null, ourSignatoryVersion: frozen?.version ?? null, ourSignatorySnapshot: frozen }
  }
  draft.value = { ...draft.value, ...contractSupplierSelectionPatch(draft.value, patch, context.value?.suppliers ?? []) }
}

function clearFieldError(field: string) {
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

function appendImportedLines(lines: ContractLineItemDraft[], original: ContractFormAttachmentDraft) {
  patchDraft({ lineItems: lines })
  appendAttachmentDrafts([original])
}

function validateRequired() {
  const errors: Record<string, string> = {}
  const required: Array<[keyof ProjectContractFormDraft, string]> = [
    ['name', '合同名称'],
    ['projectId', '项目'],
    ['supplierId', '乙方分供方'],
    ['content', '合同内容简述'],
    ['signDate', '签约日期'],
    ['ourSignatoryId', '我方签约主体'],
  ]
  if (draft.value.isSupplement)
    required.splice(1, 2, ['originalContractId', '原合同'])
  for (const [key, label] of required) {
    const value = draft.value[key]
    if (typeof value === 'string' ? !value.trim() : value == null)
      errors[String(key)] = `${label}为必填项`
  }
  fieldErrors.value = errors
  if (Object.keys(errors).length)
    warning(Object.values(errors)[0]!)
  return Object.keys(errors).length === 0
}

async function save(action: FormFooterAction) {
  if (action === 'cancel') {
    await leave()
    return
  }
  if (loadingAction.value || commandSession.busy || commandSession.pending) {
    warning(commandSession.pending ? '请先核对原提交后再保存新的内容' : '正在保存，请等待当前结果')
    return
  }
  if (!active || loadError.value || !context.value) {
    warning('请先按当前身份重新读取合同候选资料')
    return
  }
  if (readingFiles.value) {
    warning('附件原件正在读取，请完成后保存')
    return
  }
  const saveAction: F2SaveAction = action === 'draft' ? 'draft' : action === 'saveSubmit' ? 'submit' : 'save'
  if (!draft.value.id && !constructionMain.value) {
    warning('新建时必须搜索并选择实际工程对应的施工主合同')
    return
  }
  if (saveAction !== 'draft' && !validateRequired())
    return
  if (saveAction === 'submit' && (lineItemsEditor.value?.validate().length ?? 0) > 0) {
    warning('采购合同明细仍有必填项未填写')
    await nextTick()
    lineItemsEditor.value?.$el.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    return
  }
  loadingAction.value = action
  pendingInputSnapshot = inputSnapshot()
  // The command draft is a JSON payload; nested rows may still be Vue proxies.
  pendingSubmittedDraft = JSON.parse(JSON.stringify(draft.value)) as ProjectContractFormDraft
  pendingAttachmentInput = captureAttachments()
  try {
    const result = await store.saveForm(commandSession, draft.value, saveAction, attachmentChanges(), constructionMain.value ? { constructionMain: constructionMain.value } : undefined)
    const retainedInput = result.retainedInput || inputSnapshot() !== pendingInputSnapshot
    if (retainedInput) {
      if (pendingAttachmentInput)
        acknowledgeAttachments(result.form.attachments, pendingAttachmentInput)
      draft.value = reconcileMaterialDraftIdentities(draft.value, pendingSubmittedDraft!, result.id, result)
      savedSnapshot.value = JSON.stringify(result.form.draft)
      savedConstructionMain.value = JSON.stringify(result.form.constructionMain ?? null)
      success('原提交已保存并读回；后来的修改仍保留，请核对后保存')
      pendingInputSnapshot = null
      pendingSubmittedDraft = null
      pendingAttachmentInput = null
      return
    }
    draft.value = result.form.draft
    constructionMain.value = result.form.constructionMain ?? constructionMain.value
    savedConstructionMain.value = JSON.stringify(constructionMain.value)
    resetAttachments(result.form.attachments)
    clearPendingAttachments()
    pendingInputSnapshot = null
    pendingSubmittedDraft = null
    pendingAttachmentInput = null
    success(saveAction === 'draft' ? '草稿已保存' : '材料采购合同已保存')
    savedSnapshot.value = JSON.stringify(draft.value)
    if ('warnings' in result && Array.isArray(result.warnings) && result.warnings.length) {
      warning(String(result.warnings[0]))
      return
    }
    if (action === 'saveNew') {
      await openNew(() => initialize(null))
      return
    }
    if (closeAfterSave.value) {
      closeCurrent()
      await navigateTo({
        path: `/contract/${encodeURIComponent(draft.value.isSupplement ? draft.value.originalContractId! : result.id)}`,
        query: { origin: 'real', contractKind: 'material', returnTo: returnTo.value, ...(draft.value.isSupplement ? { tab: 'supplements', supplementId: result.id } : {}) },
      })
      return
    }
    closeCurrent()
    await navigateTo({
      path: `/contract/material/form/${encodeURIComponent(result.id)}`,
      query: { origin: 'real', returnTo: returnTo.value },
    }, { replace: true })
    await initialize(result.id)
  }
  catch (cause) {
    if (cause instanceof MaterialContractCommandConflictError) {
      const reload = await confirm({
        variant: 'simple',
        title: '合同已有更新',
        message: '载入服务器最新版会替换当前内容；选择“保留我的内容”后，可基于服务器新版本再次保存。',
        confirmLabel: '载入最新版',
        cancelLabel: '保留我的内容',
      })
      store.adoptConflictVersion(commandSession, cause.latest)
      if (reload) {
        draft.value = cause.latest.draft
        constructionMain.value = cause.latest.constructionMain ?? null
        savedConstructionMain.value = JSON.stringify(constructionMain.value)
        resetAttachments(cause.latest.attachments)
        savedSnapshot.value = JSON.stringify(draft.value)
      }
      else {
        warning('已保留当前内容；请核对后再次保存')
      }
    }
    else {
      const problem = materialContractProblemFromUnknown(cause).problem
      fieldErrors.value = Object.fromEntries(Object.entries(problem.fieldErrors).map(([key, messages]) => [key, messages[0] ?? '字段无效']))
      error(`保存失败：${problem.message}`)
    }
  }
  finally {
    loadingAction.value = null
  }
}

async function recoverOriginal() {
  if (commandSession.busy)
    return
  const before = inputSnapshot()
  try {
    const recovered = await store.recover(commandSession)
    context.value = recovered.context
    if (recovered.outcome === 'not-applied') {
      pendingInputSnapshot = null
      pendingSubmittedDraft = null
      pendingAttachmentInput = null
      warning('原提交已确认为未应用并封存；当前输入保留，可重新保存')
      return
    }
    const laterInput = (pendingInputSnapshot !== null && before !== pendingInputSnapshot) || inputSnapshot() !== before
    if (!laterInput) {
      draft.value = recovered.form.draft
      constructionMain.value = recovered.form.constructionMain ?? null
      resetAttachments(recovered.form.attachments)
      savedSnapshot.value = JSON.stringify(draft.value)
    }
    else {
      if (pendingAttachmentInput)
        acknowledgeAttachments(recovered.form.attachments, pendingAttachmentInput)
      draft.value = pendingSubmittedDraft ? reconcileMaterialDraftIdentities(draft.value, pendingSubmittedDraft, recovered.result.id, recovered.result) : { ...draft.value, id: recovered.result.id }
      savedSnapshot.value = JSON.stringify(recovered.form.draft)
    }
    savedConstructionMain.value = JSON.stringify(recovered.form.constructionMain ?? null)
    pendingInputSnapshot = null
    pendingSubmittedDraft = null
    pendingAttachmentInput = null
    success(laterInput ? '原提交已保存并读回；后来的修改继续保留' : '原提交已保存并读回')
  }
  catch (cause) {
    error(cause instanceof Error ? cause.message : '原提交仍待核对，请保留原编号')
  }
}

async function leave() {
  if (dirty.value && !await confirm({ variant: 'simple', title: '放弃修改', message: '当前表单还有未保存内容，确认离开？', confirmLabel: '放弃修改' }))
    return
  closeCurrent()
  await navigateTo(returnTo.value)
}

useTabCloseGuard(async () => !dirty.value || await confirm({ variant: 'simple', title: '放弃修改', message: '当前表单还有未保存内容，确认离开？', confirmLabel: '放弃修改' }))
watch(routeId, id => void initialize(id), { immediate: true })
useTabTitle(title)
</script>

<template>
  <EntityFormShell :title="title" back-label="返回材料采购合同" :sections="F2_FORM_META.material.sections" :state="pageState" :state-title="loadError || '正在载入表单'" state-action-label="重新载入" @back="leave" @state-action="initialize">
    <form class="flex min-w-0 flex-col gap-4" @submit.prevent>
      <ConstructionScopeSelector v-if="draft.id && context?.capabilities.includes('construction-scope:read') && (!draft.isSupplement || draft.originalContractId)" :source="{ domain: 'material-contract', id: draft.isSupplement ? draft.originalContractId! : draft.id }" :disabled-reason="draft.isSupplement ? '补充协议继承原材料主合同归属，请在原主合同维护。' : dirty || commandSession.pending || commandSession.busy ? '请先保存并可靠读取材料合同，再核对施工归属。' : undefined" />
      <section v-if="commandSession.pending" class="panel border border-warn p-3" role="status">
        <strong>{{ commandSession.pending.result ? '原提交已保存待刷新' : '原提交结果待核对' }}</strong>
        <p class="mt-1 text-12px">
          原编号：{{ commandSession.pending.id }}。当前输入保留，核对后再保存新的内容。
        </p>
        <button type="button" class="btn-secondary mt-2" :disabled="commandSession.busy" @click="recoverOriginal">
          {{ commandSession.pending.result ? '重试读取已保存合同' : '核对原提交' }}
        </button>
      </section>
      <ContractFormFields kind="material" :editing="isEditing" :draft="draft" :field-errors="fieldErrors" :fetch-projects="fetchProjects" :fetch-customers="emptyLookup" :fetch-suppliers="fetchSuppliers" :fetch-original-contracts="fetchOriginalContracts" :fetch-other-expense-contracts="emptyLookup" @patch="patchDraft" @clear-error="clearFieldError">
        <template v-if="!draft.id" #project-field>
          <label class="field-block">
            <span class="field-label">工程名称 *</span>
            <LookupSelect :model-value="constructionMain?.id ?? null" :fetch="fetchEngineering" :disabled-reason="commandSession.pending ? '请先核对原提交' : undefined" placeholder="搜索工程及施工主合同" @update:model-value="selectEngineering" />
          </label>
        </template>
      </ContractFormFields>
      <section v-if="draft.isSupplement && originalContract" class="panel p-3 text-12px" aria-label="原合同继承信息">
        项目：{{ context?.projects.find(row => row.id === originalContract?.projectId)?.label ?? '未记录' }} · 分供方：{{ context?.suppliers.find(row => row.id === originalContract?.supplierId)?.label ?? '未记录' }}；归属由原合同继承。
      </section>
      <label v-if="!draft.id && draft.isSupplement" class="field-block panel p-4">
        <span class="field-label">工程名称 *</span>
        <LookupSelect :model-value="constructionMain?.id ?? null" :fetch="fetchEngineering" :disabled-reason="commandSession.pending ? '请先核对原提交' : originalContract?.constructionMain ? '继承原合同工程' : undefined" placeholder="搜索原合同工程对应的施工主合同" @update:model-value="selectEngineering" />
      </label>
      <ContractLineItemsEditor ref="lineItemsEditor" :lines="draft.lineItems ?? []" :supplement="draft.isSupplement" :original-lines="originalContract?.lineItems ?? []" @update="patchDraft({ lineItems: $event })" />
      <MaterialContractLineImport :key="`${routeId ?? 'new'}:${draft.isSupplement}`" :lines="draft.lineItems ?? []" @append="appendImportedLines" />
      <ContractDeductionsEditor :deductions="draft.deductions ?? []" @update="patchDraft({ deductions: $event })" />
      <p class="text-right text-13px" data-testid="material-contract-detail-total">
        材料及减项合计：{{ total == null ? '待完善' : yuan(total) }}
      </p>
      <ContractAttachmentSection :attachments="attachments" :pending-attachments="pendingAttachments" :pending-remove-ids="pendingRemoveIds" :pending-restore-ids="pendingRestoreIds" :note="draft.note ?? ''" @files="handleFiles" @toggle-existing="toggleExistingAttachment" @remove-pending="removePending" @patch-pending="patchPending" @update-note="patchDraft({ note: $event })" />
      <FormFooter v-model="closeAfterSave" :dirty="dirty" close-after-save :loading-action="loadingAction" @action="save" />
    </form>
  </EntityFormShell>
</template>
