import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PayrollAFloorReview from '~/components/payroll/PayrollAFloorReview.vue'
import { payrollUiFact } from '../helpers/payroll-a-ui-fixture'

it('楼层轴只取本簿截至本月真实完成，格内区分往月、本月和未涉及', () => {
  const first = { ...payrollUiFact('one'), completedAt: '2026-08-12' }
  const sameFloorThisMonth = { ...first, completionId: 'done-new', completedAt: '2026-09-02' }
  const secondItem = { ...payrollUiFact('two'), itemId: 'floor-item', itemName: '地砖', completedAt: '2026-09-10' }
  const future = { ...payrollUiFact('future'), completedAt: '2026-10-01' }
  const wrapper = mount(PayrollAFloorReview, { props: { facts: [first, sameFloorThisMonth, secondItem, future], month: '2026-09', selectedItemId: 'floor-item', returnTo: '/subcontract/payroll/form/wage?origin=real' } })
  expect(wrapper.text()).not.toContain('future层')
  const wall = wrapper.get('[data-floor-item="item"]')
  expect(wall.findAll('td')[0]!.text()).toContain('往月已完成')
  expect(wall.findAll('td')[0]!.text()).toContain('本月新增')
  expect(wall.findAll('td')[1]!.text()).toContain('未涉及')
  const floor = wrapper.get('[data-floor-item="floor-item"]')
  expect(floor.attributes('data-selected')).toBe('true')
  expect(floor.findAll('td')[0]!.text()).toContain('未涉及')
  expect(floor.findAll('td')[1]!.text()).toContain('本月新增')
  wrapper.unmount()
})

it('没有已证明完成事实不补全项目楼层，也不把未排查写成零', () => {
  const wrapper = mount(PayrollAFloorReview, { props: { facts: [], month: '2026-09', selectedItemId: '', returnTo: '/subcontract/payroll/form/wage?origin=real' } })
  expect(wrapper.text()).toContain('尚无已证明的施工楼层')
  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('空鼓 0')
  wrapper.unmount()
})
