// 桩识别统一接口回归（issue #60）：调用方只依赖 recognizeInvoice 签名，
// 这里锁定桩实现的产出契约——字段齐全、金额铁律、置信度分档、进度收尾。
import { describe, expect, it } from 'vitest'
import {
  CONFIDENCE_FIELD_KEYS,
  CONFIDENCE_THRESHOLDS,
  confidenceTier,
  isRecognizableFile,
  stubRecognizeInvoice,
} from '~/lib/invoice/recognize'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

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

describe('stubRecognizeInvoice:桩识别产出契约', () => {
  const recognize = (fileName: string) => stubRecognizeInvoice({ fileName }, { stepMs: 0 })

  it('字段齐全:9+ 字段非空、发票号 17 位数字、日期 YYYY-MM-DD', async () => {
    const r = await recognize('scan_test_001.pdf')
    expect(r.invoiceNumber).toMatch(/^\d{17}$/)
    expect(r.invoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it.each(Array.from(['invoiceType', 'invoiceNumber', 'invoiceDate', 'buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo', 'taxRate', 'remark'] as const).map(input => ({ input })))('字段齐全:9+ 字段非空、发票号 17 位数字、日期 YYYY-MM-DD：输入组合 1 案例 %#', async ({ input: key }) => {
    const r = await recognize('scan_test_001.pdf')
    expect(r[key], `${key} 不应为空`).toBeTruthy()
  })

  it.each((['a.pdf', 'b.jpg', 'scan_0615_001.pdf', '扫描件_汇丰水泥.pdf']).map(input => ({ input })))('金额铁律:两位小数,amount+taxAmount=totalAmount,明细金额/税额合计=票面：输入案例 %#', async ({ input: name }) => {
    const r = await recognize(name)
    expect(r.amount).toBe(round2(r.amount))
    expect(r.taxAmount).toBe(round2(r.taxAmount))
    expect(r.totalAmount).toBe(round2(r.totalAmount))
    expect(round2(r.amount + r.taxAmount), `${name} 价税不平`).toBe(r.totalAmount)

    const itemAmountSum = round2(r.items.reduce((s, i) => s + i.amount, 0))
    const itemTaxSum = round2(r.items.reduce((s, i) => s + i.taxAmount, 0))
    expect(itemAmountSum, `${name} 明细金额合计≠票面`).toBe(r.amount)
    expect(itemTaxSum, `${name} 明细税额合计≠票面`).toBe(r.taxAmount)
    expect(r.items.length).toBeGreaterThanOrEqual(1)
  })

  it.each((['x.pdf', 'y.pdf', 'z.pdf', '上传测试_电缆发票.pdf']).map(input => ({ input })))('逐字段置信度:键 ⊆ 已知字段集,值在 (0,1],且 1~2 个字段落 warn/danger 档(演示确认变绿流程)：输入案例 %#', async ({ input: name }) => {
    const r = await recognize(name)
    const keys = Object.keys(r.fieldConfidence)
    expect(keys.length).toBe(CONFIDENCE_FIELD_KEYS.length)
    for (const k of keys) {
      expect(CONFIDENCE_FIELD_KEYS as readonly string[], `未知置信度字段 ${k}`).toContain(k)
      const v = r.fieldConfidence[k]!
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    const lowKeys = keys.filter(k => confidenceTier(r.fieldConfidence[k]) !== 'ok')
    expect(lowKeys.length, `${name} 非绿字段应为 1~2 个(基线 0.96+,仅哈希强制压低的字段落黄/红)`).toBeGreaterThanOrEqual(1)
    expect(lowKeys.length, `${name} 非绿字段应为 1~2 个(基线 0.96+,仅哈希强制压低的字段落黄/红)`).toBeLessThanOrEqual(2)
    // amount 不在校对网格渲染(由 total−tax 派生):强制压低若落在 amount 上,
    // 黄/红字段在 UI 不可见且永远无法✓确认——必须只从可见字段里选
    expect(lowKeys, `${name} 压低字段不得落在网格不渲染的 amount 上`).not.toContain('amount')
  })

  it('确定性:同一文件名重复识别结果一致(可复现演示/换真引擎前的回归锚点)', async () => {
    const a = await recognize('same.pdf')
    const b = await recognize('same.pdf')
    expect(a).toEqual(b)
    const c = await recognize('other.pdf')
    expect(c.invoiceNumber).not.toBe(a.invoiceNumber)
  })

  it('日期纯 seed 派生:不依赖当前时钟(跨日/时区重识别结果仍一致,发票号年前缀随 invoiceDate 同源)', async () => {
    const r = await recognize('date-anchor.pdf')
    // UTC 锚点派生,与本地时区/运行时刻无关;发票号 5~8 位 = 开票年份
    expect(r.invoiceNumber.slice(4, 8)).toBe(r.invoiceDate.slice(0, 4))
  })

  it('进度回调:递增且以 100 收尾', async () => {
    const ticks: number[] = []
    await stubRecognizeInvoice({ fileName: 'p.pdf' }, { stepMs: 0, onProgress: p => ticks.push(p) })
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks.at(-1)).toBe(100)
    for (let i = 1; i < ticks.length; i++)
      expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!)
  })
})
