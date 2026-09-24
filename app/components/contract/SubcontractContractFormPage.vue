<script setup lang="ts">
import type { F2SaveAction, ProjectContractFormDraft } from '~/lib/contract/forms'
import type { LookupOption } from '~/lib/kit/lookup'
import type { FormFooterAction } from '~/lib/master-data/page'
import { useContractFormNavigation } from '~/composables/useContractFormNavigation'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { F2_FORM_META, f2FormDefaults } from '~/lib/contract/page'
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
  desktopAttachmentPicker,
  dirty: attachmentDirty,
  reset: resetAttachments,
  clearPending: clearPendingAttachments,
  changes: attachmentChanges,
  handleFiles,
  pickNativeFiles,
  removePending,
  patchPending,
  toggleExisting: toggleExistingAttachment,
} = useContractFormAttachments()
const routeId = computed(() => Array.isArray(route.params.id) ? route.params.id[0] ?? null : typeof route.params.id === 'string' ? route.params.id : null)
const isEditing = computed(() => Boolean(routeId.value))
const title = computed(() => `${isEditing.value ? '编辑' : '新建'} · 分包合同`)
const draft = ref<ProjectContractFormDraft>(f2FormDefaults('subcontract') as ProjectContractFormDraft)
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(true)
const loadError = shallowRef('')
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = ref(true)
const savedSnapshot = shallowRef('')
const context = shallowRef<Awaited<ReturnType<typeof store.hydrate>>['context'] | null>(null)

const dirty = computed(() => JSON.stringify(draft.value) !== savedSnapshot.value || attachmentDirty.value)
const pageState = computed(() => loading.value ? 'loading' : loadError.value ? 'error' : 'ready')
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
let initializeRequest = 0

async function initialize(targetId = routeId.value) {
  const request = ++initializeRequest
  loading.value = true
  loadError.value = ''
  fieldErrors.value = {}
  resetAttachments()
  try {
    const hydrated = await store.hydrate(commandSession, targetId)
    if (request !== initializeRequest)
      return
    context.value = hydrated.context
    draft.value = hydrated.form?.draft ?? (f2FormDefaults('subcontract') as ProjectContractFormDraft)
    resetAttachments(hydrated.form?.attachments ?? [])
    await nextTick()
    savedSnapshot.value = JSON.stringify(draft.value)
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
  draft.value = { ...draft.value, ...patch }
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
  const saveAction: F2SaveAction = action === 'draft' ? 'draft' : action === 'saveSubmit' ? 'submit' : 'save'
  if (saveAction !== 'draft' && !validateRequired())
    return
  loadingAction.value = action
  try {
    const result = await store.saveForm(commandSession, draft.value, saveAction, attachmentChanges())
    clearPendingAttachments()
    success(saveAction === 'draft' ? '草稿已保存' : '分包合同已保存')
    savedSnapshot.value = JSON.stringify(draft.value)
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
    if (cause instanceof SubcontractContractCommandConflictError) {
      const reload = await confirm({ variant: 'simple', title: '合同已有更新', message: '载入服务器最新版会替换当前内容。', confirmLabel: '载入最新版', cancelLabel: '保留我的内容' })
      store.adoptConflictVersion(commandSession, cause.latest)
      if (reload) {
        draft.value = cause.latest.draft
        resetAttachments(cause.latest.attachments)
        savedSnapshot.value = JSON.stringify(draft.value)
      }
      else {
        warning('已保留当前内容；请核对后再次保存')
      }
    }
    else {
      const problem = subcontractContractProblemFromUnknown(cause).problem
      fieldErrors.value = Object.fromEntries(Object.entries(problem.fieldErrors).map(([key, messages]) => [key, messages[0] ?? '字段无效']))
      error(`保存失败：${problem.message}`)
    }
  }
  finally {
    loadingAction.value = null
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
  <EntityFormShell :title="title" back-label="返回分包合同" :sections="F2_FORM_META.subcontract.sections" :state="pageState" :state-title="loadError || '正在载入表单'" state-action-label="重新载入" @back="leave" @state-action="initialize">
    <form class="flex min-w-0 flex-col gap-4" @submit.prevent>
      <ContractFormFields kind="subcontract" :editing="isEditing" :draft="draft" :field-errors="fieldErrors" :fetch-projects="fetchProjects" :fetch-customers="emptyLookup" :fetch-suppliers="fetchSuppliers" :fetch-original-contracts="emptyLookup" :fetch-other-expense-contracts="emptyLookup" @patch="patchDraft" @clear-error="clearFieldError" />
      <ContractAttachmentSection :attachments="attachments" :pending-attachments="pendingAttachments" :pending-remove-ids="pendingRemoveIds" :pending-restore-ids="pendingRestoreIds" :desktop-picker="desktopAttachmentPicker" :note="draft.note ?? ''" @pick-native="pickNativeFiles" @files="handleFiles" @toggle-existing="toggleExistingAttachment" @remove-pending="removePending" @patch-pending="patchPending" @update-note="patchDraft({ note: $event })" />
      <FormFooter v-model="closeAfterSave" :dirty="dirty" close-after-save :loading-action="loadingAction" @action="save" />
    </form>
  </EntityFormShell>
</template>
