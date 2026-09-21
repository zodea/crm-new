import type { PayrollC2ConfigDraft, PayrollC2ConfigRead } from '~/lib/payroll/central-c2-contract'
import { computed, ref, shallowRef, watch } from 'vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { payrollC2WorkspaceReturn } from '~/lib/payroll/c2-navigation'
import { payrollReadLocation, payrollReturnTo, payrollViewScope } from '~/lib/payroll/central-navigation'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { toErrorMessage } from '~/lib/util/error'
import { usePayrollRead } from './usePayrollRead'

export function usePayrollC2Config(additionalGuard: () => boolean | Promise<boolean> = () => true) {
  const route = useRoute()
  const router = useRouter()
  const store = usePayrollC2Store()
  const kit = useKitUI()
  const view = computed(() => payrollViewScope(route.query))
  const scope = computed(() => ({ projectId: view.value.projectId, leaderWorkerId: typeof route.query.leader === 'string' ? route.query.leader : '' }))
  const target = () => JSON.stringify([view.value.origin, scope.value])
  const read = shallowRef<PayrollC2ConfigRead | null>(null)
  const draft = ref<PayrollC2ConfigDraft>({ crewId: null, unitRate: null, ruleText: '' })
  const original = shallowRef('')
  const working = shallowRef(false)
  const commandError = shallowRef('')
  const fieldErrors = shallowRef<Record<string, string>>({})
  const matches = (value: PayrollC2ConfigRead) => value.context.origin === view.value.origin && value.scope.projectId === scope.value.projectId && value.scope.leaderWorkerId === scope.value.leaderWorkerId
  const matching = computed(() => read.value && matches(read.value) ? read.value : null)
  const pending = computed(() => matching.value ? store.getC2Pending(matching.value) : null)
  const cache = new Map<string, { read: PayrollC2ConfigRead, draft: PayrollC2ConfigDraft, original: string }>()
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  const key = (value: PayrollC2ConfigRead) => JSON.stringify([value.context.workspaceId, value.context.actorId, value.context.origin, value.scope])
  const ui = usePayrollRead(target, async () => {
    if (read.value)
      cache.set(key(read.value), { read: read.value, draft: clone(draft.value), original: original.value })
    if (view.value.error || view.value.origin !== 'real')
      throw new Error(view.value.error || '请从正式工资入口打开主体配置。')
    return store.loadC2Config({ origin: 'real' }, scope.value)
  })
  watch(() => ui.current.value, (value) => {
    if (!value || !matches(value))
      return
    const saved = cache.get(key(value))
    read.value = saved?.read ?? value
    draft.value = clone(saved?.draft ?? value.draft)
    original.value = saved?.original ?? JSON.stringify(draft.value)
    const operation = store.getC2Pending(value)
    if (!saved && operation?.command.action.kind === 'save-c2-config')
      draft.value = clone(operation.command.action.config)
  }, { immediate: true })
  const busy = computed(() => ui.loading.value || working.value)
  const writable = computed(() => !!matching.value && !!ui.current.value && !ui.error.value && !ui.current.value.context.readonly && ui.current.value.context.capabilities.includes('payroll:write') && !ui.current.value.readonlyReasons.length && !pending.value && !busy.value)
  const dirty = computed(() => !!matching.value && original.value !== JSON.stringify(draft.value))
  const latest = computed(() => !!matching.value && ui.current.value?.context.sourceVersion !== matching.value.context.sourceVersion)
  function adopt() {
    if (ui.current.value && !pending.value && !busy.value)
      read.value = ui.current.value
  }
  function change(value: Partial<PayrollC2ConfigDraft>) {
    if (writable.value) {
      draft.value = { ...draft.value, ...value }
      fieldErrors.value = {}
    }
  }
  function capture(cause: unknown) {
    commandError.value = toErrorMessage(cause)
    fieldErrors.value = Object.fromEntries(Object.entries(projectProblemFromUnknown(cause).problem.fieldErrors ?? {}).map(([field, messages]) => [field.replace(/^config\./, ''), messages.join('；')]))
  }
  async function submit(recover = false) {
    const value = matching.value
    if (!value || busy.value || (!recover && (!writable.value || !dirty.value)))
      return
    const requested = target()
    working.value = true
    commandError.value = ''
    try {
      const existing = store.getC2Pending(value)
      if (recover && !existing)
        return
      if (recover && existing)
        await store.recoverC2(existing)
      else
        await store.saveC2Config(value, clone(draft.value))
      const operation = store.getC2Pending(value)
      const refreshed = await store.loadC2Config({ origin: value.context.origin }, value.scope)
      if (!ui.active.value || requested !== target() || !operation)
        return
      store.acknowledgeC2(operation, refreshed)
      cache.delete(key(value))
      read.value = refreshed
      draft.value = clone(refreshed.draft)
      original.value = JSON.stringify(draft.value)
      ui.current.value = refreshed
      kit.success('C2 主体配置已保存，未发工资请重新核对签工。')
    }
    catch (cause) {
      if (ui.active.value && requested === target())
        capture(cause)
    }
    finally { working.value = false }
  }
  const returnTo = computed(() => (view.value.origin && payrollC2WorkspaceReturn(route.query.returnTo, view.value.origin)) || payrollReturnTo(route.query.returnTo, view.value.origin) || payrollReadLocation('/subcontract/payroll', view.value))
  async function mayLeave() {
    if (!await additionalGuard())
      return false
    return !working.value && !pending.value && (!dirty.value || await kit.confirm({ variant: 'simple', title: '放弃主体配置修改', message: '当前单价或规则尚未保存，确认放弃？', confirmLabel: '放弃修改' }))
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
  return { ...ui, view, scope, matching, draft, busy, pending, writable, dirty, latest, commandError, fieldErrors, adopt, change, save: () => submit(), recover: () => submit(true), leave }
}
