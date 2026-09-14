import type { PayrollAttendanceInput } from '~/lib/payroll/c1-presentation'
import type { PayrollAttendanceMatrixRead, PayrollAttendanceRecordDraft } from '~/lib/payroll/central-attendance-contract'
import { useEventListener } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { c1MonthDays } from '~/lib/payroll/c1-presentation'
import { payrollReadLocation, payrollViewScope } from '~/lib/payroll/central-navigation'
import { toErrorMessage } from '~/lib/util/error'
import { usePayrollRead } from './usePayrollRead'

export function useCentralAttendance() {
  const route = useRoute()
  const store = useAttendanceCentralStore()
  const kit = useKitUI()
  const scope = computed(() => payrollViewScope(route.query))
  const target = () => JSON.stringify([scope.value.origin, scope.value.projectId, scope.value.month, scope.value.crewId])
  const query = () => {
    if (scope.value.error || !scope.value.origin)
      throw new Error(scope.value.error || '来源无效')
    return { origin: scope.value.origin }
  }
  const ui = usePayrollRead(target, () => store.loadMatrix(query(), { projectId: scope.value.projectId, month: scope.value.month, crewId: scope.value.crewId || null }))
  const selected = shallowRef<{
    read: PayrollAttendanceMatrixRead
    workerId: string
    workDate: string
  } | null>(null)
  const working = shallowRef(false)
  const error = shallowRef('')
  const cellDrafts = new Map<string, PayrollAttendanceInput>()
  const openedCells = new Map<string, NonNullable<typeof selected.value>>()
  const draftCount = shallowRef(0)
  const draftRevision = shallowRef(0)
  const cellKey = (value: NonNullable<typeof selected.value>) => JSON.stringify([value.read.context.workspaceId, value.read.context.actorId, value.read.context.origin, value.read.scope.projectId, value.workerId, value.workDate])
  const cellDraft = computed(() => {
    void draftRevision.value
    return selected.value ? cellDrafts.get(cellKey(selected.value)) : undefined
  })
  function keepInput(input: PayrollAttendanceInput | null) {
    if (!selected.value)
      return
    if (input)
      cellDrafts.set(cellKey(selected.value), { ...input })
    else
      cellDrafts.delete(cellKey(selected.value))
    draftCount.value = cellDrafts.size
    draftRevision.value += 1
  }
  function discard() {
    if (selected.value)
      openedCells.delete(cellKey(selected.value))
    keepInput(null)
    selected.value = null
  }
  const hasPending = () => [...openedCells.values()].some(value => store.getAttendancePending(value.read, value.workerId, value.workDate))
  useTabCloseGuard(async () => {
    if (working.value || hasPending()) {
      error.value = '请先核对原考勤提交，再关闭或刷新页签。'
      return false
    }
    if (!cellDrafts.size)
      return true
    const before = draftRevision.value
    const accepted = await kit.confirm({ variant: 'simple', title: '放弃考勤修改', message: '本页仍有未保存的日期内容，确认放弃并关闭或刷新？', confirmLabel: '放弃修改' })
    if (!accepted || working.value || hasPending() || draftRevision.value !== before)
      return false
    return true
  })
  useEventListener('beforeunload', (event: BeforeUnloadEvent) => {
    if (draftCount.value || hasPending()) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  const pending = computed(() => selected.value ? store.getAttendancePending(selected.value.read, selected.value.workerId, selected.value.workDate) : null)
  const pendingCells = computed(() => ui.current.value
    ? ui.current.value.workers.flatMap(worker => c1MonthDays(ui.current.value!.scope.month).flatMap((date) => {
        const operation = store.getAttendancePending(ui.current.value!, worker.id, date)
        return operation ? [{ operation, name: worker.name || '姓名未记录', workerId: worker.id, date }] : []
      }))
    : [])
  const worker = computed(() => selected.value?.read.workers.find(worker => worker.id === selected.value?.workerId))
  const records = computed(() => selected.value?.read.records.filter(record => record.workerId === selected.value?.workerId && record.workDate === selected.value?.workDate) || [])
  const readonlyReasons = computed(() => {
    const value = selected.value
    if (!value)
      return []
    const reasons = [...worker.value?.reasons || []]
    if (!ui.active.value || !ui.current.value || ui.error.value || ui.current.value.scope.projectId !== value.read.scope.projectId || ui.current.value.context.origin !== value.read.context.origin)
      reasons.push('当前范围已变化或未能读取，请重新打开这一天。')
    if (value.read.context.readonly || value.read.context.origin !== 'real' || !value.read.context.capabilities.includes('payroll:write'))
      reasons.push('当前身份或来源仅可查看考勤。')
    if (!worker.value?.eligible)
      reasons.push('该工人当前不具备本项目登记资格，原考勤保留供核对。')
    if (value.read.locks.some(lock => lock.workerId === value.workerId))
      reasons.push('该成员本月已被签工或已发工资占用，不能修改考勤。')
    if (records.value.length > 1 || records.value.some(record => record.hours === null || record.overtimeHours === null))
      reasons.push('原考勤资料有缺项或重复，请先核对原始证据。')
    reasons.push(...value.read.diagnostics.filter(issue => records.value.some(record => issue.recordId === record.id)).map(issue => issue.message))
    return [...new Set(reasons)]
  })
  function select(workerId: string, workDate: string) {
    const read = ui.current.value
    if (!read || ui.loading.value || working.value || !read.workers.some(worker => worker.id === workerId) || !c1MonthDays(read.scope.month).includes(workDate))
      return
    selected.value = { read, workerId, workDate }
    openedCells.set(cellKey(selected.value), selected.value)
    error.value = ''
  }
  async function save(record: PayrollAttendanceRecordDraft) {
    const value = selected.value
    if (!value || readonlyReasons.value.length || working.value || pending.value || record.workerId !== value.workerId || record.workDate !== value.workDate)
      return
    working.value = true
    error.value = ''
    try {
      const result = await store.saveRecord(value.read, record)
      if (ui.active.value && selected.value === value && result.workerId === value.workerId && result.workDate === value.workDate && result.projectId === value.read.scope.projectId) {
        const operation = store.getAttendancePending(value.read, value.workerId, value.workDate)
        await ui.load()
        if (!ui.active.value || selected.value !== value || !ui.current.value || ui.error.value)
          return
        if (!operation)
          throw new Error('原考勤提交未能核对，请保留输入。')
        store.acknowledgeAttendance(operation, ui.current.value)
        discard()
      }
    }
    catch (cause) {
      if (ui.active.value && selected.value === value)
        error.value = toErrorMessage(cause)
    }
    finally {
      working.value = false
    }
  }
  async function recover() {
    const operation = pending.value
    const value = selected.value
    if (!operation || !value || working.value)
      return
    working.value = true
    try {
      const result = await store.recoverAttendance(operation)
      if (ui.active.value && selected.value === value && result.workerId === value.workerId && result.workDate === value.workDate && result.projectId === operation.command.projectId) {
        await ui.load()
        if (!ui.active.value || selected.value !== value || !ui.current.value || ui.error.value)
          return
        store.acknowledgeAttendance(operation, ui.current.value)
        discard()
      }
    }
    catch (cause) {
      if (ui.active.value && selected.value === value)
        error.value = toErrorMessage(cause)
    }
    finally {
      working.value = false
    }
  }
  watch(target, () => {
    selected.value = null
    error.value = ''
  }, { flush: 'sync' })
  return { ...ui, scope, selected, worker, records, cellDraft, keepInput, discard, working, commandError: error, pending, pendingCells, readonlyReasons, select, save, recover, back: computed(() => payrollReadLocation('/subcontract/payroll', scope.value)) }
}
