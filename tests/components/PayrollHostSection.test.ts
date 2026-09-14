import type { PayrollActualFact } from '~/lib/payroll/central-actual-contract'
import { fireEvent, render, screen } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import PayrollHostSection from '~/components/crew-worker/PayrollHostSection.vue'
import { buildPayrollHostSection, unavailablePayrollHostSection } from '~/lib/crew-worker/payroll-read'
import { payrollAAmount } from '~/lib/payroll/central-a-calculation'

const fact: PayrollActualFact = {
  identity: 'real:payroll:released:original-payroll',
  ref: { kind: 'released-statement', statementId: 'original-payroll' },
  kind: 'initial-release',
  projectId: 'project-1',
  originalStatementIds: ['original-payroll'],
  adjustmentIds: [],
  applicationIds: [],
  reverses: null,
  occurredOn: '2026-08-01',
  recordedAt: '2026-08-01T00:00:00.000Z',
  signedAmount: payrollAAmount([1000]),
  allocationState: 'complete',
  sourceVersion: 'frozen-1',
  qualification: 'proven',
  diagnostics: [],
  historicalMembers: [{ workerId: 'worker-1', crewId: 'crew-1', name: '原姓名' }, { workerId: 'worker-2', crewId: 'crew-1', name: '另一成员' }],
  allocations: [{ workerId: 'worker-1', workerName: '原姓名', crewId: 'crew-1', amount: 0, proofRefs: [{ kind: 'frozen-source', id: 'original-payroll', sourceFingerprint: 'frozen-1' }] }, { workerId: 'worker-2', workerName: '另一成员', crewId: 'crew-1', amount: 1000, proofRefs: [{ kind: 'frozen-source', id: 'original-payroll', sourceFingerprint: 'frozen-1' }] }],
}
const globals = { components: { NuxtLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: `${props.to.path}?${new URLSearchParams(props.to.query)}` }, slots.default?.()) }), SectionHeader: defineComponent({ props: ['title', 'subtitle'], template: '<header><h2>{{ title }}</h2><p>{{ subtitle }}</p></header>' }) } }

it('个人0与整单1000分列，来源链接保原档案查询，表可获得键盘焦点', () => {
  const section = buildPayrollHostSection({ kind: 'worker', id: 'worker-1' }, { rows: [fact], netAmount: fact.signedAmount, sourceVersion: 'v1', status: 'complete', diagnostics: [] })
  render(PayrollHostSection, { props: { section, returnTo: '/base/worker/worker-1?origin=real&returnTo=%2Fbase%2Fworker%3Fsearch%3D%E5%BC%A0' }, global: globals })
  expect(screen.getByTestId('payroll-host-net').textContent).toContain('0.00')
  expect(screen.getByText('整笔实际额（参考）')).toBeTruthy()
  expect(screen.getByText('原姓名')).toBeTruthy()
  expect(screen.queryByText('另一成员')).toBeNull()
  const href = screen.getByRole('link', { name: '原工资与签名' }).getAttribute('href')!
  expect(href).toContain('/subcontract/payroll/original-payroll?')
  expect(new URL(href, 'https://crm.invalid').searchParams.get('returnTo')).toContain('/base/worker/worker-1?origin=real')
  screen.getByRole('region', { name: '工资实际收付明细，可横向滚动' }).focus()
  expect(document.activeElement?.getAttribute('role')).toBe('region')
})

it('分配未知不能显示个人实收1000，读源失败提供重读，缺权不展示来源金额姓名', async () => {
  const missing = { ...fact, allocations: [], allocationState: 'unknown' as const, qualification: 'historical-amount-proven' as const }
  const section = buildPayrollHostSection({ kind: 'worker', id: 'worker-1' }, { rows: [missing], netAmount: fact.signedAmount, sourceVersion: 'v1', status: 'partial', diagnostics: [] })
  const retry = vi.fn()
  const view = render(PayrollHostSection, { props: { section, returnTo: '/base/worker/worker-1?origin=real', onRetry: retry }, global: globals })
  expect(screen.getByTestId('payroll-host-net').textContent).toBe('尚不能确认')
  await view.rerender({ section: unavailablePayrollHostSection(section.scope, 'unavailable', '读取失败') })
  await fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
  expect(retry).toHaveBeenCalledOnce()
  await view.rerender({ section: unavailablePayrollHostSection(section.scope, 'forbidden', '无权') })
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.queryByText('原姓名')).toBeNull()
  expect(screen.queryByTestId('payroll-host-net')).toBeNull()
})
