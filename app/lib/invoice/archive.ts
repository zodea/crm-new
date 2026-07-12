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

export function checkArchiveOwnership(ownerKind: unknown, projectId: unknown): ArchiveCheckResult {
  if (ownerKind !== 'project' && ownerKind !== 'personal')
    return { ok: false, reason: '缺少归属（项目/个人开支），无法归档' }
  if (ownerKind === 'project' && !projectId)
    return { ok: false, reason: '归属为项目时需选择具体项目' }
  return { ok: true }
}
