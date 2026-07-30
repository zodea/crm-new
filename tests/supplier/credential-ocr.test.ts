import type { OcrRecognitionResult } from '~/lib/recognize/engine'
import { describe, expect, it } from 'vitest'
import {
  buildCredentialOcrReview,
  parseCredentialOcr,
  resolveCredentialOcrReview,
  suggestCredentialCategory,
} from '~/lib/supplier/credential-ocr'

function result(markdown: string): OcrRecognitionResult {
  return {
    engine: 'paddleocr-official-api',
    model: 'PaddleOCR-VL-1.6',
    jobId: 'synthetic-job',
    pages: [{
      pageIndex: 0,
      markdown,
      prunedResult: {},
      layoutRegions: [],
    }],
    markdownPages: [markdown],
    dataInfo: {},
  }
}

describe('supplier credential OCR', () => {
  it('兼容基本存款账户信息并归一化银行账号', () => {
    const parsed = parseCredentialOcr(result(`
      基本存款账户信息
      开户行：广东示例银行广州支行
      基本存款账户编号：1234 5678 9012 3456
    `), '基本存款账户信息.pdf')

    expect(parsed.category.category).toBe('银行账户资料')
    expect(parsed.category.confidence).toBeGreaterThan(0.7)
    expect(parsed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'bank', value: '广东示例银行广州支行' }),
      expect.objectContaining({ key: 'bankAccount', value: '1234567890123456' }),
    ]))
    expect(parsed.fields.some(field => field.key === 'name')).toBe(false)
  })

  it('提取营业执照字段与期限，不包含真实敏感夹具', () => {
    const parsed = parseCredentialOcr(result(`
      营业执照
      名称：示例材料有限公司
      统一社会信用代码：91440000TEST123456
      法定代表人：张某
      住所：广东省示例市示例路 1 号
      有效期自：2024年01月02日
      有效期至：2034年01月01日
    `))

    expect(parsed.category.category).toBe('营业执照')
    expect(parsed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'name', value: '示例材料有限公司' }),
      expect.objectContaining({ key: 'uniqueCode', value: '91440000TEST123456' }),
      expect.objectContaining({ key: 'validFrom', value: '2024-01-02' }),
      expect.objectContaining({ key: 'expiresAt', value: '2034-01-01' }),
    ]))
  })

  it('识别身份证常见姓名与起止式有效期限', () => {
    const parsed = parseCredentialOcr(result(`
      中华人民共和国居民身份证
      姓名 张某
      公民身份号码 440000********1234
      有效期限 2023.08.16-2043.08.16
    `), '法人身份证.png')

    expect(parsed.category.category).toBe('法人身份证')
    expect(parsed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'legalRep', value: '张某' }),
      expect.objectContaining({ key: 'validFrom', value: '2023-08-16' }),
      expect.objectContaining({ key: 'expiresAt', value: '2043-08-16' }),
    ]))
  })

  it('已有值冲突默认保留，空字段待用户确认后采用识别值', () => {
    const review = buildCredentialOcrReview([
      { key: 'name', label: '公司名称', value: 'OCR 名称', confidence: 0.9 },
      { key: 'bank', label: '开户行', value: '示例银行', confidence: 0.9 },
    ], {
      name: '人工名称',
      bank: '',
    })

    expect(review[0]).toMatchObject({
      conflict: true,
      decision: 'keep-current',
    })
    expect(review[1]).toMatchObject({
      conflict: false,
      decision: 'use-recognized',
    })
    expect(resolveCredentialOcrReview(review)).toEqual({
      name: '人工名称',
      bank: '示例银行',
    })
  })

  it('允许逐项手工修正，不提供隐式全部覆盖', () => {
    const review = buildCredentialOcrReview([
      { key: 'legalRep', label: '法定代表人', value: '识别值', confidence: 0.72 },
    ], { legalRep: '当前值' })
    review[0]!.decision = 'manual'
    review[0]!.manualValue = '人工确认值'

    expect(resolveCredentialOcrReview(review)).toEqual({
      legalRep: '人工确认值',
    })
    expect(suggestCredentialCategory('无法识别的内容').category).toBe('其他')
  })
})
