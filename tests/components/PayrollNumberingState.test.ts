import type { PayrollNumberingRead } from '~/lib/payroll/central-numbering-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, ref } from 'vue'
import { usePayrollNumbering } from '~/composables/usePayrollNumbering'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
const load = vi.fn()
const submit = vi.fn()
const recover = vi.fn()
const getPending = vi.fn(() => null)
const confirm = vi.fn(async () => true)
const success = vi.fn()
vi.mock('~/stores/payroll-numbering', () => ({ usePayrollNumberingStore: () => ({ load, submit, recover, getPending }) }))
const id = ref('original-one')
let ui: ReturnType<typeof usePayrollNumbering>
function read(statementId = 'original-one'): PayrollNumberingRead {
  return { context: { workspaceId: 'work', actorId: 'actor', origin: 'real', sourceVersion: 'v1', capabilities: ['payroll:read', 'payroll:write'], readonly: false }, input: { projectId: 'project-one', statementId }, document: null, settings: null, issue: null, eligibility: { canInitialize: true, canIssue: false, canDownload: false, reasons: ['请先登记项目旧纸号起点'] } }
}
const Harness = defineComponent({ setup() {
  ui = usePayrollNumbering(() => 'project-one', () => id.value)
  return () => h('div', ui.current.value?.input.statementId ?? '未读取')
} })
beforeEach(() => {
  vi.clearAllMocks()
  id.value = 'original-one'
  load.mockImplementation(async (input: { statementId: string }) => read(input.statementId))
  getPending.mockReturnValue(null)
  confirm.mockResolvedValue(true)
  vi.stubGlobal('useKitUI', () => ({ confirm, success, exportFile: vi.fn() }))
  vi.stubGlobal('useTabCloseGuard', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

it('项目旧纸号不猜起点，未明确填写时不发命令', async () => {
  const wrapper = mount(Harness)
  await flushPromises()
  expect(ui.nextNumber.value).toBe('')
  await ui.submit('initialize')
  expect(submit).not.toHaveBeenCalled()
  expect(ui.error.value).toContain('下一张')
  wrapper.unmount()
})
it('起点保存失败保留原输入，取消明确确认不会提交', async () => {
  const wrapper = mount(Harness)
  await flushPromises()
  ui.nextNumber.value = '128'
  ui.evidenceNote.value = '人工核对到127'
  confirm.mockResolvedValueOnce(false)
  await ui.submit('initialize')
  expect(submit).not.toHaveBeenCalled()
  submit.mockRejectedValueOnce(new Error('来源已变化'))
  await ui.submit('initialize')
  expect(submit).toHaveBeenCalledWith(expect.anything(), { kind: 'initialize', nextNumber: 128, evidenceNote: '人工核对到127' })
  expect(ui.nextNumber.value).toBe('128')
  expect(ui.evidenceNote.value).toBe('人工核对到127')
  expect(ui.error.value).toContain('来源已变化')
  wrapper.unmount()
})
it('切换原工资后迟到读取不能覆盖新目标', async () => {
  let finish!: (value: PayrollNumberingRead) => void
  load.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
  const wrapper = mount(Harness)
  id.value = 'original-two'
  await flushPromises()
  finish(read())
  await flushPromises()
  expect(wrapper.text()).toBe('original-two')
  wrapper.unmount()
})
it('页面停用后的迟到提交不能恢复旧原件或提示完成', async () => {
  let finish!: (value: PayrollNumberingRead) => void
  submit.mockImplementation(() => new Promise(resolve => finish = resolve))
  const active = ref(true)
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, null, () => active.value ? h(Harness) : h('div', 'other')) }))
  await flushPromises()
  ui.nextNumber.value = '128'
  ui.evidenceNote.value = '已核对'
  const saving = ui.submit('initialize')
  await flushPromises()
  active.value = false
  await flushPromises()
  finish(read())
  await saving
  expect(ui.current.value).toBeNull()
  expect(ui.printRead.value).toBeNull()
  expect(success).not.toHaveBeenCalled()
  wrapper.unmount()
})
