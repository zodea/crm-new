import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import TargetCostItemTable from '~/components/target-cost/TargetCostItemTable.vue'

const KitTable = defineComponent({
  props: ['data', 'empty'],
  template: `
    <div data-testid="kit-table">
      <span v-if="!data.length">{{ typeof empty === 'string' ? empty : empty.title }}</span>
      <div v-for="row in data" :key="row.id" data-testid="table-row">
        {{ row.itemName || row.category }}
      </div>
    </div>
  `,
})

describe('target cost detail presentation', () => {
  it('keeps item table in its own reusable table surface', () => {
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
  })
})
