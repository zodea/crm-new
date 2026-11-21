import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import PayrollASourceReview from '~/components/payroll/PayrollASourceReview.vue'
import PayrollACreateFromQuantity from '~/pages/subcontract/quantity/_components/PayrollACreateFromQuantity.vue'
import { payrollUiFact, payrollUiForm, payrollUiLine } from '../helpers/payroll-a-ui-fixture'

const Table = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    return () => h('div', props.data.map((row: unknown) => slots.sources?.({ row })))
  },
})
it('没有已证明工资行时仍展示原户位置、损坏说明和原身份，无权入口保持不可用', async () => {
  vi.stubGlobal('useRoute', () => ({ query: {}, fullPath: '/subcontract/payroll/form/wage-a?origin=real' }))
  const read = payrollUiForm()
  read.facts = []
  read.lines = []
  read.blockers = [{ code: 'assignment-scope-incomplete', message: '原责任范围记录不完整', field: null, completionId: 'done-original', assignmentId: 'assignment-original', unitId: 'unit-original', roomId: 'room-original', itemId: 'item-original', workerId: 'worker', statementId: null, locationLabel: '一栋 · 一层 · 101 · 客厅 · 墙砖', sourceUnavailableReason: '当前身份无权打开工程量来源', source: null }]
  const wrapper = mount(PayrollASourceReview, { props: { read, returnTo: '/subcontract/payroll/form/wage-a?origin=real' }, global: { components: { KitTable: Table }, stubs: { SectionHeader: true, KitButton: true, NuxtLink: true } } })
  await flushPromises()
  const gap = wrapper.find('[aria-label="工资来源缺口"]')
  expect(gap.text()).toContain('一栋 · 一层 · 101 · 客厅 · 墙砖')
  expect(gap.text()).toContain('当前身份无权打开工程量来源')
  expect(gap.text()).toContain('原责任范围记录不完整')
  expect(gap.find('nuxt-link-stub').exists()).toBe(false)
  expect(gap.find('details').text()).toContain('unit-original')
  expect(gap.find('details').text()).toContain('done-original')
  wrapper.unmount()
})
it('聚合行两户不同楼层的来源2回到自己的完成记录，分别保留可聚焦锚点', async () => {
  vi.stubGlobal('useRoute', () => ({ query: {}, fullPath: '/subcontract/payroll/form/wage-a?origin=real' }))
  const read = payrollUiForm()
  read.facts = [payrollUiFact('one'), payrollUiFact('two')]
  read.lines = [{ ...payrollUiLine(), facts: read.facts, sources: read.facts.map(fact => ({ kind: 'entity-detail', subject: { state: 'resolved', entity: 'quantity-unit', id: fact.unitId, label: fact.unitName!, no: null }, variant: 'detail', view: null, filters: { projectId: 'project', dataOrigin: 'real', stageId: fact.stageId, itemId: fact.itemId, completionId: fact.completionId } })) }]
  const wrapper = mount(PayrollASourceReview, { props: { read, returnTo: '/subcontract/payroll/form/wage-a?origin=real' }, global: { components: { KitTable: Table, NuxtLink: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) }, stubs: { SectionHeader: true, KitButton: { template: '<button><slot /></button>' } } } })
  await flushPromises()
  const second = wrapper.findAll('a').find(link => link.text() === '查看来源 2')!
  const target = new URL(second.attributes('href'), 'https://test.invalid')
  expect(target.pathname).toBe('/subcontract/quantity/project/unit-two')
  expect(new URL(target.searchParams.get('payrollReturnTo')!, 'https://test.invalid').searchParams.get('focus')).toBe('completion-two')
  expect(wrapper.find('[data-source-focus="completion-two"]').exists()).toBe(true)
  expect(wrapper.find('[data-source-focus="completion-one"]').exists()).toBe(true)
  wrapper.unmount()
})

it('没有旧工资的纯量项目按授权新建候选显示入口，固定draftKey并保来源筛选', async () => {
  const read = payrollUiForm('new')
  const load = vi.fn().mockImplementation(async (_query, input) => ({ ...read, statementId: null, draftKey: input.draftKey }))
  const oldList = vi.fn().mockResolvedValue({ context: read.context, projects: [] })
  vi.stubGlobal('usePayrollStore', () => ({ loadAForm: load, loadRead: oldList }))
  const wrapper = mount(PayrollACreateFromQuantity, { props: { projectId: 'project', origin: 'real', returnTo: '/subcontract/quantity?origin=real&project=project&view=crew&assignee=worker%3Aworker' }, global: { components: { NuxtLink: defineComponent({ props: ['to'], setup: props => () => h('a', { 'data-query': JSON.stringify(props.to.query) }, '新建') }) } } })
  await flushPromises()
  const query = JSON.parse(wrapper.get('a').attributes('data-query'))
  expect(query.draftKey).toBe(load.mock.calls[0]?.[1].draftKey)
  expect(query.returnTo).toContain('assignee=worker%3Aworker')
  expect(oldList).not.toHaveBeenCalled()
  load.mockRejectedValue(new Error('项目读取权限不足'))
  await wrapper.setProps({ projectId: 'another', returnTo: '/subcontract/quantity?origin=real&project=another' })
  await flushPromises()
  expect(wrapper.find('a').exists()).toBe(false)
  wrapper.unmount()
})
