import type { PayrollAFeesFormRead, PayrollAFeesPending } from '~/lib/payroll/central-a-fees-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, onActivated, onDeactivated, shallowRef } from 'vue'
import { usePayrollANegativeLines } from '~/composables/usePayrollANegativeLines'
import { feeConfigRead, feeFormRead, negativeDraft } from '../helpers/payroll-fees-ui-fixture'

const calls = vi.hoisted(() => ({ save: vi.fn(), recover: vi.fn(), load: vi.fn(), scope: vi.fn(), acknowledge: vi.fn() }))
const pending = shallowRef<PayrollAFeesPending | null>(null)
vi.mock('~/stores/payroll-a-fees', () => ({ usePayrollAFeesStore: () => ({ saveNegativeLines: calls.save, recover: calls.recover, loadForm: calls.load, loadConfig: calls.scope, acknowledge: calls.acknowledge, getPending: () => pending.value }) }))
const read = shallowRef<PayrollAFeesFormRead>(feeFormRead())
const latest = shallowRef<PayrollAFeesFormRead | null>(null)
let ui: ReturnType<typeof usePayrollANegativeLines>
const Harness = defineComponent({ setup() {
  const active = shallowRef(true)
  ui = usePayrollANegativeLines({ read: () => read.value, latest: () => latest.value, blocked: () => false, active: () => active.value, saved: async () => { } })
  onActivated(() => active.value = true)
  onDeactivated(() => active.value = false)
  return () => h('p', ui.busy.value ? '正在保存' : '可核对')
} })
beforeEach(() => {
  vi.clearAllMocks()
  pending.value = null
  latest.value = null
  read.value = feeFormRead()
  read.value.book = { bookPurpose: 'management', managementBookId: 'management-book' }
  read.value.bookProof = { state: 'proven', book: read.value.book, sourceVersion: 'book' }
  read.value.negativeLineDrafts = [negativeDraft()]
  calls.scope.mockResolvedValue(feeConfigRead())
  calls.load.mockImplementation(async () => read.value)
  calls.acknowledge.mockImplementation(() => pending.value = null)
  vi.stubGlobal('useKitUI', () => ({ confirm: vi.fn().mockResolvedValue(true), success: vi.fn() }))
})
it('负价命令停用后迟到失败不锁死，原键恢复保负价输入和原基准', async () => {
  let reject!: (error: Error) => void
  calls.save.mockImplementation((value, lines) => {
    pending.value = { state: 'unknown', command: { ...value.context, commandId: 'original-negative', requiredCapability: 'payroll:write', projectId: 'project', statementId: value.statementId, draftKey: null, configScope: null, book: value.book, action: { kind: 'save-a-negative-lines', baseVersion: value.context.sourceVersion, lines, remove: [] } } }
    return new Promise((_resolve, no) => reject = no)
  })
  const visible = shallowRef(true)
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Harness) : h(defineComponent({ render: () => h('p', '来源') }))) }))
  await flushPromises()
  ui.change('negative-line', { ...negativeDraft(), unitPrice: -30 })
  const saving = ui.execute()
  visible.value = false
  await flushPromises()
  reject(new Error('回执丢失'))
  await saving
  visible.value = true
  await flushPromises()
  expect(ui.busy.value).toBe(false)
  expect(ui.rows.value[0]!.draft.unitPrice).toBe(-30)
  await ui.execute(true)
  expect(calls.recover).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({ commandId: 'original-negative', sourceVersion: read.value.context.sourceVersion }) }))
  wrapper.unmount()
})
it('后读新依据或已发冻结都不抬未提交负价基准，也不允许继续编辑已发单', async () => {
  const wrapper = mount(Harness)
  await flushPromises()
  ui.change('negative-line', { ...negativeDraft(), quantity: 20 })
  latest.value = { ...read.value, context: { ...read.value.context, sourceVersion: 'new-version' } }
  await flushPromises()
  expect(ui.matching.value?.context.sourceVersion).toBe(read.value.context.sourceVersion)
  expect(ui.rows.value[0]!.draft.quantity).toBe(20)
  await ui.recheck()
  expect(ui.matching.value?.context.sourceVersion).toBe('new-version')
  latest.value = { ...latest.value, status: 'released' }
  await flushPromises()
  expect(ui.editable.value).toBe(false)
  await ui.execute()
  expect(calls.save).not.toHaveBeenCalled()
  wrapper.unmount()
})
