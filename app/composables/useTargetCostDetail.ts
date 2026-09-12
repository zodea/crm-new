import type { TargetCostDetailRead } from '~/lib/target-cost/central-contract'
import type { TargetCostItemDraft } from '~/lib/target-cost/items'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { TARGET_COST_LIST_PATH, targetCostOrigin, targetCostReturnTo } from '~/lib/target-cost/navigation'
import { toErrorMessage } from '~/lib/util/error'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

export function useTargetCostDetail() {
  const route = useRoute()
  const router = useRouter()
  const store = useTargetCostDetailStore()
  const commandStore = useTargetCostStore()
  const { confirm, success } = useKitUI()
  const read = shallowRef<TargetCostDetailRead | null>(null)
  const latest = shallowRef<TargetCostDetailRead | null>(null)
  const itemDrafts = shallowRef<TargetCostItemDraft[]>([])
  const editing = shallowRef(false)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  const readState = shallowRef<'error' | 'not-found'>('error')
  const active = shallowRef(true)
  const itemEditor = shallowRef<{ validate: () => Promise<unknown[]>, setServerErrors: (errors: Record<string, string | string[]>) => Promise<void> } | null>(null)
  const pageKey = deriveKey(route.fullPath)
  const id = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
  const origin = computed(() => targetCostOrigin(route.query.origin))
  let original = ''
  let sequence = 0
  const target = () => JSON.stringify([id.value, origin.value])
  const sameTarget = (key: string, request: number) => active.value && target() === key && sequence === request
  const current = computed(() => read.value?.targetCostId === id.value && read.value.context.origin === origin.value ? read.value : null)
  const pending = computed(() => current.value ? commandStore.getPending(current.value) : null)
  const dirty = computed(() => !!read.value && editing.value && JSON.stringify(itemDrafts.value) !== original)
  const hasUnresolvedDraft = () => !!read.value && !!commandStore.getPending(read.value)
  const busy = computed(() => loading.value || saving.value)
  const editable = computed(() => !!current.value && !current.value.deletedAt && !latest.value?.deletedAt && current.value.context.origin === 'real' && (latest.value?.context ?? current.value.context).capabilities.includes('target-cost:write') && !busy.value && !pending.value)
  const returnTo = computed(() => origin.value ? targetCostReturnTo(route.query.returnTo, origin.value) ?? `${TARGET_COST_LIST_PATH}?origin=${origin.value}` : TARGET_COST_LIST_PATH)
  let commandSequence = 0
  let started = false
  let browserBack = false
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  const keyFor = (value: TargetCostDetailRead) => JSON.stringify([value.context.workspaceId, value.context.actorId, value.context.origin, value.targetCostId])
  const cache = new Map<string, { read: TargetCostDetailRead, drafts: TargetCostItemDraft[], editing: boolean, original: string }>()
  function remember() {
    if (read.value)
      cache.set(keyFor(read.value), { read: read.value, drafts: clone(itemDrafts.value), editing: editing.value, original })
  }
  function adopt(value: TargetCostDetailRead) {
    read.value = value
    latest.value = null
    editing.value = false
    itemDrafts.value = []
    original = ''
    const saved = cache.get(keyFor(value))
    const operation = commandStore.getPending(value)
    if (saved?.editing) {
      read.value = saved.read
      itemDrafts.value = clone(saved.drafts)
      editing.value = true
      original = saved.original
      latest.value = value
    }
    else if (operation?.command.action.kind === 'save-items') {
      editing.value = true
      itemDrafts.value = clone(operation.command.action.items)
      original = JSON.stringify(value.view.items)
    }
  }
  async function load(recheck = false) {
    const requested = target()
    const request = ++sequence
    started = true
    loading.value = true
    error.value = ''
    readState.value = 'error'
    if (!origin.value || !isStableRouteIdentity(id.value)) {
      error.value = '预算版本或资料来源无效，请从目标成本列表重新打开'
      read.value = null
      loading.value = false
      return
    }
    try {
      const value = await store.loadCentral(id.value, origin.value)
      if (!sameTarget(requested, request))
        return
      if (value.targetCostId !== id.value || value.context.origin !== origin.value)
        throw new Error('读取的预算版本与当前页面不匹配')
      if (read.value && keyFor(read.value) === keyFor(value) && (editing.value || recheck || pending.value))
        latest.value = value
      else
        adopt(value)
    }
    catch (cause) {
      if (sameTarget(requested, request)) {
        error.value = toErrorMessage(cause)
        readState.value = projectProblemFromUnknown(cause).problem.code === 'not-found' ? 'not-found' : 'error'
      }
    }
    finally {
      if (sameTarget(requested, request))
        loading.value = false
    }
  }
  function beginEdit() {
    if (!current.value || !editable.value)
      return
    itemDrafts.value = current.value.view.items.map(item => ({ ...item }))
    original = JSON.stringify(itemDrafts.value)
    editing.value = true
  }
  async function mayLeave() {
    if (saving.value || hasUnresolvedDraft()) {
      error.value = '请先核对原提交结果；未决科目明细不能放弃'
      return false
    }
    if (!dirty.value)
      return true
    const snapshot = JSON.stringify(itemDrafts.value)
    const accepted = await confirm({ variant: 'simple', title: '放弃科目修改', message: '当前科目明细还有未保存内容，确认放弃？', confirmLabel: '放弃修改' })
    return accepted && snapshot === JSON.stringify(itemDrafts.value) && !hasUnresolvedDraft()
  }
  function discard() {
    if (read.value)
      cache.delete(keyFor(read.value))
    editing.value = false
    itemDrafts.value = []
    original = ''
  }
  async function cancelEdit() {
    const requested = target()
    if (await mayLeave() && active.value && requested === target())
      discard()
  }
  async function navigate(path: string) {
    const requested = target()
    if (!await mayLeave() || !active.value || requested !== target())
      return
    discard()
    await router.push(path)
  }
  useTabCloseGuard(mayLeave)
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (dirty.value || hasUnresolvedDraft()) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  useEventListener('popstate', () => {
    browserBack = true
  })
  onBeforeRouteLeave(async () => {
    const explicitBack = browserBack
    browserBack = false
    if (!explicitBack)
      return true
    if (!await mayLeave())
      return false
    discard()
    return true
  })
  async function saveItems() {
    const value = current.value
    if (!value || !editable.value || !editing.value)
      return
    const requested = target()
    const request = sequence
    const errors = await itemEditor.value?.validate() ?? []
    if (errors.length || !sameTarget(requested, request))
      return
    saving.value = true
    const attempt = ++commandSequence
    error.value = ''
    try {
      const result = await store.saveItems(value, clone(itemDrafts.value))
      if (!sameTarget(requested, request) || result.id !== value.targetCostId)
        return
      discard()
      await load()
      if (active.value && requested === target())
        success('科目明细已保存，版本头状态保持不变')
    }
    catch (cause) {
      if (sameTarget(requested, request)) {
        error.value = toErrorMessage(cause)
        const fields = projectProblemFromUnknown(cause).problem.fieldErrors ?? {}
        await nextTick()
        if (sameTarget(requested, request))
          await itemEditor.value?.setServerErrors(fields)
      }
    }
    finally {
      if (active.value && requested === target() && attempt === commandSequence)
        saving.value = false
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
    const attempt = ++commandSequence
    error.value = ''
    try {
      const result = await commandStore.recover(operation)
      if (sameTarget(requested, request) && result.id === value.targetCostId) {
        discard()
        await load()
      }
    }
    catch (cause) {
      if (sameTarget(requested, request))
        error.value = toErrorMessage(cause)
    }
    finally {
      if (active.value && requested === target() && attempt === commandSequence)
        saving.value = false
    }
  }
  async function replaceWithLatest() {
    const value = latest.value
    if (!value || busy.value || pending.value || !await mayLeave() || !active.value || value !== latest.value)
      return
    discard()
    adopt(value)
    error.value = ''
  }
  watch(target, () => {
    if (!active.value || deriveKey(route.fullPath) !== pageKey)
      return
    remember()
    commandSequence += 1
    saving.value = false
    void load()
  }, { immediate: true })
  onDeactivated(() => {
    remember()
    active.value = false
    saving.value = false
    loading.value = false
    sequence += 1
    commandSequence += 1
  })
  onActivated(() => {
    if (active.value && started)
      return
    active.value = true
    browserBack = false
    void load()
  })
  onScopeDispose(() => {
    active.value = false
    sequence += 1
  })
  return { read, current, latest, itemDrafts, itemEditor, editing, loading, saving, active, error, readState, pending, busy, editable, dirty, returnTo, id, origin, load, beginEdit, cancelEdit, navigate, saveItems, recover, replaceWithLatest }
}
