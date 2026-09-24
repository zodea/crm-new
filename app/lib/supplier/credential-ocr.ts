import type { OcrRecognitionResult } from '~/lib/recognize/engine'
import type { SupplierCredentialCategory } from '~/lib/supplier/detail'

export const CREDENTIAL_OCR_FIELD_KEYS = ['name', 'uniqueCode', 'taxNo', 'legalRep', 'address', 'bank', 'bankAccount', 'validFrom', 'expiresAt'] as const
export type CredentialOcrFieldKey = typeof CREDENTIAL_OCR_FIELD_KEYS[number]

export type CredentialOcrDecision = 'keep-current' | 'use-recognized' | 'manual'

export interface CredentialCategorySuggestion {
  category: SupplierCredentialCategory
  confidence: number
  evidence: string[]
}

export interface CredentialOcrCandidate {
  /** 旧候选可无 ID；新解析结果始终提供与同份识别结果绑定的稳定 ID。 */
  id?: string
  key: CredentialOcrFieldKey
  label: string
  sourceLabel?: string
  value: string
  confidence: number
}

export interface CredentialOcrReviewField extends CredentialOcrCandidate {
  currentValue: string
  decision: CredentialOcrDecision
  manualValue: string
  conflict: boolean
}

export interface CredentialOcrReviewGroup {
  key: CredentialOcrFieldKey
  label: string
  currentValue: string
  candidates: CredentialOcrCandidate[]
  conflict: boolean
  decision: CredentialOcrDecision
  candidateId: string
  manualValue: string
}

export type CredentialOcrFieldChoice
  = | { key: CredentialOcrFieldKey, decision: 'keep-current' }
    | { key: CredentialOcrFieldKey, decision: 'use-recognized', candidateId: string }
    | { key: CredentialOcrFieldKey, decision: 'manual', manualValue: string }

export interface CredentialOcrReviewDraft {
  choices: CredentialOcrFieldChoice[]
  categoryDecision: CredentialOcrDecision
  manualCategory: SupplierCredentialCategory
  longTermDecision: CredentialOcrDecision
  manualLongTerm: boolean
}

export interface ParsedCredentialOcr {
  rawText: string
  category: CredentialCategorySuggestion
  fields: CredentialOcrCandidate[]
  longTerm: boolean
}

export const CREDENTIAL_OCR_FIELD_LABELS: Record<CredentialOcrFieldKey, string> = {
  name: '公司名称',
  uniqueCode: '内部唯一识别码',
  taxNo: '统一社会信用代码 / 税号',
  legalRep: '法定代表人',
  address: '注册地址',
  bank: '开户行',
  bankAccount: '银行账号',
  validFrom: '生效日期',
  expiresAt: '到期日期',
}
const FIELD_LABEL = CREDENTIAL_OCR_FIELD_LABELS

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
    key: 'taxNo',
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
  const fields: CredentialOcrCandidate[] = []
  for (const { key, patterns } of FIELD_RULES) {
    for (const pattern of patterns) {
      for (const match of rawText.matchAll(new RegExp(pattern.source, 'g'))) {
        if (!match[1])
          continue
        const value = normalizeFieldValue(key, match[1])
        const sourceLabel = match[0].slice(0, match[0].lastIndexOf(match[1])).trim().replace(/[：:]$/, '').trim()
        if (!fields.some(field => field.key === key && field.value === value && field.sourceLabel === sourceLabel))
          fields.push({ key, label: FIELD_LABEL[key], sourceLabel, value, confidence: 0.9 })
      }
    }
  }
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
    fields: fields.map((field, index) => ({ ...field, id: `ocr-${field.key}-${index}`, sourceLabel: field.sourceLabel ?? field.label })),
    longTerm: validityRange?.[2] === '长期'
      || (/长期|无固定期限/.test(rawText)
        && /有效期|营业期限/.test(rawText)),
  }
}

export function buildCredentialOcrReview(
  candidates: readonly CredentialOcrCandidate[],
  currentValues: Partial<Record<CredentialOcrFieldKey, string | null | undefined>>,
): CredentialOcrReviewField[] {
  return candidates.map((candidate, index) => {
    const currentValue = String(currentValues[candidate.key] ?? '').trim()
    const conflict = candidate.key === 'uniqueCode'
      || (currentValue !== '' && currentValue !== candidate.value)
      || new Set(candidates.filter(field => field.key === candidate.key).map(field => field.value)).size > 1
    return {
      ...candidate,
      id: candidate.id ?? `legacy-${candidate.key}-${index}`,
      sourceLabel: candidate.sourceLabel ?? candidate.label,
      label: FIELD_LABEL[candidate.key],
      currentValue,
      conflict,
      decision: conflict || candidates.findIndex(field => field.key === candidate.key) !== index ? 'keep-current' : 'use-recognized',
      manualValue: '',
    }
  })
}

export function resolveCredentialOcrReview(
  fields: readonly CredentialOcrReviewField[],
): Partial<Record<CredentialOcrFieldKey, string>> {
  const candidates = fields.map((field, index) => ({ ...field, id: field.id ?? `legacy-${field.key}-${index}` }))
  const choices: CredentialOcrFieldChoice[] = [...new Set(fields.map(field => field.key))].map((key) => {
    const selected = candidates.filter(field => field.key === key && field.decision !== 'keep-current')
    if (selected.length > 1)
      throw new Error(`${FIELD_LABEL[key]}只能确认一个候选或一项人工值`)
    const field = selected[0]
    return !field
      ? { key, decision: 'keep-current' }
      : field.decision === 'manual'
        ? { key, decision: 'manual', manualValue: field.manualValue }
        : { key, decision: 'use-recognized', candidateId: field.id }
  })
  return resolveCredentialOcrChoices(candidates, Object.fromEntries(fields.map(field => [field.key, field.currentValue])), choices)
}

/** 只由候选身份与明确决定解析值；不接受客户端另传的“最终识别值”。 */
export function resolveCredentialOcrChoices(
  candidates: readonly CredentialOcrCandidate[],
  currentValues: Partial<Record<CredentialOcrFieldKey, string | null | undefined>>,
  choices: readonly CredentialOcrFieldChoice[],
): Partial<Record<CredentialOcrFieldKey, string>> {
  const ids = candidates.map(field => field.id)
  if (ids.some(id => !id) || new Set(ids).size !== ids.length)
    throw new Error('识别候选身份缺失或重复，请重新识别后核对')
  const keys = new Set(choices.map(choice => choice.key))
  if (keys.size !== choices.length || candidates.some(candidate => !keys.has(candidate.key)))
    throw new Error('每个字段必须提供且只提供一项人工决定')
  const resolved: Partial<Record<CredentialOcrFieldKey, string>> = {}
  for (const choice of choices) {
    if (!Object.hasOwn(FIELD_LABEL, choice.key))
      throw new Error('人工核对字段无效')
    let value: string
    if (choice.decision === 'keep-current') {
      value = String(currentValues[choice.key] ?? '').trim()
    }
    else if (choice.decision === 'manual') {
      value = choice.manualValue.trim()
      if (!value && choice.key !== 'validFrom' && choice.key !== 'expiresAt')
        throw new Error(`请填写${FIELD_LABEL[choice.key]}手工确认值`)
    }
    else if (choice.decision === 'use-recognized') {
      const candidate = candidates.find(candidate => candidate.id === choice.candidateId && candidate.key === choice.key)
      if (!candidate || !candidate.value || choice.key === 'uniqueCode')
        throw new Error('候选与确认字段不一致，历史内部编码候选不能直接采用，请重新识别或人工核对')
      value = candidate.value
    }
    else { throw new Error('人工核对决定无效') }
    if (value || choice.decision === 'manual')
      resolved[choice.key] = value
  }
  return resolved
}
