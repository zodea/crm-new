import { fireEvent, render } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import FactorTaxCalculator from '~/components/finance/invoice/factor/FactorTaxCalculator.vue'

describe('共用金额税额栏', () => {
  it.each([
    { amount: 128640, net: '113840.71', tax: '14799.29', uppercase: '壹拾贰万捌仟陆佰肆拾元整' },
    { amount: 113, net: '100.00', tax: '13.00', uppercase: '壹佰壹拾叁元整' },
    { amount: 1.13, net: '1.00', tax: '0.13', uppercase: '壹元壹角叁分' },
    { amount: 0, net: '0.00', tax: '0.00', uppercase: '零元整' },
  ])('金额 $amount 即时计算四格并复制各自原始值', async ({ amount, net, tax, uppercase }) => {
    const copy = vi.fn()
    const view = render(FactorTaxCalculator, { props: { modelValue: amount, onCopy: copy } })
    const values = [
      ['价税合计', amount.toFixed(2)],
      ['不含税金额', net],
      ['税额', tax],
      ['大写', uppercase],
    ]
    for (const [label, value] of values) {
      await fireEvent.click(view.getByRole('button', { name: `复制${label}` }))
      expect(copy).toHaveBeenLastCalledWith(value)
    }
    expect(copy.mock.calls.map(([value]) => value)).toEqual(values.map(([, value]) => value))
  })

  it.each([
    { amount: '', message: null },
    { amount: null, message: null },
    { amount: -1, message: '请输入有效的含税金额' },
    { amount: Number.NaN, message: '请输入有效的含税金额' },
    { amount: Number.POSITIVE_INFINITY, message: '请输入有效的含税金额' },
  ])('未知或无效金额 $amount 不以零值计算', ({ amount, message }) => {
    const copy = vi.fn()
    const view = render(FactorTaxCalculator, { props: { modelValue: amount, onCopy: copy } })
    expect(view.getByRole('button', { name: '复制价税合计' }).hasAttribute('disabled')).toBe(true)
    expect(view.getByRole('button', { name: '复制税额' }).hasAttribute('disabled')).toBe(true)
    if (message)
      expect(view.getByRole('alert').textContent).toContain(message)
    else
      expect(view.queryByRole('alert')).toBeNull()
    expect(copy).not.toHaveBeenCalled()
  })

  it.each([113, 0, 1.13])('金额输入 %s 回传父级同一金额', async (amount) => {
    const update = vi.fn()
    const view = render(FactorTaxCalculator, { props: { 'modelValue': '', 'onUpdate:modelValue': update } })
    expect(view.getByRole('button', { name: '复制价税合计' }).hasAttribute('disabled')).toBe(true)
    await fireEvent.update(view.getByLabelText('含税金额'), String(amount))
    expect(update).toHaveBeenCalledExactlyOnceWith(amount)
  })
})
