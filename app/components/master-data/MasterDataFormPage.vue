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
import { isTauri } from '@tauri-apps/api/core'
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
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  kind: MasterDataOwnerType
}>()

const route = useRoute()
const supplierStore = useSupplierStore()
const customerStore = useCustomerStore()
const crewStore = useCrewStore()
const workerStore = useWorkerStore()
const projectStore = useProjectStore()
const targetCostStore = useTargetCostStore()
const readStore = useMasterDataReadStore()
const tabsStore = useTabsStore()
const { confirm, success, warning, error } = useKitUI()

const meta = computed(() => FORM_META[props.kind])
const pageFullPath = route.fullPath
const pageKey = deriveKey(pageFullPath)
const routeId = (() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] : value
})()
const isEditing = Boolean(routeId)
const title = computed(() => `${isEditing ? '编辑' : '新建'} · ${meta.value.label}`)
useTabTitle(title)

const draft = ref<MasterDataPageDraft>(
  formDefaults(props.kind) as MasterDataPageDraft,
)
const attachments = shallowRef<FormAttachment[]>([])
const pendingAttachments = shallowRef<PendingMasterDataAttachment[]>([])
const pendingRemoveIds = shallowRef<string[]>([])
const pendingRestoreIds = shallowRef<string[]>([])
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(false)
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = shallowRef(true)
const savedSnapshot = shallowRef('')
const desktopAttachmentPicker = shallowRef(false)
let allowLeave = false

const dirty = computed(() => JSON.stringify(draft.value) !== savedSnapshot.value
  || pendingAttachments.value.length > 0
  || pendingRemoveIds.value.length > 0
  || pendingRestoreIds.value.length > 0)

const sections = computed(() => meta.value.sections)
const attachmentTitle = computed(() => props.kind === 'worker' ? '证书档案' : '附件')

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

async function initialize() {
  loading.value = true
  fieldErrors.value = {}
  pendingAttachments.value = []
  pendingRemoveIds.value = []
  pendingRestoreIds.value = []
  try {
    if (!routeId) {
      draft.value = formDefaults(props.kind) as MasterDataPageDraft
      attachments.value = []
    }
    else {
      const [record, files] = await Promise.all([
        loadRecord(routeId),
        listFormAttachments(props.kind, routeId, true),
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
  }
  finally {
    loading.value = false
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
  if (labels.length)
    warning(`${labels[0]}（共 ${labels.length} 处）`)
  return labels.length === 0
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
      return projectStore.saveForm(draft.value, action, attachmentChanges())
    case 'target_cost':
      return targetCostStore.save(draft.value, action, attachmentChanges())
  }
}

async function handleFooterAction(action: FormFooterAction) {
  if (action === 'cancel') {
    await leaveToList()
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
    success(saveAction === 'draft' ? '草稿已保存' : '保存成功')
    pendingAttachments.value = []
    pendingRemoveIds.value = []
    pendingRestoreIds.value = []
    fieldErrors.value = {}

    if (action === 'saveNew') {
      allowLeave = true
      if (route.path === meta.value.newPath) {
        draft.value = formDefaults(props.kind) as MasterDataPageDraft
        attachments.value = []
        savedSnapshot.value = JSON.stringify(draft.value)
        allowLeave = false
      }
      else {
        tabsStore.close(pageKey)
        await navigateTo(meta.value.newPath)
      }
      return
    }

    if (closeAfterSave.value) {
      allowLeave = true
      tabsStore.close(pageKey)
      await navigateTo(meta.value.listPath)
      return
    }

    if (!isEditing) {
      allowLeave = true
      tabsStore.close(pageKey)
      await navigateTo(`${meta.value.newPath}/${result.id}`)
      return
    }
    await initialize()
  }
  catch (cause) {
    error(`保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
  }
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

  // 普通页签切换保留 KeepAlive 草稿；只有当前表单页签已被关闭时才拦截。
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

onMounted(() => {
  desktopAttachmentPicker.value = isTauri()
  void initialize()
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-1340px items-start gap-4 pb-6">
    <aside
      v-if="sections.length >= 3"
      class="sticky top-4 hidden w-44 shrink-0 rounded-[var(--radius-card)] border border-line bg-panel p-2 xl:block"
      aria-label="表单分区"
    >
      <a
        v-for="section in sections"
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
            <span class="i-lucide-arrow-left" aria-hidden="true" />
            返回{{ meta.listLabel }}
          </button>
          <h1 class="text-20px font-800 text-ink">
            {{ title }}
          </h1>
          <p class="mt-1 text-12px text-ink-faint">
            草稿可暂存不完整内容；提交时校验必填、关联和金额规则。
          </p>
        </div>
        <span v-if="draft.status || draft.approvalStatus" class="chip bg-surface-3 text-ink-soft">
          {{ draft.approvalStatus || draft.status }}
        </span>
      </header>

      <div v-if="loading" class="panel grid min-h-56 place-items-center text-13px text-ink-faint">
        正在载入表单…
      </div>

      <form v-else class="flex flex-col gap-4" @submit.prevent>
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

        <section id="section-note" class="panel scroll-mt-4 p-4">
          <SectionHeader title="备注" />
          <textarea v-model="draft.note" rows="4" class="field-input w-full" placeholder="补充说明" />
        </section>

        <FormFooter
          v-model="closeAfterSave"
          :dirty="dirty"
          close-after-save
          :loading-action="loadingAction"
          @action="handleFooterAction"
        />
      </form>
    </main>
  </div>
</template>
