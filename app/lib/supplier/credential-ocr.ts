import type { OcrRecognitionResult } from '~/lib/recognize/engine'
import type { SupplierCredentialCategory } from '~/lib/supplier/detail'

export type CredentialOcrFieldKey
  = | 'name'
    | 'uniqueCode'
    | 'taxNo'
    | 'legalRep'
    | 'address'
    | 'bank'
    | 'bankAccount'
    | 'validFrom'
    | 'expiresAt'

export type CredentialOcrDecision = 'keep-current' | 'use-recognized' | 'manual'

export interface CredentialCategorySuggestion {
  category: SupplierCredentialCategory
  confidence: number
  evidence: string[]
}

export interface CredentialOcrCandidate {
  key: CredentialOcrFieldKey
  label: string
  value: string
  confidence: number
}

export interface CredentialOcrReviewField extends CredentialOcrCandidate {
  currentValue: string
  decision: CredentialOcrDecision
  manualValue: string
  conflict: boolean
}

export interface ParsedCredentialOcr {
  rawText: string
  category: CredentialCategorySuggestion
  fields: CredentialOcrCandidate[]
  longTerm: boolean
}

const FIELD_LABEL: Record<CredentialOcrFieldKey, string> = {
  name: '公司名称',
  uniqueCode: '统一社会信用代码',
  taxNo: '纳税人识别号',
  legalRep: '法定代表人',
  address: '注册地址',
  bank: '开户行',
  bankAccount: '银行账号',
  validFrom: '生效日期',
  expiresAt: '到期日期',
}

const CATEGORY_RULES: Array<{
  category: SupplierCredentialCategory
  patterns: RegExp[]
}> = [
  {
    category: '营业执照',
    patterns: [/营业执照/, /统一社会信用代码/, /法定代表人/, /经营范围/],
  },
  {
    category: '法人身份证',
    patterns: [/居民身份证/, /身份证/, /公民身份号码/, /签发机关/, /有效期限/],
  },
  {
    category: '银行账户资料' as SupplierCredentialCategory,
    patterns: [/基本存款账户信息/, /开户许可证/, /开户银行/, /基本存款账户编号/],
  },
  {
    category: '资质证书' as SupplierCredentialCategory,
    patterns: [/资质证书/, /资质类别/, /资质等级/, /许可范围/],
  },
  {
    category: '品牌授权书' as SupplierCredentialCategory,
    patterns: [/品牌授权(?:书|证明)?/, /授权期限/, /被授权/],
  },
]

const FIELD_RULES: Array<{
  key: CredentialOcrFieldKey
  patterns: RegExp[]
}> = [
  {
    key: 'uniqueCode',
    patterns: [
      /统一社会信用代码(?:\/注册号)?[ \t]*[:：][ \t]*([0-9A-Z]{18})/,
      /统一社会信用代码(?:\/注册号)?[ \t]+([0-9A-Z]{18})/,
    ],
  },
  {
    key: 'taxNo',
    patterns: [
      /(?:纳税人识别号|税号)[ \t]*[:：][ \t]*([0-9A-Z]{15,20})/,
      /(?:纳税人识别号|税号)[ \t]+([0-9A-Z]{15,20})/,
    ],
  },
  {
    key: 'name',
    patterns: [
      /(?:^|\n)[ \t]*(?:企业名称|公司名称|单位名称|名称)[ \t]*[:：][ \t]*([^\n|]{2,80})/,
    ],
  },
  {
    key: 'legalRep',
    patterns: [
      /法定代表人[ \t]*[:：][ \t]*([^\s|，,]{2,20})/,
      /法定代表人[ \t]+([^\s|，,]{2,20})/,
    ],
  },
  {
    key: 'address',
    patterns: [
      /(?:注册地址|住所)[ \t]*[:：][ \t]*([^\n|]{4,120})/,
    ],
  },
  {
    key: 'bank',
    patterns: [
      /(?:开户银行|开户行名称|开户行)[ \t]*[:：][ \t]*([^\n|]{4,80})/,
    ],
  },
  {
    key: 'bankAccount',
    patterns: [
      /(?:银行账号|账户号码|账号|基本存款账户编号)[ \t]*[:：][ \t]*(\d[\d \t-]{7,30})/,
      /(?:银行账号|账户号码|账号|基本存款账户编号)[ \t]+(\d[\d \t-]{7,30})/,
    ],
  },
  {
    key: 'validFrom',
    patterns: [
      /(?:有效期自|有效期限自|生效日期)[ \t]*[:：][ \t]*(\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?)/,
      /(?:有效期自|有效期限自|生效日期)[ \t]+(\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?)/,
    ],
  },
  {
    key: 'expiresAt',
    patterns: [
      /(?:有效期至|有效期限至|到期日期)[ \t]*[:：][ \t]*(\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?)/,
      /(?:有效期至|有效期限至|到期日期)[ \t]+(\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?)/,
    ],
  },
]

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))))
}

function normalizeText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeDate(value: string): string {
  const match = value.match(/(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})/)
  if (!match)
    return value.trim()
  return `${match[1]}-${match[2]?.padStart(2, '0')}-${match[3]?.padStart(2, '0')}`
}

function normalizeFieldValue(key: CredentialOcrFieldKey, value: string): string {
  const trimmed = value.trim().replace(/[；;，,。]+$/, '')
  if (key === 'bankAccount')
    return trimmed.replace(/[\s-]/g, '')
  if (key === 'validFrom' || key === 'expiresAt')
    return normalizeDate(trimmed)
  return trimmed
}

export function suggestCredentialCategory(
  text: string,
  fileName = '',
): CredentialCategorySuggestion {
  const source = `${fileName}\n${text}`
  const ranked = CATEGORY_RULES
    .map((rule) => {
      const evidence = rule.patterns
        .filter(pattern => pattern.test(source))
        .map(pattern => pattern.source)
      return { category: rule.category, evidence }
    })
    .sort((left, right) => right.evidence.length - left.evidence.length)
  const best = ranked[0]
  if (!best || best.evidence.length === 0) {
    return {
      category: '其他',
      confidence: 0.2,
      evidence: [],
    }
  }
  return {
    ...best,
    confidence: clampConfidence(0.48 + best.evidence.length * 0.13),
  }
}

export function parseCredentialOcr(
  result: OcrRecognitionResult,
  fileName = '',
): ParsedCredentialOcr {
  const rawText = normalizeText(result.markdownPages.join('\n'))
  const category = suggestCredentialCategory(rawText, fileName)
  const fields = FIELD_RULES.flatMap(({ key, patterns }) => {
    const match = patterns.map(pattern => rawText.match(pattern)).find(Boolean)
    if (!match?.[1])
      return []
    return [{
      key,
      label: FIELD_LABEL[key],
      value: normalizeFieldValue(key, match[1]),
      confidence: 0.9,
    }]
  })
  if (category.category === '法人身份证' && !fields.some(field => field.key === 'legalRep')) {
    const name = rawText.match(/(?:^|\n)[ \t]*姓名[ \t]*[:：][ \t]*([^\s|，,]{2,20})/)
      ?? rawText.match(/(?:^|\n)[ \t]*姓名[ \t]+([^\s|，,]{2,20})/)
    if (name?.[1]) {
      fields.push({
        key: 'legalRep',
        label: FIELD_LABEL.legalRep,
        value: normalizeFieldValue('legalRep', name[1]),
        confidence: 0.9,
      })
    }
  }
  const validityRange = rawText.match(
    /(?:有效期限|有效期)[ \t]*[:：][ \t]*(\d{4}[./-]\d{1,2}[./-]\d{1,2})[ \t]*[至—-][ \t]*(\d{4}[./-]\d{1,2}[./-]\d{1,2}|长期)/,
  )
  ?? rawText.match(
    /(?:有效期限|有效期)[ \t]+(\d{4}[./-]\d{1,2}[./-]\d{1,2})[ \t]*[至—-][ \t]*(\d{4}[./-]\d{1,2}[./-]\d{1,2}|长期)/,
  )
  if (validityRange?.[1] && !fields.some(field => field.key === 'validFrom')) {
    fields.push({
      key: 'validFrom',
      label: FIELD_LABEL.validFrom,
      value: normalizeFieldValue('validFrom', validityRange[1]),
      confidence: 0.9,
    })
  }
  if (validityRange?.[2] && validityRange[2] !== '长期'
    && !fields.some(field => field.key === 'expiresAt')) {
    fields.push({
      key: 'expiresAt',
      label: FIELD_LABEL.expiresAt,
      value: normalizeFieldValue('expiresAt', validityRange[2]),
      confidence: 0.9,
    })
  }
  return {
    rawText,
    category,
    fields,
    longTerm: validityRange?.[2] === '长期'
      || (/长期|无固定期限/.test(rawText)
        && /有效期|营业期限/.test(rawText)),
  }
}

export function buildCredentialOcrReview(
  candidates: readonly CredentialOcrCandidate[],
  currentValues: Partial<Record<CredentialOcrFieldKey, string | null | undefined>>,
): CredentialOcrReviewField[] {
  return candidates.map((candidate) => {
    const currentValue = String(currentValues[candidate.key] ?? '').trim()
    const conflict = currentValue !== '' && currentValue !== candidate.value
    return {
      ...candidate,
      currentValue,
      conflict,
      decision: conflict ? 'keep-current' : 'use-recognized',
      manualValue: '',
    }
  })
}

export function resolveCredentialOcrReview(
  fields: readonly CredentialOcrReviewField[],
): Partial<Record<CredentialOcrFieldKey, string>> {
  const resolved: Partial<Record<CredentialOcrFieldKey, string>> = {}
  for (const field of fields) {
    const value = field.decision === 'keep-current'
      ? field.currentValue
      : field.decision === 'manual'
        ? field.manualValue.trim()
        : field.value
    if (value)
      resolved[field.key] = value
  }
  return resolved
}
