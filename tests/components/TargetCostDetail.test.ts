import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import TargetCostComparisonTable from '~/components/target-cost/TargetCostComparisonTable.vue'
import TargetCostDetailSummary from '~/components/target-cost/TargetCostDetailSummary.vue'
import TargetCostItemTable from '~/components/target-cost/TargetCostItemTable.vue'

const MetricGrid = defineComponent({
  template: '<div data-testid="metric-grid"><slot /></div>',
})
const Metric = defineComponent({
  props: ['label', 'value', 'status', 'missingSources'],
  template: '<span data-testid="metric">{{ label }}：{{ value }}<span>{{ status }} {{ missingSources }}</span></span>',
})
const KitTable = defineComponent({
  props: ['data', 'empty'],
  template: `
    <div data-testid="kit-table">
      <span v-if="!data.length">{{ typeof empty === 'string' ? empty : empty.title }}</span>
      <div v-for="row in data" :key="row.id" data-testid="table-row">
        <slot name="source" :row="row" />
        <slot name="cost-settledAmount" :row="row" />
        <slot name="cost-paidAmount" :row="row" />
        {{ row.itemName || row.category }}
      </div>
    </div>
  `,
})
const NuxtLink = defineComponent({
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
})

const header = {
  id: 'target-1',
  projectId: 'project-1',
  projectCode: 'P-01',
  projectName: '测试项目',
  name: '开工基线',
  isBaseline: true,
  contractRevenue: 5000,
  plannedProfit: 1000,
  signedContractSum: 200,
  taxInclusiveTotal: 4000,
  taxExclusiveTotal: 3600,
  taxAmount: 400,
  status: 'submitted',
  note: '',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
}
const complete = (value: number) => ({ value, knownValue: value, status: 'complete' as const, missingSources: [] })

describe('target cost detail presentation', () => {
  it('shows selected-version and actual totals as distinct metrics', () => {
    const wrapper = mount(TargetCostDetailSummary, {
      props: {
        header,
        summary: {
          itemTotal: 1300,
          signedAmount: 200,
          settledAmount: 120,
          paidAmount: 70,
          remainingAmount: 1180,
          metrics: { targetAmount: complete(1300), signedAmount: complete(200), settledAmount: complete(120), paidAmount: complete(70), remainingAmount: complete(1180) },
        },
      },
      global: { components: { MetricGrid, Metric } },
    })

    expect(wrapper.text()).toContain('科目明细合计：¥1,300.00')
    expect(wrapper.text()).toContain('含税预算基准：¥4,000.00')
    expect(wrapper.text()).toContain('动态成本：¥120.00')
    expect(wrapper.text()).toContain('累计支付：¥70.00')
  })

  it('keeps item and comparison tables in their own reusable table surfaces', () => {
    const item = {
      id: 'item-1',
      category: '材料' as const,
      itemName: 'BV 电线',
      unit: 'm',
      qty: 100,
      unitPrice: 2.5,
      amount: 250,
      note: '',
      sortOrder: 10,
    }
    const itemTable = mount(TargetCostItemTable, {
      props: { items: [item] },
      global: { components: { KitTable } },
    })
    expect(itemTable.get('[data-testid="kit-table"]').text()).toContain('BV 电线')
    expect(itemTable.text()).toContain('当前版本共 1 行')

    const comparison = mount(TargetCostComparisonTable, {
      props: {
        categories: [{
          id: 'category-wage',
          category: '工人工资',
          targetAmount: 300,
          signedAmount: 0,
          settledAmount: 70,
          paidAmount: 70,
          remainingAmount: 230,
          metrics: { targetAmount: complete(300), signedAmount: complete(0), settledAmount: complete(70), paidAmount: complete(70), remainingAmount: complete(230) },
          targetLineCount: 1,
          contractCount: 0,
          settlementCount: 0,
          paymentCount: 1,
          reimbursementCount: 0,
          contractPath: '/contract/other-expense',
          settlementPath: '/subcontract/payroll',
          paymentPath: '/subcontract/payroll',
          reimbursementPath: '/finance/reimbursement',
        }],
      },
      global: { components: { KitTable, NuxtLink } },
    })
    const payrollLink = comparison.get('a')
    expect(payrollLink.attributes('href')).toBe('/subcontract/payroll')
    expect(payrollLink.text()).toContain('工资单 1')
  })

  it('shows proven subtotals with source gaps and never formats unknown wages or budget remaining as zero', () => {
    const pending = { value: null, knownValue: null, status: 'pending' as const, missingSources: ['P4实际工资源:unavailable'] }
    const partial = { value: null, knownValue: 120, status: 'partial' as const, missingSources: ['P4实际工资源:unavailable'] }
    const wrapper = mount(TargetCostDetailSummary, {
      props: { header, summary: { itemTotal: 1300, signedAmount: 200, settledAmount: null, paidAmount: null, remainingAmount: null, metrics: { targetAmount: complete(1300), signedAmount: complete(200), settledAmount: partial, paidAmount: pending, remainingAmount: pending } } },
      global: { components: { MetricGrid, Metric } },
    })
    expect(wrapper.text()).toContain('动态成本：已知 ¥120.00部分已知')
    expect(wrapper.text()).toContain('累计支付：未知来源未齐')
    expect(wrapper.text()).toContain('预算剩余：未知来源未齐')
    expect(wrapper.text()).toContain('P4实际工资源:unavailable')
    expect(wrapper.text()).not.toContain('¥0.00')
  })
})
