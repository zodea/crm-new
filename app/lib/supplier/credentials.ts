export const SUPPLIER_CREDENTIAL_CATEGORIES = [
  '营业执照',
  '法人身份证',
  '银行账户资料',
  '签约代表身份证',
  '资质证书',
  '品牌授权书',
  '合同模板',
  '完税证明',
  '过往业绩合同',
  '施工照片',
  '其他',
] as const

export type SupplierCredentialCategory = (typeof SUPPLIER_CREDENTIAL_CATEGORIES)[number]
export type SupplierCredentialRequirement = 'not_applicable' | 'optional' | 'required'
export type SupplierCredentialExpiryState = 'expired' | 'expiring' | 'valid' | 'unrecorded'
export type AutomaticCredentialStatus = 'incomplete' | 'reviewing'

export interface SupplierCredentialRequirementFact {
  category: SupplierCredentialCategory
  requirement: SupplierCredentialRequirement
  reason?: string
}

export interface SupplierCredentialStatusFact {
  category: string
  hasAccessibleFile: boolean
  expiresAt?: string | null
  longTerm?: boolean
}

export const REQUIRED_SUPPLIER_CREDENTIALS: readonly SupplierCredentialCategory[] = [
  '营业执照',
  '法人身份证',
  '银行账户资料',
]

const CATEGORY_ALIASES: Readonly<Record<string, SupplierCredentialCategory>> = {
  营业执照: '营业执照',
  法人身份证: '法人身份证',
  法定代表人身份证: '法人身份证',
  银行账户资料: '银行账户资料',
  银行开户许可证: '银行账户资料',
  开户许可证: '银行账户资料',
  基本存款账户信息: '银行账户资料',
  基本存款账户信息表: '银行账户资料',
  签约代表身份证: '签约代表身份证',
  资质证书: '资质证书',
  品牌授权书: '品牌授权书',
  品牌授权证明: '品牌授权书',
  合同模板: '合同模板',
  完税证明: '完税证明',
  过往业绩合同: '过往业绩合同',
  施工照片: '施工照片',
  其他: '其他',
}

export function canonicalCredentialCategory(value: string): SupplierCredentialCategory {
  return CATEGORY_ALIASES[value.trim()] ?? '其他'
}

export function defaultCredentialRequirement(
  category: string,
): SupplierCredentialRequirement {
  const canonical = canonicalCredentialCategory(category)
  if (REQUIRED_SUPPLIER_CREDENTIALS.includes(canonical))
    return 'required'
  if (canonical === '签约代表身份证' || canonical === '资质证书' || canonical === '品牌授权书')
    return 'not_applicable'
  return 'optional'
}

function isoDate(value: string | null | undefined): string {
  const normalized = value?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized))
    return ''
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized ? normalized : ''
}

function utcDay(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year!, month! - 1, day!)
}

export function shanghaiBusinessDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export function credentialExpiryState(
  credential: Pick<SupplierCredentialStatusFact, 'expiresAt' | 'longTerm'>,
  now: Date = new Date(),
): SupplierCredentialExpiryState {
  if (credential.longTerm)
    return 'valid'

  const expiresAt = isoDate(credential.expiresAt)
  if (!expiresAt)
    return 'unrecorded'

  const today = shanghaiBusinessDate(now)
  const days = Math.round((utcDay(expiresAt) - utcDay(today)) / 86_400_000)
  if (days < 0)
    return 'expired'
  return days <= 7 ? 'expiring' : 'valid'
}

export function credentialValidityProjection(credential: Pick<SupplierCredentialStatusFact, 'expiresAt' | 'longTerm'>, now: Date = new Date()) {
  const state = credentialExpiryState(credential, now)
  return {
    businessDate: shanghaiBusinessDate(now),
    state,
    reason: credential.longTerm
      ? 'long-term' as const
      : state === 'unrecorded'
        ? (credential.expiresAt?.trim() ? 'invalid-date' as const : 'missing-date' as const)
        : state === 'expired' ? 'expired' as const : state === 'expiring' ? 'within-seven-days' as const : 'outside-warning-window' as const,
  }
}

function requirementMap(
  requirements: readonly SupplierCredentialRequirementFact[],
): Map<SupplierCredentialCategory, SupplierCredentialRequirement> {
  const result = new Map<SupplierCredentialCategory, SupplierCredentialRequirement>()
  for (const requirement of requirements) {
    result.set(
      canonicalCredentialCategory(requirement.category),
      requirement.requirement,
    )
  }
  return result
}

export function resolveAutomaticCredentialStatus(
  credentials: readonly SupplierCredentialStatusFact[],
  requirements: readonly SupplierCredentialRequirementFact[] = [],
  now: Date = new Date(),
): AutomaticCredentialStatus {
  const overrides = requirementMap(requirements)
  const required = SUPPLIER_CREDENTIAL_CATEGORIES.filter(category =>
    (overrides.get(category) ?? defaultCredentialRequirement(category)) === 'required',
  )

  const complete = required.every(category =>
    credentials.some(credential =>
      canonicalCredentialCategory(credential.category) === category
      && credential.hasAccessibleFile
      && credentialExpiryState(credential, now) !== 'expired',
    ),
  )
  return complete ? 'reviewing' : 'incomplete'
}

/** 兼容旧调用点：只有类别事实时仍只能算出自动态，绝不自动产生人工合格。 */
export function resolveCredentialStatus(
  categories: readonly string[],
): AutomaticCredentialStatus {
  return resolveAutomaticCredentialStatus(categories.map(category => ({
    category,
    hasAccessibleFile: true,
  })))
}

export function hasManualCredentialReviewProof(input: {
  status: string
  reviewedAt: string | null
  reviewNote: string
}): boolean {
  if (!input.reviewedAt?.trim())
    return false
  if (input.status === 'qualified')
    return true
  return input.status === 'rejected' && Boolean(input.reviewNote.trim())
}

/** 原 Native 库只读投影：人工凭证字段保留原义，不回写状态、时间或审计。 */
export function storedSupplierCredentialStatus(
  proof: { status: string, reviewedAt: string | null, reviewNote: string },
  credentials: readonly SupplierCredentialStatusFact[],
  requirements: readonly SupplierCredentialRequirementFact[],
  now: Date,
): string {
  const automatic = resolveAutomaticCredentialStatus(credentials, requirements, now)
  if (automatic === 'incomplete' || !hasManualCredentialReviewProof(proof))
    return automatic
  const reviewedAt = new Date(proof.reviewedAt!)
  if (!Number.isFinite(reviewedAt.getTime()))
    return automatic
  const required = requirementMap(requirements)
  const expiredSinceReview = credentials.some(row =>
    (required.get(canonicalCredentialCategory(row.category)) ?? defaultCredentialRequirement(row.category)) === 'required'
    && row.hasAccessibleFile && credentialExpiryState(row, reviewedAt) !== 'expired' && credentialExpiryState(row, now) === 'expired',
  )
  return expiredSinceReview ? automatic : proof.status
}
