import type { PayrollDayworkFormRead, PayrollDayworkStatus } from '~/lib/payroll/central-daywork-contract'
import { computed, nextTick, shallowRef, watch } from 'vue'
import { payrollDayworkReturn } from '~/lib/payroll/c2-navigation'
import { payrollReadLocation, payrollViewScope } from '~/lib/payroll/central-navigation'
import { toErrorMessage } from '~/lib/util/error'
import { usePayrollRead } from './usePayrollRead'

export function useCentralDaywork() {
  const route = useRoute()
  const router = useRouter()
  const store = useDayworkCentralStore()
  const scope = computed(() => payrollViewScope(route.query))
  const confirmation = shallowRef<PayrollDayworkFormRead | null>(null)
  const commandError = shallowRef('')
  const confirming = shallowRef(false)
  const dayworkStatuses = computed<PayrollDayworkStatus[]>(() => {
    const value = scope.value.dayworkStatus
    if (!value)
      return []
    try {
      const rows: unknown = value.startsWith('[') ? JSON.parse(value) : [value]
      if (!Array.isArray(rows) || rows.some(item => item !== 'draft' && item !== 'confirmed'))
        throw new Error('签工状态无效')
      return [...new Set(rows)] as PayrollDayworkStatus[]
    }
    catch { throw new Error('签工确认状态无效，请重新选择。') }
  })
  const target = () => JSON.stringify([scope.value, route.query.record, route.query.worker, route.query.workDate])
  const ui = usePayrollRead(target, async () => {
    if (scope.value.error || !scope.value.origin)
      throw new Error(scope.value.error || '签工来源无效')
    return store.loadDayworkList({ origin: scope.value.origin }, { projectId: scope.value.projectId, month: scope.value.month, crewId: scope.value.crewId || null, dayworkStatuses: dayworkStatuses.value })
  })
  const canWrite = computed(() => !!ui.current.value && !ui.current.value.context.readonly && ui.current.value.context.origin === 'real' && ui.current.value.context.capabilities.includes('payroll:write'))
  const focused = computed(() => typeof route.query.record === 'string' ? ui.current.value?.records.find(row => row.id === route.query.record && row.projectId === scope.value.projectId && row.workerId === route.query.worker && row.workDate === route.query.workDate) ?? null : null)
  const focusError = computed(() => route.query.record && ui.current.value && !focused.value ? '当前记录身份或范围已变化，请按原记录重新读取；不会替换为另一条签工。' : '')
  async function confirm(id: string) {
    if (!canWrite.value || confirming.value || confirmation.value)
      return
    const requested = target()
    confirming.value = true
    commandError.value = ''
    try {
      const read = await store.loadDayworkForm({ origin: 'real' }, { recordId: id })
      if (ui.active.value && requested === target())
        confirmation.value = read
    }
    catch (cause) {
      if (ui.active.value && requested === target())
        commandError.value = toErrorMessage(cause)
    }
    finally { confirming.value = false }
  }
  watch(focused, async (record) => {
    if (!record || !ui.active.value)
      return
    await nextTick()
    if (record === focused.value && ui.active.value) {
      document.getElementById(`daywork-${record.id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      document.getElementById(`daywork-${record.id}`)?.focus()
    }
  })
  async function filter(field: 'project' | 'month' | 'crew' | 'dayworkStatus', value: string) {
    if (confirmation.value || confirming.value)
      return
    await router.replace({ path: '/subcontract/daywork', query: { ...route.query, [field]: value || undefined, ...(field === 'project' ? { crew: undefined } : {}), record: undefined, worker: undefined, workDate: undefined } })
  }
  async function closeConfirmation() {
    const id = confirmation.value?.recordId
    const requested = target()
    confirmation.value = null
    await nextTick()
    if (id && ui.active.value && requested === target())
      document.getElementById(`daywork-${id}`)?.querySelector<HTMLElement>('button')?.focus()
  }
  const returnTo = computed(() => (scope.value.origin && payrollDayworkReturn(route.fullPath, scope.value.origin)) || payrollReadLocation('/subcontract/daywork', scope.value))
  return { ...ui, scope, canWrite, dayworkStatuses, confirmation, commandError, confirming, focused, focusError, returnTo, filter, confirm, closeConfirmation }
}
