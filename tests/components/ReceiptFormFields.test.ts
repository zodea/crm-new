import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import ReceiptFormFields from '../../app/components/receipt/ReceiptFormFields.vue'
import { draft, references, session } from '../receipt/fixtures'

describe('收款独立表单字段', () => {
  it('关联错误接到真实选择控件及说明，供表单首错聚焦', () => {
    setActivePinia(createPinia())
    const wrapper = mount(ReceiptFormFields, { props: { draft, context: { ...references, ...session }, fieldErrors: { projectId: ['请选择项目'], customerId: ['请选择付款方客户'], contractId: ['合同关系已改变'] } }, global: { stubs: { SectionHeader: true, KitButton: true } } })
    for (const field of ['projectId', 'customerId', 'contractId']) {
      const input = wrapper.get(`input[data-field="${field}"]`)
      expect(input.attributes('aria-invalid')).toBe('true')
      const descriptionId = input.attributes('aria-describedby')
      expect(descriptionId).toBe(`receipt-${field}-error`)
      expect(wrapper.get(`#${descriptionId}`).text()).not.toBe('')
    }
    wrapper.unmount()
  })
  it('清空金额保存为未知，显式零和超精度输入保留供校验，不以零替代错误', async () => {
    const wrapper = mount(ReceiptFormFields, { props: { draft, context: { ...references, ...session }, fieldErrors: {} }, global: { stubs: { LookupSelect: true, SectionHeader: true } } })
    const input = wrapper.get('input[aria-label="收款金额"]')
    for (const [value, expected] of [['', null], ['0', '0'], ['1.005', '1.005']] as const) {
      await input.setValue(value)
      expect(wrapper.emitted('patch')!.at(-1)).toEqual([{ amount: expected }])
    }
  })

  it('项目变化使用当前中央主客户并清空旧合同；不可写时禁用输入', async () => {
    const wrapper = mount(ReceiptFormFields, { props: { draft, context: { ...references, ...session }, fieldErrors: {}, readonly: true }, global: { stubs: { LookupSelect: true, SectionHeader: true } } })
    expect(wrapper.get('fieldset').attributes()).toHaveProperty('disabled')
    const lookup = wrapper.findAllComponents({ name: 'LookupSelect' })
    lookup[0]!.vm.$emit('update:modelValue', 'project-a')
    expect(wrapper.emitted('patch')!.at(-1)).toEqual([{ projectId: 'project-a', customerId: 'customer-a', contractId: null }])
  })
})
