import type { ProjectManagementFeeRead } from '~/lib/project/management-fee'
import type { MetricDTO } from '~/types/read-model'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, reactive } from 'vue'
import { createMemoryHistory, createRouter, RouterLink } from 'vue-router'
import ProjectManagementFees from '~/pages/project/_components/ProjectManagementFees.vue'

const asOf = '2026-10-04T10:00:00.000Z'
function metric(value: string | null, knownValue: string | null, status: MetricDTO['status'], missingSources: string[], participatingCount: number | null, missingCount: number | null): MetricDTO {
  return { value, knownValue, status, missingSources, participatingCount, missingCount, unit: 'CNY', quantityUnit: null, asOf, drilldown: null }
}
const missing = ['合同实际归属未接入', '仓储原费用归属未接入']
const known: ProjectManagementFeeRead = {
  projectId: 'project-actual-fee',
  dataOrigin: 'real',
  actualCost: metric(null, '420.00', 'partial', missing, null, null),
  sources: [
    {
      key: 'management-payroll',
      state: 'complete',
      sourceVersion: 'actual-management-owner-v1',
      asOf,
      reasons: [],
      missingCount: 0,
      actualCost: metric('420.00', '420.00', 'complete', [], 2, 0),
      rows: [
        { identity: 'original-release', ref: { kind: 'released-statement', statementId: 'frozen-wage' }, originalStatementIds: ['frozen-wage'], managementBookId: 'frozen-management-book', amount: '500.00', knownValue: '500.00', occurredOn: '2026-10-01', sourceVersion: 'release-v1' },
        { identity: 'original-refund', ref: { kind: 'actual-event', eventId: 'refund-event' }, originalStatementIds: ['frozen-wage'], managementBookId: 'frozen-management-book', amount: '-80.00', knownValue: '-80.00', occurredOn: '2026-10-02', sourceVersion: 'refund-v1' },
      ],
    },
    { key: 'contract-management', state: 'unavailable', sourceVersion: null, asOf: null, reasons: [missing[0]!], missingCount: null, rows: [], actualCost: metric(null, null, 'pending', [missing[0]!], null, null) },
    { key: 'other-management', state: 'unavailable', sourceVersion: null, asOf: null, reasons: [missing[1]!], missingCount: null, rows: [], actualCost: metric(null, null, 'pending', [missing[1]!], null, null) },
  ],
}

afterEach(() => vi.unstubAllGlobals())

it('管理费实际组件五档视口保留未知及原净额，键盘可展开原单，撤权不留旧金额或链接', async () => {
  const state = reactive({ fees: structuredClone(known) })
  const retry = vi.fn()
  const returnTo = '/project/project-actual-fee?origin=real'
  const placeholder = defineComponent({ setup: () => () => h('div') })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: placeholder }, { path: '/subcontract/payroll/:id', component: placeholder }, { path: '/subcontract/payroll/payments/:id', component: placeholder }] })
  await router.push('/')
  await router.isReady()
  await render(defineComponent({ setup: () => () => h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, h(ProjectManagementFees, { fees: state.fees, returnTo, onRetry: retry })) }), {
    global: { plugins: [router], components: { NuxtLink: RouterLink } },
  })
  const section = page.getByRole('region', { name: '管理费实际成本', exact: true })
  await expect.element(section.getByLabelText('管理费合计')).toHaveTextContent(/总额未知\s*已核实小计 ¥420\.00/)
  const source = section.getByRole('region', { name: '管理人员：独立管理簿', exact: true })
  await expect.element(source).toHaveTextContent('已核实来源')
  const summary = source.getByText('查看原实际记录（2）', { exact: true })
  await summary.element().focus()
  await expect.element(summary).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(source.element().querySelector('details')?.open).toBe(true)
  await expect.element(source).toHaveTextContent('¥500.00')
  await expect.element(source).toHaveTextContent('¥-80.00')
  const release = source.getByRole('link', { name: '原工资发放', exact: true })
  await expect.element(release).toHaveAttribute('href', expect.stringContaining('frozen-wage'))
  await expect.element(release).toHaveAttribute('href', expect.stringContaining('returnTo'))
  await expect.element(source.getByRole('link', { name: '原补退或冲销记录', exact: true })).toHaveAttribute('href', expect.stringContaining('refund-event'))
  const reload = section.getByRole('button', { name: '重新读取管理费', exact: true })
  await reload.element().focus()
  await userEvent.keyboard('{Enter}')
  expect(retry).toHaveBeenCalledTimes(1)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)

  state.fees = {
    ...structuredClone(known),
    actualCost: metric(null, null, 'pending', [...missing, '权限撤回'], null, null),
    sources: [{ key: 'management-payroll', state: 'forbidden', sourceVersion: null, asOf: null, reasons: ['权限撤回'], missingCount: null, rows: [], actualCost: metric(null, null, 'pending', ['权限撤回'], null, null) }, ...structuredClone(known.sources.slice(1))],
  }
  await expect.element(source).toHaveTextContent('无查看权限')
  await expect.element(section).not.toHaveTextContent('¥420.00')
  await expect.element(section).not.toHaveTextContent('¥0.00')
  expect(section.element().querySelector('a')).toBeNull()

  state.fees = {
    ...structuredClone(known),
    actualCost: metric(null, '0.00', 'partial', missing, null, null),
    sources: [{ key: 'management-payroll', state: 'complete', sourceVersion: 'actual-empty-owner-v2', asOf, reasons: [], missingCount: 0, rows: [], actualCost: metric('0.00', '0.00', 'complete', [], 0, 0) }, ...structuredClone(known.sources.slice(1))],
  }
  await expect.element(source).toHaveTextContent('¥0.00')
  await expect.element(source).toHaveTextContent('当前无有效管理簿实际记录')
  await expect.element(section.getByLabelText('管理费合计')).toHaveTextContent('总额未知')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})
