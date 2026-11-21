<script setup lang="ts">
import type { PendingMasterDataAttachment } from './MasterDataAttachmentSection.vue'
import type { CrewFormReadDTO, WorkerFormReadDTO } from '~/lib/crew-worker/command-contract'
import type { CrewListPageDTO } from '~/lib/crew-worker/read-contract'
import type { CustomerFormReadDTO } from '~/lib/customer/command-contract'
import type { CustomerListPageDTO } from '~/lib/customer/read-contract'
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
import type { ProjectListPageDTO } from '~/lib/project/read-contract'
import type { SupplierFormReadDTO } from '~/lib/supplier/command-contract'
import { onActivated, onDeactivated, onScopeDispose } from 'vue'
import CommandRecoveryPanel from '~/components/shared/CommandRecoveryPanel.vue'
import SupplierTaxpayerDialog from '~/components/supplier/SupplierTaxpayerDialog.vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { crewFeePriceIssues } from '~/lib/crew-worker/payroll-fee-defaults'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { customerOriginal } from '~/lib/customer/original'
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
import { projectOriginal } from '~/lib/project/original'
import { collectReadPages } from '~/lib/read-model/collection'
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
import { ProjectPersistentConflictError } from '~/stores/project-persistent-command'
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
const projectCommandStore = useProjectCommandStore()
const customerCommandStore = () => useCustomerCommandStore()
const supplierCommandStore = () => useSupplierCommandStore()
const crewWorkerCommandStore = () => useCrewWorkerCommandStore()
const projectSession = projectCommandStore.createSession()
const customerSession = props.kind === 'customer' ? customerCommandStore().createSession() : null
const customerStoresOriginals = shallowRef(false)
const projectStoresOriginals = shallowRef(false)
const storesOriginals = computed(() => customerStoresOriginals.value || projectStoresOriginals.value)
const preparingOriginals = shallowRef(0)
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
const localDraftNotice = shallowRef('')
const conflictLatest = shallowRef<ProjectFormReadDTO | CustomerFormReadDTO | SupplierFormReadDTO | CrewFormReadDTO | WorkerFormReadDTO | null>(null)
const customerAlreadyApplied = shallowRef(false)
const formalSession = computed(() => customerSession?.storesOriginals
  ? customerSession.persistent
  : props.kind === 'project' && projectSession.storesOriginals
    ? projectSession.persistent
    : supplierSession?.persistent
      ? supplierSession.formal
      : crewWorkerSession && (props.kind === 'crew' || props.kind === 'worker') ? crewWorkerCommandStore().formSession(crewWorkerSession, props.kind) : null)
const pendingOriginal = computed(() => formalSession.value?.pending ?? null)
const heldSubmission = shallowRef<{ draft: MasterDataPageDraft, files: PendingMasterDataAttachment[], changes: FormAttachmentChanges } | null>(null)
const formElement = useTemplateRef<HTMLFormElement>('formElement')
let allowLeave = false
let lastInitializedTarget = ''
let viewGeneration = 0
let viewActive = true
function captureView() {
  return { generation: viewGeneration, path: pageFullPath.value }
}
function isCurrentView(view: ReturnType<typeof captureView>) {
  return viewActive && view.generation === viewGeneration && view.path === pageFullPath.value
}

const dirty = computed(() => hydrated.value && (
  JSON.stringify(draft.value) !== savedSnapshot.value
  || pendingAttachments.value.length > 0
  || pendingRemoveIds.value.length > 0
  || pendingRestoreIds.value.length > 0
))

const taxpayerEditor = createTaxpayerEditorState({
  target: () => ({ supplierId: supplierSession?.targetSupplierId ?? null, origin: route.query.origin && route.query.origin !== 'real' ? 'demo' : 'real', version: supplierSession?.baseVersion ?? null, draft: draft.value, saved: savedSnapshot.value ? JSON.parse(savedSnapshot.value) : {}, enabled: props.kind === 'supplier' && hydrated.value && !loadingAction.value }),
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

// 浏览器预算有独立中央表单；不启动此页的本地记录、附件或保存流程。
const centralTargetCost = props.kind === 'target_cost'
let taxpayerTrigger: HTMLElement | null = null
async function openTaxpayerEditor() {
  taxpayerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const message = taxpayerEditor.begin()
  if (message)
    warning(message)
}
async function closeTaxpayerEditor() {
  const view = captureView()
  const trigger = taxpayerTrigger
  if (taxpayerEditor.busy.value || taxpayerEditor.locked.value)
    return
  if (taxpayerEditor.dirty.value && !await confirm({ variant: 'simple', title: '放弃未保存的核验输入？', message: '仅放弃本次核验输入，主档其他输入继续保留。', confirmLabel: '放弃核验输入' }))
    return
  if (!isCurrentView(view))
    return
  taxpayerEditor.close()
  await nextTick()
  if (isCurrentView(view) && taxpayerEditor.active.value && trigger?.isConnected)
    trigger.focus()
}
async function submitTaxpayerEditor() {
  const view = captureView()
  const trigger = taxpayerTrigger
  if (await taxpayerEditor.save()) {
    await nextTick()
    if (isCurrentView(view) && taxpayerEditor.active.value && trigger?.isConnected)
      trigger.focus()
  }
}

const sections = computed(() => meta.value.sections)
const usesSupplierCredentialFlow = computed(() =>
  meta.value.attachmentMode === 'supplierCredential',
)
const usesCentralCrewWorkerFlow = computed(() =>
  props.kind === 'crew' || props.kind === 'worker',
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

async function fetchCustomers(keyword: string) {
  if (props.kind !== 'project')
    return readStore.searchCustomers(keyword)
  const view = captureView()
  const collection = await collectReadPages<CustomerListPageDTO>({ load: page => useNuxtApp().$repositories.customerRead.list({ includeDemo: false, search: keyword, status: null, sort: 'name-asc', page, pageSize: 100 }), identity: item => `${item.dataOrigin}:${item.customer.id}`, isCurrent: () => isCurrentView(view) })
  return collection.items.filter(item => item.dataOrigin === 'real' && item.status !== 'inactive').map(item => ({ id: item.customer.id, label: item.customer.label }))
}
async function fetchProjects(keyword: string) {
  if (props.kind !== 'worker')
    return readStore.searchProjects(keyword)
  const view = captureView()
  const collection = await collectReadPages<ProjectListPageDTO>({ load: page => useNuxtApp().$repositories.projectList.list({
    includeDemo: false,
    search: keyword,
    status: null,
    filters: { statuses: [], plannedEnds: [], managers: [], customerIds: [] },
    sort: 'name-asc',
    page,
    pageSize: 100,
  }), identity: item => `${item.dataOrigin}:${item.project.id}`, isCurrent: () => isCurrentView(view) })
  return collection.items.map(item => ({ id: item.project.id, label: item.project.label, hint: item.code }))
}
async function fetchCrews(keyword: string) {
  if (props.kind !== 'worker')
    return readStore.searchCrews(keyword)
  const view = captureView()
  const collection = await collectReadPages<CrewListPageDTO>({ load: page => useNuxtApp().$repositories.crewWorkerRead.listCrews({
    includeDemo: false,
    search: keyword,
    trade: null,
    status: null,
    sort: 'name-asc',
    page,
    pageSize: 100,
  }), identity: item => `${item.dataOrigin}:${item.crew.id}`, isCurrent: () => isCurrentView(view) })
  return collection.items.map(item => ({ id: item.crew.id, label: item.crew.label, hint: item.trade }))
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

async function initialize(retainInput = false) {
  viewGeneration++
  preparingOriginals.value = 0
  const view = captureView()
  if (pendingOriginal.value && route.query.origin && route.query.origin !== 'real') {
    hydrated.value = false
    loadError.value = '请恢复原真实来源后核对提交。'
    return
  }
  if (pendingOriginal.value && heldSubmission.value && pendingOriginal.value.descriptor.targetId === (routeId.value ?? null) && (!route.query.origin || route.query.origin === 'real')) {
    await recoverOriginal()
    return
  }
  if (retainInput && savedSnapshot.value && lastInitializedTarget === `${props.kind}:${routeId.value ?? 'new'}`) {
    hydrated.value = false
    loading.value = true
    loadError.value = ''
    try {
      if (route.query.origin && route.query.origin !== 'real')
        throw new Error('请恢复原真实来源后继续编辑；本页输入仍保留。')
      if (props.kind === 'project') {
        await projectCommandStore.revalidate(projectSession)
      }
      else if (props.kind === 'customer') {
        await customerCommandStore().revalidate(customerSession!)
      }
      else if (props.kind === 'supplier') {
        await supplierCommandStore().revalidate(supplierSession!)
      }
      else if (props.kind === 'crew' || props.kind === 'worker') {
        await crewWorkerCommandStore().revalidate(crewWorkerSession!, props.kind)
      }
      if (isCurrentView(view))
        hydrated.value = true
    }
    catch (cause) {
      if (isCurrentView(view))
        loadError.value = toErrorMessage(cause)
    }
    finally {
      if (isCurrentView(view))
        loading.value = false
    }
    return
  }
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
  customerAlreadyApplied.value = false
  let shouldFocus = false
  try {
    if ((props.kind === 'customer' || props.kind === 'project' || props.kind === 'supplier') && route.query.origin && route.query.origin !== 'real')
      throw new Error('正式表单只能读取真实来源，请恢复原来源后继续。')
    if ((props.kind === 'project' || props.kind === 'customer' || props.kind === 'supplier' || props.kind === 'crew' || props.kind === 'worker')) {
      const central = props.kind === 'project'
        ? await projectCommandStore.hydrate(projectSession, routeId.value ?? null)
        : props.kind === 'customer'
          ? await customerCommandStore().hydrate(customerSession!, routeId.value ?? null)
          : props.kind === 'supplier'
            ? await supplierCommandStore().hydrate(supplierSession!, routeId.value ?? null)
            : await crewWorkerCommandStore().hydrate(crewWorkerSession!, props.kind, routeId.value ?? null)
      if (!isCurrentView(view))
        return
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
      customerStoresOriginals.value = customerSession?.storesOriginals ?? false
      projectStoresOriginals.value = props.kind === 'project' && projectSession.storesOriginals
      if ('productionNotice' in central && central.productionNotice)
        localDraftNotice.value = central.productionNotice
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
      if (!isCurrentView(view))
        return
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
    if (!isCurrentView(view))
      return
    savedSnapshot.value = JSON.stringify(draft.value)
    hydrated.value = true
    shouldFocus = true
  }
  catch (cause) {
    if (isCurrentView(view))
      loadError.value = toErrorMessage(cause)
  }
  finally {
    if (isCurrentView(view))
      loading.value = false
    if (shouldFocus && isCurrentView(view)) {
      await nextTick()
      if (isCurrentView(view)) {
        formElement.value
          ?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
          ?.focus({ preventScroll: true })
      }
    }
  }
}

function validateForSave(action: MasterDataSaveAction): boolean {
  const errors: Record<string, string> = {}
  if (action !== 'draft') {
    for (const [field, label] of formRequiredFields(props.kind)) {
      const value = draft.value[field as keyof MasterDataPageDraft]
      if (typeof value === 'string' ? !value.trim() : value == null)
        errors[field] = `${label}为必填项`
    }
  }
  if (props.kind === 'crew') {
    for (const { field, message } of crewFeePriceIssues(draft.value))
      errors[field] = message
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
      return supplierCommandStore().saveForm(supplierSession!, draft.value, action, attachmentChanges())
    case 'customer':
      return customerCommandStore().saveForm(customerSession!, draft.value, action, attachmentChanges())
    case 'crew':
      return crewWorkerCommandStore().saveCrew(crewWorkerSession!, draft.value, action, attachmentChanges())
    case 'worker':
      return crewWorkerCommandStore().saveWorker(crewWorkerSession!, draft.value, action, attachmentChanges())
    case 'project':
      return projectCommandStore.saveForm(projectSession, draft.value, action, attachmentChanges())
    case 'target_cost':
      return targetCostStore.save(draft.value, action, attachmentChanges())
  }
}

async function handleFooterAction(action: FormFooterAction) {
  if (action !== 'cancel' && (loadingAction.value || pendingOriginal.value)) {
    warning('请先核对原提交，再保存新的内容。')
    return
  }
  if (action !== 'cancel' && customerAlreadyApplied.value) {
    warning('上次提交已经保存，请先使用已保存内容，再继续更正；不要重复添加原件。')
    return
  }
  if (preparingOriginals.value) {
    warning('附件原件正在读取，请完成后再保存。')
    return
  }
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
  if ((saveAction !== 'draft' || props.kind === 'crew') && !validateForSave(saveAction))
    return

  loadingAction.value = action
  const view = captureView()
  const sent = { draft: JSON.parse(JSON.stringify(draft.value)) as MasterDataPageDraft, files: JSON.parse(JSON.stringify(pendingAttachments.value)) as PendingMasterDataAttachment[], changes: JSON.parse(JSON.stringify(attachmentChanges())) as FormAttachmentChanges }
  if (formalSession.value)
    heldSubmission.value = sent
  try {
    const result = await saveThroughStore(saveAction)
    if (!isCurrentView(view))
      return
    if ('readbackConfirmed' in result && result.readbackConfirmed) {
      const retained = acknowledgeSubmission(result.form, sent)
      heldSubmission.value = null
      if (retained) {
        warning('本次提交已保存；保存期间继续编辑的内容仍在页面，请作为新的更正保存。')
        return
      }
    }
    success(saveAction === 'draft'
      ? '草稿已保存'
      : meta.value.saveSuccessMessage ?? '保存成功')
    pendingAttachments.value = []
    pendingRemoveIds.value = []
    pendingRestoreIds.value = []
    fieldErrors.value = {}

    if (action === 'saveNew') {
      if (props.kind === 'project')
        projectCommandStore.startNewProject(projectSession)
      if (props.kind === 'customer')
        customerCommandStore().startNewCustomer(customerSession!)
      if (props.kind === 'supplier')
        supplierCommandStore().startNewSupplier(supplierSession!)
      if ((props.kind === 'crew' || props.kind === 'worker'))
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
        const submittedKey = pageKey.value
        await navigateTo(closePath)
        tabsStore.close(submittedKey)
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
    if (!('readbackConfirmed' in result))
      await initialize()
  }
  catch (cause) {
    if (!isCurrentView(view))
      return
    if (cause instanceof ProjectPersistentConflictError) {
      conflictLatest.value = cause.latest
      customerAlreadyApplied.value = cause.alreadyApplied
      warning(cause.message)
    }
    else if (cause instanceof ProjectCommandConflictError) {
      conflictLatest.value = cause.latest
      localDraftNotice.value = '当前内容仍只保留在本地，未覆盖服务器最新版本。'
      warning(cause.message)
    }
    else if (cause instanceof CustomerCommandConflictError) {
      conflictLatest.value = cause.latest
      customerAlreadyApplied.value = cause.alreadyApplied
      warning(cause.message)
    }
    else if (cause instanceof SupplierCommandConflictError) {
      conflictLatest.value = cause.latest
      customerAlreadyApplied.value = cause.alreadyApplied
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
      if (pendingOriginal.value && !formalSession.value?.context) {
        hydrated.value = false
        loadError.value = toErrorMessage(cause)
      }
      error(`保存失败：${toErrorMessage(cause)}`)
    }
  }
  finally {
    if (isCurrentView(view))
      loadingAction.value = null
  }
}

function acknowledgeSubmission(form: CustomerFormReadDTO | ProjectFormReadDTO | SupplierFormReadDTO, sent: NonNullable<typeof heldSubmission.value>) {
  const retained = JSON.stringify(draft.value) !== JSON.stringify(sent.draft)
  attachments.value = form.attachments
  pendingAttachments.value = pendingAttachments.value.filter(file => !sent.files.some(original => original.localId === file.localId && JSON.stringify(original) === JSON.stringify(file)))
  pendingRemoveIds.value = pendingRemoveIds.value.filter(id => !sent.changes.removeIds?.includes(id))
  pendingRestoreIds.value = pendingRestoreIds.value.filter(id => !sent.changes.restoreIds?.includes(id))
  if (retained) {
    draft.value = { ...draft.value, id: form.draft.id }
    savedSnapshot.value = JSON.stringify({ ...sent.draft, id: form.draft.id })
  }
  else {
    draft.value = { ...formDefaults(props.kind), ...form.draft } as MasterDataPageDraft
    savedSnapshot.value = JSON.stringify(draft.value)
  }
  fieldErrors.value = {}
  return retained || pendingAttachments.value.length > 0 || pendingRemoveIds.value.length > 0 || pendingRestoreIds.value.length > 0
}

async function recoverOriginal() {
  if (!pendingOriginal.value || formalSession.value?.busy)
    return
  const view = captureView()
  try {
    if (route.query.origin && route.query.origin !== 'real')
      throw new Error('请恢复原真实来源后核对提交。')
    const resolved = props.kind === 'customer'
      ? await customerCommandStore().recover(customerSession!)
      : props.kind === 'supplier'
        ? await supplierCommandStore().recover(supplierSession!)
        : (props.kind === 'crew' || props.kind === 'worker') ? await crewWorkerCommandStore().recover(crewWorkerSession!, props.kind) : await projectCommandStore.recover(projectSession)
    if (!isCurrentView(view))
      return
    if (resolved.outcome === 'applied') {
      if (heldSubmission.value) {
        acknowledgeSubmission(resolved.form, heldSubmission.value)
      }
      else {
        draft.value = { ...formDefaults(props.kind), ...resolved.form.draft } as MasterDataPageDraft
        attachments.value = resolved.form.attachments
        savedSnapshot.value = JSON.stringify(draft.value)
      }
      localDraftNotice.value = '已核对原提交并读取已保存记录。当前页面保留继续编辑的内容，请确认后再作新的更正。'
    }
    else {
      localDraftNotice.value = '原提交没有保存，原编号已封存；当前输入保留，可以重新保存。'
    }
    heldSubmission.value = null
    loadError.value = ''
    hydrated.value = true
  }
  catch (cause) {
    if (!isCurrentView(view))
      return
    error(`核对失败：${toErrorMessage(cause)}`)
    if (!formalSession.value?.context) {
      hydrated.value = false
      loadError.value = toErrorMessage(cause)
    }
  }
}

function keepLocalAgainstLatest() {
  if (!conflictLatest.value)
    return
  if (conflictLatest.value.draft.id !== draft.value.id || !hydrated.value || !viewActive) {
    conflictLatest.value = null
    return
  }
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
  if (!latest || latest.draft.id !== draft.value.id || !hydrated.value || !viewActive)
    return
  const view = captureView()
  if (props.kind === 'customer') {
    try {
      customerCommandStore().acceptLatest(customerSession!, latest as CustomerFormReadDTO)
    }
    catch (cause) {
      error(toErrorMessage(cause))
      return
    }
  }
  else if (props.kind === 'supplier') {
    supplierCommandStore().acceptLatest(supplierSession!, latest as SupplierFormReadDTO)
  }
  else if (props.kind === 'crew' || props.kind === 'worker') {
    crewWorkerCommandStore().acceptLatest(crewWorkerSession!, props.kind, latest as CrewFormReadDTO | WorkerFormReadDTO)
  }
  else {
    projectCommandStore.acceptLatest(projectSession, latest as ProjectFormReadDTO)
  }
  customerAlreadyApplied.value = false
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
  if (isCurrentView(view))
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

async function handleFiles(files: File[]) {
  const view = captureView()
  preparingOriginals.value++
  try {
    const originals = storesOriginals.value
      ? await Promise.all(files.map(props.kind === 'project' ? projectOriginal : customerOriginal))
      : files.map(file => ({ fileName: file.name, fileSize: file.size, mimeType: file.type }))
    if (isCurrentView(view))
      appendPendingAttachments(originals)
  }
  catch (cause) {
    if (isCurrentView(view)) {
      error(toErrorMessage(cause))
    }
  }
  finally {
    if (isCurrentView(view))
      preparingOriginals.value = Math.max(0, preparingOriginals.value - 1)
  }
}

async function downloadCustomerOriginal(file: FormAttachment) {
  const view = captureView()
  const session = formalSession.value
  const generation = session?.generation
  const context = session?.context
  try {
    const blob = props.kind === 'project'
      ? await projectCommandStore.downloadOriginal(file.ownerId, file.id)
      : await customerCommandStore().downloadOriginal(file.ownerId, file.id)
    if (!isCurrentView(view) || !hydrated.value || file.ownerId !== draft.value.id
      || session !== formalSession.value || session?.generation !== generation || session?.context !== context
      || !attachments.value.some(current => current.id === file.id && current.ownerId === file.ownerId && !current.deletedAt)) {
      return
    }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }
  catch (cause) {
    if (isCurrentView(view))
      error(toErrorMessage(cause))
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
  if (dirty.value || pendingOriginal.value || taxpayerEditor.dirty.value) {
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

if (!centralTargetCost) {
  useTabCloseGuard(async () => {
    if (taxpayerEditor.busy.value)
      return false
    if (allowLeave || (!dirty.value && !pendingOriginal.value && !taxpayerEditor.dirty.value))
      return true

    const leave = await confirm({
      variant: 'simple',
      title: '放弃修改',
      message: '当前表单还有未保存内容，确认离开？',
      confirmLabel: '放弃修改',
    })
    return leave
  })
}

onMounted(() => {
  if (centralTargetCost)
    return
  void initialize()
})

onActivated(() => {
  if (centralTargetCost)
    return
  taxpayerEditor.activate()
  const wasInactive = !viewActive
  viewActive = true
  const target = `${props.kind}:${routeId.value ?? 'new'}`
  if (wasInactive || (lastInitializedTarget && target !== lastInitializedTarget))
    void initialize(wasInactive && target === lastInitializedTarget)
})
function deactivateView() {
  viewActive = false
  viewGeneration++
  taxpayerEditor.deactivate()
  if (props.kind === 'project')
    projectCommandStore.deactivate(projectSession)
  else if (customerSession)
    customerCommandStore().deactivate(customerSession)
  else if (supplierSession)
    supplierCommandStore().deactivate(supplierSession)
  if (crewWorkerSession && (props.kind === 'crew' || props.kind === 'worker'))
    crewWorkerCommandStore().deactivate(crewWorkerSession, props.kind)
  preparingOriginals.value = 0
  loadingAction.value = null
  loading.value = false
}
onDeactivated(deactivateView)
onScopeDispose(deactivateView)

watch(routeSupplierCategory, () => {
  if (props.kind === 'supplier' && !isEditing.value)
    void initialize()
})
watch(() => [routeId.value, route.query.origin], () => {
  if ((props.kind !== 'customer' && props.kind !== 'project' && props.kind !== 'supplier' && props.kind !== 'crew' && props.kind !== 'worker'))
    return
  const session = formalSession.value
  if (session) {
    session.generation++
    session.context = null
    session.busy = false
  }
  if (pendingOriginal.value?.descriptor.targetId !== (routeId.value ?? null))
    heldSubmission.value = null
  void initialize()
})
</script>

<template>
  <CommandRecoveryPanel v-if="pendingOriginal" :command-id="pendingOriginal.id" :saved="Boolean(pendingOriginal.result)" :busy="Boolean(formalSession?.busy)" @recover="recoverOriginal" />
  <CentralTargetCostFormScreen v-if="centralTargetCost" />
  <EntityFormShell
    v-else
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
      <b class="text-warn">{{ customerStoresOriginals || supplierSession?.persistent ? '提交核对' : '本地草稿' }}</b>
      · {{ localDraftNotice }}
    </section>

    <section
      v-if="conflictLatest"
      data-ui="project-version-conflict"
      class="border border-danger/30 bg-danger/6 p-3"
      role="alert"
    >
      <h2 class="text-13px font-800 text-danger">
        {{ customerAlreadyApplied ? `上次${meta.label}提交已保存` : `${meta.label}已被其他操作更新` }}
      </h2>
      <p class="mt-1 text-12px leading-5 text-ink-soft">
        {{ customerAlreadyApplied ? `已核对原${meta.label}和附件。当前输入仍保留在页面，采用已保存内容后再作新的更正，避免重复添加原件。` : `服务器最新版本为 ${conflictLatest.version}。请选择保留当前内容后重试，或改用服务器版本。` }}
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        <button v-if="!customerAlreadyApplied" type="button" class="btn-primary" @click="keepLocalAgainstLatest">
          保留我的内容
        </button>
        <button type="button" class="btn-secondary" @click="useLatestServerVersion">
          {{ customerAlreadyApplied ? '使用已保存内容' : '改用服务器最新版' }}
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
        :stores-originals="storesOriginals"
        :original-description="kind === 'project' ? '原件随项目一同保存，重启后可下载；单份不超过 10 MiB' : undefined"
        :attachments="attachments"
        :pending-attachments="pendingAttachments"
        :pending-remove-ids="pendingRemoveIds"
        :pending-restore-ids="pendingRestoreIds"
        :files-disabled="Boolean(loadingAction || pendingOriginal || preparingOriginals)"
        @files="handleFiles"
        @download="downloadCustomerOriginal"
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
        :write-disabled="Boolean(pendingOriginal || preparingOriginals || !hydrated)"
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
