// @vitest-environment jsdom
import type { PayrollAttendanceCommand } from '~/lib/payroll/central-attendance-contract'
import type { PayrollC1Command, PayrollC1ConfigRead } from '~/lib/payroll/central-c1-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { useCentralAttendance } from '~/composables/useCentralAttendance'
import { deriveKey } from '~/lib/tabs/tab-machine'
import { useAttendanceCentralStore } from '~/stores/attendance-central'
import { usePayrollC1Store } from '~/stores/payroll-c1'
import { useTabsStore } from '~/stores/tabs'
import { c1Form, c1Matrix } from '../helpers/payroll-c1-ui'

const repository = { executeC1: vi.fn(), c1Form: vi.fn(), c1Config: vi.fn(), executeAttendance: vi.fn(), attendanceMatrix: vi.fn() }
beforeEach(() => {
  sessionStorage.clear()
  vi.resetAllMocks()
  setActivePinia(createPinia())
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repository } }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('c1 成功回执后冷读失败并刷新页面，仍可用原金额原编号恢复结果', async () => {
  const form = c1Form()
  const store = usePayrollC1Store()
  repository.executeC1.mockImplementation(async (command: PayrollC1Command) => ({ commandId: command.commandId, projectId: command.projectId, statementId: command.statementId, rateRevisionIds: [], sourceVersion: 'after-release', outcome: 'released', logIds: ['original-log'] }))
  repository.c1Form.mockRejectedValue(new Error('成功后读取中断'))
  const release = { actualAmount: 300, allocations: [{ workerId: 'w', amount: 300 }, { workerId: 'zero', amount: 0 }] }
  await store.releaseC1(form, release)
  const original = structuredClone(repository.executeC1.mock.calls[0]![0])
  await expect(store.loadC1Form({ origin: 'real' }, { statementId: form.statementId! })).rejects.toThrow('成功后读取中断')
  setActivePinia(createPinia())
  const cold = usePayrollC1Store()
  expect(cold.getC1Pending(form)?.command).toEqual(original)
})

it('考勤成功回执后矩阵冷读失败并刷新页面，原日期原工时与原命令仍保留', async () => {
  const matrix = c1Matrix()
  const store = useAttendanceCentralStore()
  repository.executeAttendance.mockImplementation(async (command: PayrollAttendanceCommand) => ({ commandId: command.commandId, projectId: command.projectId, recordId: 'saved-record', workerId: command.action.record.workerId, workDate: command.action.record.workDate, sourceVersion: 'after-save', outcome: 'saved', logIds: ['original-log'] }))
  repository.attendanceMatrix.mockRejectedValue(new Error('成功后矩阵读取中断'))
  const record = { workerId: 'w', crewId: 'c', workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '必须保留的施工内容', note: '' }
  await store.saveRecord(matrix, record)
  const original = structuredClone(repository.executeAttendance.mock.calls[0]![0])
  await expect(store.loadMatrix({ origin: 'real' }, matrix.scope)).rejects.toThrow('成功后矩阵读取中断')
  setActivePinia(createPinia())
  const cold = useAttendanceCentralStore()
  expect(cold.getAttendancePending(matrix, record.workerId, record.workDate)?.command).toEqual(original)
})

it('个人标准保存后原项目失效，只有空标准和只读原因的冷读不能解除原操作', async () => {
  const form = c1Form()
  const scope = { projectId: 'p', month: '2026-08', crewId: 'c' }
  const original: PayrollC1ConfigRead = { context: form.context, scope, options: form.options, rates: [], readonlyReasons: [], history: [] }
  const store = usePayrollC1Store()
  repository.executeC1.mockImplementation(async (command: PayrollC1Command) => ({ commandId: command.commandId, projectId: command.projectId, statementId: null, rateRevisionIds: ['saved-rate'], sourceVersion: 'after-rate', outcome: 'saved', logIds: ['rate-log'] }))
  await store.saveC1Rates(original, [{ workerId: 'w', dailyWage: null, overtimeRate: 55 }])
  const pending = store.getC1Pending(original)!
  // 与真实 config 服务在 source.projects 不含原项目时一致：保 scope，项目不可用且无工资事实。
  repository.c1Config.mockResolvedValueOnce({ ...original, options: { projects: [], crews: [], workers: [] }, rates: [], readonlyReasons: ['当前工资项目不可用'] })
  const unavailable = await store.loadC1Config({ origin: 'real' }, scope)
  expect(() => store.acknowledgeC1(pending, unavailable)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  expect(store.getC1Pending(original)?.command).toEqual(pending.command)
})

it('冷恢复考勤只能由本实例原身份真实后读确认，拷贝 DTO 或只读身份均不能清除', async () => {
  const matrix = c1Matrix()
  const record = { workerId: 'w', crewId: 'c', workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '原施工内容', note: '' }
  const store = useAttendanceCentralStore()
  repository.executeAttendance.mockImplementation(async (command: PayrollAttendanceCommand) => ({ commandId: command.commandId, projectId: command.projectId, recordId: 'r', workerId: command.action.record.workerId, workDate: command.action.record.workDate, sourceVersion: 'after-save', outcome: 'saved', logIds: ['original-log'] }))
  await store.saveRecord(matrix, record)
  const original = store.getAttendancePending(matrix, 'w', record.workDate)!
  setActivePinia(createPinia())
  const cold = useAttendanceCentralStore()
  expect(cold.getAttendancePending(matrix, 'w', record.workDate)).toEqual(original)
  repository.attendanceMatrix.mockResolvedValueOnce({ ...matrix, context: { ...matrix.context, readonly: true, capabilities: ['payroll:read'] } })
  const readonly = await cold.loadMatrix({ origin: 'real' }, matrix.scope)
  expect(() => cold.acknowledgeAttendance(original, readonly)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  repository.attendanceMatrix.mockResolvedValueOnce(c1Matrix())
  const refreshed = await cold.loadMatrix({ origin: 'real' }, matrix.scope)
  expect(() => cold.acknowledgeAttendance(original, structuredClone(refreshed))).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  expect(cold.getAttendancePending(matrix, 'w', record.workDate)?.command).toEqual(original.command)
  cold.acknowledgeAttendance(original, refreshed)
  expect(cold.getAttendancePending(matrix, 'w', record.workDate)).toBeNull()
  expect(repository.executeAttendance).toHaveBeenCalledTimes(1)
})

it('考勤格未保存时关闭或刷新应用页签，取消放弃确认必须保住页签与原格输入', async () => {
  const fullPath = '/subcontract/attendance?origin=real&project=p&month=2026-08&crew=c'
  const route = reactive({ fullPath, query: { origin: 'real', project: 'p', month: '2026-08', crew: 'c' } })
  const tabs = useTabsStore()
  tabs.open({ fullPath, title: '考勤' })
  const key = deriveKey(fullPath)
  const confirm = vi.fn().mockResolvedValue(false)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useTabsStore', () => tabs)
  vi.stubGlobal('useKitUI', () => ({ confirm }))
  vi.stubGlobal('useAttendanceCentralStore', () => ({ loadMatrix: async () => c1Matrix(), getAttendancePending: () => null }))
  let ui!: ReturnType<typeof useCentralAttendance>
  const view = mount(defineComponent({ setup() {
    ui = useCentralAttendance()
    return () => h('p')
  } }))
  try {
    await flushPromises()
    ui.select('w', '2026-08-01')
    const input = { hours: 7.51, overtimeHours: 0, workContent: '尚未保存的施工内容', note: '不能因关页签消失' }
    ui.keepInput(input)
    expect(await tabs.requestClose(key)).toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
    expect(tabs.tabs.some(tab => tab.key === key)).toBe(true)
    expect(ui.cellDraft.value).toEqual(input)
    expect(await tabs.requestRefresh()).toBe(false)
    expect(tabs.invalidatedKeys).not.toContain(key)
    expect(ui.cellDraft.value).toEqual(input)
  }
  finally {
    view.unmount()
  }
})

it('批量关闭在其他页签取消时，考勤已确认但尚未卸载的原稿仍须保留', async () => {
  const fullPath = '/subcontract/attendance?origin=real&project=p&month=2026-08&crew=c'
  const route = reactive({ fullPath, query: { origin: 'real', project: 'p', month: '2026-08', crew: 'c' } })
  const tabs = useTabsStore()
  tabs.open({ fullPath, title: '考勤' })
  const key = deriveKey(fullPath)
  const confirm = vi.fn().mockResolvedValue(true)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useTabsStore', () => tabs)
  vi.stubGlobal('useKitUI', () => ({ confirm }))
  vi.stubGlobal('useAttendanceCentralStore', () => ({ loadMatrix: async () => c1Matrix(), getAttendancePending: () => null }))
  let ui!: ReturnType<typeof useCentralAttendance>
  const view = mount(defineComponent({ setup() {
    ui = useCentralAttendance()
    return () => h('p')
  } }))
  try {
    await flushPromises()
    ui.select('w', '2026-08-01')
    const input = { hours: 7.51, overtimeHours: 0, workContent: '关闭整批取消后仍须保留', note: '' }
    ui.keepInput(input)
    const another = '/subcontract/payroll/new?origin=real&format=C1&draftKey=another'
    tabs.open({ fullPath: another, title: '另一个工资草稿' })
    tabs.registerCloseGuard(deriveKey(another), () => false)
    expect(await tabs.requestCloseEvery()).toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
    expect(tabs.tabs.some(tab => tab.key === key)).toBe(true)
    expect(ui.cellDraft.value).toEqual(input)
  }
  finally {
    view.unmount()
  }
})
