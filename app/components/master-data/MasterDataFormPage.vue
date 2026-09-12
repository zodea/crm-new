<script setup lang="ts">
import type { PendingMasterDataAttachment } from './MasterDataAttachmentSection.vue'
import type { CrewFormReadDTO, WorkerFormReadDTO } from '~/lib/crew-worker/command-contract'
import type { CustomerFormReadDTO } from '~/lib/customer/command-contract'
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
import type { SupplierFormReadDTO } from '~/lib/supplier/command-contract'
import { onActivated, onDeactivated, onScopeDispose } from 'vue'
import SupplierTaxpayerDialog from '~/components/supplier/SupplierTaxpayerDialog.vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
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
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { validateSupplierReturnTo } from '~/lib/supplier/return-context'
import { SUPPLIER_CATEGORIES } from '~/lib/supplier/status'
import { createTaxpayerEditorState } from '~/lib/supplier/taxpayer-editor-state'
import { mergeTaxpayerVerification } from '~/lib/supplier/taxpayer-verification'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { CrewWorkerCommandConflictError, useCrewWorkerCommandStore } from '~/stores/crew-worker-command'
import { CustomerCommandConflictError, useCustomerCommandStore } from '~/stores/customer-command'
import {
  ProjectCommandConflictError,
  ProjectLocalDraftOnlyError,
} from '~/stores/project-command'
import { SupplierCommandConflictError, useSupplierCommandStore } from '~/stores/supplier-command'

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
const customerCommandStore = () => useCustomerCommandStore()
const supplierCommandStore = () => useSupplierCommandStore()
const crewWorkerCommandStore = () => useCrewWorkerCommandStore()
const projectSession = projectCommandStore.createSession()
const customerSession = props.kind === 'customer' ? customerCommandStore().createSession() : null
const supplierSession = props.kind === 'supplier' ? supplierCommandStore().createSession() : null
const crewWorkerSession = props.kind === 'crew' || props.kind === 'worker' ? crewWorkerCommandStore().createSession() : null
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
function routeQueryText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined
}
function customerDetailPath(id: string): string {
  const query = new URLSearchParams({ origin: 'real' })
  const returnTo = routeQueryText(route.query.returnTo)
  const returnContext = routeQueryText(route.query.returnContext)
  if (returnTo && returnContext) {
    query.set('returnTo', returnTo)
    query.set('returnContext', returnContext)
  }
  return `/base/customer/${encodeURIComponent(id)}?${query.toString()}`
}
function supplierDetailPath(id: string): string {
  const query = new URLSearchParams({ origin: 'real' })
  const returnTo = validateSupplierReturnTo(routeQueryText(route.query.returnTo))
  if (returnTo)
    query.set('returnTo', returnTo)
  return `/base/supplier/${encodeURIComponent(id)}?${query.toString()}`
}
function supplierCredentialPath(id: string): string {
  const query = new URLSearchParams({ origin: 'real' })
  const returnTo = validateSupplierReturnTo(routeQueryText(route.query.returnTo))
  if (returnTo)
    query.set('returnTo', returnTo)
  return `/base/supplier/credential/${encodeURIComponent(id)}?${query.toString()}`
}
function crewWorkerDetailPath(kind: 'crew' | 'worker', id: string): string {
  const query = new URLSearchParams({ origin: 'real' })
  const returnTo = validateCrewWorkerReturnTo(routeQueryText(route.query.returnTo))
  if (returnTo)
    query.set('returnTo', returnTo)
  return `/base/${kind}/${encodeURIComponent(id)}?${query.toString()}`
}
const returnPath = computed(() =>
  props.returnToDetail && isEditing.value && meta.value.detailPath
    ? props.kind === 'customer'
      ? customerDetailPath(routeId.value ?? '')
      : props.kind === 'supplier'
        ? supplierDetailPath(routeId.value ?? '')
        : props.kind === 'crew' || props.kind === 'worker'
          ? crewWorkerDetailPath(props.kind, routeId.value ?? '')
          : `${meta.value.detailPath}/${routeId.value}${props.kind === 'project' ? '?origin=real' : ''}`
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
const conflictLatest = shallowRef<ProjectFormReadDTO | CustomerFormReadDTO | SupplierFormReadDTO | CrewFormReadDTO | WorkerFormReadDTO | null>(null)
const formElement = useTemplateRef<HTMLFormElement>('formElement')
let allowLeave = false
let lastInitializedTarget = ''

const dirty = computed(() => hydrated.value && (
  JSON.stringify(draft.value) !== savedSnapshot.value
  || pendingAttachments.value.length > 0
  || pendingRemoveIds.value.length > 0
  || pendingRestoreIds.value.length > 0
))

const taxpayerEditor = createTaxpayerEditorState({
  target: () => ({ supplierId: supplierSession?.targetSupplierId ?? null, origin: route.query.origin && route.query.origin !== 'real' ? 'demo' : 'real', version: supplierSession?.baseVersion ?? null, draft: draft.value, saved: savedSnapshot.value ? JSON.parse(savedSnapshot.value) : {}, enabled: props.kind === 'supplier' && !isDesktopRuntime() && hydrated.value && !loadingAction.value }),
  pending: () => supplierSession?.pendingTaxpayerCommand ?? null,
  execute: (input, current) => supplierCommandStore().recordTaxpayerVerification(supplierSession!, input, current),
  read: id => useNuxtApp().$repositories.supplierCommands.loadForm(id),
  apply: (result, verifiedTaxNo) => {
    const saved = savedSnapshot.value ? JSON.parse(savedSnapshot.value) : {}
    const merged = mergeTaxpayerVerification(draft.value, saved, result.verification)
    // 重新核对见到的新税号只有在本页税号未被编辑时才同步；其他草稿保持原样。
    if ((draft.value.taxNo ?? '').trim() === (saved.taxNo ?? '').trim()) {
      merged.draft.taxNo = verifiedTaxNo
      merged.saved.taxNo = verifiedTaxNo
    }
    draft.value = merged.draft as MasterDataPageDraft
    savedSnapshot.value = JSON.stringify(merged.saved)
    success('纳税人核验记录已保存；主档其他输入仍保留')
  },
})
let taxpayerTrigger: HTMLElement | null = null
async function openTaxpayerEditor() {
  taxpayerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const message = taxpayerEditor.begin()
  if (message)
    warning(message)
}
async function closeTaxpayerEditor() {
  if (taxpayerEditor.busy.value || taxpayerEditor.locked.value)
    return
  if (taxpayerEditor.dirty.value && !await confirm({ variant: 'simple', title: '放弃未保存的核验输入？', message: '仅放弃本次核验输入，主档其他输入继续保留。', confirmLabel: '放弃核验输入' }))
    return
  taxpayerEditor.close()
  await nextTick()
  if (taxpayerEditor.active.value && taxpayerTrigger?.isConnected)
    taxpayerTrigger.focus()
}
async function submitTaxpayerEditor() {
  if (await taxpayerEditor.save()) {
    await nextTick()
    if (taxpayerEditor.active.value && taxpayerTrigger?.isConnected)
      taxpayerTrigger.focus()
  }
}

const sections = computed(() => meta.value.sections)
const usesSupplierCredentialFlow = computed(() =>
  meta.value.attachmentMode === 'supplierCredential',
)
const usesCentralCrewWorkerFlow = computed(() =>
  !isDesktopRuntime() && (props.kind === 'crew' || props.kind === 'worker'),
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
async function fetchProjects(keyword: string) {
  if (isDesktopRuntime() || props.kind !== 'worker')
    return readStore.searchProjects(keyword)
  const page = await useNuxtApp().$repositories.projectList.list({
    includeDemo: false,
    search: keyword,
    status: null,
    filters: { statuses: [], plannedEnds: [], managers: [], customerIds: [] },
    sort: 'name-asc',
    page: 1,
    pageSize: 20,
  })
  return page.items.map(item => ({ id: item.project.id, label: item.project.label, hint: item.code }))
}
async function fetchCrews(keyword: string) {
  if (isDesktopRuntime() || props.kind !== 'worker')
    return readStore.searchCrews(keyword)
  const page = await useNuxtApp().$repositories.crewWorkerRead.listCrews({
    includeDemo: false,
    search: keyword,
    trade: null,
    status: null,
    sort: 'name-asc',
    page: 1,
    pageSize: 20,
  })
  return page.items.map(item => ({ id: item.crew.id, label: item.crew.label, hint: item.trade }))
}

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
    if ((props.kind === 'project' || props.kind === 'customer' || props.kind === 'supplier' || props.kind === 'crew' || props.kind === 'worker') && !isDesktopRuntime()) {
      const central = props.kind === 'project'
        ? await projectCommandStore.hydrate(projectSession, routeId.value ?? null)
        : props.kind === 'customer'
          ? await customerCommandStore().hydrate(customerSession!, routeId.value ?? null)
          : props.kind === 'supplier'
            ? await supplierCommandStore().hydrate(supplierSession!, routeId.value ?? null)
            : await crewWorkerCommandStore().hydrate(crewWorkerSession!, props.kind, routeId.value ?? null)
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
      if (props.kind === 'project' && central.restoredLocalDraft) {
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
      return isDesktopRuntime()
        ? supplierStore.saveForm(draft.value, action, attachmentChanges())
        : supplierCommandStore().saveForm(supplierSession!, draft.value, action, attachmentChanges())
    case 'customer':
      return isDesktopRuntime()
        ? customerStore.save(draft.value, action, attachmentChanges())
        : customerCommandStore().saveForm(customerSession!, draft.value, action, attachmentChanges())
    case 'crew':
      return isDesktopRuntime()
        ? crewStore.save(draft.value, action, attachmentChanges())
        : crewWorkerCommandStore().saveCrew(crewWorkerSession!, draft.value, action, attachmentChanges())
    case 'worker':
      return isDesktopRuntime()
        ? workerStore.save(draft.value, action, attachmentChanges())
        : crewWorkerCommandStore().saveWorker(crewWorkerSession!, draft.value, action, attachmentChanges())
    case 'project':
      return isDesktopRuntime()
        ? projectStore.saveForm(draft.value, action, attachmentChanges())
        : projectCommandStore.saveForm(projectSession, draft.value, action, attachmentChanges())
    case 'target_cost':
      return targetCostStore.save(draft.value, action, attachmentChanges())
  }
}

async function handleFooterAction(action: FormFooterAction) {
  if (taxpayerEditor.open.value) {
    warning('请先完成或取消当前税务核验')
    return
  }
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
      if (props.kind === 'project' && !isDesktopRuntime())
        projectCommandStore.startNewProject(projectSession)
      if (props.kind === 'customer' && !isDesktopRuntime())
        customerCommandStore().startNewCustomer(customerSession!)
      if (props.kind === 'supplier' && !isDesktopRuntime())
        supplierCommandStore().startNewSupplier(supplierSession!)
      if ((props.kind === 'crew' || props.kind === 'worker') && !isDesktopRuntime())
        crewWorkerCommandStore().startNew(crewWorkerSession!, props.kind)
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
      const originSuffix = props.kind === 'project' || props.kind === 'crew' || props.kind === 'worker'
        ? `${detailSuffix ? '&' : '?'}origin=real`
        : ''
      const closePath = props.kind === 'customer' && props.returnToDetail
        ? customerDetailPath(routeId.value ?? result.id)
        : props.kind === 'supplier' && props.returnToDetail
          ? supplierDetailPath(routeId.value ?? result.id)
          : (props.kind === 'crew' || props.kind === 'worker') && props.returnToDetail
              ? crewWorkerDetailPath(props.kind, routeId.value ?? result.id)
              : (props.returnToDetail || meta.value.postSaveDetailTab) && meta.value.detailPath
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
    else if (cause instanceof CustomerCommandConflictError) {
      conflictLatest.value = cause.latest
      warning(cause.message)
    }
    else if (cause instanceof SupplierCommandConflictError) {
      conflictLatest.value = cause.latest
      warning(cause.message)
    }
    else if (cause instanceof CrewWorkerCommandConflictError) {
      conflictLatest.value = cause.latest
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
  if (props.kind === 'customer')
    customerCommandStore().rebase(customerSession!, conflictLatest.value.version)
  else if (props.kind === 'supplier')
    supplierCommandStore().rebase(supplierSession!, conflictLatest.value.version)
  else if (props.kind === 'crew' || props.kind === 'worker')
    crewWorkerCommandStore().rebase(crewWorkerSession!, props.kind, conflictLatest.value.version)
  else
    projectCommandStore.rebase(projectSession, conflictLatest.value.version)
  conflictLatest.value = null
  localDraftNotice.value = '已保留你的内容并基于服务器最新版本；请再次保存以提交。'
}

async function useLatestServerVersion() {
  const latest = conflictLatest.value
  if (!latest)
    return
  if (props.kind === 'customer')
    customerCommandStore().acceptLatest(customerSession!, latest as CustomerFormReadDTO)
  else if (props.kind === 'supplier')
    supplierCommandStore().acceptLatest(supplierSession!, latest as SupplierFormReadDTO)
  else if (props.kind === 'crew' || props.kind === 'worker')
    crewWorkerCommandStore().acceptLatest(crewWorkerSession!, props.kind, latest as CrewFormReadDTO | WorkerFormReadDTO)
  else
    projectCommandStore.acceptLatest(projectSession, latest as ProjectFormReadDTO)
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
  if (taxpayerEditor.busy.value)
    return
  if (dirty.value || taxpayerEditor.dirty.value) {
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

useTabCloseGuard(async () => {
  if (taxpayerEditor.busy.value)
    return false
  if (allowLeave || (!dirty.value && !taxpayerEditor.dirty.value))
    return true

  const leave = await confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
  return leave
})

onMounted(() => {
  desktopAttachmentPicker.value = isDesktopRuntime()
  void initialize()
})

onActivated(() => {
  taxpayerEditor.activate()
  const target = `${props.kind}:${routeId.value ?? 'new'}`
  if (lastInitializedTarget && target !== lastInitializedTarget)
    void initialize()
})
onDeactivated(taxpayerEditor.deactivate)
onScopeDispose(taxpayerEditor.deactivate)

watch(routeSupplierCategory, () => {
  if (props.kind === 'supplier' && !isEditing.value)
    void initialize()
})
</script>

<template>
  <EntityFormShell
    :title="title"
    :subtitle="kind === 'supplier' ? undefined : '草稿可暂存不完整内容；提交时校验必填、关联和金额规则。'"
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
        {{ meta.label }}已被其他操作更新
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
        @verify-taxpayer="openTaxpayerEditor"
      />

      <MasterDataAttachmentSection
        v-if="!usesSupplierCredentialFlow && !usesCentralCrewWorkerFlow"
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
        v-else-if="usesSupplierCredentialFlow"
        id="section-attachments"
        data-ui="supplier-credential-guidance"
        class="panel scroll-mt-4 p-4"
      >
        <SectionHeader title="证照资料" />
        <div class="mt-3 flex min-w-0 flex-wrap items-center gap-3 text-12px text-ink-soft">
          <NuxtLink
            v-if="isEditing && routeId"
            :to="supplierCredentialPath(routeId)"
            class="btn-secondary shrink-0"
          >
            前往证照附件
          </NuxtLink>
          <span v-else>保存分供方后可维护证照资料。</span>
        </div>
      </section>

      <section
        v-else
        id="section-attachments"
        data-ui="crew-worker-central-attachment-guidance"
        class="panel scroll-mt-4 p-4"
      >
        <SectionHeader title="附件" subtitle="班组与工人正式主数据只通过中央命令保存。" />
        <p class="mt-3 border border-line bg-surface-2 p-3 text-12px leading-5 text-ink-soft">
          中央附件边界尚未接入；当前表单不会回退到本地附件，也不会生成并行正式来源。
        </p>
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
  <SupplierTaxpayerDialog v-if="taxpayerEditor.open.value && taxpayerEditor.active.value" :value="taxpayerEditor.form" :tax-no="taxpayerEditor.taxNo.value" :busy="taxpayerEditor.busy.value" :locked="taxpayerEditor.locked.value" :conflict="taxpayerEditor.conflict.value" :error="taxpayerEditor.error.value" :summary="taxpayerEditor.summary.value" @patch="patch => { if (!taxpayerEditor.busy.value && !taxpayerEditor.locked.value && !taxpayerEditor.conflict.value) Object.assign(taxpayerEditor.form, patch) }" @submit="submitTaxpayerEditor" @cancel="closeTaxpayerEditor" @recheck="taxpayerEditor.recheck" />
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
