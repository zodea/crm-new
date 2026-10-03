import type { PendingBudgetFile } from '~/components/target-cost/TargetCostAttachments.vue'
import type { MasterDataSaveAction, TargetCostFormDraft } from '~/lib/master-data/forms'
import type { TargetCostFormRead } from '~/lib/target-cost/central-contract'
import type { BudgetFileChanges } from '~/lib/target-cost/central-files'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { useTargetCostFiles } from '~/composables/useTargetCostFiles'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { TARGET_COST_LIST_PATH, targetCostOrigin, targetCostReturnTo } from '~/lib/target-cost/navigation'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

export function useTargetCostForm() {
  const route = useRoute()
  const router = useRouter()
  const store = useTargetCostStore()
  const tabs = useTabsStore()
  const { confirm, success } = useKitUI()
  const formKey = deriveKey(route.fullPath)
  const generatedDraftKey = generateId('budget-draft')
  const read = shallowRef<TargetCostFormRead | null>(null)
  const latest = shallowRef<TargetCostFormRead | null>(null)
  const draft = ref<TargetCostFormDraft>({})
  const pendingFiles = shallowRef<PendingBudgetFile[]>([])
  const removeIds = shallowRef<string[]>([])
  const restoreIds = shallowRef<string[]>([])
  const error = shallowRef('')
  const fieldErrors = shallowRef<Record<string, string>>({})
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const active = shallowRef(true)
  const loadingAction = shallowRef<'draft' | 'save' | 'saveNew' | 'saveSubmit' | null>(null)
  const original = shallowRef('')
  const formElement = shallowRef<HTMLFormElement | null>(null)
  let sequence = 0
  let started = false
  let allowLeave = false
  let browserBack = false
  const id = computed(() => typeof route.params.id === 'string' ? route.params.id : null)
  const origin = computed(() => targetCostOrigin(route.query.origin))
  const draftKey = computed(() => typeof route.query.draftKey === 'string' ? route.query.draftKey : generatedDraftKey)
  const target = () => JSON.stringify([id.value, origin.value, id.value ? null : draftKey.value])
  const returnTo = computed(() => origin.value ? targetCostReturnTo(route.query.returnTo, origin.value) ?? `${TARGET_COST_LIST_PATH}?origin=${origin.value}` : TARGET_COST_LIST_PATH)
  const matchingRead = computed(() => read.value && read.value.targetCostId === id.value && read.value.context.origin === origin.value && (id.value != null || read.value.draftKey === draftKey.value) ? read.value : null)
  const pending = computed(() => matchingRead.value ? store.getPending(matchingRead.value) : null)
  const busy = computed(() => loading.value || saving.value)
  const editable = computed(() => !!matchingRead.value && !matchingRead.value.deletedAt && !latest.value?.deletedAt && matchingRead.value.context.origin === 'real' && (latest.value?.context ?? matchingRead.value.context).capabilities.includes('target-cost:write') && !busy.value && !pending.value)
  const changes = (): BudgetFileChanges => ({ add: pendingFiles.value.map(({ localId: _localId, ...file }) => file), removeIds: [...removeIds.value], restoreIds: [...restoreIds.value] })
  const snapshot = () => JSON.stringify({ draft: draft.value, files: changes() })
  const dirty = computed(() => !!read.value && original.value !== snapshot())
  const hasUnresolvedDraft = () => !!read.value && !!store.getPending(read.value)
  const projectLabel = computed(() => read.value?.projects.find(project => project.id === draft.value.projectId)?.name ?? (draft.value.projectId ? '已关联项目（当前候选不可读取）' : ''))
  const sessionKey = computed(() => read.value ? JSON.stringify([read.value.context.workspaceId, read.value.context.actorId, read.value.context.origin, read.value.targetCostId ?? read.value.draftKey]) : '')
  const cache = new Map<string, { read: TargetCostFormRead, draft: TargetCostFormDraft, files: PendingBudgetFile[], removeIds: string[], restoreIds: string[], original: string }>()
  const keyFor = (value: TargetCostFormRead) => JSON.stringify([value.context.workspaceId, value.context.actorId, value.context.origin, value.targetCostId ?? value.draftKey])
  const sameTarget = (key: string, request: number) => active.value && key === target() && request === sequence
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  function remember() {
    if (read.value)
      cache.set(keyFor(read.value), { read: read.value, draft: clone(draft.value), files: clone(pendingFiles.value), removeIds: [...removeIds.value], restoreIds: [...restoreIds.value], original: original.value })
  }
  function adopt(value: TargetCostFormRead) {
    read.value = value
    latest.value = null
    const saved = cache.get(keyFor(value))
    const command = store.getPending(value)?.command
    if (saved) {
      read.value = saved.read
      draft.value = clone(saved.draft)
      pendingFiles.value = clone(saved.files)
      removeIds.value = [...saved.removeIds]
      restoreIds.value = [...saved.restoreIds]
      original.value = saved.original
      latest.value = value
      return
    }
    draft.value = clone(value.draft)
    pendingFiles.value = []
    removeIds.value = []
    restoreIds.value = []
    original.value = snapshot()
    if (command?.action.kind === 'save-header') {
      draft.value = clone(command.action.draft)
      pendingFiles.value = (command.action.files?.add ?? []).map((file, index) => ({ ...file, localId: `restored-${index}` }))
      removeIds.value = [...command.action.files?.removeIds ?? []]
      restoreIds.value = [...command.action.files?.restoreIds ?? []]
    }
  }
  async function load(recheck = false) {
    const request = ++sequence
    const requested = target()
    started = true
    loading.value = true
    error.value = ''
    if (!origin.value || (route.params.id != null && !isStableRouteIdentity(route.params.id)) || (!id.value && ((route.query.draftKey != null && !isStableRouteIdentity(route.query.draftKey)) || !isStableRouteIdentity(draftKey.value)))) {
      read.value = null
      error.value = '预算版本或资料来源无效，请从目标成本列表重新进入'
      loading.value = false
      return
    }
    try {
      if (!id.value && route.query.draftKey !== draftKey.value)
        await router.replace({ path: route.path, query: { ...route.query, origin: origin.value, draftKey: draftKey.value } })
      const value = await store.loadForm(id.value, origin.value, id.value ? undefined : draftKey.value)
      if (!sameTarget(requested, request))
        return
      if (value.targetCostId !== id.value || value.context.origin !== origin.value || (!id.value && value.draftKey !== draftKey.value))
        throw new Error('读取的预算与当前版本身份不匹配')
      if (read.value && keyFor(value) === keyFor(read.value) && (recheck || dirty.value || pending.value))
        latest.value = value
      else
        adopt(value)
    }
    catch (cause) {
      if (sameTarget(requested, request))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (sameTarget(requested, request))
        loading.value = false
    }
  }
  async function mayLeave() {
    if (allowLeave)
      return true
    if (saving.value || hasUnresolvedDraft()) {
      error.value = '请先核对原提交，不能丢弃尚未确认的预算操作'
      return false
    }
    if (!dirty.value)
      return true
    const before = snapshot()
    const accepted = await confirm({ variant: 'simple', title: '放弃预算修改', message: '当前版本头或附件尚未保存，确认放弃？', confirmLabel: '放弃修改' })
    return accepted && before === snapshot() && !hasUnresolvedDraft()
  }
  useTabCloseGuard(mayLeave)
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (dirty.value || hasUnresolvedDraft()) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  async function leave() {
    const requested = target()
    if (!await mayLeave() || !active.value || requested !== target())
      return
    if (read.value)
      cache.delete(keyFor(read.value))
    allowLeave = true
    tabs.close(formKey)
    await router.push(returnTo.value)
  }
  async function replaceWithLatest() {
    if (!latest.value || pending.value || busy.value)
      return
    const value = latest.value
    const before = snapshot()
    if (dirty.value && !await confirm({ variant: 'simple', title: '载入最新预算', message: '这会放弃当前未保存的版本头和附件修改，按最新资料重新编辑。', confirmLabel: '放弃修改并载入' }))
      return
    if (!active.value || latest.value !== value || before !== snapshot())
      return
    cache.delete(keyFor(value))
    adopt(value)
    error.value = ''
    fieldErrors.value = {}
  }
  async function focusError(requested: ReturnType<typeof target>, request: number) {
    await nextTick()
    if (!sameTarget(requested, request))
      return
    const first = Object.keys(fieldErrors.value)[0]
    const element = [...formElement.value?.querySelectorAll<HTMLElement>('[data-field]') ?? []].find(element => element.dataset.field === first)
    element?.focus()
  }
  function captureError(cause: unknown) {
    error.value = toErrorMessage(cause)
    const fields = projectProblemFromUnknown(cause).problem.fieldErrors ?? {}
    fieldErrors.value = Object.fromEntries(Object.entries(fields).map(([key, messages]) => [key.replace(/^draft\./, ''), Array.isArray(messages) ? messages.join('；') : String(messages)]))
  }
  async function finish(value: TargetCostFormRead, resultId: string, next = false) {
    cache.delete(keyFor(value))
    allowLeave = true
    tabs.close(formKey)
    await router.push(next ? { path: `${TARGET_COST_LIST_PATH}/form`, query: { origin: 'real', draftKey: generateId('budget-draft') } } : returnTo.value)
    success(`预算版本${resultId ? '已保存' : '操作已完成'}`)
  }
  async function save(action: 'draft' | 'save' | 'saveNew' | 'saveSubmit') {
    const value = matchingRead.value
    if (!value || !editable.value)
      return
    const requested = target()
    const request = sequence
    let focusFailedFields = false
    saving.value = true
    loadingAction.value = action
    error.value = ''
    fieldErrors.value = {}
    try {
      const saveAction: MasterDataSaveAction = action === 'saveSubmit' ? 'submit' : action === 'draft' ? 'draft' : 'save'
      const result = await store.saveForm(value, clone(draft.value), saveAction, changes())
      if (sameTarget(requested, request))
        await finish(value, result.id, action === 'saveNew')
    }
    catch (cause) {
      if (sameTarget(requested, request)) {
        captureError(cause)
        focusFailedFields = true
      }
    }
    finally {
      if (sameTarget(requested, request)) {
        saving.value = false
        loadingAction.value = null
        if (focusFailedFields)
          await focusError(requested, request)
      }
    }
  }
  async function recover() {
    const value = read.value
    const operation = pending.value
    if (!value || !operation || busy.value)
      return
    const requested = target()
    const request = sequence
    saving.value = true
    error.value = ''
    try {
      const result = await store.recover(operation)
      if (sameTarget(requested, request) && (value.targetCostId ? result.id === value.targetCostId : operation.command.draftKey === value.draftKey))
        await finish(value, result.id)
    }
    catch (cause) {
      if (sameTarget(requested, request))
        captureError(cause)
    }
    finally {
      if (sameTarget(requested, request))
        saving.value = false
    }
  }
  async function addFiles(files: File[]) {
    if (!editable.value)
      return
    const requested = target()
    const request = sequence
    try {
      const values = await Promise.all(files.map(async (file) => {
        const converted = await fileRefDraftFromFile(file)
        if (typeof converted.payloadBase64 !== 'string' || converted.fileSize == null)
          throw new Error('附件原件读取失败')
        return { localId: generateId('budget-file'), fileName: file.name, fileSize: converted.fileSize, mimeType: converted.mimeType ?? '', payloadBase64: converted.payloadBase64, category: '' }
      }))
      if (sameTarget(requested, request) && editable.value)
        pendingFiles.value = [...pendingFiles.value, ...values]
    }
    catch (cause) {
      if (sameTarget(requested, request))
        error.value = toErrorMessage(cause)
    }
  }
  function toggleFile(fileId: string) {
    if (!editable.value)
      return
    const file = read.value?.files.find(file => file.id === fileId)
    if (!file)
      return
    const ids = file.deletedAt ? restoreIds : removeIds
    ids.value = ids.value.includes(fileId) ? ids.value.filter(id => id !== fileId) : [...ids.value, fileId]
  }
  async function fetchProjects(keyword: string) {
    if (!matchingRead.value || matchingRead.value.projectOptionsStatus !== 'available')
      return []
    return matchingRead.value.projects.filter(project => `${project.name} ${project.code}`.includes(keyword)).map(project => ({ id: project.id, label: project.name, hint: project.code }))
  }
  watch(target, () => {
    if (!active.value || deriveKey(route.fullPath) !== formKey)
      return
    remember()
    allowLeave = false
    void load()
  }, { immediate: true })
  onDeactivated(() => {
    remember()
    active.value = false
    sequence += 1
    saving.value = false
    loading.value = false
    loadingAction.value = null
  })
  onActivated(() => {
    if (active.value && started)
      return
    active.value = true
    browserBack = false
    allowLeave = false
    void load()
  })
  onScopeDispose(() => {
    active.value = false
    sequence += 1
  })
  useEventListener('popstate', () => {
    browserBack = true
  })
  onBeforeRouteLeave(async () => {
    const explicitBack = browserBack
    browserBack = false
    return !explicitBack || await mayLeave()
  })
  const files = useTargetCostFiles({ current: () => matchingRead.value, active: () => active.value, error: message => error.value = message })
  return { read, matchingRead, latest, draft, pendingFiles, removeIds, restoreIds, error, fieldErrors, loading, loadingAction, pending, busy, editable, dirty, projectLabel, sessionKey, formElement, returnTo, id, origin, load, leave, save, recover, replaceWithLatest, addFiles, toggleFile, fetchProjects, downloadFile: files.download }
}
