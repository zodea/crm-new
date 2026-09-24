import { fireEvent, render } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import FactorTaxCalculator from '~/components/finance/invoice/factor/FactorTaxCalculator.vue'

describe('共用金额税额栏', () => {
  it('即时计算四格并复制各自原始值', async () => {
    const copy = vi.fn()
    const view = render(FactorTaxCalculator, { props: { modelValue: 128640, onCopy: copy } })
    expect(view.getByText('113,840.71', { exact: true })).toBeTruthy()
    const values = [
      ['价税合计', '128640.00'],
      ['不含税金额', '113840.71'],
      ['税额', '14799.29'],
      ['大写', '壹拾贰万捌仟陆佰肆拾元整'],
    ]
    for (const [label, value] of values) {
      await fireEvent.click(view.getByRole('button', { name: `复制${label}` }))
      expect(copy).toHaveBeenLastCalledWith(value)
    }
    await view.rerender({ modelValue: 113 })
    expect(view.getByText('100.00', { exact: true })).toBeTruthy()
    expect(view.getByText('13.00', { exact: true })).toBeTruthy()
  })

  it('清空或无效金额不以零值计算，输入改变回传父级同一金额', async () => {
    const update = vi.fn()
    const view = render(FactorTaxCalculator, { props: { 'modelValue': '', 'onUpdate:modelValue': update } })
    expect(view.getByRole('button', { name: '复制价税合计' }).hasAttribute('disabled')).toBe(true)
    await fireEvent.update(view.getByLabelText('含税金额'), '113')
    expect(update).toHaveBeenLastCalledWith(113)
    await view.rerender({ modelValue: -1 })
    expect(view.getByRole('alert').textContent).toContain('请输入有效的含税金额')
    expect(view.getByRole('button', { name: '复制税额' }).hasAttribute('disabled')).toBe(true)
  })
})
