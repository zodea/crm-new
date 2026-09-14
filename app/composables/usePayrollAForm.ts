import type { PayrollADraft, PayrollAFormRead, PayrollAStatementCommandResult } from '~/lib/payroll/central-a-contract'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { usePayrollANegativeLines } from '~/composables/usePayrollANegativeLines'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { payrollAEntryReturn } from '~/lib/payroll/a-navigation'
import { payrollDraft } from '~/lib/payroll/a-presentation'
import { payrollAdjustmentReturn } from '~/lib/payroll/adjustment-navigation'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { payrollReadLocation, payrollViewScope } from '~/lib/payroll/central-navigation'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { toErrorMessage } from '~/lib/util/error'
import { generateId } from '~/lib/util/id'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

export function usePayrollAForm() {
  const route = useRoute()
  const router = useRouter()
  const store = usePayrollStore()
  const tabs = useTabsStore()
  const kit = useKitUI()
  const formKey = deriveKey(route.fullPath)
  const generatedKey = generateId('payroll-a-draft')
  const id = computed(() => typeof route.params.id === 'string' ? route.params.id : null)
  const scope = computed(() => payrollViewScope(route.query))
  const draftKey = computed(() => typeof route.query.draftKey === 'string' ? route.query.draftKey : generatedKey)
  const target = () => JSON.stringify([scope.value.origin, id.value, id.value ? null : draftKey.value])
  const read = shallowRef<PayrollAFormRead | null>(null)
  const latest = shallowRef<PayrollAFormRead | null>(null)
  const draft = ref<PayrollADraft>(payrollDraft({}))
  const loading = shallowRef(false)
  const readFailed = shallowRef(false)
  const saving = shallowRef(false)
  const active = shallowRef(true)
  const error = shallowRef('')
  const fieldErrors = shallowRef<Record<string, string>>({})
  const original = shallowRef('')
  const ratioExplicit = shallowRef(false)
  const formElement = shallowRef<HTMLFormElement | null>(null)
  const errorPanel = shallowRef<{ focus: () => void } | null>(null)
  const matchingRead = computed(() => read.value && read.value.context.origin === scope.value.origin && read.value.statementId === id.value && (id.value !== null || read.value.draftKey === draftKey.value) ? read.value : null)
  const pending = computed(() => matchingRead.value ? store.getAPending(matchingRead.value) : null)
  const negative = usePayrollANegativeLines({ read: () => matchingRead.value, latest: () => latest.value, blocked: () => loading.value || saving.value || !!pending.value, active: () => active.value, saved: () => load(true) })
  const busy = computed(() => loading.value || saving.value || negative.busy.value)
  const editable = computed(() => {
    const value = latest.value ?? matchingRead.value
    return !!matchingRead.value && !!value && (!hasPayrollAFeesForm(value) || (!!value.fees && value.bookProof.state === 'proven' && value.bookEligibility.canSave)) && ['new', 'draft'].includes(value.status) && value.context.origin === 'real' && !value.context.readonly && value.context.capabilities.includes('payroll:write') && !readFailed.value && !pending.value && !negative.pending.value && !busy.value
  })
  const dirty = computed(() => (!!matchingRead.value && original.value !== JSON.stringify(draft.value)) || negative.dirty.value)
  const returnTo = computed(() => (scope.value.origin && payrollAdjustmentReturn(route.query.returnTo, scope.value.origin)) || payrollAEntryReturn(route.query.returnTo, scope.value.origin) || payrollReadLocation('/subcontract/payroll', scope.value))
  const previewed = computed(() => !!matchingRead.value && sourceSelection(draft.value) === sourceSelection(payrollDraft(matchingRead.value.draft)))
  const canSave = computed(() => editable.value && !negative.dirty.value && previewed.value && !!matchingRead.value?.eligibility.canSaveDraft)
  const cache = new Map<string, { read: PayrollAFormRead, draft: PayrollADraft, original: string, ratioExplicit: boolean }>()
  const key = (value: PayrollAFormRead) => JSON.stringify([value.context.workspaceId, value.context.actorId, value.context.origin, value.statementId ?? value.draftKey])
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  let sequence = 0
  let started = false
  let allowLeave = false
  let browserBack = false
  function sourceSelection(value: PayrollADraft) {
    const { note: _note, ...source } = value
    return JSON.stringify(source)
  }
  const isCurrent = (requested: string, request: number) => active.value && requested === target() && request === sequence
  function remember() {
    if (read.value)
      cache.set(key(read.value), { read: read.value, draft: clone(draft.value), original: original.value, ratioExplicit: ratioExplicit.value })
  }
  function capture(cause: unknown) {
    error.value = toErrorMessage(cause)
    const problem = projectProblemFromUnknown(cause).problem
    fieldErrors.value = Object.fromEntries(Object.entries(problem.fieldErrors ?? {}).map(([key, messages]) => [key.replace(/^draft\./, ''), messages.join('；')]))
  }
  async function load(preview = false) {
    if (preview && (pending.value || negative.pending.value))
      return
    if (!preview && matchingRead.value)
      remember()
    const request = ++sequence
    const requested = target()
    started = true
    loading.value = true
    readFailed.value = false
    error.value = ''
    const origin = scope.value.origin
    if (scope.value.error || origin !== 'real' || (id.value !== null && !isStableRouteIdentity(id.value)) || (!id.value && !isStableRouteIdentity(draftKey.value))) {
      read.value = null
      error.value = scope.value.error || '请选择正式工资来源，从台账进入有效的 A 工资草稿。'
      loading.value = false
      return
    }
    try {
      if (!id.value && route.query.draftKey !== draftKey.value)
        await router.replace({ path: route.path, query: { ...route.query, origin, draftKey: draftKey.value } })
      if (!isCurrent(requested, request))
        return
      const hasDraft = matchingRead.value !== null
      let inputDraft: Partial<PayrollADraft> | undefined = preview && hasDraft ? clone(draft.value) : !id.value ? { projectId: scope.value.projectId, month: scope.value.month, crewId: scope.value.crewId || null } : undefined
      if (inputDraft && !id.value && !ratioExplicit.value) {
        const { payRatio: _payRatio, ...withoutExplicitRatio } = inputDraft
        inputDraft = withoutExplicitRatio
      }
      const value = await store.loadAForm({ origin }, id.value ? { statementId: id.value, ...(inputDraft ? { draft: inputDraft } : {}) } : { statementId: null, draftKey: draftKey.value, draft: inputDraft })
      if (!isCurrent(requested, request))
        return
      if (value.statementId !== id.value || value.context.origin !== origin || (!id.value && value.draftKey !== draftKey.value))
        throw new Error('读取的工资草稿与当前目标不一致。')
      if (preview && hasDraft) {
        read.value = value
        latest.value = null
        draft.value = { ...payrollDraft(value.draft), note: draft.value.note }
      }
      else {
        const saved = cache.get(key(value))
        if (saved) {
          read.value = saved.read
          draft.value = clone(saved.draft)
          original.value = saved.original
          ratioExplicit.value = saved.ratioExplicit
          latest.value = value
        }
        else {
          read.value = value
          latest.value = null
          draft.value = payrollDraft(value.draft)
          original.value = JSON.stringify(draft.value)
          ratioExplicit.value = id.value !== null
          const operation = store.getAPending(value)
          if (operation?.command.action.kind === 'save-a-draft') {
            draft.value = clone(operation.command.action.draft)
            ratioExplicit.value = true
          }
        }
      }
    }
    catch (cause) {
      if (isCurrent(requested, request)) {
        readFailed.value = true
        capture(cause)
      }
    }
    finally {
      if (isCurrent(requested, request))
        loading.value = false
    }
  }
  function change(patch: Partial<PayrollADraft>) {
    if (!editable.value)
      return
    draft.value = { ...draft.value, ...patch }
    if ('payRatio' in patch && !('periodKind' in patch))
      ratioExplicit.value = true
    fieldErrors.value = {}
  }
  async function mayLeave() {
    if (allowLeave)
      return true
    if (saving.value || negative.busy.value || negative.pending.value || (read.value && store.getAPending(read.value))) {
      error.value = '请先核对原提交，不能放弃结果尚未确认的工资操作。'
      return false
    }
    if (!dirty.value)
      return true
    const before = JSON.stringify([draft.value, negative.snapshot.value])
    const accepted = await kit.confirm({ variant: 'simple', title: '放弃工资草稿修改', message: '当前输入尚未保存，确认放弃？', confirmLabel: '放弃修改' })
    return accepted && before === JSON.stringify([draft.value, negative.snapshot.value]) && !pending.value && !negative.pending.value
  }
  useTabCloseGuard(mayLeave)
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (dirty.value || pending.value || negative.pending.value) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  useEventListener('popstate', () => browserBack = true)
  onBeforeRouteLeave(async () => {
    const back = browserBack
    browserBack = false
    return !back || await mayLeave()
  })
  async function leave() {
    const requested = target()
    if (!await mayLeave() || !active.value || requested !== target())
      return
    if (read.value)
      cache.delete(key(read.value))
    negative.discard()
    allowLeave = true
    tabs.close(formKey)
    await router.push(returnTo.value)
  }
  async function finish(result: PayrollAStatementCommandResult, requested: string, request: number) {
    const value = matchingRead.value
    const operation = value ? store.getAPending(value) : null
    const refreshed = await store.loadAForm({ origin: 'real' }, { statementId: result.statementId })
    if (!isCurrent(requested, request))
      return
    if (!operation)
      throw new Error('原工资提交未能核对，请保留草稿。')
    store.acknowledgeA(operation, refreshed)
    if (read.value)
      cache.delete(key(read.value))
    allowLeave = true
    tabs.close(formKey)
    const destination = `/subcontract/payroll/${encodeURIComponent(result.statementId)}`
    const originalReturn = new URL(returnTo.value, 'https://payroll.invalid')
    const back = originalReturn.pathname === destination
      ? payrollAEntryReturn(originalReturn.searchParams.get('returnTo'), scope.value.origin, result.projectId) || payrollReadLocation('/subcontract/payroll', payrollViewScope(Object.fromEntries(originalReturn.searchParams)))
      : returnTo.value
    await router.push({ path: destination, query: { origin: 'real', returnTo: back } })
    kit.success('工资草稿已保存，请继续核对实际完成来源。')
  }
  async function save() {
    const value = matchingRead.value
    if (!value || !canSave.value)
      return
    const requested = target()
    const request = sequence
    saving.value = true
    error.value = ''
    try {
      const result = await store.saveADraft(value, clone(draft.value))
      if (isCurrent(requested, request))
        await finish(result, requested, request)
    }
    catch (cause) {
      if (isCurrent(requested, request)) {
        capture(cause)
        await nextTick()
        if (isCurrent(requested, request)) {
          const field = Object.keys(fieldErrors.value)[0]
          const element = [...formElement.value?.querySelectorAll<HTMLElement>('[data-field]') ?? []].find(element => element.dataset.field === field)
          if (element)
            element.focus()
          else errorPanel.value?.focus()
        }
      }
    }
    finally {
      if (isCurrent(requested, request))
        saving.value = false
    }
  }
  async function recover() {
    const operation = pending.value
    const value = matchingRead.value
    if (!operation || !value || busy.value)
      return
    const requested = target()
    const request = sequence
    saving.value = true
    try {
      const result = await store.recoverA(operation)
      if (isCurrent(requested, request) && result.statementId && result.projectId === operation.command.projectId && (value.statementId ? result.statementId === value.statementId : operation.command.draftKey === value.draftKey))
        await finish({ ...result, statementId: result.statementId }, requested, request)
    }
    catch (cause) {
      if (isCurrent(requested, request))
        capture(cause)
    }
    finally {
      if (isCurrent(requested, request))
        saving.value = false
    }
  }
  watch(target, () => {
    if (active.value && deriveKey(route.fullPath) === formKey) {
      remember()
      allowLeave = false
      void load()
    }
  }, { immediate: true })
  onDeactivated(() => {
    remember()
    active.value = false
    sequence += 1
    loading.value = false
    saving.value = false
  })
  onActivated(() => {
    if (active.value && started)
      return
    active.value = true
    allowLeave = false
    browserBack = false
    void load()
  })
  onScopeDispose(() => {
    active.value = false
    sequence += 1
  })
  return { id, draftKey, scope, read, matchingRead, latest, draft, loading, busy, error, fieldErrors, formElement, errorPanel, negative, pending, editable, dirty, previewed, canSave, returnTo, change, load, save, recover, leave }
}
