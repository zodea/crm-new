<script setup lang="ts">
import type { PendingMasterDataAttachment } from './MasterDataAttachmentSection.vue'
import type {
  FormAttachment,
  FormAttachmentChanges,
  FormAttachmentDraft,
  MasterDataOwnerType,
  MasterDataSaveAction,
} from '~/lib/master-data/forms'
import type {
  FormFooterAction,
  MasterDataPageDraft,
} from '~/lib/master-data/page'
import type { ProjectFormReadDTO } from '~/lib/project/command-contract'
import { isTauri } from '@tauri-apps/api/core'
import { onActivated } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import {
  listFormAttachments,
  loadCrewForm,
  loadCustomerForm,
  loadProjectForm,
  loadSupplierForm,
  loadTargetCostForm,
  loadWorkerForm,
} from '~/lib/master-data/forms'
import {
  FORM_META,
  formDefaults,
  formRequiredFields,
} from '~/lib/master-data/page'
import { SUPPLIER_CATEGORIES } from '~/lib/supplier/status'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import {
  ProjectCommandConflictError,
  ProjectLocalDraftOnlyError,
} from '~/stores/project-command'

const props = withDefaults(defineProps<{
  kind: MasterDataOwnerType
  hideSections?: boolean
  returnToDetail?: boolean
}>(), {
  hideSections: false,
  returnToDetail: false,
})

const route = useRoute()
const supplierStore = useSupplierStore()
const customerStore = useCustomerStore()
const crewStore = useCrewStore()
const workerStore = useWorkerStore()
const projectStore = useProjectStore()
const projectCommandStore = useProjectCommandStore()
const targetCostStore = useTargetCostStore()
const readStore = useMasterDataReadStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()

const meta = computed(() => FORM_META[props.kind])
const pageFullPath = computed(() => route.fullPath)
const pageKey = computed(() => deriveKey(pageFullPath.value))
const routeId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] : value
})
const isEditing = computed(() => Boolean(routeId.value))
const routeSupplierCategory = computed(() => {
  const value = route.query.category
  const category = Array.isArray(value) ? value[0] : value
  return typeof category === 'string' && SUPPLIER_CATEGORIES.some(item => item === category)
    ? category
    : ''
})
const routeSupplierName = computed(() => {
  const value = route.query.name
  const name = Array.isArray(value) ? value[0] : value
  return typeof name === 'string' ? name.trim() : ''
})
const title = computed(() => `${isEditing.value ? '编辑' : '新建'} · ${meta.value.label}`)
const returnPath = computed(() =>
  props.returnToDetail && isEditing.value && meta.value.detailPath
    ? `${meta.value.detailPath}/${routeId.value}${props.kind === 'project' ? '?origin=real' : ''}`
    : meta.value.listPath,
)
const backLabel = computed(() =>
  props.returnToDetail && isEditing.value
    ? `返回${meta.value.label}详情`
    : `返回${meta.value.listLabel}`,
)
useTabTitle(title)

const draft = ref<MasterDataPageDraft>(
  createDefaultDraft(),
)
const attachments = shallowRef<FormAttachment[]>([])
const pendingAttachments = shallowRef<PendingMasterDataAttachment[]>([])
const pendingRemoveIds = shallowRef<string[]>([])
const pendingRestoreIds = shallowRef<string[]>([])
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(false)
const loadError = shallowRef('')
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = shallowRef(true)
const savedSnapshot = shallowRef('')
const hydrated = shallowRef(false)
const desktopAttachmentPicker = shallowRef(false)
const localDraftNotice = shallowRef('')
const conflictLatest = shallowRef<ProjectFormReadDTO | null>(null)
const formElement = useTemplateRef<HTMLFormElement>('formElement')
let allowLeave = false
let lastInitializedTarget = ''

const dirty = computed(() => hydrated.value && (
  JSON.stringify(draft.value) !== savedSnapshot.value
  || pendingAttachments.value.length > 0
  || pendingRemoveIds.value.length > 0
  || pendingRestoreIds.value.length > 0
))

const sections = computed(() => meta.value.sections)
const usesSupplierCredentialFlow = computed(() =>
  meta.value.attachmentMode === 'supplierCredential',
)
const shellSections = computed(() =>
  props.hideSections || meta.value.hideSectionNav ? [] : sections.value,
)
const attachmentTitle = computed(() => props.kind === 'worker' ? '证书档案' : '附件')
const requiredFields = computed(() =>
  new Map<string, string>(formRequiredFields(props.kind)),
)
const shellState = computed(() => {
  if (loading.value)
    return 'loading'
  if (loadError.value)
    return 'error'
  return 'ready'
})
const shellStateTitle = computed(() =>
  loading.value
    ? `正在载入${meta.value.label}表单`
    : `${meta.value.label}表单载入失败`,
)

const fetchCustomers = readStore.searchCustomers
const fetchProjects = readStore.searchProjects
const fetchCrews = readStore.searchCrews

async function loadRecord(id: string): Promise<MasterDataPageDraft | null> {
  switch (props.kind) {
    case 'supplier': return await loadSupplierForm(id) as MasterDataPageDraft | null
    case 'customer': return await loadCustomerForm(id) as MasterDataPageDraft | null
    case 'crew': return await loadCrewForm(id) as MasterDataPageDraft | null
    case 'worker': return await loadWorkerForm(id) as MasterDataPageDraft | null
    case 'project': return await loadProjectForm(id) as MasterDataPageDraft | null
    case 'target_cost': return await loadTargetCostForm(id) as MasterDataPageDraft | null
  }
}

function createDefaultDraft(): MasterDataPageDraft {
  const defaults = formDefaults(props.kind) as MasterDataPageDraft
  if (props.kind !== 'supplier' || isEditing.value)
    return defaults

  return {
    ...defaults,
    ...(routeSupplierCategory.value ? { supplierCategory: routeSupplierCategory.value } : {}),
    ...(routeSupplierName.value ? { name: routeSupplierName.value } : {}),
  }
}

async function initialize() {
  lastInitializedTarget = `${props.kind}:${routeId.value ?? 'new'}`
  hydrated.value = false
  loading.value = true
  loadError.value = ''
  fieldErrors.value = {}
  pendingAttachments.value = []
  pendingRemoveIds.value = []
  pendingRestoreIds.value = []
  localDraftNotice.value = ''
  conflictLatest.value = null
  let shouldFocus = false
  try {
    if (props.kind === 'project' && !isTauri()) {
      const central = await projectCommandStore.hydrate(routeId.value ?? null)
      draft.value = {
        ...formDefaults(props.kind),
        ...(central.draft ?? createDefaultDraft()),
      } as MasterDataPageDraft
      attachments.value = central.attachments
      pendingAttachments.value = central.pendingAttachments.map((file, index) => ({
        ...file,
        localId: `restored-${index}-${file.fileName}`,
      }))
      pendingRemoveIds.value = central.pendingRemoveIds
      pendingRestoreIds.value = central.pendingRestoreIds
      if (central.restoredLocalDraft) {
        localDraftNotice.value = '已恢复上次仅保留在本地的草稿；它尚未写入正式项目。'
      }
    }
    else if (!routeId.value) {
      draft.value = createDefaultDraft()
      attachments.value = []
    }
    else {
      const [record, files] = await Promise.all([
        loadRecord(routeId.value),
        usesSupplierCredentialFlow.value
          ? Promise.resolve([])
          : listFormAttachments(props.kind, routeId.value, true),
      ])
      if (!record) {
        error(`${meta.value.label}不存在或已删除`)
        allowLeave = true
        await navigateTo(meta.value.listPath)
        return
      }
      draft.value = {
        ...formDefaults(props.kind),
        ...record,
      } as MasterDataPageDraft
      attachments.value = files
    }
    await nextTick()
    savedSnapshot.value = JSON.stringify(draft.value)
    hydrated.value = true
    shouldFocus = true
  }
  catch (cause) {
    loadError.value = toErrorMessage(cause)
  }
  finally {
    loading.value = false
    if (shouldFocus) {
      await nextTick()
      formElement.value
        ?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
        ?.focus({ preventScroll: true })
    }
  }
}

function validateRequired(): boolean {
  const errors: Record<string, string> = {}
  for (const [field, label] of formRequiredFields(props.kind)) {
    const value = draft.value[field as keyof MasterDataPageDraft]
    if (typeof value === 'string' ? !value.trim() : value == null)
      errors[field] = `${label}为必填项`
  }
  fieldErrors.value = errors
  const labels = Object.values(errors)
  if (labels.length) {
    warning(`${labels[0]}（共 ${labels.length} 处）`)
    const firstField = Object.keys(errors)[0]
    if (firstField)
      focusField(firstField)
  }
  return labels.length === 0
}

function focusField(field: string) {
  void nextTick(() => {
    const target = formElement.value
      ?.querySelector<HTMLElement>(`[data-field="${field}"]`)
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
    target?.focus()
  })
}

function validateFieldOnBlur(event: FocusEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement))
    return
  const field = target.dataset.field
  if (!field)
    return
  const label = requiredFields.value.get(field)
  if (!label)
    return

  const value = draft.value[field as keyof MasterDataPageDraft]
  const missing = typeof value === 'string' ? !value.trim() : value == null
  if (!missing) {
    clearFieldError(field as keyof MasterDataPageDraft)
    return
  }
  fieldErrors.value = {
    ...fieldErrors.value,
    [field]: `${label}为必填项`,
  }
}

function clearFieldError(field: keyof MasterDataPageDraft) {
  if (!fieldErrors.value[field])
    return
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

function attachmentChanges(): FormAttachmentChanges {
  return {
    add: pendingAttachments.value.map(({ localId: _localId, ...file }) => file),
    removeIds: pendingRemoveIds.value,
    restoreIds: pendingRestoreIds.value,
  }
}

async function saveThroughStore(action: MasterDataSaveAction) {
  switch (props.kind) {
    case 'supplier':
      return supplierStore.saveForm(draft.value, action, attachmentChanges())
    case 'customer':
      return customerStore.save(draft.value, action, attachmentChanges())
    case 'crew':
      return crewStore.save(draft.value, action, attachmentChanges())
    case 'worker':
      return workerStore.save(draft.value, action, attachmentChanges())
    case 'project':
      return isTauri()
        ? projectStore.saveForm(draft.value, action, attachmentChanges())
        : projectCommandStore.saveForm(draft.value, action, attachmentChanges())
    case 'target_cost':
      return targetCostStore.save(draft.value, action, attachmentChanges())
  }
}

async function handleFooterAction(action: FormFooterAction) {
  if (action === 'cancel') {
    await leaveForm()
    return
  }

  const saveAction: MasterDataSaveAction
    = action === 'draft'
      ? 'draft'
      : action === 'saveSubmit'
        ? 'submit'
        : 'save'
  if (saveAction !== 'draft' && !validateRequired())
    return

  loadingAction.value = action
  try {
    const result = await saveThroughStore(saveAction)
    success(saveAction === 'draft'
      ? '草稿已保存'
      : meta.value.saveSuccessMessage ?? '保存成功')
    pendingAttachments.value = []
    pendingRemoveIds.value = []
    pendingRestoreIds.value = []
    fieldErrors.value = {}

    if (action === 'saveNew') {
      if (props.kind === 'project' && !isTauri())
        projectCommandStore.startNewProject()
      allowLeave = true
      if (route.path === meta.value.newPath) {
        draft.value = createDefaultDraft()
        attachments.value = []
        savedSnapshot.value = JSON.stringify(draft.value)
        allowLeave = false
      }
      else {
        tabsStore.close(pageKey.value)
        await navigateTo(meta.value.newPath)
      }
      return
    }

    if (closeAfterSave.value) {
      allowLeave = true
      const detailSuffix = meta.value.postSaveDetailTab
        ? `?tab=${encodeURIComponent(meta.value.postSaveDetailTab)}`
        : ''
      const originSuffix = props.kind === 'project'
        ? `${detailSuffix ? '&' : '?'}origin=real`
        : ''
      const closePath = (props.returnToDetail || meta.value.postSaveDetailTab) && meta.value.detailPath
        ? `${meta.value.detailPath}/${routeId.value ?? result.id}${detailSuffix}${originSuffix}`
        : meta.value.listPath
      if (meta.value.postSaveDetailTab) {
        await navigateTo(closePath)
        tabsStore.close(pageKey.value)
      }
      else {
        tabsStore.close(pageKey.value)
        await navigateTo(closePath)
      }
      return
    }

    if (!isEditing.value) {
      allowLeave = true
      tabsStore.close(pageKey.value)
      await navigateTo(`${meta.value.newPath}/${result.id}`)
      return
    }
    await initialize()
  }
  catch (cause) {
    if (cause instanceof ProjectCommandConflictError) {
      conflictLatest.value = cause.latest
      localDraftNotice.value = '当前内容仍只保留在本地，未覆盖服务器最新版本。'
      warning(cause.message)
    }
    else if (cause instanceof ProjectLocalDraftOnlyError) {
      localDraftNotice.value = cause.message
      error(cause.message)
    }
    else {
      error(`保存失败：${toErrorMessage(cause)}`)
    }
  }
  finally {
    loadingAction.value = null
  }
}

function keepLocalAgainstLatest() {
  if (!conflictLatest.value)
    return
  projectCommandStore.rebase(conflictLatest.value.version)
  conflictLatest.value = null
  localDraftNotice.value = '已保留你的内容并基于服务器最新版本；请再次保存以提交。'
}

async function useLatestServerVersion() {
  const latest = conflictLatest.value
  if (!latest)
    return
  projectCommandStore.acceptLatest(latest)
  draft.value = {
    ...formDefaults(props.kind),
    ...latest.draft,
  } as MasterDataPageDraft
  attachments.value = latest.attachments
  pendingAttachments.value = []
  pendingRemoveIds.value = []
  pendingRestoreIds.value = []
  conflictLatest.value = null
  localDraftNotice.value = ''
  await nextTick()
  savedSnapshot.value = JSON.stringify(draft.value)
}

function appendPendingAttachments(files: FormAttachmentDraft[]) {
  const activeExisting = attachments.value.filter(file =>
    (!file.deletedAt && !pendingRemoveIds.value.includes(file.id))
    || pendingRestoreIds.value.includes(file.id),
  ).length
  const available = props.kind === 'customer'
    ? Math.max(0, 9 - activeExisting - pendingAttachments.value.length)
    : files.length
  const accepted = files.slice(0, available)
  if (accepted.length < files.length)
    warning('客户附件最多 9 个，超出部分未加入')

  pendingAttachments.value = [
    ...pendingAttachments.value,
    ...accepted.map((file, index) => ({
      ...file,
      localId: `${file.filePath || file.fileName}-${Date.now()}-${index}`,
      category: file.category || meta.value.defaultAttachmentCategory,
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
    const paths = selected == null
      ? []
      : Array.isArray(selected) ? selected : [selected]
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

function removePending(localId: string) {
  pendingAttachments.value = pendingAttachments.value.filter(file =>
    file.localId !== localId,
  )
}

function updatePendingCategory(localId: string, category: string) {
  pendingAttachments.value = pendingAttachments.value.map(file =>
    file.localId === localId ? { ...file, category } : file,
  )
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

async function leaveForm() {
  if (dirty.value) {
    const leave = await confirm({
      variant: 'simple',
      title: '放弃修改',
      message: `当前表单还有未保存内容，确认放弃并${isEditing.value && props.returnToDetail ? '返回详情' : '返回列表'}？`,
      confirmLabel: '放弃修改',
    })
    if (!leave)
      return
  }
  allowLeave = true
  tabsStore.close(pageKey.value)
  await navigateTo(returnPath.value)
}

onBeforeRouteLeave(async () => {
  if (allowLeave || !dirty.value)
    return true

  // 普通页签切换保留 KeepAlive 草稿；只有当前表单页签已被关闭时才拦截。
  if (tabsStore.tabs.some(tab => tab.key === pageKey.value))
    return true

  const leave = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  if (!leave)
    tabsStore.open({ fullPath: pageFullPath.value, title: title.value })
  return leave
})

onMounted(() => {
  desktopAttachmentPicker.value = isTauri()
  void initialize()
})

onActivated(() => {
  const target = `${props.kind}:${routeId.value ?? 'new'}`
  if (lastInitializedTarget && target !== lastInitializedTarget)
    void initialize()
})

watch(routeSupplierCategory, () => {
  if (props.kind === 'supplier' && !isEditing.value)
    void initialize()
})
</script>

<template>
  <EntityFormShell
    :title="title"
    subtitle="草稿可暂存不完整内容；提交时校验必填、关联和金额规则。"
    :back-label="backLabel"
    :sections="shellSections"
    :state="shellState"
    :state-title="shellStateTitle"
    :state-description="loadError"
    state-action-label="重新加载"
    @back="leaveForm"
    @state-action="initialize"
  >
    <template #status>
      <template v-if="shellState === 'ready'">
        <span v-if="!meta.hideStatus && (draft.status || draft.approvalStatus)" class="chip bg-surface-3 text-ink-soft">
          {{ draft.approvalStatus || draft.status }}
        </span>
      </template>
    </template>

    <section
      v-if="localDraftNotice"
      data-ui="project-local-draft-notice"
      class="border border-warn/35 bg-warn/8 px-3 py-2 text-12px leading-5 text-ink-soft"
      role="status"
    >
      <b class="text-warn">本地草稿</b>
      · {{ localDraftNotice }}
    </section>

    <section
      v-if="conflictLatest"
      data-ui="project-version-conflict"
      class="border border-danger/30 bg-danger/6 p-3"
      role="alert"
    >
      <h2 class="text-13px font-800 text-danger">
        项目已被其他操作更新
      </h2>
      <p class="mt-1 text-12px leading-5 text-ink-soft">
        服务器最新版本为 {{ conflictLatest.version }}。请选择保留当前内容后重试，或改用服务器版本。
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        <button type="button" class="btn-primary" @click="keepLocalAgainstLatest">
          保留我的内容
        </button>
        <button type="button" class="btn-secondary" @click="useLatestServerVersion">
          改用服务器最新版
        </button>
      </div>
    </section>

    <form
      ref="formElement"
      :data-ui="kind === 'supplier' ? 'supplier-form-scroll' : undefined"
      class="flex flex-col gap-4"
      :class="{ 'supplier-form-scroll': kind === 'supplier' }"
      @focusout="validateFieldOnBlur"
      @submit.prevent
    >
      <MasterDataFormFields
        v-model="draft"
        :kind="kind"
        :field-errors="fieldErrors"
        :fetch-customers="fetchCustomers"
        :fetch-projects="fetchProjects"
        :fetch-crews="fetchCrews"
        @clear-error="clearFieldError"
      />

      <MasterDataAttachmentSection
        v-if="!usesSupplierCredentialFlow"
        :title="attachmentTitle"
        :desktop-picker="desktopAttachmentPicker"
        :attachments="attachments"
        :pending-attachments="pendingAttachments"
        :pending-remove-ids="pendingRemoveIds"
        :pending-restore-ids="pendingRestoreIds"
        @pick-native="pickNativeFiles"
        @files="handleFiles"
        @toggle-existing="toggleExistingAttachment"
        @remove-pending="removePending"
        @update-pending-category="updatePendingCategory"
      />

      <section
        v-else
        id="section-attachments"
        data-ui="supplier-credential-guidance"
        class="panel scroll-mt-4 p-4"
      >
        <SectionHeader
          title="证照资料"
          subtitle="证照原件、OCR 核对、有效期和人工审核统一在分供方详情维护。"
        />
        <div class="mt-3 flex min-w-0 flex-wrap items-center gap-3 border border-brand/20 bg-brand-soft/35 p-3 text-12px text-ink-soft">
          <span class="i-lucide-shield-check shrink-0 text-18px text-brand" aria-hidden="true" />
          <p class="min-w-52 flex-1 leading-5">
            此处只保存主数据，不会把普通附件伪装成证照。保存后进入“证照附件”，按真实文件、资料要求和人工核验规则完成准入。
          </p>
          <NuxtLink
            v-if="isEditing && routeId"
            :to="`/base/supplier/${routeId}?tab=credential`"
            class="btn-secondary shrink-0"
          >
            前往证照附件
          </NuxtLink>
        </div>
      </section>

      <section id="section-note" class="panel scroll-mt-4 p-4">
        <SectionHeader title="备注" />
        <textarea v-model="draft.note" rows="4" class="field-input w-full" placeholder="补充说明" />
      </section>
    </form>

    <template #footer>
      <FormFooter
        v-model="closeAfterSave"
        class="mt-4"
        :dirty="dirty"
        close-after-save
        :loading-action="loadingAction"
        @action="handleFooterAction"
      />
    </template>
  </EntityFormShell>
</template>

<style scoped>
.supplier-form-scroll {
  max-height: calc(100dvh - var(--header-h, 52px) - var(--tabbar-h, 36px) - 13rem);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
  scrollbar-gutter: stable;
}
</style>
