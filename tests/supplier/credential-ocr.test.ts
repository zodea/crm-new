import type { OcrRecognitionResult } from '~/lib/recognize/engine'
import { describe, expect, it } from 'vitest'
import {
  buildCredentialOcrReview,
  parseCredentialOcr,
  resolveCredentialOcrChoices,
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
      expect.objectContaining({ key: 'taxNo', value: '91440000TEST123456' }),
      expect.objectContaining({ key: 'validFrom', value: '2024-01-02' }),
      expect.objectContaining({ key: 'expiresAt', value: '2034-01-01' }),
    ]))
    expect(parsed.fields.some(field => field.key === 'uniqueCode')).toBe(false)
  })

  it('同一原件的不同税号候选全部保留，稳定身份区分并默认保留当前值', () => {
    const original = result('统一社会信用代码：91440000TEST123456\n纳税人识别号：91440000TEST654321\n税号：91440000TEST654322')
    const parsed = parseCredentialOcr(original)
    const candidates = parsed.fields.filter(field => field.key === 'taxNo')
    expect(candidates.map(field => field.value)).toEqual(['91440000TEST123456', '91440000TEST654321', '91440000TEST654322'])
    expect(new Set(candidates.map(field => field.id)).size).toBe(3)
    expect(parseCredentialOcr(original).fields).toEqual(parsed.fields)
    const review = buildCredentialOcrReview(candidates, { uniqueCode: 'INTERNAL', taxNo: '' })
    expect(review.every(field => field.conflict && field.decision === 'keep-current')).toBe(true)
    expect(resolveCredentialOcrReview(review)).toEqual({})
    review[0]!.decision = 'use-recognized'
    expect(resolveCredentialOcrReview(review)).toEqual({ taxNo: '91440000TEST123456' })
    review[1]!.decision = 'use-recognized'
    expect(() => resolveCredentialOcrReview(review)).toThrow(/多个|一项|一个/)
  })

  it('不同原标签识别为同一税号时没有伪冲突，确认仍只有一个目标值', () => {
    const parsed = parseCredentialOcr(result('统一社会信用代码：91440000TEST123456\n纳税人识别号：91440000TEST123456'))
    expect(parsed.fields).toHaveLength(2)
    const review = buildCredentialOcrReview(parsed.fields, { taxNo: '' })
    expect(review.some(field => field.conflict)).toBe(false)
    expect(resolveCredentialOcrReview(review)).toEqual({ taxNo: '91440000TEST123456' })
  })

  it('确认只接受所属候选身份和一项明确决定，旧内部编码目标不自动搬值', () => {
    const candidates = [{ id: 'tax-candidate', key: 'taxNo' as const, label: '税号', value: '91440000TEST123456', confidence: 0.9 }]
    expect(() => resolveCredentialOcrChoices(candidates, {}, [])).toThrow(/每个字段/)
    expect(() => resolveCredentialOcrChoices(candidates, {}, [{ key: 'taxNo', decision: 'use-recognized', candidateId: 'other' }])).toThrow(/候选/)
    expect(() => resolveCredentialOcrChoices(candidates, {}, [{ key: 'taxNo', decision: 'keep-current' }, { key: 'taxNo', decision: 'manual', manualValue: 'MANUAL' }])).toThrow(/一项/)
    const legacy = [{ id: 'old-code', key: 'uniqueCode' as const, label: '统一社会信用代码', value: '91440000TEST123456', confidence: 0.9 }]
    const review = buildCredentialOcrReview(legacy, { uniqueCode: 'INTERNAL', taxNo: 'TAX' })
    expect(review[0]).toMatchObject({ key: 'uniqueCode', label: '内部唯一识别码', sourceLabel: '统一社会信用代码', currentValue: 'INTERNAL', decision: 'keep-current' })
    expect(resolveCredentialOcrReview(review)).toEqual({ uniqueCode: 'INTERNAL' })
    expect(() => resolveCredentialOcrChoices(legacy, {}, [{ key: 'uniqueCode', decision: 'use-recognized', candidateId: 'old-code' }])).toThrow(/内部编码/)
    expect(resolveCredentialOcrChoices(legacy, {}, [{ key: 'uniqueCode', decision: 'manual', manualValue: 'CONFIRMED-INTERNAL' }])).toEqual({ uniqueCode: 'CONFIRMED-INTERNAL' })
    expect(legacy[0]!.key).toBe('uniqueCode')
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
