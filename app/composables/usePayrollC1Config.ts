import type { PayrollC1ConfigRead, PayrollC1RateDraft } from '~/lib/payroll/central-c1-contract'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { payrollAEntryReturn } from '~/lib/payroll/a-navigation'
import { payrollC1WorkspaceReturn } from '~/lib/payroll/c1-navigation'
import { payrollReadLocation, payrollViewScope } from '~/lib/payroll/central-navigation'
import { toErrorMessage } from '~/lib/util/error'
import { usePayrollRead } from './usePayrollRead'

export function usePayrollC1Config() {
  const route = useRoute()
  const router = useRouter()
  const store = usePayrollC1Store()
  const kit = useKitUI()
  const scope = computed(() => payrollViewScope(route.query))
  const read = shallowRef<PayrollC1ConfigRead | null>(null)
  const drafts = ref<PayrollC1RateDraft[]>([])
  const original = shallowRef('')
  const working = shallowRef(false)
  const commandError = shallowRef('')
  const target = () => JSON.stringify([scope.value.origin, scope.value.projectId, scope.value.month, scope.value.crewId])
  const matches = (value: PayrollC1ConfigRead) => value.context.origin === scope.value.origin && value.scope.projectId === scope.value.projectId && value.scope.month === scope.value.month && value.scope.crewId === (scope.value.crewId || null)
  const matching = computed(() => read.value && matches(read.value) ? read.value : null)
  const pending = computed(() => matching.value ? store.getC1Pending(matching.value) : null)
  const dirty = computed(() => !!matching.value && original.value !== JSON.stringify(drafts.value))
  const cache = new Map<string, {
    read: PayrollC1ConfigRead
    drafts: PayrollC1RateDraft[]
    original: string
  }>()
  const key = (value: PayrollC1ConfigRead) => JSON.stringify([value.context.workspaceId, value.context.actorId, value.context.origin, value.scope])
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  const ui = usePayrollRead(target, async () => {
    if (read.value)
      cache.set(key(read.value), { read: read.value, drafts: clone(drafts.value), original: original.value })
    if (scope.value.error || !scope.value.origin)
      throw new Error(scope.value.error || '配置来源无效')
    return store.loadC1Config({ origin: scope.value.origin }, { projectId: scope.value.projectId, month: scope.value.month, crewId: scope.value.crewId || null })
  })
  const stop = watch(() => ui.current.value, (value) => {
    if (!value || !matches(value))
      return
    const saved = cache.get(key(value))
    if (saved) {
      read.value = saved.read
      drafts.value = clone(saved.drafts)
      original.value = saved.original
    }
    else {
      read.value = value
      drafts.value = value.rates.map(rate => ({ workerId: rate.workerId, dailyWage: rate.configuredDailyWage, overtimeRate: rate.configuredOvertimeRate }))
      original.value = JSON.stringify(drafts.value)
      const operation = store.getC1Pending(value)
      if (operation?.command.action.kind === 'save-c1-rates')
        drafts.value = drafts.value.map(draft => operation.command.action.kind === 'save-c1-rates' ? operation.command.action.rates.find(row => row.workerId === draft.workerId) || draft : draft)
    }
  }, { immediate: true })
  onScopeDispose(stop)
  const busy = computed(() => ui.loading.value || working.value)
  const writable = computed(() => !!matching.value && !!ui.current.value && !ui.error.value && !ui.current.value.context.readonly && ui.current.value.context.origin === 'real' && ui.current.value.context.capabilities.includes('payroll:write') && !ui.current.value.readonlyReasons.length && !pending.value && !busy.value)
  const latest = computed(() => !!matching.value && ui.current.value?.context.sourceVersion !== matching.value.context.sourceVersion)
  function adopt() {
    if (ui.current.value && !pending.value && !busy.value) {
      read.value = ui.current.value
      commandError.value = ''
    }
  }
  async function save() {
    const value = matching.value
    if (!value || !writable.value || !dirty.value)
      return
    const requested = target()
    const rates = drafts.value.filter((row) => {
      const old = value.rates.find(rate => rate.workerId === row.workerId)
      return !old || row.dailyWage !== old.configuredDailyWage || row.overtimeRate !== old.configuredOvertimeRate
    })
    working.value = true
    commandError.value = ''
    try {
      await store.saveC1Rates(value, clone(rates))
      if (ui.active.value && requested === target()) {
        const operation = store.getC1Pending(value)
        await ui.load()
        if (!ui.active.value || requested !== target() || !ui.current.value || ui.error.value)
          return
        if (!operation)
          throw new Error('原标准提交未能核对，请保留输入。')
        store.acknowledgeC1(operation, ui.current.value)
        cache.delete(key(value))
        read.value = ui.current.value
        drafts.value = read.value.rates.map(rate => ({ workerId: rate.workerId, dailyWage: rate.configuredDailyWage, overtimeRate: rate.configuredOvertimeRate }))
        original.value = JSON.stringify(drafts.value)
        kit.success('个人工资标准已保存，未发工资请重新核对考勤。')
      }
    }
    catch (cause) {
      if (ui.active.value && requested === target())
        commandError.value = toErrorMessage(cause)
    }
    finally {
      working.value = false
    }
  }
  async function recover() {
    const operation = pending.value
    const value = matching.value
    if (!operation || !value || busy.value)
      return
    const requested = target()
    working.value = true
    try {
      const result = await store.recoverC1(operation)
      if (ui.active.value && requested === target() && result.projectId === operation.command.projectId && result.statementId === null) {
        await ui.load()
        if (!ui.active.value || requested !== target() || !ui.current.value || ui.error.value)
          return
        store.acknowledgeC1(operation, ui.current.value)
        cache.delete(key(value))
        read.value = ui.current.value
        drafts.value = read.value.rates.map(rate => ({ workerId: rate.workerId, dailyWage: rate.configuredDailyWage, overtimeRate: rate.configuredOvertimeRate }))
        original.value = JSON.stringify(drafts.value)
      }
    }
    catch (cause) {
      if (ui.active.value && requested === target())
        commandError.value = toErrorMessage(cause)
    }
    finally {
      working.value = false
    }
  }
  const returnTo = computed(() => (scope.value.origin ? payrollC1WorkspaceReturn(route.query.returnTo, scope.value.origin) : null) || payrollAEntryReturn(route.query.returnTo, scope.value.origin) || payrollReadLocation('/subcontract/payroll', scope.value))
  async function mayLeave() {
    if (pending.value || working.value) {
      commandError.value = '请先核对原提交。'
      return false
    }
    return !dirty.value || await kit.confirm({ variant: 'simple', title: '放弃个人标准修改', message: '当前修改尚未保存，确认放弃？', confirmLabel: '放弃修改' })
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
    if (await mayLeave() && requested === target())
      await router.push(returnTo.value)
  }
  return { ...ui, scope, matching, drafts, pending, dirty, busy, writable, latest, commandError, adopt, save, recover, leave }
}
