import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import QuantityFieldFormulaCell from '~/pages/subcontract/quantity/_components/QuantityFieldFormulaCell.vue'

describe('quantity field formula cell', () => {
  it('阅读态显示计算结果，点击后才显示计算式', async () => {
    render(QuantityFieldFormulaCell, {
      props: {
        formula: '2×5',
      },
    })

    expect(screen.getByRole('button', { name: '现场复核量 10，点击编辑算式' })).not.toBeNull()
    expect(screen.queryByRole('textbox', { name: '现场复核算式' })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '现场复核量 10，点击编辑算式' }))

    const editor = screen.getByRole<HTMLInputElement>('textbox', { name: '现场复核算式' })
    expect(editor.value).toBe('2×5')
  })

  it('错误算式在失焦后仍保留编辑态，修正并回车后恢复数值态', async () => {
    const view = render(QuantityFieldFormulaCell, {
      props: {
        formula: '2×5',
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: '现场复核量 10，点击编辑算式' }))
    const editor = screen.getByRole<HTMLInputElement>('textbox', { name: '现场复核算式' })

    await fireEvent.update(editor, '2÷0')
    await fireEvent.blur(editor)

    expect(screen.getByRole('textbox', { name: '现场复核算式' })).not.toBeNull()
    expect(screen.getByRole('alert')).not.toBeNull()

    await fireEvent.update(editor, '3×4')
    await fireEvent.keyDown(editor, { key: 'Enter' })

    expect(view.emitted().updateFormula?.at(-1)).toEqual(['3×4'])
    expect(screen.getByRole('button', { name: '现场复核量 12，点击编辑算式' })).not.toBeNull()
    expect(screen.queryByRole('textbox', { name: '现场复核算式' })).toBeNull()
  })
})
