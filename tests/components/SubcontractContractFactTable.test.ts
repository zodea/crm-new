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

  it('补充协议聚焦行使用稳定 DOM 锚点并指向分包变洽签页签', async () => {
    const wrapper = mount(SubcontractContractFactTable, {
      attachTo: document.body,
      props: {
        emptyLabel: '暂无事实',
        focusId: 'supplement-1',
        rows: [{
          id: 'supplement-1',
          no: 'FB-BC-001',
          name: '劳务补充协议',
          amount: '50.00',
          date: '2026-08-25',
          status: '生效',
          navigation: {
            kind: 'entity-subview',
            subject: { state: 'resolved', entity: 'contract', id: 'contract-1', label: '主合同', no: 'HT-1' },
            variant: 'supplement',
            view: 'supplement-1',
            filters: { dataOrigin: 'real', contractKind: '分包' },
          },
        }],
      },
      global: { stubs: { KitTable: KitTableStub, NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    })

    const target = wrapper.get('#subcontract-contract-fact-supplement-1')
    await wrapper.vm.$nextTick()
    expect(target.attributes()).toMatchObject({
      tabindex: '-1',
      href: '/contract/contract-1?origin=real&contractKind=subcontract&tab=changes&focus=supplement-1',
    })
    expect(target.element).toBe(document.activeElement)
    wrapper.unmount()
  })
})
