import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConstructionContractFactTable from '~/components/contract/ConstructionContractFactTable.vue'

const KitTableStub = {
  props: ['data', 'empty'],
  template: '<div><template v-if="data.length"><div v-for="row in data" :key="row.id"><slot name="name" :row="row" /></div></template><div v-else data-ui="kit-table-empty">{{ empty.title }}</div></div>',
}

describe('constructionContractFactTable', () => {
  it('中央只读目标未闭合时只展示事实文本，并保留 KitTable 空态', () => {
    const wrapper = mount(ConstructionContractFactTable, {
      props: {
        emptyLabel: '暂无事实',
        rows: [{
          id: 'change-1',
          no: 'BG-001',
          name: '已审定变更',
          amount: '50.00',
          date: '2026-08-11',
          status: 'approved',
          navigation: {
            kind: 'entity-detail',
            subject: { state: 'resolved', entity: 'owner-document', id: 'owner-change-1', label: '已审定变更', no: 'BG-001' },
            variant: 'detail',
            view: null,
            filters: { dataOrigin: 'real', documentKind: 'change' },
          },
        }],
      },
      global: { stubs: { KitTable: KitTableStub, NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('已审定变更')

    const empty = mount(ConstructionContractFactTable, { props: { emptyLabel: '暂无事实', rows: [] }, global: { stubs: { KitTable: KitTableStub } } })
    expect(empty.text()).toContain('暂无事实')
  })
})
