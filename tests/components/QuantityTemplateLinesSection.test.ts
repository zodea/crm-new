import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import QuantityTemplateLinesSection from '~/components/quantity/QuantityTemplateLinesSection.vue'

describe('quantity template lines section', () => {
  const props = {
    rooms: [{
      key: 'whole',
      id: null,
      code: '__whole_unit__',
      name: '整户范围',
      kind: 'whole_unit' as const,
      sortOrder: 0,
    }],
    newItems: [],
    lines: [{
      key: 'line-1',
      id: null,
      roomKey: 'whole',
      itemId: 'item-1',
      recognizedContractQty: 12,
      contractQty: 12,
      provisionalQty: 8,
      fieldFormula: '2×5',
      fieldQty: 10,
      note: '',
      sortOrder: 0,
    }],
    itemOptions: [{
      key: 'item-1',
      label: '泥水工 · 墙砖铺贴（㎡）',
    }],
  }

  it('工资预付预览只提供暂估量和现场复核量，并实时切换总量', async () => {
    render(QuantityTemplateLinesSection, { props })

    const source = screen.getByRole<HTMLSelectElement>('combobox', { name: '工资预付取数' })
    expect(Array.from(source.options).map(option => option.textContent))
      .toEqual(['暂估量', '现场复核量'])
    expect(Array.from(source.options).some(option => option.value === 'contract')).toBe(false)
    expect(screen.getByTestId('wage-preview-total').textContent?.replace(/\s+/g, ' ').trim())
      .toBe('预览合计 8')
    expect(screen.getByText('最终结算固定取现场复核量')).not.toBeNull()

    await fireEvent.update(source, 'field')

    expect(screen.getByTestId('wage-preview-total').textContent?.replace(/\s+/g, ' ').trim())
      .toBe('预览合计 10')
  })
})
