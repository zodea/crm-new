import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PayrollAFrozenPrint from '~/components/payroll/PayrollAFrozenPrint.vue'
import { payrollUiDocument } from '../helpers/payroll-a-ui-fixture'

it('打印内容仅用已传冻结值，零成员和四类签名位置完整', () => {
  const wrapper = mount(PayrollAFrozenPrint, { props: { document: payrollUiDocument() }, global: { stubs: { teleport: true } } })
  expect(wrapper.text()).toContain('原负责人')
  expect(wrapper.text()).toContain('零收款成员')
  expect(wrapper.text()).toContain('¥0.00')
  expect(wrapper.text()).toContain('此前实际已发')
  for (const label of ['班组长', '施工员', '安全员', '现场负责人', '签字确认并按手印'])
    expect(wrapper.text()).toContain(label)
  wrapper.unmount()
})
