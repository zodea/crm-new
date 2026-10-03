import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import ReceiptFormFields from '../../app/components/receipt/ReceiptFormFields.vue'
import { draft, references, session } from '../receipt/fixtures'

describe('收款独立表单字段', () => {
  it.each([
    { field: 'projectId', message: '请选择项目' },
    { field: 'customerId', message: '请选择付款方客户' },
    { field: 'contractId', message: '合同关系已改变' },
  ])('$field 关联错误接到真实选择控件及说明，供表单首错聚焦', ({ field, message }) => {
    setActivePinia(createPinia())
    const wrapper = mount(ReceiptFormFields, { props: { draft, context: { ...references, ...session }, fieldErrors: { [field]: [message] } }, global: { stubs: { SectionHeader: true, KitButton: true } } })
    const input = wrapper.get(`input[data-field="${field}"]`)
    expect(input.attributes('aria-invalid')).toBe('true')
    const descriptionId = input.attributes('aria-describedby')
    expect(descriptionId).toBe(`receipt-${field}-error`)
    expect(wrapper.get(`#${descriptionId}`).text()).toBe(message)
    wrapper.unmount()
  })
  it.each([
    { value: '', expected: null },
    { value: '0', expected: '0' },
    { value: '123.45', expected: '123.45' },
    { value: '1.005', expected: '1.005' },
    { value: '-1', expected: '-1' },
  ])('金额输入 $value 保存为 $expected，未知、零及待校验输入保持区分', async ({ value, expected }) => {
    const wrapper = mount(ReceiptFormFields, { props: { draft, context: { ...references, ...session }, fieldErrors: {} }, global: { stubs: { LookupSelect: true, SectionHeader: true } } })
    const input = wrapper.get('input[aria-label="收款金额"]')
    await input.setValue(value)
    expect(wrapper.emitted('patch')!.at(-1)).toEqual([{ amount: expected }])
    wrapper.unmount()
  })

  it('项目变化使用当前中央主客户并清空旧合同；不可写时禁用输入', async () => {
    const wrapper = mount(ReceiptFormFields, { props: { draft, context: { ...references, ...session }, fieldErrors: {}, readonly: true }, global: { stubs: { LookupSelect: true, SectionHeader: true } } })
    expect(wrapper.get('fieldset').attributes()).toHaveProperty('disabled')
    const lookup = wrapper.findAllComponents({ name: 'LookupSelect' })
    lookup[0]!.vm.$emit('update:modelValue', 'project-a')
    expect(wrapper.emitted('patch')!.at(-1)).toEqual([{ projectId: 'project-a', customerId: 'customer-a', contractId: null }])
  })
})
