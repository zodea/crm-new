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
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : ''
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
  return days <= 30 ? 'expiring' : 'valid'
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

export async function revalidateSupplierCredentialStatuses(
  db: { execute: (sql: string, params?: unknown[]) => Promise<void> },
  businessDate: string = shanghaiBusinessDate(),
): Promise<void> {
  await db.execute(`
    WITH automatic_status AS (
      SELECT supplier.id,
             CASE
               WHEN NOT EXISTS (
                 SELECT required.category
                 FROM (
                   SELECT '营业执照' AS category
                   UNION ALL SELECT '法人身份证'
                   UNION ALL SELECT '银行账户资料'
                 ) AS required
                 WHERE COALESCE((
                   SELECT requirement.requirement
                   FROM supplier_credential_requirements AS requirement
                   WHERE requirement.supplier_id = supplier.id
                     AND requirement.category = required.category
                     AND requirement.deleted_at IS NULL
                   LIMIT 1
                 ), 'required') = 'required'
                   AND NOT EXISTS (
                     SELECT 1
                     FROM supplier_credentials AS credential
                     WHERE credential.supplier_id = supplier.id
                       AND credential.category = required.category
                       AND credential.deleted_at IS NULL
                       AND (
                         credential.long_term = 1
                         OR trim(credential.expires_at) = ''
                         OR credential.expires_at >= ?
                       )
                       AND EXISTS (
                         SELECT 1
                         FROM file_refs AS file
                         JOIN file_payloads AS payload ON payload.file_ref_id = file.id
                         WHERE file.id = credential.file_ref_id
                           AND file.owner_type = 'supplier_credential'
                           AND file.owner_id = credential.id
                           AND file.deleted_at IS NULL
                       )
                   )
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM supplier_credential_requirements AS requirement
                 WHERE requirement.supplier_id = supplier.id
                   AND requirement.requirement = 'required'
                   AND requirement.deleted_at IS NULL
                   AND NOT EXISTS (
                     SELECT 1
                     FROM supplier_credentials AS credential
                     WHERE credential.supplier_id = supplier.id
                       AND credential.category = requirement.category
                       AND credential.deleted_at IS NULL
                       AND (
                         credential.long_term = 1
                         OR trim(credential.expires_at) = ''
                         OR credential.expires_at >= ?
                       )
                       AND EXISTS (
                         SELECT 1
                         FROM file_refs AS file
                         JOIN file_payloads AS payload ON payload.file_ref_id = file.id
                         WHERE file.id = credential.file_ref_id
                           AND file.owner_type = 'supplier_credential'
                           AND file.owner_id = credential.id
                           AND file.deleted_at IS NULL
                       )
                   )
               )
               THEN 'reviewing'
               ELSE 'incomplete'
             END AS status
      FROM suppliers AS supplier
      WHERE supplier.deleted_at IS NULL
    )
    UPDATE suppliers
    SET credential_status = (
          SELECT status FROM automatic_status WHERE automatic_status.id = suppliers.id
        ),
        credential_reviewed_at = NULL,
        credential_review_note = ''
    WHERE id IN (
      SELECT supplier.id
      FROM suppliers AS supplier
      JOIN automatic_status ON automatic_status.id = supplier.id
      WHERE (
        supplier.credential_status IN ('incomplete', 'reviewing')
        AND (
          supplier.credential_status <> automatic_status.status
          OR supplier.credential_reviewed_at IS NOT NULL
          OR trim(supplier.credential_review_note) <> ''
        )
      )
      OR (
        supplier.credential_status = 'qualified'
        AND (
          supplier.credential_reviewed_at IS NULL
          OR automatic_status.status = 'incomplete'
        )
      )
      OR (
        supplier.credential_status = 'rejected'
        AND (
          supplier.credential_reviewed_at IS NULL
          OR trim(supplier.credential_review_note) = ''
          OR automatic_status.status = 'incomplete'
        )
      )
    )
  `, [businessDate, businessDate])
}
