import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import ProjectSubTableSection from '~/components/project/ProjectSubTableSection.vue'

const KitTable = defineComponent({
  props: {
    data: { type: Array, required: true },
    page: { type: Object, required: true },
  },
  emits: ['filterChange', 'pageChange'],
  template: `
    <div>
      <span data-testid="page-total">{{ page.total }}</span>
      <span v-for="row in data" :key="row.id" data-testid="visible-row">{{ row.name }}</span>
      <button
        type="button"
        data-testid="filter-active"
        @click="$emit('filterChange', {
          field: 'status',
          values: ['履约中'],
          filters: [{ field: 'status', values: ['履约中'] }],
        })"
      >
        只看履约中
      </button>
    </div>
  `,
})

const rows = [
  { id: '1', name: '泥水劳务合同', status: '履约中', amount: 1200 },
  { id: '2', name: '瓷砖采购合同', status: '已结清', amount: 800 },
  { id: '3', name: '防水专业合同', status: '履约中', amount: 500 },
]

function mountSection() {
  return mount(ProjectSubTableSection, {
    props: {
      title: '支出合同',
      columns: [
        { field: 'name', title: '合同名称' },
        { field: 'status', title: '状态', filterable: true },
        { field: 'amount', title: '金额', type: 'money' },
      ],
      rows,
      summaryFields: [{ field: 'amount', label: '合同金额合计' }],
    },
    global: { components: { KitTable } },
  })
}

describe('project subtable section read-only contract', () => {
  it('searches visible fields and recalculates count and money summary', async () => {
    const wrapper = mountSection()

    expect(wrapper.get('[data-testid="page-total"]').text()).toBe('3')
    expect(wrapper.text()).toContain('合同金额合计')
    expect(wrapper.text()).toContain('¥2,500.00')

    await wrapper.get('input[type="search"]').setValue('瓷砖')

    expect(wrapper.get('[data-testid="page-total"]').text()).toBe('1')
    expect(wrapper.findAll('[data-testid="visible-row"]').map(row => row.text())).toEqual([
      '瓷砖采购合同',
    ])
    expect(wrapper.text()).toContain('¥800.00')
    expect(wrapper.text()).toContain('原 3 条')
  })

  it('applies full-data column filters before controlled pagination and summary', async () => {
    const wrapper = mountSection()

    await wrapper.get('[data-testid="filter-active"]').trigger('click')

    expect(wrapper.get('[data-testid="page-total"]').text()).toBe('2')
    expect(wrapper.findAll('[data-testid="visible-row"]').map(row => row.text())).toEqual([
      '泥水劳务合同',
      '防水专业合同',
    ])
    expect(wrapper.text()).toContain('¥1,700.00')
  })
})
