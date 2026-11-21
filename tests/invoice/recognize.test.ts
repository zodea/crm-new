import { describe, expect, it, vi } from 'vitest'
import { invoiceCandidateForCommand } from '~/lib/invoice/central-recognition'
import { CONFIDENCE_THRESHOLDS, confidenceTier, isRecognizableFile, recognizeInvoiceLocally } from '~/lib/invoice/recognize'

describe('confidenceTier:置信度分档(边框色/角标/✓确认 依据)', () => {
  it.each([
    { case: '0.99', input: 0.99, expected: 'ok' },
    { case: 'CONFIDENCE_THRESHOLDS.ok', input: CONFIDENCE_THRESHOLDS.ok, expected: 'ok' },
    { case: '0.9', input: 0.9, expected: 'warn' },
    { case: 'CONFIDENCE_THRESHOLDS.warn', input: CONFIDENCE_THRESHOLDS.warn, expected: 'warn' },
    { case: '0.5', input: 0.5, expected: 'danger' },
  ])('≥ok 绿 / ≥warn 黄 / 其余红 / 无数据 null(人工录入字段不着色) / confidenceTier：$case', ({ input, expected }) => {
    expect(confidenceTier(input)).toBe(expected)
  })

  it.each([
    { case: 'null', input: null },
    { case: 'undefined', input: undefined },
  ])('≥ok 绿 / ≥warn 黄 / 其余红 / 无数据 null(人工录入字段不着色) / confidenceTier：$case', ({ input }) => {
    expect(confidenceTier(input)).toBeNull()
  })
})

describe('isRecognizableFile:上传文件类型判定(file input accept 与拖拽过滤的唯一定义源)', () => {
  it.each([
    { case: '\'a.pdf\'', input: 'a.pdf', expected: true },
    { case: '\'B.PNG\'', input: 'B.PNG', expected: true },
    { case: '\'c.jpg\'', input: 'c.jpg', expected: true },
    { case: '\'d.JPEG\'', input: 'd.JPEG', expected: true },
    { case: '\'e.txt\'', input: 'e.txt', expected: false },
    { case: '\'f.pdf.exe\'', input: 'f.pdf.exe', expected: false },
  ])('pdf/图片(含大写扩展名)放行,其余拒绝 / isRecognizableFile：$case', ({ input, expected }) => {
    expect(isRecognizableFile(input)).toBe(expected)
  })
})

it('中央识别命令保留票面内容，不携带本次识别的定位和源帧', async () => {
  const readDocument = vi.fn().mockResolvedValue({ pages: ['发票号码：87654321'], unrecognizedPageIndexes: [], geometryPages: [{ pageIndex: 0, width: 300, height: 200, source: 'image', blocks: [{ text: '发票号码：87654321', polygon: [[10, 10], [200, 10], [200, 30], [10, 30]] }] }] })
  const candidate = await recognizeInvoiceLocally({ file: new File(['image'], 'synthetic.png'), basePath: '/' }, { readDocument })
  expect(candidate.fieldRegions?.invoiceNumber).toEqual({ pageIndex: 0, blockLabel: 'text', box: { x: expect.closeTo(1 / 30), y: 0.05, width: expect.closeTo(190 / 300), height: expect.closeTo(0.1) } })
  expect(candidate.regionFrames).toEqual([{ pageIndex: 0, width: 300, height: 200, source: 'image' }])
  const command = invoiceCandidateForCommand(candidate)
  expect(command).toMatchObject({ fields: { invoiceNumber: '87654321' }, source: 'local', textPages: ['发票号码：87654321'], unrecognizedPageIndexes: [] })
  expect(command).not.toHaveProperty('fieldRegions')
  expect(command).not.toHaveProperty('regionFrames')
})

it('识别命令携带票面证据与明示零，勾稽建议留在本次候选内', async () => {
  const textPages = ['发票号码：87654321\n税额：￥0.00\n价税合计（小写）：￥100.00']
  const readDocument = vi.fn().mockResolvedValue({ pages: textPages, unrecognizedPageIndexes: [] })
  const candidate = await recognizeInvoiceLocally({ file: new File(['image'], 'synthetic.png'), basePath: '/' }, { readDocument })

  expect(candidate.fields.calculatedAmounts).toEqual({ amount: 100 })
  const command = invoiceCandidateForCommand(candidate)
  expect(command).toMatchObject({ fields: { amount: null, taxAmount: 0, totalAmount: 100 }, textPages })
  expect(command.fields).not.toHaveProperty('calculatedAmounts')
})
