import { describe, expect, it } from 'vitest'
import {
  deliveryNaturalKey,
  deliveryReviewIssueDetails,
  editDeliveryAmountLine,
  normalizeDeliveryOrderNo,
  summarizeDeliveryAmounts,
} from '~/lib/delivery/review'

describe('送货单号规范化', () => {
  it('用 NFKC、首尾去空格和大写形成持久化与自然键共用值', () => {
    expect(normalizeDeliveryOrderNo('  ａｂｃ－１２３  ')).toBe('ABC-123')
    expect(normalizeDeliveryOrderNo('　')).toBe('')
    expect(deliveryNaturalKey({
      projectId: 'project-1',
      supplierId: 'supplier-1',
      orderNo: ' abc-123 ',
    })).toBe(deliveryNaturalKey({
      projectId: 'project-1',
      supplierId: 'supplier-1',
      orderNo: 'ＡＢＣ－１２３',
    }))
  })
})

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

  it('#257 识别未完成和自然键重复仍阻断，缺价格经人工确认后允许归档', () => {
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
    })).toEqual([])
  })

  it('材料名称、单位和非零数量继续作为归档硬门禁', () => {
    const base = {
      projectId: 'project-1',
      supplierId: 'supplier-1',
      orderNo: 'DL-002',
      deliveryDate: '2026-06-02',
      docType: '材料送货单',
      note: '',
      items: [{
        id: 'line-1',
        name: 'BV 电线',
        unit: 'm',
        qty: 10,
        unitPrice: null,
        amount: null,
        amountSource: 'manual' as const,
      }],
      confirmations: { humanReviewed: true },
    }

    for (const item of [
      { ...base.items[0]!, name: '' },
      { ...base.items[0]!, unit: '' },
      { ...base.items[0]!, qty: 0 },
    ]) {
      expect(deliveryReviewIssueDetails({ ...base, items: [item] })
        .some(issue => issue.key === 'items')).toBe(true)
    }
  })

  it('金额与数量乘单价不一致时仍需人工复核并记录原因', () => {
    const input = {
      projectId: 'project-1',
      supplierId: 'supplier-1',
      orderNo: 'DL-003',
      deliveryDate: '2026-06-03',
      docType: '材料送货单',
      note: '',
      items: [{
        id: 'line-1',
        name: 'BV 电线',
        unit: 'm',
        qty: 10,
        unitPrice: 2.5,
        amount: 20,
        amountSource: 'manual' as const,
      }],
      confirmations: { humanReviewed: true },
    }

    expect(deliveryReviewIssueDetails(input).some(issue => issue.key === 'amount')).toBe(true)
    expect(deliveryReviewIssueDetails({
      ...input,
      note: '已对照原件，票面金额按 20 元保留',
      confirmations: { humanReviewed: true, amountReviewed: true },
    }).some(issue => issue.key === 'amount')).toBe(false)
  })
})
