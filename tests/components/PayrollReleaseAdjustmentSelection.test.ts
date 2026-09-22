import type { PayrollReleaseAdjustmentApplication, PayrollReleaseAdjustmentPreview } from '~/lib/payroll/central-release-adjustment-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import PayrollReleaseAdjustmentSelection from '~/components/payroll/PayrollReleaseAdjustmentSelection.vue'
import { payrollAdjustmentFormRead } from '../helpers/payroll-adjustment-ui-fixture'

const load = vi.fn()
function preview(version = 'balance-1', embedded = -100): PayrollReleaseAdjustmentPreview {
  return { context: payrollAdjustmentFormRead().context, statementId: 'later-wage', candidates: [{ adjustmentId: 'adjustment', rootAdjustmentId: 'adjustment', originalStatementId: 'wage-original', originalMonth: '2026-08', remainingAmount: -100, embeddedInCalculation: embedded, additionalWithholding: embedded === -100 ? 0 : 100, balanceVersion: version, coverageVersion: `coverage-${version}`, eligible: true, reasons: [] }], reasons: [] }
}
beforeEach(() => {
  vi.clearAllMocks()
  load.mockResolvedValue(preview())
  vi.stubGlobal('usePayrollAdjustmentsStore', () => ({ loadReleaseAdjustments: load }))
})
it('后续工资核算变化重读候选，保留处理金额直到明确采用新依据', async () => {
  const applications = ref<PayrollReleaseAdjustmentApplication[]>([])
  const valid = vi.fn()
  const sourceVersion = ref('wage-source-1')
  render(defineComponent({ setup: () => () => h(PayrollReleaseAdjustmentSelection, { statementId: 'later-wage', origin: 'real', sourceVersion: sourceVersion.value, applications: applications.value, disabled: false, returnTo: '/subcontract/payroll/later-wage?origin=real', onChange: value => applications.value = value, onValid: valid }) }), { global: { stubs: { SectionHeader: true, NuxtLink: { template: '<a><slot /></a>' }, KitButton: { template: '<button><slot /></button>' } } } })
  await fireEvent.update(await screen.findByRole('spinbutton', { name: '2026-08更正本次处理差额' }), '-40')
  expect(applications.value).toEqual([{ adjustmentId: 'adjustment', amount: -40, balanceVersion: 'balance-1', coverageVersion: 'coverage-balance-1' }])
  expect(valid).toHaveBeenLastCalledWith(true)
  load.mockResolvedValueOnce(preview('balance-2', 0))
  sourceVersion.value = 'wage-source-2'
  await flushPromises()
  expect(valid).toHaveBeenLastCalledWith(false)
  expect(applications.value[0]?.amount).toBe(-40)
  expect(applications.value[0]?.balanceVersion).toBe('balance-1')
  await fireEvent.click(screen.getByRole('button', { name: '保留金额并采用当前处理依据' }))
  expect(applications.value).toEqual([{ adjustmentId: 'adjustment', amount: -40, balanceVersion: 'balance-2', coverageVersion: 'coverage-balance-2' }])
  expect(valid).toHaveBeenLastCalledWith(true)
})
it('撤销工资写权限后，即使没有关联处理也不能打开真实发放', async () => {
  const current = preview()
  current.candidates = []
  current.context.capabilities = ['payroll:read']
  load.mockResolvedValue(current)
  const valid = vi.fn()
  render(PayrollReleaseAdjustmentSelection, { props: { statementId: 'later-wage', origin: 'real', sourceVersion: 'source-1', applications: [], disabled: false, returnTo: '/subcontract/payroll', onValid: valid }, global: { stubs: { SectionHeader: true, NuxtLink: true, KitButton: { template: '<button><slot /></button>' } } } })
  await flushPromises()
  expect(valid).toHaveBeenLastCalledWith(false)
})
