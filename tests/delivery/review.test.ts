import { describe, expect, it } from 'vitest'
import { editDeliveryAmountLine, summarizeDeliveryAmounts } from '~/lib/delivery/review'

describe('送货单人工复核金额', () => {
  it('计算行随数量/单价更新，OCR 或手改金额不被覆盖', () => {
    const calculated = {
      id: 'calculated',
      qty: 2,
      unitPrice: 10,
      amount: 20,
      amountSource: 'calculated' as const,
    }
    expect(editDeliveryAmountLine(calculated, 'qty', 3)).toMatchObject({ amount: 30 })

    const ocr = { ...calculated, id: 'ocr', amount: 19.5, amountSource: 'ocr' as const }
    expect(editDeliveryAmountLine(ocr, 'qty', 3)).toMatchObject({ qty: 3, amount: 19.5, amountSource: 'ocr' })

    const manual = editDeliveryAmountLine(calculated, 'amount', 18)
    expect(editDeliveryAmountLine(manual, 'unitPrice', 12)).toMatchObject({
      unitPrice: 12,
      amount: 18,
      amountSource: 'manual',
    })
  })

  it('按当前可编辑金额重算合计，并定位数量×单价不平的行', () => {
    const summary = summarizeDeliveryAmounts([
      { id: 'ok', qty: 2, unitPrice: 10, amount: 20, amountSource: 'ocr' },
      { id: 'bad', qty: 3, unitPrice: 10, amount: 25, amountSource: 'manual' },
    ], 45)

    expect(summary).toEqual({
      total: 45,
      mismatchedLineIds: ['bad'],
      statedBalanced: true,
      balanced: false,
    })
  })
})
