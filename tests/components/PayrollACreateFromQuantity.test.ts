import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import PayrollACreateFromQuantity from '~/components/payroll/PayrollACreateFromQuantity.vue'
import { payrollUiForm } from '../helpers/payroll-a-ui-fixture'

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
