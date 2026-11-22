import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import MaterialContractFactTable from '~/pages/contract/_components/MaterialContractFactTable.vue'

const NuxtLink = defineComponent({
  props: ['to'],
  template: '<a :href="to"><slot/></a>',
})
const KitTable = defineComponent({
  props: ['data', 'empty'],
  template: '<div><div v-for="row in data" :key="row.id"><slot name="name" :row="row" /></div></div>',
})

describe('材料采购合同来源事实表', () => {
  it('目标未消费同一中央来源时保留稳定事实但不生成写态链接', () => {
    render(MaterialContractFactTable, {
      props: {
        emptyLabel: '暂无事实',
        rows: [
          {
            id: 'invoice-1',
            no: 'FP-1',
            name: '已归档发票',
            amount: '100.00',
            date: '2026-08-24',
            status: '已归档',
            navigation: { kind: 'unavailable', reason: 'unverified-target' },
          },
          {
            id: 'settlement-1',
            no: 'JS-1',
            name: '未验证结算目标',
            amount: '80.00',
            date: '2026-08-24',
            status: '已确认',
            navigation: { kind: 'unavailable', reason: 'unverified-target' },
          },
        ],
      },
      global: { components: { NuxtLink }, stubs: { KitTable } },
    })

    expect(screen.queryByRole('link', { name: '已归档发票' })).toBeNull()
    expect(screen.getByText('已归档发票')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '未验证结算目标' })).toBeNull()
  })
})
