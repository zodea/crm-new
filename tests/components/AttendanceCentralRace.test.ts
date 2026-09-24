import type { PayrollAttendanceCommandResult, PayrollAttendanceMatrixRead } from '~/lib/payroll/central-attendance-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import CentralAttendanceScreen from '~/components/payroll/CentralAttendanceScreen.vue'
import { useCentralAttendance } from '~/composables/useCentralAttendance'
import { c1Matrix } from '../helpers/payroll-c1-ui'

beforeEach(() => {
  vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {} }))
  vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn().mockResolvedValue(false) }))
})

describe('中央考勤原格保存边界', () => {
  it('旧格保存途中切换月份，迟到成功不清新月份当前格或重读旧范围', async () => {
    const route = reactive({ fullPath: '/subcontract/attendance?origin=real&project=p&month=2026-08&crew=c', query: { origin: 'real', project: 'p', month: '2026-08', crew: 'c' } })
    let resolve!: (value: PayrollAttendanceCommandResult) => void
    const save = vi.fn(() => new Promise<PayrollAttendanceCommandResult>(done => resolve = done))
    const load = vi.fn(async (_query, scope: PayrollAttendanceMatrixRead['scope']) => ({ ...c1Matrix(), scope, records: [] }))
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useAttendanceCentralStore', () => ({ loadMatrix: load, getAttendancePending: () => null, saveRecord: save }))
    let ui!: ReturnType<typeof useCentralAttendance>
    const view = mount(defineComponent({ setup() {
      ui = useCentralAttendance()
      return () => h('p', ui.current.value?.scope.month)
    } }))
    await flushPromises()
    ui.select('w', '2026-08-01')
    const waiting = ui.save({ workerId: 'w', crewId: 'c', workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '原格', note: '' })
    route.query.month = '2026-09'
    await flushPromises()
    resolve({ commandId: 'cmd', projectId: 'p', recordId: 'r', workerId: 'w', workDate: '2026-08-01', sourceVersion: 'v2', outcome: 'saved', logIds: [] })
    await waiting
    expect(ui.current.value?.scope.month).toBe('2026-09')
    expect(ui.selected.value).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[0]?.[0].scope.month).toBe('2026-08')
    view.unmount()
  })
  it('由原考勤链接打开并保存后，重读同一矩阵不再次弹出旧格', async () => {
    const route = reactive({ fullPath: '/subcontract/attendance?origin=real&project=p&month=2026-08&crew=c', query: { origin: 'real', project: 'p', month: '2026-08', crew: 'c', record: 'r', worker: 'w', workDate: '2026-08-01' } })
    const load = vi.fn(async () => c1Matrix())
    const save = vi.fn(async () => ({ commandId: 'cmd', projectId: 'p', recordId: 'r', workerId: 'w', workDate: '2026-08-01', sourceVersion: 'v2', outcome: 'saved', logIds: [] }))
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }))
    vi.stubGlobal('useAttendanceCentralStore', () => ({ loadMatrix: load, getAttendancePending: () => save.mock.calls.length ? { command: { commandId: 'cmd' } } : null, saveRecord: save, acknowledgeAttendance: vi.fn() }))
    const view = mount(CentralAttendanceScreen, { global: { stubs: { NuxtLink: true, KitButton: true, PayrollC1SourceReturn: true, PayrollSourceEvidence: true, CentralAttendanceGrid: true, PayrollAttendanceCellDialog: true } } })
    await flushPromises()
    const dialog = view.findComponent({ name: 'PayrollAttendanceCellDialog' })
    expect(dialog.exists()).toBe(true)
    dialog.vm.$emit('save', { workerId: 'w', crewId: 'c', workDate: '2026-08-01', hours: 7.51, overtimeHours: 0, workContent: '仅改施工内容', note: '' })
    await flushPromises()
    expect(save).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledTimes(2)
    expect(view.findComponent({ name: 'PayrollAttendanceCellDialog' }).exists()).toBe(false)
    view.unmount()
  })
  it('切月份不会丢弃原格未提交输入，返回原范围仍可继续填写', async () => {
    const route = reactive({ fullPath: '/subcontract/attendance?origin=real&project=p&month=2026-08&crew=c', query: { origin: 'real', project: 'p', month: '2026-08', crew: 'c' } })
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useAttendanceCentralStore', () => ({ loadMatrix: async (_query: unknown, scope: PayrollAttendanceMatrixRead['scope']) => ({ ...c1Matrix(), scope }), getAttendancePending: () => null }))
    let ui!: ReturnType<typeof useCentralAttendance>
    const view = mount(defineComponent({ setup() {
      ui = useCentralAttendance()
      return () => h('p')
    } }))
    await flushPromises()
    ui.select('w', '2026-08-01')
    ui.keepInput({ hours: null, overtimeHours: 2, workContent: '原格未保存', note: '原备注' })
    route.query.month = '2026-09'
    await flushPromises()
    route.query.month = '2026-08'
    await flushPromises()
    ui.select('w', '2026-08-01')
    expect(ui.cellDraft.value).toEqual({ hours: null, overtimeHours: 2, workContent: '原格未保存', note: '原备注' })
    ui.discard()
    ui.select('w', '2026-08-01')
    expect(ui.cellDraft.value).toBeUndefined()
    view.unmount()
  })
})
