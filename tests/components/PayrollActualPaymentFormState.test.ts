import type { PayrollActualPaymentFormInput, PayrollActualPaymentFormRead } from '~/lib/payroll/central-actual-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { usePayrollActualPaymentForm } from '~/composables/usePayrollActualPaymentForm'
import { knownPayrollSigned, payrollAdjustmentFormRead, payrollAdjustmentOriginal } from '../helpers/payroll-adjustment-ui-fixture'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
vi.mock('~/lib/platform/runtime', () => ({ isDesktopRuntime: () => false }))
const route = reactive({ path: '/subcontract/payroll/payments/new', fullPath: '/subcontract/payroll/payments/new?origin=real&draftKey=payment-draft&adjustmentId=adjustment', params: {}, query: { origin: 'real', draftKey: 'payment-draft', adjustmentId: 'adjustment' } })
const load = vi.fn()
const confirm = vi.fn()
const execute = vi.fn()
let ui: ReturnType<typeof usePayrollActualPaymentForm>
function read(input: PayrollActualPaymentFormInput): PayrollActualPaymentFormRead {
  return { context: payrollAdjustmentFormRead().context, target: input.target, originals: [payrollAdjustmentOriginal()], balances: [{ adjustmentId: 'adjustment', rootAdjustmentId: 'adjustment', confirmedDelta: knownPayrollSigned(-100), appliedDelta: knownPayrollSigned(0), remainingDelta: knownPayrollSigned(-100), balanceVersion: 'balance-current', applicationIds: [] }], draft: input.draft ?? { kind: 'refund', occurredOn: '', amount: null, evidenceNote: '', allocations: [], applications: [{ adjustmentId: 'adjustment', amount: null, balanceVersion: 'balance-current' }] }, eligibility: { canConfirmActual: !!input.draft?.amount && input.draft.applications[0]?.balanceVersion === 'balance-current', reasons: [] } }
}
const Harness = defineComponent({ setup() {
  ui = usePayrollActualPaymentForm()
  return () => h('p', ui.error.value)
} })
beforeEach(() => {
  vi.clearAllMocks()
  load.mockImplementation(async (_query, input: PayrollActualPaymentFormInput) => read(input))
  confirm.mockResolvedValue(false)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push: vi.fn(), replace: vi.fn() }))
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn(), registerCloseGuard: () => () => {} }))
  vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn() }))
  vi.stubGlobal('usePayrollAdjustmentsStore', () => ({ loadActualPaymentForm: load, getAdjustmentPending: () => null, confirmActualPayment: execute }))
})
afterEach(() => vi.unstubAllGlobals())
it('待退差额不会默认成实际已退，取消实际确认仍保人员金额', async () => {
  const wrapper = mount(Harness)
  await flushPromises()
  expect(ui.draft.value?.amount).toBeNull()
  expect(ui.draft.value?.allocations).toEqual([])
  expect(ui.canConfirm.value).toBe(false)
  ui.change({ ...ui.draft.value!, occurredOn: '2026-09-01', amount: -40, evidenceNote: '现场实际退回40', allocations: [{ workerId: 'worker', amount: -40 }, { workerId: 'zero', amount: 0 }], applications: [{ adjustmentId: 'adjustment', amount: -40, balanceVersion: 'balance-current' }] })
  await ui.load(true)
  await ui.execute('confirm')
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: '确认实际退款', message: expect.stringContaining('-40') }))
  expect(execute).not.toHaveBeenCalled()
  expect(ui.draft.value?.amount).toBe(-40)
  expect(ui.draft.value?.allocations[1]?.amount).toBe(0)
  wrapper.unmount()
})
it('明确重新核对只采用当前余额版本，保留原部分处理金额', async () => {
  const wrapper = mount(Harness)
  await flushPromises()
  ui.change({ ...ui.draft.value!, amount: -40, applications: [{ adjustmentId: 'adjustment', amount: -40, balanceVersion: 'balance-old' }] })
  await ui.load(true)
  expect(load.mock.calls.at(-1)?.[1].draft).toMatchObject({ amount: -40, applications: [{ amount: -40, balanceVersion: 'balance-current' }] })
  expect(ui.draft.value?.applications[0]).toMatchObject({ amount: -40, balanceVersion: 'balance-current' })
  expect(execute).not.toHaveBeenCalled()
  wrapper.unmount()
})
