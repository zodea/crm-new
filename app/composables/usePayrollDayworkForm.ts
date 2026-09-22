import type { PayrollDayworkCommandResult, PayrollDayworkFormRead, PayrollDayworkRecordDraft } from '~/lib/payroll/central-daywork-contract'
import { computed, nextTick, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { payrollC2WorkspaceReturn, payrollDayworkReturn } from '~/lib/payroll/c2-navigation'
import { dayworkDraft } from '~/lib/payroll/c2-presentation'
import { payrollReadLocation, payrollReturnTo, payrollViewScope } from '~/lib/payroll/central-navigation'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { usePayrollRead } from './usePayrollRead'

export function usePayrollDayworkForm() {
  const route = useRoute()
  const router = useRouter()
  const store = useDayworkCentralStore()
  const kit = useKitUI()
  const generated = generateId('daywork-draft')
  const scope = computed(() => payrollViewScope(route.query))
  const recordId = computed(() => typeof route.params.id === 'string' ? route.params.id : null)
  const draftKey = computed(() => typeof route.query.draftKey === 'string' ? route.query.draftKey : generated)
  const target = () => JSON.stringify([scope.value.origin, recordId.value, recordId.value ? null : draftKey.value])
  const read = shallowRef<PayrollDayworkFormRead | null>(null)
  const latest = shallowRef<PayrollDayworkFormRead | null>(null)
  const authority = shallowRef<PayrollDayworkFormRead | null>(null)
  const draft = ref(dayworkDraft({}))
  const original = shallowRef('')
  const working = shallowRef(false)
  const error = shallowRef('')
  const fieldErrors = shallowRef<Record<string, string>>({})
  const changedAfterSave = shallowRef(false)
  const formElement = shallowRef<HTMLFormElement | null>(null)
  const matches = (value: PayrollDayworkFormRead) => value.context.origin === scope.value.origin && value.recordId === recordId.value && (recordId.value !== null || value.draftKey === draftKey.value)
  const matching = computed(() => read.value && matches(read.value) ? read.value : null)
  const pending = computed(() => matching.value ? store.getDayworkPending(matching.value) : null)
  const cache = new Map<string, { read: PayrollDayworkFormRead, draft: PayrollDayworkRecordDraft, original: string, changedAfterSave: boolean }>()
  const key = (value: PayrollDayworkFormRead) => JSON.stringify([value.context.workspaceId, value.context.actorId, value.context.origin, value.recordId ?? value.draftKey])
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  function remember() {
    if (read.value)
      cache.set(key(read.value), { read: read.value, draft: clone(draft.value), original: original.value, changedAfterSave: changedAfterSave.value })
  }
  const ui = usePayrollRead(target, async () => {
    remember()
    if (scope.value.error || scope.value.origin !== 'real' || (recordId.value ? !isStableRouteIdentity(recordId.value) : !isStableRouteIdentity(draftKey.value)))
      throw new Error(scope.value.error || '请从正式签工台账打开有效记录。')
    if (!recordId.value && !route.query.draftKey)
      await router.replace({ path: route.path, query: { ...route.query, origin: 'real', draftKey: draftKey.value } })
    return store.loadDayworkForm({ origin: 'real' }, recordId.value ? { recordId: recordId.value } : { recordId: null, draftKey: draftKey.value, draft: { projectId: scope.value.projectId, crewId: scope.value.crewId || null } })
  })
  watch(() => ui.current.value, (value) => {
    if (!value || !matches(value))
      return
    authority.value = value
    const saved = cache.get(key(value))
    changedAfterSave.value = saved?.changedAfterSave ?? false
    if (saved) {
      read.value = saved.read
      draft.value = clone(saved.draft)
      original.value = saved.original
      latest.value = value
    }
    else {
      read.value = value
      latest.value = null
      draft.value = dayworkDraft(value.draft)
      original.value = JSON.stringify(draft.value)
      const operation = store.getDayworkPending(value)
      if (operation?.command.action.kind === 'save-daywork')
        draft.value = clone(operation.command.action.record)
    }
  }, { immediate: true })
  const busy = computed(() => ui.loading.value || working.value)
  const currentRead = computed(() => authority.value && matching.value && matches(authority.value) && key(authority.value) === key(matching.value) ? authority.value : null)
  const editable = computed(() => !!matching.value && !!currentRead.value && !ui.error.value && !busy.value && !pending.value && !changedAfterSave.value && !currentRead.value.context.readonly && currentRead.value.context.capabilities.includes('payroll:write') && (!recordId.value || currentRead.value.eligibility.canEdit))
  const needsReview = computed(() => !!currentRead.value && !!matching.value && currentRead.value.context.sourceVersion !== matching.value.context.sourceVersion)
  const canSubmit = computed(() => editable.value && !needsReview.value && !matching.value?.context.readonly)
  const dirty = computed(() => !!matching.value && original.value !== JSON.stringify(draft.value))
  const returnTo = computed(() => (scope.value.origin && (payrollC2WorkspaceReturn(route.query.returnTo, scope.value.origin) || payrollDayworkReturn(route.query.returnTo, scope.value.origin))) || payrollReturnTo(route.query.returnTo, scope.value.origin) || payrollReadLocation('/subcontract/daywork', scope.value))
  function capture(cause: unknown) {
    error.value = toErrorMessage(cause)
    fieldErrors.value = Object.fromEntries(Object.entries(projectProblemFromUnknown(cause).problem.fieldErrors ?? {}).map(([field, messages]) => [field.replace(/^(?:record|confirmation)\./, ''), messages.join('；')]))
  }
  function change(patch: Partial<PayrollDayworkRecordDraft>) {
    if (!editable.value)
      return
    draft.value = { ...draft.value, ...patch }
    fieldErrors.value = {}
  }
  /** 手动重新核对才采纳新保存依据；自动恢复页签只更新当前资格。 */
  async function load() {
    if (busy.value || pending.value || changedAfterSave.value)
      return
    const requested = target()
    const priorRead = matching.value
    const body = JSON.stringify(draft.value)
    await ui.load()
    const next = ui.current.value
    if (ui.active.value && requested === target() && next && matches(next) && (!priorRead || key(priorRead) === key(next)) && body === JSON.stringify(draft.value)) {
      read.value = next
      latest.value = null
      error.value = ''
      fieldErrors.value = {}
      remember()
    }
  }
  async function preview() {
    const value = matching.value
    if (!value || !editable.value)
      return
    const requested = target()
    const body = clone(draft.value)
    working.value = true
    try {
      const next = await store.loadDayworkForm({ origin: 'real' }, recordId.value ? { recordId: recordId.value, draft: body } : { recordId: null, draftKey: draftKey.value, draft: body })
      if (ui.active.value && requested === target() && JSON.stringify(body) === JSON.stringify(draft.value)) {
        read.value = next
        authority.value = next
        latest.value = null
      }
    }
    catch (cause) {
      if (ui.active.value && requested === target())
        capture(cause)
    }
    finally { working.value = false }
  }
  async function finish(result: PayrollDayworkCommandResult, value: PayrollDayworkFormRead, requested: string) {
    const operation = store.getDayworkPending(value)
    const refreshed = await store.loadDayworkForm({ origin: value.context.origin }, { recordId: result.recordId })
    if (!ui.active.value || requested !== target())
      return
    if (!operation)
      throw new Error('原签工提交未能核对，请保留输入。')
    const acknowledgment = store.acknowledgeDaywork(operation, refreshed)
    if (acknowledgment.changedSinceCommand) {
      latest.value = refreshed
      changedAfterSave.value = true
      error.value = '原提交已完成，记录随后有更新。当前输入仍保留，请查看当前原记录后决定下一步。'
      return
    }
    cache.delete(key(value))
    original.value = JSON.stringify(draft.value)
    kit.success(result.status === 'confirmed' ? '签工已保存并确认。' : '待确认签工已保存，尚未计薪。')
    await router.push(returnTo.value)
  }
  async function save(status: 'draft' | 'confirmed') {
    const value = matching.value
    if (!value || !canSubmit.value)
      return
    const requested = target()
    const body = clone({ ...draft.value, status })
    draft.value = body
    working.value = true
    error.value = ''
    try {
      const result = await store.saveDaywork(value, body)
      if (ui.active.value && requested === target())
        await finish(result, value, requested)
    }
    catch (cause) {
      if (ui.active.value && requested === target()) {
        capture(cause)
        await nextTick()
        const field = Object.keys(fieldErrors.value)[0]
        formElement.value?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus()
      }
    }
    finally { working.value = false }
  }
  async function recover() {
    const value = matching.value
    const operation = pending.value
    if (!value || !operation || busy.value)
      return
    const requested = target()
    working.value = true
    try {
      await finish(await store.recoverDaywork(operation), value, requested)
    }
    catch (cause) {
      if (ui.active.value && requested === target())
        capture(cause)
    }
    finally { working.value = false }
  }
  async function mayLeave() {
    if (working.value || pending.value)
      return false
    return !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃签工修改', message: '原输入尚未保存，确认放弃？', confirmLabel: '放弃修改' })
  }
  useTabCloseGuard(mayLeave)
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (dirty.value || pending.value) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  async function leave() {
    const requested = target()
    if (await mayLeave() && ui.active.value && requested === target())
      await router.push(returnTo.value)
  }
  onScopeDispose(remember)
  return { ...ui, load, readError: ui.error, scope, recordId, matching, currentRead, latest, draft, busy, editable, canSubmit, needsReview, pending, dirty, error, fieldErrors, formElement, changedAfterSave, returnTo, change, preview, save, recover, leave }
}
