import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, shallowRef } from 'vue'
import { usePayrollAStatement } from '~/composables/usePayrollAStatement'
import { payrollUiForm } from '../helpers/payroll-a-ui-fixture'

const load = vi.fn()
const release = vi.fn()
const check = vi.fn()
const changed = vi.fn()
const target = reactive({ id: 'wage-a' })
const pending = shallowRef<{ command: { commandId: string, action: { kind: string } }, state: 'awaiting-read' } | null>(null)
let ui: ReturnType<typeof usePayrollAStatement>
const Harness = defineComponent({ setup() {
  ui = usePayrollAStatement({ id: () => target.id, origin: () => 'real', changed })
  return () => h('p', ui.error.value)
} })
beforeEach(() => {
  vi.clearAllMocks()
  target.id = 'wage-a'
  pending.value = null
  load.mockResolvedValue(payrollUiForm())
  vi.stubGlobal('usePayrollStore', () => ({ loadAForm: load, getAPending: () => pending.value, acknowledgeA: vi.fn(() => pending.value = null), releaseA: async (...args: unknown[]) => {
    const result = await release(...args)
    pending.value = { command: { commandId: 'release', action: { kind: 'release-a' } }, state: 'awaiting-read' }
    return result
  }, checkA: async (...args: unknown[]) => {
    const result = await check(...args)
    pending.value = { command: { commandId: 'check', action: { kind: 'check-a' } }, state: 'awaiting-read' }
    return result
  } }))
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn() }))
})
it('此前实付变化后持久需重核，重核成功仍保原实发输入且再确认使用新依据', async () => {
  const wrapper = mount(Harness)
  await flushPromises()
  ui.openRelease()
  const original = { actualAmount: 250, allocations: [{ workerId: 'worker', amount: 250 }, { workerId: 'zero', amount: 0 }] }
  const recheck = { ...payrollUiForm('checked', 'v2'), needsRecheck: true, eligibility: { ...payrollUiForm().eligibility, canRelease: false } }
  release.mockResolvedValue({ statementId: 'wage-a', projectId: 'project', outcome: 'needs-recheck' })
  load.mockResolvedValue(recheck)
  await ui.execute('release', original)
  expect(release).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ sourceVersion: 'v1' }) }), original)
  expect(ui.releaseOpen.value).toBe(false)
  expect(ui.releaseDraft.value).toEqual(original)
  expect(ui.error.value).toContain('已保存为需重核')
  check.mockResolvedValue({ statementId: 'wage-a', projectId: 'project', outcome: 'checked' })
  load.mockResolvedValue(payrollUiForm('checked', 'v3'))
  await ui.execute('check')
  ui.openRelease()
  expect(ui.releaseDraft.value).toEqual(original)
  expect(ui.releaseRead.value?.context.sourceVersion).toBe('v3')
  wrapper.unmount()
})
it('同目标KeepAlive切回保未保存比例，显式重读不会偷改原提交依据', async () => {
  const visible = shallowRef(true)
  const Other = defineComponent({ render: () => h('p', '其他页') })
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Harness) : h(Other)) }))
  await flushPromises()
  ui.ratio.value = 0.7
  visible.value = false
  await flushPromises()
  load.mockResolvedValue(payrollUiForm('checked', 'v2'))
  visible.value = true
  await flushPromises()
  expect(ui.ratio.value).toBe(0.7)
  expect(ui.matching.value?.context.sourceVersion).toBe('v1')
  wrapper.unmount()
})
it('刷新403保比例和实发金额，但立即禁止原界面发起新核对与发放', async () => {
  const wrapper = mount(Harness)
  await flushPromises()
  ui.ratio.value = 0.7
  ui.openRelease()
  ui.releaseDraft.value = { actualAmount: 299.99, allocations: [{ workerId: 'worker', amount: 299.99 }, { workerId: 'zero', amount: 0 }] }
  load.mockRejectedValue(new Error('无权读取工资'))
  await ui.load()
  expect(ui.writable.value).toBe(false)
  expect(ui.ratio.value).toBe(0.7)
  expect(ui.releaseDraft.value.actualAmount).toBe(299.99)
  await ui.execute('check')
  await ui.execute('release', ui.releaseDraft.value)
  expect(check).not.toHaveBeenCalled()
  expect(release).not.toHaveBeenCalled()
  wrapper.unmount()
})
