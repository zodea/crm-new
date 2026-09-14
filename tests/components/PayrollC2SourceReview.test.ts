import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PayrollC2SourceReview from '~/components/payroll/PayrollC2SourceReview.vue'
import { c2Fact, c2Form } from '../helpers/payroll-c2-ui'

it('待确认与被占用原记录仍显示具体时段、证明及未采用原因；只以服务采用集合标记', () => {
  const read = c2Form()
  read.facts.push(c2Fact({ id: 'pending', status: 'draft', workContent: '原待确认内容', availability: 'pending', witness: null, confirmedOn: null, eligibility: { canEdit: true, canConfirm: true, reasons: ['待人工确认，不计入工资'] } }))
  const view = mount(PayrollC2SourceReview, { props: { read, returnTo: '/subcontract/payroll/wage?origin=real&format=C2' }, global: { stubs: { SectionHeader: true, NuxtLink: { template: '<a><slot /></a>' } } } })
  expect(view.get('[data-daywork-id="pending"]').text()).toContain('未采用')
  expect(view.get('[data-daywork-id="pending"]').text()).toContain('待人工确认，不计入工资')
  expect(view.get('[data-daywork-id="pending"]').text()).toContain('证明人未记录')
  expect(view.get('[data-daywork-id="half"]').text()).toContain('0.5 工')
  expect(view.get('[data-daywork-id="half"]').text()).toContain('已采用')
  expect(view.text()).toContain('已明确保存为空规则')
  expect(view.findAll('input[type="checkbox"]')).toHaveLength(0)
  view.unmount()
})
