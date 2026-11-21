import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import CentralPayrollDetailScreen from '~/components/payroll/CentralPayrollDetailScreen.vue'
import { payrollDetailFixture } from '../helpers/payroll-central-read-fixture'

afterEach(() => vi.unstubAllGlobals())
it.each([
  { family: 'C1', priceLabel: '时薪', line: { itemName: '正常工时', unit: '小时', unitPrice: 60.125 }, rounded: '60.13' },
  { family: 'C2', priceLabel: '工价', line: { itemName: '零星签工', unit: '工', unitPrice: 350.125 }, rounded: '350.13' },
] as const)('$family 详情及保存的明细保留 $line.unitPrice 原$priceLabel，金额仍到分，未知价不补零', async ({ family, line: priced, rounded }) => {
  const read = payrollDetailFixture()
  read.statement.formatFamily = family
  const line = { ...read.statement.lines[0]!, ...priced, quantity: 8, amount: 481 }
  read.statement.lines = [line, { ...line, id: 'missing-price', unitPrice: null, amount: null }]
  read.statement.stored.lines = [line]
  vi.stubGlobal('useRoute', () => ({ fullPath: '/subcontract/payroll/wage-a?origin=real', params: { id: 'wage-a' }, query: { origin: 'real' } }))
  vi.stubGlobal('usePayrollStatementDetailStore', () => ({ loadRead: async () => read }))
  vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
  vi.stubGlobal('useTabTitle', vi.fn())
  const view = mount(CentralPayrollDetailScreen, { global: { stubs: {
    PayrollC1StatementWorkspace: true,
    PayrollC2StatementWorkspace: true,
    PayrollAStatementWorkspace: true,
    PayrollAdjustmentHistorySection: true,
    PayrollActualLedgerSection: true,
    PayrollReadNotice: true,
    PayrollReadDiagnostics: true,
    PayrollSnapshotEvidence: true,
    PayrollReadHistory: true,
    PayrollSourceEvidence: true,
    SectionHeader: true,
    KitStatusTag: true,
    NuxtLink: { template: '<a><slot /></a>' },
    KitButton: { template: '<button><slot /></button>' },
    KitTable: { props: ['columns', 'data'], template: '<table><tbody><tr v-for="row in data"><td v-for="column in columns">{{ row[column.field] }}</td></tr></tbody></table>' },
  } } })
  await flushPromises()
  for (const label of ['工资明细', '保存的明细历史']) {
    const table = view.get(`[aria-label="${label}"] table`)
    expect(table.text()).toContain(String(priced.unitPrice))
    expect(table.text()).not.toContain(rounded)
    expect(table.text()).toContain('¥481.00')
  }
  const unknown = view.get('[aria-label="工资明细"] table').findAll('tr')[1]!
  expect(unknown.text()).toContain('未记录')
  expect(unknown.text()).not.toContain('¥0.00')
  view.unmount()
})
