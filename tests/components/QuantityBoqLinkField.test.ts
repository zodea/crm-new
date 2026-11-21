import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import QuantityBoqLinkField from '~/pages/subcontract/quantity/_components/QuantityBoqLinkField.vue'

const oldLine = { id: 'old', contractId: 'contract', contractNo: 'C-01', contractName: '施工合同', itemName: '墙面', unit: '㎡', qty: 12, unitPrice: null, effectiveUnitPrice: null, approvedDeltaQty: 4, building: null, updatedAt: null }
const newLine = { ...oldLine, id: 'new', qty: null, contractNo: 'C-02', itemName: '另一清单' }

describe('模板稳定清单关联', () => {
  it('按明确稳定ID切换，未知原量不显示0；解除保留原识别值并明确历史含义', async () => {
    const view = render(QuantityBoqLinkField, { props: { value: 'old', originalId: 'old', recognizedQty: 12, lines: [oldLine, newLine] } })
    await fireEvent.update(screen.getByRole('combobox', { name: '关联合同清单' }), 'new')
    expect(view.emitted('change')).toEqual([['new']])
    await view.rerender({ value: 'new' })
    expect(screen.getByText('待保存原识别量：未记录')).toBeTruthy()
    await fireEvent.update(screen.getByRole('combobox', { name: '关联合同清单' }), '')
    expect(view.emitted('change')?.at(-1)).toEqual([null])
    await view.rerender({ value: null })
    expect(screen.getByText('原识别值：12（已解除关联）')).toBeTruthy()
  })

  it('当前关联不在候选中仍保留其ID和原值，读取失败不替换为空选择', () => {
    render(QuantityBoqLinkField, { props: { value: undefined, originalId: 'hidden', recognizedQty: 0, lines: [], error: '清单读取失败' } })
    const select = screen.getByRole('combobox', { name: '关联合同清单' }) as HTMLSelectElement
    expect(select.value).toBe('hidden')
    expect(select.disabled).toBe(true)
    expect(screen.getByText('原识别量：0')).toBeTruthy()
    expect(screen.getByText('清单读取失败')).toBeTruthy()
  })
})
