<script setup lang="ts">
import type { ConstructionMainSelection } from '~/lib/construction-scope/contract'
import type { F2SaveAction, ProjectContractFormDraft } from '~/lib/contract/forms'
import type { LookupOption } from '~/lib/kit/lookup'
import type { FormFooterAction } from '~/lib/master-data/page'
import { onActivated, onDeactivated, onScopeDispose } from 'vue'
import ContractAttachmentSection from '~/components/contract/ContractAttachmentSection.vue'
import ContractFormFields from '~/components/contract/ContractFormFields.vue'
import CommandRecoveryPanel from '~/components/shared/CommandRecoveryPanel.vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { useContractFormNavigation } from '~/composables/useContractFormNavigation'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { contractSupplierSelectionPatch, F2_FORM_META, f2FormDefaults } from '~/lib/contract/page'
import { subcontractContractProblemFromUnknown } from '~/lib/subcontract-contract/repository'
import { validateSubcontractContractDetailReturnTo, validateSubcontractContractReturnTo } from '~/lib/subcontract-contract/return-context'
import { SubcontractContractCommandConflictError, useSubcontractContractCommandStore } from '~/stores/subcontract-contract-command'

const route = useRoute()
const store = useSubcontractContractCommandStore()
const commandSession = store.createSession()
const { closeCurrent, openNew } = useContractFormNavigation('subcontract')
const { confirm, success, warning, error } = useKitUI()
const {
  attachments,
  pendingAttachments,
  pendingRemoveIds,
  pendingRestoreIds,
  readingFiles,
  invalidatePreparation,
  dirty: attachmentDirty,
  reset: resetAttachments,
  capture: captureAttachments,
  acknowledge: acknowledgeAttachments,
  changes: attachmentChanges,
  handleFiles,
  removePending,
  patchPending,
  toggleExisting: toggleExistingAttachment,
} = useContractFormAttachments()
const routeId = computed(() => Array.isArray(route.params.id) ? route.params.id[0] ?? null : typeof route.params.id === 'string' ? route.params.id : null)
const isEditing = computed(() => Boolean(routeId.value))
const title = computed(() => `${isEditing.value ? '编辑' : '新建'} · 分包合同`)
const draft = ref<ProjectContractFormDraft>(f2FormDefaults('subcontract') as ProjectContractFormDraft)
const constructionMain = shallowRef<ConstructionMainSelection | null>(null)
const savedConstructionMain = shallowRef('null')
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(true)
const loadError = shallowRef('')
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = ref(true)
const savedSnapshot = shallowRef('')
const context = shallowRef<Awaited<ReturnType<typeof store.hydrate>>['context'] | null>(null)
let submitted: { draft: ProjectContractFormDraft, constructionMain: ConstructionMainSelection | null, attachments: ReturnType<typeof captureAttachments> } | null = null
const footerActions = computed<FormFooterAction[]>(() => commandSession.pending || readingFiles.value || !context.value ? ['cancel'] : ['cancel', 'draft', 'saveNew', 'saveSubmit', 'save'])
const savedPending = computed(() => Boolean(commandSession.pending?.result))

const dirty = computed(() => JSON.stringify(draft.value) !== savedSnapshot.value || JSON.stringify(constructionMain.value) !== savedConstructionMain.value || attachmentDirty.value)
const pageState = computed(() => loading.value ? 'loading' : loadError.value && !commandSession.pending ? 'error' : 'ready')
const detailReturnTo = computed(() => validateSubcontractContractDetailReturnTo(route.query.returnTo, 'real'))
const listReturnTo = computed(() => {
  const nested = detailReturnTo.value && new URL(detailReturnTo.value, 'https://ruihang.invalid').searchParams.get('returnTo')
  return validateSubcontractContractReturnTo(nested, 'real')
})
const returnTo = computed(() => detailReturnTo.value ?? '/contract/subcontract')
const emptyLookup = async (): Promise<LookupOption[]> => []

function lookup(rows: readonly { id: string, label: string }[], keyword: string): LookupOption[] {
  const needle = keyword.trim().toLocaleLowerCase('zh-CN')
  return rows.filter(row => !needle || row.label.toLocaleLowerCase('zh-CN').includes(needle))
}
const fetchProjects = async (keyword: string) => lookup(context.value?.projects ?? [], keyword)
const fetchSuppliers = async (keyword: string) => lookup(context.value?.suppliers ?? [], keyword)
async function fetchEngineering(keyword: string): Promise<LookupOption[]> {
  const needle = keyword.trim().toLocaleLowerCase('zh-CN')
  return (context.value?.constructionMains ?? [])
    .map(row => ({ id: row.id, label: [row.projectName, row.no, row.name].filter(Boolean).join(' · ') }))
    .filter(option => !needle || option.id === keyword || option.label.toLocaleLowerCase('zh-CN').includes(needle))
}
function selectEngineering(id: string | null) {
  if (commandSession.pending || commandSession.busy)
    return
  const selected = context.value?.constructionMains?.find(row => row.id === id)
  if (id && !selected)
    return
  constructionMain.value = selected ? { id: selected.id, projectId: selected.projectId, basis: selected.basis } : null
  draft.value = { ...draft.value, projectId: selected?.projectId ?? null }
}
let initializeRequest = 0
let viewActive = true
function captureView() {
  return { request: initializeRequest, generation: commandSession.generation, id: routeId.value, origin: route.query.origin }
}
function currentView(view: ReturnType<typeof captureView>) {
  return viewActive && view.request === initializeRequest && view.generation === commandSession.generation
    && view.id === routeId.value && view.origin === route.query.origin
}
function deactivateView() {
  if (!viewActive)
    return
  viewActive = false
  initializeRequest++
  invalidatePreparation()
  store.invalidate(commandSession)
  context.value = null
  loading.value = false
  loadingAction.value = null
}
onDeactivated(deactivateView)
onScopeDispose(deactivateView)
onActivated(() => {
  if (!viewActive) {
    viewActive = true
    void initialize(routeId.value, true)
  }
})

async function initialize(targetId = routeId.value, retainInput = false) {
  if (commandSession.pending && submitted && commandSession.pending.descriptor.targetId === targetId) {
    await recover()
    return
  }
  const request = ++initializeRequest
  invalidatePreparation()
  loading.value = true
  // 新视图接管状态后，上一笔保存的 finally 不再有权清理它。
  loadingAction.value = null
  context.value = null
  loadError.value = ''
  fieldErrors.value = {}
  try {
    const hydrated = retainInput && commandSession.authority && commandSession.targetId === targetId
      ? await store.revalidate(commandSession)
      : await store.hydrate(commandSession, targetId)
    if (request !== initializeRequest)
      return
    context.value = hydrated.context
    if (retainInput && commandSession.authority && commandSession.targetId === targetId)
      return
    draft.value = hydrated.form?.draft ?? (f2FormDefaults('subcontract') as ProjectContractFormDraft)
    constructionMain.value = hydrated.form?.constructionMain ?? null
    resetAttachments(hydrated.form?.attachments ?? [])
    await nextTick()
    if (request !== initializeRequest || !viewActive)
      return
    savedSnapshot.value = JSON.stringify(draft.value)
    savedConstructionMain.value = JSON.stringify(constructionMain.value)
    submitted = null
  }
  catch (cause) {
    if (request === initializeRequest)
      loadError.value = subcontractContractProblemFromUnknown(cause).problem.message
  }
  finally {
    if (request === initializeRequest)
      loading.value = false
  }
}

function patchDraft(patch: Partial<ProjectContractFormDraft>) {
  draft.value = { ...draft.value, ...contractSupplierSelectionPatch(draft.value, patch, context.value?.suppliers ?? []) }
}

function clearFieldError(field: string) {
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

function validateRequired() {
  const errors: Record<string, string> = {}
  for (const [key, label] of [['name', '合同名称'], ['projectId', '项目'], ['supplierId', '乙方分供方'], ['subKind', '分包类别'], ['content', '合同内容简述'], ['signDate', '签约日期']] as Array<[keyof ProjectContractFormDraft, string]>) {
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
  if (commandSession.busy || commandSession.pending || readingFiles.value || !context.value)
    return
  const saveAction: F2SaveAction = action === 'draft' ? 'draft' : action === 'saveSubmit' ? 'submit' : 'save'
  if (!commandSession.targetId && !constructionMain.value) {
    warning('工程名称必须明确选择对应的真实施工主合同')
    return
  }
  if (saveAction !== 'draft' && !validateRequired())
    return
  const view = captureView()
  loadingAction.value = action
  submitted = { draft: JSON.parse(JSON.stringify(draft.value)), constructionMain: constructionMain.value ? { ...constructionMain.value } : null, attachments: captureAttachments() }
  try {
    const result = await store.saveForm(commandSession, draft.value, saveAction, attachmentChanges(), constructionMain.value ? { constructionMain: constructionMain.value } : undefined)
    if (!currentView(view) || !submitted)
      return
    const retainedInput = result.retainedInput || JSON.stringify(draft.value) !== JSON.stringify(submitted.draft) || JSON.stringify(constructionMain.value) !== JSON.stringify(submitted.constructionMain)
    acknowledgeAttachments(result.form.attachments, submitted.attachments)
    savedSnapshot.value = JSON.stringify({ ...submitted.draft, id: result.id })
    savedConstructionMain.value = JSON.stringify(result.form.constructionMain ?? submitted.constructionMain)
    if (!retainedInput)
      constructionMain.value = result.form.constructionMain ?? submitted.constructionMain
    draft.value = { ...draft.value, id: result.id }
    submitted = null
    success(saveAction === 'draft' ? '草稿已保存' : '分包合同已保存')
    if (retainedInput || attachmentDirty.value) {
      warning('原提交已确认保存，后续输入已保留；请核对后继续编辑')
      return
    }
    if (action === 'saveNew') {
      await openNew(() => initialize(null))
      return
    }
    if (closeAfterSave.value) {
      closeCurrent()
      await navigateTo(detailReturnTo.value && routeId.value === result.id ? detailReturnTo.value : { path: `/contract/${encodeURIComponent(result.id)}`, query: { origin: 'real', contractKind: 'subcontract', returnTo: listReturnTo.value ?? undefined } })
      return
    }
    closeCurrent()
    await navigateTo({ path: `/contract/subcontract/form/${encodeURIComponent(result.id)}`, query: { origin: 'real', returnTo: returnTo.value } }, { replace: true })
    await initialize(result.id)
  }
  catch (cause) {
    if (!currentView(view))
      return
    if (cause instanceof SubcontractContractCommandConflictError && !commandSession.pending) {
      const reload = await confirm({ variant: 'simple', title: '合同已有更新', message: '载入服务器最新版会替换当前内容。', confirmLabel: '载入最新版', cancelLabel: '保留我的内容' })
      if (!currentView(view) || cause.latest.draft.id !== draft.value.id)
        return
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
      if (commandSession.pending && !commandSession.context)
        context.value = null
      const problem = subcontractContractProblemFromUnknown(cause).problem
      fieldErrors.value = Object.fromEntries(Object.entries(problem.fieldErrors).map(([key, messages]) => [key, messages[0] ?? '字段无效']))
      error(savedPending.value ? '合同已保存待刷新，请保留输入并核对原提交' : `保存失败：${problem.message}`)
    }
  }
  finally {
    if (currentView(view))
      loadingAction.value = null
  }
}

async function leave() {
  const view = captureView()
  if (!await mayLeave() || !currentView(view))
    return
  closeCurrent()
  await navigateTo(returnTo.value)
}

async function mayLeave() {
  return !(dirty.value || commandSession.pending) || await confirm({ variant: 'simple', title: '离开表单', message: commandSession.pending ? '原提交仍需核对；原编号会保留，离开将丢失本页输入。确认离开？' : '当前表单还有未保存内容，确认离开？', confirmLabel: '确认离开' })
}
async function recover() {
  const view = captureView()
  try {
    if (route.query.origin != null && route.query.origin !== 'real')
      throw new Error('请恢复原真实来源后核对提交。')
    const value = await store.recover(commandSession)
    if (!currentView(view))
      return
    loadError.value = ''
    if (value.outcome === 'not-applied') {
      context.value = value.context
      if (!submitted && value.form) {
        draft.value = value.form.draft
        constructionMain.value = value.form.constructionMain ?? null
        savedConstructionMain.value = JSON.stringify(constructionMain.value)
        resetAttachments(value.form.attachments)
        savedSnapshot.value = JSON.stringify(draft.value)
      }
      submitted = null
      warning('原提交已确认未应用；本页输入已保留，可以重新保存')
      return
    }
    context.value = value.context
    if (submitted) {
      acknowledgeAttachments(value.form.attachments, submitted.attachments)
      savedSnapshot.value = JSON.stringify({ ...submitted.draft, id: value.result.id })
      draft.value = { ...draft.value, id: value.result.id }
      savedConstructionMain.value = JSON.stringify(value.form.constructionMain ?? submitted.constructionMain)
      if (JSON.stringify(constructionMain.value) === JSON.stringify(submitted.constructionMain))
        constructionMain.value = value.form.constructionMain ?? submitted.constructionMain
      submitted = null
    }
    else {
      draft.value = value.form.draft
      constructionMain.value = value.form.constructionMain ?? null
      savedConstructionMain.value = JSON.stringify(constructionMain.value)
      resetAttachments(value.form.attachments)
      savedSnapshot.value = JSON.stringify(draft.value)
    }
    success('原提交已确认保存；请核对本页内容后继续')
  }
  catch (cause) {
    if (!currentView(view))
      return
    if (!commandSession.context)
      context.value = null
    error(cause instanceof Error ? cause.message : '原提交暂未可靠核对，请保留输入')
  }
}
useTabCloseGuard(mayLeave)
watch([routeId, () => route.query.origin], ([id, origin]) => {
  if (origin != null && origin !== 'real') {
    initializeRequest++
    invalidatePreparation()
    store.invalidate(commandSession)
    context.value = null
    loading.value = false
    loadError.value = '当前来源不可编辑'
    return
  }
  void initialize(id)
}, { immediate: true })
useTabTitle(title)
</script>

<template>
  <EntityFormShell :title="title" back-label="返回分包合同" :sections="F2_FORM_META.subcontract.sections" :state="pageState" :state-title="loadError || '正在载入表单'" state-action-label="重新载入" @back="leave" @state-action="initialize">
    <CommandRecoveryPanel v-if="commandSession.pending" class="mb-4" :command-id="commandSession.pending.id" :saved="Boolean(commandSession.pending.result)" :busy="commandSession.busy" @recover="recover" />
    <form v-if="context" class="flex min-w-0 flex-col gap-4" @submit.prevent>
      <p v-if="readingFiles" role="status" class="text-12px text-ink-faint">
        正在读取附件正文，请稍候…
      </p>
      <ContractFormFields kind="subcontract" :editing="isEditing" :draft="draft" :field-errors="fieldErrors" :fetch-projects="fetchProjects" :fetch-customers="emptyLookup" :fetch-suppliers="fetchSuppliers" :fetch-original-contracts="emptyLookup" :fetch-other-expense-contracts="emptyLookup" @patch="patchDraft" @clear-error="clearFieldError">
        <template v-if="context?.constructionMains" #project-field>
          <p v-if="commandSession.targetId && !constructionMain" class="form-span-full m-0 text-12px text-warn-ink">
            历史工程：{{ context.projects.find(row => row.id === draft.projectId)?.label ?? '原工程身份保留' }}；原记录没有主合同关联，不强填或猜第一份。
          </p>
          <label class="field-block form-span-full"><span class="field-label">工程名称 *</span><LookupSelect :model-value="constructionMain?.id ?? null" :fetch="fetchEngineering" :disabled-reason="commandSession.pending ? '请先核对原提交' : undefined" placeholder="搜索工程及施工主合同" @update:model-value="selectEngineering" /></label>
          <p class="form-span-full m-0 text-12px text-ink-soft">
            项目由所选工程主合同带出；同工程多份主合同按名称和编号分别核对，不默认第一份。历史未保存关联时保留原项目。
          </p>
        </template>
      </ContractFormFields>
      <ContractAttachmentSection :files-disabled="commandSession.busy || Boolean(commandSession.pending) || readingFiles" :attachments="attachments" :pending-attachments="pendingAttachments" :pending-remove-ids="pendingRemoveIds" :pending-restore-ids="pendingRestoreIds" :note="draft.note ?? ''" @files="handleFiles" @toggle-existing="toggleExistingAttachment" @remove-pending="removePending" @patch-pending="patchPending" @update-note="patchDraft({ note: $event })" />
      <FormFooter v-model="closeAfterSave" :actions="footerActions" :dirty="dirty" close-after-save :loading-action="loadingAction" :write-disabled="Boolean(commandSession.pending || readingFiles || pageState !== 'ready')" @action="save" />
    </form>
  </EntityFormShell>
</template>
