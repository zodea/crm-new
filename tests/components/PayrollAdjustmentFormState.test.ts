import type { PayrollAdjustmentCommand, PayrollAdjustmentFormInput, PayrollAdjustmentFormRead } from '~/lib/payroll/central-adjustment-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, reactive, shallowRef } from 'vue'
import PayrollACommandState from '~/components/payroll/PayrollACommandState.vue'
import { usePayrollAdjustmentForm } from '~/composables/usePayrollAdjustmentForm'
import { payrollAdjustmentFormRead } from '../helpers/payroll-adjustment-ui-fixture'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
vi.mock('~/lib/platform/runtime', () => ({ isDesktopRuntime: () => false }))
const route = reactive({ path: '/subcontract/payroll/adjustments/new', fullPath: '/subcontract/payroll/adjustments/new?origin=real&draftKey=draft-adjustment&statementId=wage-original', params: {} as Record<string, string>, query: { origin: 'real', draftKey: 'draft-adjustment', statementId: 'wage-original' } as Record<string, string> })
const load = vi.fn()
const detail = vi.fn()
const save = vi.fn()
const recover = vi.fn()
const confirm = vi.fn()
const push = vi.fn()
const close = vi.fn()
const pending = shallowRef<{ command: PayrollAdjustmentCommand, state: 'awaiting-read' | 'unknown' } | null>(null)
const guard = shallowRef<(() => Promise<boolean>) | null>(null)
let ui: ReturnType<typeof usePayrollAdjustmentForm>
const mountOptions = { global: { stubs: { KitButton: { template: '<button><slot /></button>' } } } }
const Harness = defineComponent({ setup() {
  ui = usePayrollAdjustmentForm()
  return () => h(PayrollACommandState, { ref: ui.errorPanel, error: ui.error.value, pending: !!ui.pending.value, busy: ui.busy.value, focusable: true })
} })
beforeEach(() => {
  vi.clearAllMocks()
  pending.value = null
  route.query = { origin: 'real', draftKey: 'draft-adjustment', statementId: 'wage-original' }
  load.mockImplementation(async (_query, input: PayrollAdjustmentFormInput) => ({ ...payrollAdjustmentFormRead(), target: input.target, ...(input.draft ? { draft: input.draft } : {}) }))
  save.mockImplementation(async (read: PayrollAdjustmentFormRead, draft: PayrollAdjustmentFormRead['draft']) => {
    pending.value = { command: { commandId: 'command', projectId: 'project', workspaceId: 'workspace', actorId: 'actor', origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, target: read.target, action: { kind: 'save-adjustment-draft', draft } }, state: 'awaiting-read' }
    return { commandId: 'command', projectId: 'project', originalStatementId: 'wage-original', adjustmentId: 'adjustment', actualEventId: null, applicationIds: [], outcome: 'saved', sourceVersion: 'saved', logIds: ['log'] }
  })
  recover.mockImplementation(async () => ({ commandId: 'command', projectId: 'project', originalStatementId: 'wage-original', adjustmentId: 'adjustment', actualEventId: null, applicationIds: [], outcome: 'saved', sourceVersion: 'saved', logIds: ['log'] }))
  detail.mockResolvedValue({ context: payrollAdjustmentFormRead().context })
  confirm.mockResolvedValue(true)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push, replace: vi.fn() }))
  vi.stubGlobal('usePayrollAdjustmentsStore', () => ({ loadAdjustmentForm: load, loadAdjustmentDetail: detail, saveAdjustmentDraft: save, confirmAdjustment: vi.fn(), recoverAdjustment: recover, getAdjustmentPending: () => pending.value, acknowledgeAdjustment: vi.fn(() => pending.value = null) }))
  vi.stubGlobal('useTabsStore', () => ({ close, registerCloseGuard: (_key: string, handler: () => Promise<boolean>) => {
    guard.value = handler
    return () => {}
  } }))
  vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn() }))
})
afterEach(() => vi.unstubAllGlobals())
it('成功后读失败保留原更正与原键，明确恢复后才关页签', async () => {
  const wrapper = mount(Harness, { ...mountOptions, attachTo: document.body })
  await flushPromises()
  ui.change({ ...ui.draft.value!, reason: '原主体单价核减', evidenceNote: '核实原证明' })
  await ui.load(true)
  detail.mockRejectedValueOnce(new Error('原结果暂不可读'))
  await ui.execute('save')
  expect(ui.draft.value?.reason).toBe('原主体单价核减')
  expect(ui.pending.value?.state).toBe('awaiting-read')
  expect(document.activeElement?.getAttribute('role')).toBe('alert')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('工资提交核对')
  expect(close).not.toHaveBeenCalled()
  expect(await guard.value!()).toBe(false)
  const original = structuredClone(pending.value!.command)
  await ui.execute('recover')
  expect(recover).toHaveBeenCalledWith(expect.objectContaining({ command: original }))
  expect(pending.value).toBeNull()
  expect(push).toHaveBeenCalledWith(expect.objectContaining({ path: '/subcontract/payroll/adjustments/adjustment' }))
  wrapper.unmount()
})
it('重新读取撤权立即禁写，原稿和采用依据保留，当前读取不冒充采用', async () => {
  const wrapper = mount(Harness, mountOptions)
  await flushPromises()
  ui.change({ ...ui.draft.value!, reason: '仍未保存' })
  load.mockResolvedValueOnce({ ...payrollAdjustmentFormRead('source-2'), context: { ...payrollAdjustmentFormRead('source-2').context, readonly: true, capabilities: ['payroll:read'] } })
  await ui.load()
  expect(ui.draft.value?.reason).toBe('仍未保存')
  expect(ui.read.value?.context.sourceVersion).toBe('source-1')
  expect(ui.latest.value?.context.sourceVersion).toBe('source-2')
  expect(ui.editable.value).toBe(false)
  await ui.execute('save')
  expect(save).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('keepAlive 切走保更正稿，返回只更新资格且不自动确认', async () => {
  const visible = shallowRef(true)
  const Other = defineComponent({ render: () => h('span', '原工资') })
  const wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Harness) : h(Other)) }), mountOptions)
  await flushPromises()
  ui.change({ ...ui.draft.value!, reason: '保留更正稿' })
  visible.value = false
  await flushPromises()
  load.mockResolvedValueOnce(payrollAdjustmentFormRead('source-later'))
  visible.value = true
  await flushPromises()
  expect(ui.draft.value?.reason).toBe('保留更正稿')
  expect(ui.read.value?.context.sourceVersion).toBe('source-1')
  expect(ui.latest.value?.context.sourceVersion).toBe('source-later')
  expect(ui.canConfirm.value).toBe(false)
  wrapper.unmount()
})
