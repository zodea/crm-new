import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PayrollHollowReview from '~/components/payroll/PayrollHollowReview.vue'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))
const confirm = vi.fn()
const success = vi.fn()
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  confirm.mockResolvedValue(true)
  vi.stubGlobal('useKitUI', () => ({ confirm, success }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

it('真实工资人工确认后才采用15处扣450，回复丢失原键核对不重复启动', async () => {
  const f = await createPayrollHollowFixture()
  let wrapper: ReturnType<typeof mount> | null = null
  try {
    const initial = await f.form()
    const saved = await f.service.execute(f.command(initial, { kind: 'save-a-draft', draft: f.draft }))
    const statementId = saved.statementId!
    const form = await f.service.aForm({ origin: 'real' }, { statementId })
    let loseReply = true
    const execute = vi.fn(async (command: Parameters<typeof f.service.executeHollow>[0]) => {
      const result = await f.service.executeHollow(command)
      if (loseReply) {
        loseReply = false
        throw new Error('启动回复丢失')
      }
      return result
    })
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: { executeHollow: execute, aForm: f.service.aForm }, projectCommands: { context: async () => f.session() } } }))
    wrapper = mount(PayrollHollowReview, { props: { read: form.hollow!, returnTo: `/subcontract/payroll/${statementId}?origin=real` }, attachTo: document.body, global: { stubs: { NuxtLink: true } } })
    const start = () => wrapper!.findAll('button').find(button => button.text() === '开始扣款')!
    expect(wrapper.text()).toContain('19 / 4 / 15 处')
    confirm.mockResolvedValueOnce(false)
    await start().trigger('click')
    await flushPromises()
    expect(execute).not.toHaveBeenCalled()
    expect((await f.service.aForm({ origin: 'real' }, { statementId })).totals.grossAmount.value).toBe(1000)
    await start().trigger('click')
    await vi.waitFor(() => expect(wrapper!.text()).toContain('启动回复丢失'))
    expect(document.activeElement?.getAttribute('aria-label')).toBe('工资提交核对')
    const original = structuredClone(execute.mock.calls[0]![0])
    await wrapper.findAll('button').find(button => button.text() === '核对原提交')!.trigger('click')
    await vi.waitFor(() => expect(success).toHaveBeenCalled())
    expect(execute.mock.calls[1]![0]).toEqual(original)
    const result = await f.service.aForm({ origin: 'real' }, { statementId })
    expect(result.hollow?.starts).toHaveLength(1)
    expect(result.totals.grossAmount.value).toBe(550)
    expect(result.hollow?.totals.currentDeduction.value).toBe(450)
    expect(wrapper.emitted('changed')).toHaveLength(1)
    await wrapper.setProps({ read: result.hollow! })
    expect(wrapper.text()).toContain('本单已开始扣款 · 原采用 15 处')
    expect(wrapper.text()).not.toContain('待人工开始')
    expect(wrapper.findAll('button').some(button => button.text() === (result.hollow!.eligibility.canStart ? '重新开始扣款' : '本单已开始扣款'))).toBe(true)
  }
  finally {
    wrapper?.unmount()
    await f.close()
  }
}, 30_000)

it('已发原扣款保持15处，后来全整改在只读伴随区显示当前0处', async () => {
  const f = await createPayrollHollowFixture()
  let wrapper: ReturnType<typeof mount> | null = null
  try {
    const initial = await f.form()
    const saved = await f.service.execute(f.command(initial, { kind: 'save-a-draft', draft: f.draft }))
    const statementId = saved.statementId!
    let read = await f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand(read.hollow!))
    read = await f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.execute(f.command(read, { kind: 'check-a' }))
    read = await f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.execute(f.command(read, { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const current = await f.quantityService.hollow(f.scope)
    await f.quantityService.executeHollow(f.hollowCommand(current, { kind: 'rectify-hollow-inspection', recordId: f.recordId, expectedRevisionId: current.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-01', count: 15, note: '发放后已全部整改' }))
    const frozen = await f.reloadPayroll().aForm({ origin: 'real' }, { statementId })
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: {}, projectCommands: {} } }))
    wrapper = mount(PayrollHollowReview, { props: { read: frozen.hollow!, returnTo: `/subcontract/payroll/${statementId}?origin=real`, readonly: true }, global: { stubs: { NuxtLink: true } } })
    expect(wrapper.text()).toContain('19 / 4 / 15 处')
    expect(wrapper.get('[aria-label="已发后当前空鼓来源"]').text()).toContain('19 / 19 / 0 处')
    expect(wrapper.get('[aria-label="已发后当前空鼓来源"]').text()).toContain('整改 4→19；余量 15→0')
    expect(wrapper.text()).toContain('上方冻结扣款与实发金额保持原样')
  }
  finally {
    wrapper?.unmount()
    await f.close()
  }
}, 30_000)
