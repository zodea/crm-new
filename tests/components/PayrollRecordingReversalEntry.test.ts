import type { PayrollActualFact, PayrollActualPaymentDetailRead } from '~/lib/payroll/central-actual-contract'
import { render, screen } from '@testing-library/vue'
import { beforeEach, expect, it, vi } from 'vitest'
import PayrollActualFactsTable from '~/components/payroll/PayrollActualFactsTable.vue'
import PayrollActualPaymentDetailScreen from '~/components/payroll/PayrollActualPaymentDetailScreen.vue'
import { knownPayrollSigned, payrollAdjustmentFormRead, payrollAdjustmentOriginal } from '../helpers/payroll-adjustment-ui-fixture'

const source = '/subcontract/payroll/payments/reversal-record?origin=real'
function fact(): PayrollActualFact {
  return { identity: 'event:reversal-record', ref: { kind: 'actual-event', eventId: 'reversal-record' }, kind: 'recording-reversal', projectId: 'project', originalStatementIds: ['wage-original'], adjustmentIds: [], applicationIds: [], reverses: { kind: 'released-statement', statementId: 'wage-original' }, occurredOn: '2026-09-10', recordedAt: '2026-09-10T00:00:00Z', signedAmount: knownPayrollSigned(-1000), allocations: [{ workerId: 'worker', workerName: '原负责人', crewId: 'crew', amount: -1000, proofRefs: [] }], allocationState: 'complete', historicalMembers: [], qualification: 'proven', sourceVersion: 'reversal-proof', diagnostics: [] }
}
function read(): PayrollActualPaymentDetailRead {
  const originalFact = { ...fact(), identity: 'released:wage-original', ref: { kind: 'released-statement' as const, statementId: 'wage-original' }, kind: 'initial-release' as const, reverses: null, signedAmount: knownPayrollSigned(1000) }
  return { context: payrollAdjustmentFormRead().context, fact: fact(), snapshot: { schemaVersion: 1, kind: 'recording-reversal', id: 'reversal-record', commandId: 'reversal-command', projectId: 'project', originalFact, originals: [payrollAdjustmentOriginal()], draft: { confirmedNotOccurred: true, confirmedOn: '2026-09-10', evidenceNote: '原具名核查依据' }, applications: [], applicationIds: [], confirmedBy: '经办人', confirmedAt: '2026-09-10T00:00:00Z' } }
}
const stubs = { NuxtLink: { props: ['to'], template: '<a :href="typeof to === \'string\' ? to : to.path + \'?\' + new URLSearchParams(to.query)"><slot /></a>', data: () => ({ URLSearchParams }) }, SectionHeader: true, KitButton: { template: '<button><slot /></button>' }, PayrollOriginalWageSummary: true, PayrollConfirmationOutput: true }
beforeEach(() => {
  vi.stubGlobal('useRoute', () => ({ params: { id: 'reversal-record' }, query: { origin: 'real' }, fullPath: source }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('usePayrollAdjustmentsStore', () => ({ loadActualPaymentDetail: vi.fn().mockResolvedValue(read()) }))
})
it('实际台账可以引用错误冲销追加纠错，保持原引用和来源返回', async () => {
  render(PayrollActualFactsTable, { props: { rows: [fact()], origin: 'real', returnTo: source, writable: true }, global: { stubs } })
  const link = screen.getByRole('link', { name: '纠正这次错记冲销' })
  const url = new URL(link.getAttribute('href')!, 'https://crm.invalid')
  expect(url.pathname).toBe('/subcontract/payroll/payments/reversal/new')
  expect(url.searchParams.get('eventId')).toBe('reversal-record')
  expect(url.searchParams.get('returnTo')).toBe(source)
  expect(screen.getByText('不是工人实际退款')).toBeTruthy()
})
it('冲销详情也提供独立纠错入口，并可回读此次冲销引用的记录', async () => {
  render(PayrollActualPaymentDetailScreen, { global: { stubs, components: { PayrollActualFactsTable } } })
  const link = await screen.findByRole('link', { name: '纠正这次错记冲销' })
  expect(new URL(link.getAttribute('href')!, 'https://crm.invalid').searchParams.get('eventId')).toBe('reversal-record')
  expect(screen.getByRole('link', { name: '查看本次冲销引用的原记录' }).getAttribute('href')).toContain('/subcontract/payroll/wage-original?')
})
