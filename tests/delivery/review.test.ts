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
    expect(deliveryNaturalKey({
      projectId: 'project-1',
      supplierId: 'supplier-1',
      orderNo: ' abc-123 ',
    })).toBe('["project-1","supplier-1","ABC-123"]')
    expect(deliveryNaturalKey({
      projectId: 'project-1',
      supplierId: 'supplier-1',
      orderNo: 'ＡＢＣ－１２３',
    })).toBe('["project-1","supplier-1","ABC-123"]')
  })

  it.each([
    { name: '项目', projectId: '', supplierId: 's', orderNo: 'A' },
    { name: '分供方', projectId: 'p', supplierId: '', orderNo: 'A' },
    { name: '单号', projectId: 'p', supplierId: 's', orderNo: ' ' },
  ])('缺少$name不生成自然键', ({ projectId, supplierId, orderNo }) => {
    expect(deliveryNaturalKey({ projectId, supplierId, orderNo })).toBeNull()
  })

  it.each([
    { case: '\' ａｂｃ－１２３ \'', input: '  ａｂｃ－１２３  ', expected: 'ABC-123' },
    { case: '\' \'', input: '　', expected: '' },
  ])('用 NFKC、首尾去空格和大写形成持久化与自然键共用值 / normalizeDeliveryOrderNo：$case', ({ input, expected }) => {
    expect(normalizeDeliveryOrderNo(input)).toBe(expected)
  })
})

describe('送货单人工复核金额', () => {
  function createCalculatedDeliveryLine() {
    const calculated = {
      id: 'calculated',
      qty: 2,
      unitPrice: 10,
      amount: 20,
      amountSource: 'calculated' as const,
    }
    return { calculated }
  }

  it.each([
    { case: 'calculated / \'qty\' / 3', prepare: ({ calculated }: ReturnType<typeof createCalculatedDeliveryLine>) => {
      return { input: calculated, argument2: 'qty', argument3: 3, expected: { amount: 30 } } as const
    } },
    { case: 'ocr / \'qty\' / 3', prepare: ({ calculated }: ReturnType<typeof createCalculatedDeliveryLine>) => {
      const ocr = { ...calculated, id: 'ocr', amount: 19.5, amountSource: 'ocr' as const }
      return { input: ocr, argument2: 'qty', argument3: 3, expected: { qty: 3, amount: 19.5, amountSource: 'ocr' } } as const
    } },
    { case: 'manual / \'unitPrice\' / 12', prepare: ({ calculated }: ReturnType<typeof createCalculatedDeliveryLine>) => {
      const manual = editDeliveryAmountLine(calculated, 'amount', 18)
      return { input: manual, argument2: 'unitPrice', argument3: 12, expected: {
        unitPrice: 12,
        amount: 18,
        amountSource: 'manual',
      } } as const
    } },
  ])('计算行随数量/单价更新，OCR 或手改金额不被覆盖 / editDeliveryAmountLine：$case', ({ prepare }) => {
    const fixture = createCalculatedDeliveryLine()
    const { input, argument2, argument3, expected } = prepare(fixture)
    expect(editDeliveryAmountLine(input, argument2, argument3)).toMatchObject(expected)
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

  it.each([{ name: '' }, { unit: '' }, { qty: 0 }])('材料名称、单位和非零数量继续作为归档硬门禁：%j', (patch) => {
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

    const item = { ...base.items[0]!, ...patch }
    expect(deliveryReviewIssueDetails({ ...base, items: [item] })
      .some(issue => issue.key === 'items')).toBe(true)
  })

  it.each([
    { label: '非闰年二月二十九日', date: '2025-02-29', qty: 1, expected: 'date' },
    { label: '四月三十一日', date: '2026-04-31', qty: 1, expected: 'date' },
    { label: '非数字数量', date: '2026-04-30', qty: Number.NaN, expected: 'items' },
    { label: '无限数量', date: '2026-04-30', qty: Number.POSITIVE_INFINITY, expected: 'items' },
  ])('不可核实的日期或数量须在审核阶段阻断：$label', ({ date, qty, expected }) => {
    const issues = deliveryReviewIssueDetails({
      projectId: 'project-1',
      supplierId: 'supplier-1',
      orderNo: 'DL-INVALID',
      deliveryDate: date,
      docType: '送货单',
      note: '',
      items: [{ id: 'line-1', name: '电线', unit: 'm', qty, unitPrice: null, amount: null, amountSource: 'manual' }],
      confirmations: { humanReviewed: true },
    })
    expect(issues.map(issue => issue.key)).toContain(expected)
  })

  it('闰年真实日期与有限正数数量仍可在价格待补录时归档', () => {
    expect(deliveryReviewIssueDetails({
      projectId: 'project-1',
      supplierId: 'supplier-1',
      orderNo: 'DL-VALID',
      deliveryDate: '2024-02-29',
      docType: '送货单',
      note: '',
      items: [{ id: 'line-1', name: '电线', unit: 'm', qty: 0.5, unitPrice: null, amount: null, amountSource: 'manual' }],
      confirmations: { humanReviewed: true },
    })).toEqual([])
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
