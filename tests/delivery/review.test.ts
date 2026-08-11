import { describe, expect, it } from 'vitest'
import { deliveryReviewIssueDetails, editDeliveryAmountLine, summarizeDeliveryAmounts } from '~/lib/delivery/review'

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

  it('缺失数量或单价时保持空值，不把金额行误判为 0×0 不平', () => {
    const amountOnly = {
      id: 'amount-only',
      qty: null,
      unitPrice: null,
      amount: 386,
      amountSource: 'ocr' as const,
    }

    expect(summarizeDeliveryAmounts([amountOnly], 386)).toEqual({
      total: 386,
      mismatchedLineIds: [],
      statedBalanced: true,
      balanced: true,
    })
    expect(editDeliveryAmountLine(amountOnly, 'qty', Number.NaN)).toMatchObject({ qty: null, amount: 386 })
  })

  it('#257 识别未完成、自然键重复或人工确认金额缺失时不得归档', () => {
    const base = {
      projectId: 'project-1',
      supplierId: 'supplier-1',
      orderNo: 'DL-001',
      deliveryDate: '2026-06-01',
      docType: '材料送货单',
      note: '人工复核记录',
      items: [{
        id: 'line-1',
        name: 'BV 电线',
        unit: 'm',
        qty: 10,
        unitPrice: null,
        amount: 25,
        amountSource: 'manual' as const,
      }],
      confirmations: { humanReviewed: true },
    }

    expect(deliveryReviewIssueDetails({ ...base, ocrStatus: 'pending' })
      .some(issue => issue.key === 'ocr-status')).toBe(true)
    expect(deliveryReviewIssueDetails({ ...base, naturalKeyDuplicate: true })
      .some(issue => issue.key === 'duplicate')).toBe(true)
    expect(deliveryReviewIssueDetails({
      ...base,
      note: '',
      items: [{ ...base.items[0]!, amount: null }],
    }).some(issue => issue.key === 'amount')).toBe(true)
  })
})
