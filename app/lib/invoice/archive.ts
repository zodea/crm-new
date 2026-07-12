// 发票归档前置校验(issue #57)——纯逻辑，vitest 直接断言，store 复用。
// 归档有两个独立的硬性前置，均不能只靠调用方（UI）按顺序调用来保证：
//   1. 已校对(DATABASE.md §2.4「核对完成是归档唯一前置」)——checkReviewed
//   2. 归属非空(ADR-0001 归属铁律；project 归属必须挂具体项目，personal 不挂项目也可归档)——checkArchiveOwnership

export interface ArchiveCheckResult {
  ok: boolean
  /** ok=false 时的失败原因，供 UI 直接展示 */
  reason?: string
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
  return { ok: true }
}
