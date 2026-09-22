import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import CentralPayrollDetailScreen from '~/components/payroll/CentralPayrollDetailScreen.vue'
import PayrollEvidenceTable from '~/components/payroll/PayrollEvidenceTable.vue'
import { payrollDetailFixture } from '../helpers/payroll-central-read-fixture'

afterEach(() => vi.unstubAllGlobals())
it('c1 详情及保存的明细保留60.125原时薪，金额仍到分，未知价不补零', async () => {
  const read = payrollDetailFixture()
  read.statement.formatFamily = 'C1'
  const line = { ...read.statement.lines[0]!, itemName: '正常工时', unit: '小时', quantity: 8, unitPrice: 60.125, amount: 481 }
  read.statement.lines = [line, { ...line, id: 'missing-price', unitPrice: null, amount: null }]
  read.statement.stored.lines = [line]
  vi.stubGlobal('useRoute', () => ({ fullPath: '/subcontract/payroll/wage-a?origin=real', params: { id: 'wage-a' }, query: { origin: 'real' } }))
  vi.stubGlobal('usePayrollStatementDetailStore', () => ({ loadRead: async () => read }))
  vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: false }))
  vi.stubGlobal('useTabTitle', vi.fn())
  const view = mount(CentralPayrollDetailScreen, { global: { components: { PayrollEvidenceTable }, stubs: {
    PayrollC1StatementWorkspace: true,
    PayrollAStatementWorkspace: true,
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
    expect(table.text()).toContain('60.125')
    expect(table.text()).not.toContain('60.13')
    expect(table.text()).toContain('¥481.00')
  }
  const unknown = view.get('[aria-label="工资明细"] table').findAll('tr')[1]!
  expect(unknown.text()).toContain('未记录')
  expect(unknown.text()).not.toContain('¥0.00')
  view.unmount()
})
