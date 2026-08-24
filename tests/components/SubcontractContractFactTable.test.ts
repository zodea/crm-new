import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SubcontractContractFactTable from '~/components/contract/SubcontractContractFactTable.vue'

const KitTableStub = {
  props: ['data', 'empty'],
  template: '<div><template v-if="data.length"><div v-for="row in data" :key="row.id"><slot name="name" :row="row" /></div></template><div v-else>{{ empty.title }}</div></div>',
}

describe('subcontractContractFactTable', () => {
  it('只对已注册目标生成链接，未闭环事实保留文本与真实空态', () => {
    const wrapper = mount(SubcontractContractFactTable, {
      props: {
        emptyLabel: '暂无事实',
        rows: [{
          id: 'payment-1',
          no: 'FK-001',
          name: '付款登记',
          amount: '50.00',
          date: '2026-08-11',
          status: '已确认',
          navigation: { kind: 'unavailable', reason: 'unverified-target' },
        }],
      },
      global: { stubs: { KitTable: KitTableStub, NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('付款登记')

    const empty = mount(SubcontractContractFactTable, { props: { emptyLabel: '暂无事实', rows: [] }, global: { stubs: { KitTable: KitTableStub } } })
    expect(empty.text()).toContain('暂无事实')
  })
})
