import type { QuantityUnitReadQuery } from '~/lib/quantity/central-contract'
import type { QuantityHollowAction, QuantityHollowCommandResult, QuantityHollowRead } from '~/lib/quantity/central-hollow-contract'
import type { QuantityHollowDraftFields } from '~/stores/quantity-hollow'
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useQuantityHollowRead } from '~/composables/useQuantityHollowRead'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { quantityProblem } from '~/lib/quantity/central-contract'
import { parseQuantityHollowAction } from '~/lib/quantity/central-hollow-validation'
import { quantityProblemFromUnknown } from '~/lib/quantity/central-repository'
import { toErrorMessage } from '~/lib/util/error'
import { useQuantityHollowStore } from '~/stores/quantity-hollow'

export type QuantityHollowFields = QuantityHollowDraftFields
const emptyFields = (): QuantityHollowFields => ({ target: '', inspectedOn: '', rectifiedOn: '', count: '', note: '', reason: '' })
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function useQuantityHollowForm(options: {
  query: () => QuantityUnitReadQuery | null
  mode: 'create' | 'revise' | 'rectify'
  recordId: () => string | null
  draftKey: () => string
  saved: (result: QuantityHollowCommandResult) => void | Promise<void>
}) {
  const store = useQuantityHollowStore()
  const kit = useKitUI()
  const workspace = useQuantityHollowRead(options.query, () => JSON.stringify([options.recordId(), options.draftKey()]))
  const fields = shallowRef<QuantityHollowFields>(emptyFields())
  const baseline = shallowRef('')
  const basis = shallowRef<QuantityHollowRead | null>(null)
  const basisCacheKey = shallowRef('')
  const staleRead = shallowRef<QuantityHollowRead | null>(null)
  const revisionId = shallowRef<string | null>(null)
  const basisVersion = shallowRef('')
  const needsRecheck = shallowRef(false)
  const saving = shallowRef(false)
  const localError = shallowRef('')
  const fieldErrors = shallowRef<Record<string, string>>({})
  const errorPanel = shallowRef<{ focus: () => void } | null>(null)
  const formElement = shallowRef<HTMLElement | null>(null)
  let restoring = false
  let allowLeave = false
  const scopeKey = () => JSON.stringify([options.query(), options.mode, options.recordId(), options.mode === 'create' ? options.draftKey() : null])
  const keyFor = (read: QuantityHollowRead) => JSON.stringify([read.context.workspaceId, read.context.actorId, read.dataOrigin, read.data.projectId, read.data.unitId, options.mode, options.recordId(), options.mode === 'create' ? options.draftKey() : null])
  const read = computed(() => workspace.current.value)
  const record = computed(() => read.value?.data.records.find(record => record.recordId === options.recordId()) ?? null)
  const pending = computed(() => read.value ? store.getPending(read.value) : null)
  function matchesAction(action: QuantityHollowAction) {
    if (action.kind === 'create-hollow-inspection')
      return options.mode === 'create'
    return action.recordId === options.recordId() && action.kind === (options.mode === 'revise' ? 'revise-hollow-inspection' : options.mode === 'rectify' ? 'rectify-hollow-inspection' : '')
  }
  const pendingElsewhere = computed(() => !!pending.value && !matchesAction(pending.value.command.action))
  const busy = computed(() => saving.value || workspace.loading.value)
  const dirty = computed(() => !!basis.value && JSON.stringify(fields.value) !== baseline.value)
  const error = computed(() => localError.value || workspace.error.value)
  const editable = computed(() => !!read.value && read.value.dataOrigin === 'real' && read.value.capabilities.includes('quantity:write') && !busy.value && !pending.value && !workspace.error.value)
  const actionAllowed = computed(() => options.mode === 'create'
    ? read.value?.data.targets.find(target => JSON.stringify(target.target) === fields.value.target)?.create.allowed ?? false
    : record.value?.eligibility[options.mode].allowed ?? false)
  const canSave = computed(() => editable.value && actionAllowed.value && !needsRecheck.value && dirty.value)

  function remember() {
    const value = basis.value
    if (!value || restoring || allowLeave)
      return
    store.rememberDraft(basisCacheKey.value, { fields: clone(fields.value), baseline: baseline.value, sourceVersion: basisVersion.value, revisionId: revisionId.value })
  }
  function discard() {
    const value = basis.value
    if (value) {
      store.discardDraft(basisCacheKey.value)
    }
  }
  function fromAction(action: QuantityHollowAction) {
    fields.value = action.kind === 'rectify-hollow-inspection'
      ? { ...emptyFields(), rectifiedOn: action.rectifiedOn, count: String(action.count), note: action.note }
      : { ...emptyFields(), target: action.kind === 'create-hollow-inspection' ? JSON.stringify(action.target) : '', inspectedOn: action.input.inspectedOn, count: String(action.input.count), note: action.input.note, reason: action.kind === 'revise-hollow-inspection' ? action.reason : '' }
  }
  watch(read, (value) => {
    if (!value)
      return
    restoring = true
    const previous = store.getDraft(keyFor(value))
    const original = value.data.records.find(record => record.recordId === options.recordId())
    const initial = options.mode === 'revise' && original
      ? { ...emptyFields(), inspectedOn: original.inspection.input.inspectedOn, count: String(original.inspection.input.count), note: original.inspection.input.note }
      : emptyFields()
    fields.value = initial
    baseline.value = JSON.stringify(initial)
    basis.value = value
    basisCacheKey.value = keyFor(value)
    basisVersion.value = value.sourceVersion
    revisionId.value = original?.inspection.revisionId ?? null
    needsRecheck.value = false
    if (previous && typeof previous.baseline === 'string' && typeof previous.sourceVersion === 'string' && (previous.revisionId === null || typeof previous.revisionId === 'string') && Object.keys(previous.fields ?? {}).length === Object.keys(initial).length && Object.keys(initial).every(key => typeof previous.fields?.[key as keyof QuantityHollowFields] === 'string')) {
      fields.value = clone(previous.fields)
      baseline.value = previous.baseline
      revisionId.value = previous.revisionId
      basisVersion.value = previous.sourceVersion
      needsRecheck.value = previous.sourceVersion !== value.sourceVersion
    }
    const operation = store.getPending(value)
    if (operation && matchesAction(operation.command.action)) {
      fromAction(operation.command.action)
      needsRecheck.value = false
    }
    localError.value = options.mode !== 'create' && !original ? '这份空鼓原记录尚未获证明，不能修订或登记整改。' : ''
    restoring = false
  })
  watch(fields, remember, { flush: 'sync' })
  function change(patch: Partial<QuantityHollowFields>) {
    if (editable.value)
      fields.value = { ...fields.value, ...patch }
  }
  function adoptLatest() {
    if (!read.value || pending.value || busy.value)
      return
    if (staleRead.value === read.value) {
      localError.value = '请先重新读取原户，再采用当前依据。原输入仍保留。'
      return
    }
    basis.value = read.value
    basisVersion.value = read.value.sourceVersion
    revisionId.value = record.value?.inspection.revisionId ?? null
    needsRecheck.value = false
    localError.value = ''
    remember()
  }
  function action(): QuantityHollowAction {
    const input = fields.value
    const count = input.count.trim() ? Number(input.count) : null
    if (options.mode === 'create') {
      const target = read.value?.data.targets.find(value => JSON.stringify(value.target) === input.target)?.target
      return parseQuantityHollowAction({ kind: 'create-hollow-inspection', target, input: { inspectedOn: input.inspectedOn, count, note: input.note } })
    }
    if (options.mode === 'revise')
      return parseQuantityHollowAction({ kind: 'revise-hollow-inspection', recordId: options.recordId(), expectedRevisionId: revisionId.value, input: { inspectedOn: input.inspectedOn, count, note: input.note }, reason: input.reason })
    return parseQuantityHollowAction({ kind: 'rectify-hollow-inspection', recordId: options.recordId(), expectedRevisionId: revisionId.value, rectifiedOn: input.rectifiedOn, count, note: input.note })
  }
  async function capture(cause: unknown) {
    localError.value = toErrorMessage(cause)
    const problem = quantityProblemFromUnknown(cause).problem
    if (problem.code === 'stale-source') {
      staleRead.value = read.value
      needsRecheck.value = true
      remember()
    }
    fieldErrors.value = Object.fromEntries(Object.entries(problem.fieldErrors ?? {}).map(([key, value]) => [key.replace(/^action\.(input\.)?/, ''), value.join('；')]))
    await nextTick()
    const field = formElement.value?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (field)
      field.focus()
    else
      errorPanel.value?.focus()
  }
  async function complete(result: QuantityHollowCommandResult, key: string) {
    const value = read.value
    const query = options.query()
    const operation = value ? store.getPending(value) : null
    if (!query || !operation)
      throw quantityProblem('conflict', '原空鼓提交未能核对，请保留输入')
    const refreshed = await store.load(query)
    if (!workspace.active.value || key !== scopeKey())
      return
    store.acknowledge(operation, refreshed)
    if (matchesAction(operation.command.action)) {
      discard()
      baseline.value = JSON.stringify(fields.value)
    }
    kit.success(operation.command.action.kind === 'rectify-hollow-inspection' ? '整改销记已保存并核对。' : '空鼓检查已保存并核对。')
    allowLeave = true
    await options.saved(result)
    allowLeave = false
  }
  async function submit() {
    if (!canSave.value || !read.value)
      return
    const key = scopeKey()
    localError.value = ''
    fieldErrors.value = {}
    try {
      const commandAction = action()
      const before = JSON.stringify(fields.value)
      if (options.mode === 'rectify') {
        const accepted = await kit.confirm({ variant: 'simple', title: '确认本次整改销记', message: `原记录目前未整改 ${record.value?.remainingCount ?? '未知'} 处，本次登记整改 ${fields.value.count} 处。保存后保留原检查和本次销记。`, confirmLabel: '确认整改销记' })
        if (!accepted || before !== JSON.stringify(fields.value) || !canSave.value || key !== scopeKey())
          return
      }
      saving.value = true
      remember()
      const result = await store.submit(read.value, commandAction)
      if (key === scopeKey() && workspace.active.value)
        await complete(result, key)
    }
    catch (cause) {
      if (key === scopeKey() && workspace.active.value)
        await capture(cause)
    }
    finally { saving.value = false }
  }
  async function recover() {
    const original = pending.value
    if (!original || busy.value)
      return
    const key = scopeKey()
    saving.value = true
    localError.value = ''
    try {
      const result = await store.recover(original)
      if (key === scopeKey() && workspace.active.value)
        await complete(result, key)
    }
    catch (cause) {
      if (key === scopeKey() && workspace.active.value)
        await capture(cause)
    }
    finally { saving.value = false }
  }
  async function mayDiscard() {
    if (busy.value || pending.value) {
      await capture(quantityProblem('conflict', '请先核对原空鼓提交，不能放弃尚未确认的操作'))
      return false
    }
    const snapshot = JSON.stringify(fields.value)
    if (dirty.value && !await kit.confirm({ variant: 'simple', title: '放弃未保存的空鼓输入', message: '确认放弃当前检查或整改输入？', confirmLabel: '放弃输入' }))
      return false
    if (snapshot !== JSON.stringify(fields.value) || pending.value)
      return false
    discard()
    allowLeave = true
    return true
  }
  useTabCloseGuard(mayDiscard)
  onBeforeRouteLeave(async () => {
    if (allowLeave)
      return true
    if (busy.value || pending.value) {
      await capture(quantityProblem('conflict', '请先核对原空鼓提交，再离开当前记录'))
      return false
    }
    remember()
    return true
  })
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (dirty.value || pending.value) {
      remember()
      event.preventDefault()
      event.returnValue = ''
    }
  })
  return { ...workspace, read, record, fields, pending, pendingElsewhere, busy, dirty, editable, canSave, needsRecheck, error, fieldErrors, errorPanel, formElement, change, adoptLatest, submit, recover, mayDiscard }
}
