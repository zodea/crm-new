const DRAFT_STATUSES = new Set(['draft', '草稿'])

export interface OwnerChangeFormalState {
  status?: unknown
  approvalDate?: unknown
  sourceLocked?: unknown
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

/** 项目驾驶舱明细保留草稿可见，但所有经营合计统一排除显式草稿。 */
export function isDraftStatus(status: unknown): boolean {
  return DRAFT_STATUSES.has(text(status))
}

export function effectiveAmount(amount: unknown, status: unknown): number {
  const parsed = Number(amount)
  return !isDraftStatus(status) && Number.isFinite(parsed) ? parsed : 0
}

export function effectiveChildAmount(
  amount: unknown,
  status: unknown,
  parentStatus: unknown,
): number {
  return isDraftStatus(parentStatus) ? 0 : effectiveAmount(amount, status)
}

/** SQLite 侧与 effectiveAmount 保持同一口径；空状态兼容迁移前的正式历史记录。 */
export function nonDraftStatusSql(column: string): string {
  return `COALESCE(TRIM(${column}), '') NOT IN ('draft', '草稿')`
}

/**
 * 变洽签的“审定额”只纳入已经审定的事实：
 * - BOQ 审批同步产生的锁定台账；
 * - 状态已经 approved；
 * - 迁移前没有状态、但已有审定日期的历史台账。
 */
export function isFormalOwnerChange(row: OwnerChangeFormalState): boolean {
  return Number(row.sourceLocked) === 1
    || text(row.status) === 'approved'
    || text(row.approvalDate) !== ''
}

export function formalOwnerChangeSql(alias: string): string {
  return `(
    ${alias}.source_locked = 1
    OR ${alias}.status = 'approved'
    OR NULLIF(TRIM(${alias}.approval_date), '') IS NOT NULL
  )`
}
