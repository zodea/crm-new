import type { PayrollAdjustmentDetailRead } from '~/lib/payroll/central-adjustment-contract'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import PayrollAdjustmentBasisFields from '~/components/payroll/PayrollAdjustmentBasisFields.vue'
import PayrollAdjustmentDetailScreen from '~/pages/subcontract/payroll/adjustments/_components/PayrollAdjustmentDetailScreen.vue'
import { knownPayrollSigned, payrollAdjustmentFormRead } from '../helpers/payroll-adjustment-ui-fixture'

it('续更正本次加40与原链累计减60独立展示，并可回读前序和新旧依据', async () => {
  const form = payrollAdjustmentFormRead()
  const basis = form.draft.basis!
  if (basis.formatFamily !== 'C2')
    throw new Error('测试须使用 C2 冻结依据')
  const snapshot = { schemaVersion: 1 as const, id: 'correction', rootAdjustmentId: 'root', correctsAdjustmentId: 'root', original: form.original, reason: '原核减多计40，具名复核', evidenceNote: '复核原签工证明', preview: { ...form.preview, before: { ...basis, unitRate: 900 }, after: { ...basis, unitRate: 940 }, beforeAmount: knownPayrollSigned(900), afterAmount: knownPayrollSigned(940), delta: knownPayrollSigned(40) }, confirmedBy: '原确认经办人', confirmedAt: '2026-09-12T09:00:00Z', commandId: 'confirmed-correction' }
  const read: PayrollAdjustmentDetailRead = { context: form.context, original: form.original, adjustment: { id: 'correction', rootAdjustmentId: 'root', originalStatementId: 'wage-original', projectId: 'project', status: 'confirmed', draft: { ...form.draft, reason: snapshot.reason, evidenceNote: snapshot.evidenceNote, correctsAdjustmentId: 'root', basis: snapshot.preview.after }, delta: 40, snapshot }, balance: { adjustmentId: 'correction', rootAdjustmentId: 'root', confirmedDelta: knownPayrollSigned(-60), appliedDelta: knownPayrollSigned(0), remainingDelta: knownPayrollSigned(-60), balanceVersion: 'current-balance', applicationIds: [] }, applications: [] }
  const fullPath = '/subcontract/payroll/adjustments/correction?origin=real'
  vi.stubGlobal('useRoute', () => ({ params: { id: 'correction' }, query: { origin: 'real' }, fullPath }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('usePayrollAdjustmentsStore', () => ({ loadAdjustmentDetail: vi.fn().mockResolvedValue(read) }))
  render(PayrollAdjustmentDetailScreen, { global: { components: { PayrollAdjustmentBasisFields }, stubs: { NuxtLink: { props: ['to'], template: '<a :href="typeof to === \'string\' ? to : to.path + \'?\' + new URLSearchParams(to.query)"><slot /></a>', data: () => ({ URLSearchParams }) }, SectionHeader: { props: ['title'], template: '<h2>{{ title }}</h2>' }, KitButton: { template: '<button><slot /></button>' }, PayrollOriginalWageSummary: true, PayrollAdjustmentApplications: true, PayrollConfirmationOutput: true } } })
  const confirmed = await screen.findByRole('region', { name: '本次更正确认' })
  expect(within(confirmed).getByText('本次确认差额').parentElement?.textContent).toContain('¥40.00')
  expect(within(confirmed).getByText('本次更正前核算').parentElement?.textContent).toContain('¥900.00')
  expect(within(confirmed).getByText('本次更正后核算').parentElement?.textContent).toContain('¥940.00')
  expect(within(confirmed).getByText('原确认经办人')).toBeTruthy()
  const previous = new URL(within(confirmed).getByRole('link', { name: '查看本次纠正的前序更正' }).getAttribute('href')!, 'https://crm.invalid')
  expect(previous.pathname).toBe('/subcontract/payroll/adjustments/root')
  expect(previous.searchParams.get('returnTo')).toBe(fullPath)
  expect(within(screen.getByRole('region', { name: '原更正链当前余额' })).getByText('当前已确认差额').parentElement?.textContent).toContain('¥-60.00')
  await fireEvent.click(within(confirmed).getByText('查看本次更正前依据'))
  await fireEvent.click(within(confirmed).getByText('查看本次采用依据'))
  expect(within(confirmed).getAllByLabelText('更正主体单价（元 / 工）').map(input => (input as HTMLInputElement).value)).toEqual(['900', '940'])
  expect(within(confirmed).getAllByLabelText('更正主体单价（元 / 工）').every(input => (input as HTMLInputElement).disabled)).toBe(true)
})
