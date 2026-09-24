import type { PayrollC1Rate } from '~/lib/payroll/central-c1-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import PayrollACommandState from '~/components/payroll/PayrollACommandState.vue'
import PayrollC1ConfigScreen from '~/components/payroll/PayrollC1ConfigScreen.vue'
import PayrollC1RateEditor from '~/components/payroll/PayrollC1RateEditor.vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import { c1Matrix } from '../helpers/payroll-c1-ui'

const rate: PayrollC1Rate = { workerId: 'w', workerName: '原工人', profileDailyWage: 481, configuredDailyWage: null, configuredOvertimeRate: null, dailyWage: 481, dailyWageSource: 'worker-profile', overtimeRate: 60.125, overtimeRateSource: 'daily-divided-eight', configId: null, revision: null, effectiveMonth: null, sourceVersion: 'v1' }
const { configUI } = vi.hoisted(() => ({ configUI: vi.fn() }))
vi.mock('~/composables/usePayrollC1Config', () => ({ usePayrollC1Config: configUI }))
describe('c1 每人标准输入', () => {
  it('成功后的重新读取失败，原标准仍显示且原提交恢复入口不被整页错误遮挡', async () => {
    const matrix = c1Matrix()
    const recover = vi.fn()
    configUI.mockReturnValue({ current: shallowRef(null), matching: shallowRef({ context: matrix.context, scope: matrix.scope, options: { ...matrix.options, workers: matrix.workers }, rates: [rate], readonlyReasons: [], history: [] }), scope: shallowRef({ origin: 'real', projectId: 'p', month: '2026-08', crewId: 'c' }), drafts: shallowRef([{ workerId: 'w', dailyWage: null, overtimeRate: 54 }]), loading: shallowRef(false), error: shallowRef('提交后读取失败'), commandError: shallowRef(''), busy: shallowRef(false), pending: shallowRef({ state: 'awaiting-read', command: { commandId: 'original' } }), writable: shallowRef(false), dirty: shallowRef(true), latest: shallowRef(false), recover, leave: vi.fn(), load: vi.fn() })
    vi.stubGlobal('useRoute', () => ({ query: {} }))
    vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }))
    vi.stubGlobal('useTabTitle', vi.fn())
    render(PayrollC1ConfigScreen, { global: { plugins: [createPinia()], components: { EntityFormShell, PayrollACommandState, PayrollC1RateEditor }, stubs: { KitButton: { template: '<button><slot /></button>' } } } })
    expect((screen.getByLabelText('原工人加班价') as HTMLInputElement).value).toBe('54')
    expect(screen.getByRole('alert').textContent).toContain('提交已保存')
    await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
    expect(recover).toHaveBeenCalledOnce()
  })
  it('默认 60.125 只展示，原配置空值不变成手工配置；显式 0 保留', async () => {
    const view = render(PayrollC1RateEditor, { props: { rates: [rate], drafts: [{ workerId: 'w', dailyWage: null, overtimeRate: null }], workers: c1Matrix().workers, disabled: false } })
    expect((screen.getByLabelText('原工人兜底日薪') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('原工人加班价') as HTMLInputElement).value).toBe('')
    expect(view.container.textContent).toContain('60.125')
    await fireEvent.update(screen.getByLabelText('原工人加班价'), '0')
    expect(view.emitted().change?.[0]?.[0]).toEqual([{ workerId: 'w', dailyWage: null, overtimeRate: 0 }])
  })
  it('已发工人只读，其他工人的标准仍可改', () => {
    render(PayrollC1RateEditor, { props: { rates: [rate, { ...rate, workerId: 'other', workerName: '另一人' }], drafts: [{ workerId: 'w', dailyWage: null, overtimeRate: null }, { workerId: 'other', dailyWage: null, overtimeRate: null }], workers: [{ ...c1Matrix().workers[0]!, eligible: false, reasons: ['该月已发放'] }, { ...c1Matrix().workers[0]!, id: 'other', name: '另一人' }], disabled: false } })
    expect((screen.getByLabelText('原工人加班价') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('另一人加班价') as HTMLInputElement).disabled).toBe(false)
  })
})
