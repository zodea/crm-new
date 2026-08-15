// 发票归档前置校验(issue #57)——纯逻辑，vitest 直接断言，store 复用。
// 归档有两个独立的硬性前置，均不能只靠调用方（UI）按顺序调用来保证：
//   1. 已校对(DATABASE.md §2.4「核对完成是归档唯一前置」)——checkReviewed
//   2. 归属非空(ADR-0001 归属铁律；project 归属必须挂具体项目，personal 不挂项目也可归档)——checkArchiveOwnership

export interface ArchiveCheckResult {
  ok: boolean
  /** ok=false 时的失败原因，供 UI 直接展示 */
  reason?: string
}

/**
 * 票据当前值的来源留痕契约。
 *
 * 归档、台账和打印只读 current fields；原始 OCR、人工修订和来源文件由调用方
 * 单独保存到审计/来源记录，不得用修订后的值覆盖这些留痕。
 */
export interface InvoiceArchiveProvenance {
  sourceKind: 'ocr' | 'excel' | 'manual'
  sourceId: string
  sourceInfo: Readonly<Record<string, unknown>>
  originalOcr: Readonly<Record<string, unknown>> | null
  revisions: readonly {
    field: string
    from: unknown
    to: unknown
    reason: string
    at: string
  }[]
}

export interface InvoiceArchiveAuditRecord {
  invoiceId: string
  archivedAt: string
  currentValues: Readonly<Record<string, unknown>>
  provenance: InvoiceArchiveProvenance
}

/** 归档写路径使用的完整终态输入；可由 Invoice 映射，不接受 UI 自己拼校验结果。 */
export interface InvoiceArchiveCandidate {
  ocrStatus: unknown
  reviewStatus: unknown
  dupStatus: unknown
  ownerKind: unknown
  projectId: unknown
  invoiceNumber: unknown
  invoiceDate: unknown
  seller: unknown
  totalAmount: unknown
  /** 数据库唯一索引或导入复核发现的自然键冲突。 */
  naturalKeyDuplicate?: boolean
  /** 需要时由调用方显式传入；缺省时以 reviewStatus='reviewed' 为人工确认凭据。 */
  currentValuesConfirmed?: boolean
  provenance: InvoiceArchiveProvenance
}

export function checkReviewed(reviewStatus: unknown): ArchiveCheckResult {
  if (reviewStatus !== 'reviewed')
    return { ok: false, reason: '归档前需先完成校对确认' }
  return { ok: true }
}

/**
 * 重复票排除(#60):dup_status='duplicate' 的票在文档页标「重复已排除」,确认/归档写路径
 * 必须同口径拒绝——否则同号票双份计入 §4.2 台账合计。要重新入流需先「重新识别」洗掉重复标记
 * (识别完成会按当下库内发票号重算 dup_status)或废弃。
 */
export function checkNotDuplicate(dupStatus: unknown): ArchiveCheckResult {
  if (dupStatus === 'duplicate')
    return { ok: false, reason: '重复发票已排除，不可确认/归档' }
  return { ok: true }
}

export function checkArchiveOwnership(ownerKind: unknown, projectId: unknown): ArchiveCheckResult {
  if (ownerKind !== 'project' && ownerKind !== 'personal')
    return { ok: false, reason: '缺少归属（项目/个人开支），无法归档' }
  if (ownerKind === 'project' && !projectId)
    return { ok: false, reason: '归属为项目时需选择具体项目' }
  if (ownerKind === 'personal' && projectId)
    return { ok: false, reason: '个人开支不能同时挂项目归属' }
  return { ok: true }
}

function requiredText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function validPositiveAmount(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function validProvenance(value: InvoiceArchiveProvenance | undefined): boolean {
  if (!value || !requiredText(value.sourceId) || !value.sourceInfo || !Array.isArray(value.revisions))
    return false
  if (!['ocr', 'excel', 'manual'].includes(value.sourceKind))
    return false
  return value.sourceKind !== 'ocr' || value.originalOcr != null
}

/**
 * 票据进入归档/台账终态的唯一纯逻辑门禁。
 *
 * 注意：provenance 只作为留痕契约传递，不参与当前值计算；门禁拒绝的是未确认的
 * 当前值和不完整/冲突的事实，绝不把原始 OCR 或历史修订值静默带入台账。
 */
export function checkInvoiceArchiveReady(input: InvoiceArchiveCandidate): ArchiveCheckResult {
  const reasons: string[] = []
  const reviewed = checkReviewed(input.reviewStatus)
  if (!reviewed.ok)
    reasons.push(reviewed.reason!)

  if (input.ocrStatus !== 'done')
    reasons.push('识别尚未完成，不能进入归档终态')
  if (input.currentValuesConfirmed === false)
    reasons.push('当前字段尚未完成人工确认，不能进入归档终态')

  const duplicate = checkNotDuplicate(input.dupStatus)
  if (!duplicate.ok)
    reasons.push(duplicate.reason!)
  if (input.naturalKeyDuplicate)
    reasons.push('自然键重复，需先完成重复记录复核')

  const ownership = checkArchiveOwnership(input.ownerKind, input.projectId)
  if (!ownership.ok)
    reasons.push(ownership.reason!)

  if (!requiredText(input.invoiceNumber))
    reasons.push('缺少发票号码，不能进入归档终态')
  if (!requiredText(input.invoiceDate))
    reasons.push('缺少发票日期，不能进入归档终态')
  if (!requiredText(input.seller))
    reasons.push('缺少销售方，不能进入归档终态')
  if (!validPositiveAmount(input.totalAmount))
    reasons.push('价税合计缺失或金额异常，不能进入归档终态')
  if (!validProvenance(input.provenance))
    reasons.push('缺少原始识别、人工修订或来源留痕，不能进入归档终态')

  return reasons.length ? { ok: false, reason: [...new Set(reasons)].join('；') } : { ok: true }
}
