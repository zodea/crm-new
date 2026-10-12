const DRAFT_STATUSES = new Set(['draft', '草稿'])

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

/** 项目驾驶舱明细保留草稿可见，但所有经营合计统一排除显式草稿。 */
export function isDraftStatus(status: unknown): boolean {
  return DRAFT_STATUSES.has(text(status))
}
