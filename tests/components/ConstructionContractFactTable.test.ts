import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConstructionContractFactTable from '~/pages/contract/_components/ConstructionContractFactTable.vue'

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

  it('补充协议聚焦行保留稳定 DOM 锚点、程序化焦点与 canonical 目标', async () => {
    const wrapper = mount(ConstructionContractFactTable, {
      attachTo: document.body,
      props: {
        emptyLabel: '暂无事实',
        focusId: 'supplement-1',
        rows: [{
          id: 'supplement-1',
          no: 'BC-001',
          name: '补充协议一',
          amount: '50.00',
          date: '2026-08-25',
          status: '有效',
          navigation: {
            kind: 'entity-subview',
            subject: { state: 'resolved', entity: 'contract', id: 'contract-1', label: '主合同', no: 'HT-1' },
            variant: 'supplement',
            view: 'supplement-1',
            filters: { dataOrigin: 'real', contractKind: '施工' },
          },
        }],
      },
      global: { stubs: { KitTable: KitTableStub, NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    })

    const target = wrapper.get('#construction-contract-fact-supplement-1')
    await wrapper.vm.$nextTick()
    expect(target.attributes()).toMatchObject({
      tabindex: '-1',
      href: '/contract/contract-1?origin=real&contractKind=construction&tab=supplements&focus=supplement-1',
    })
    expect(target.element).toBe(document.activeElement)
    wrapper.unmount()
  })

  it('验收与保修同 ID 生成各自唯一锚点，并把当前事实写入返回上下文', () => {
    const wrapper = mount(ConstructionContractFactTable, {
      props: {
        emptyLabel: '暂无事实',
        anchorScope: 'warranty',
        returnFocusView: 'warranty',
        returnTo: '/contract/contract-1?origin=real&contractKind=construction&tab=acceptance',
        rows: [{
          id: 'acceptance-324',
          no: 'YS-324',
          name: '项目竣工验收',
          amount: '1000.00',
          date: '2028-07-18',
          status: 'warranty',
          navigation: {
            kind: 'entity-detail',
            subject: { state: 'resolved', entity: 'owner-document', id: 'acceptance-324', label: '项目竣工验收', no: 'YS-324' },
            variant: 'warranty',
            view: null,
            filters: { dataOrigin: 'real' },
          },
        }],
      },
      global: { stubs: { KitTable: KitTableStub, NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    })

    expect(wrapper.get('#construction-contract-fact-warranty-acceptance-324').attributes('href')).toContain(
      `returnTo=${encodeURIComponent('/contract/contract-1?origin=real&contractKind=construction&tab=acceptance&focus=acceptance-324&focusView=warranty#construction-contract-fact-warranty-acceptance-324')}`,
    )
  })
})
