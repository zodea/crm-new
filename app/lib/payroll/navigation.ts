import type { WageStatementFilter, WageStatementStatus } from './statements'

type QueryValue = string | null | undefined | readonly (string | null)[]
type QueryLike = Record<string, QueryValue>

function firstQueryValue(value: QueryValue): string {
  if (Array.isArray(value))
    return value.find(item => typeof item === 'string') ?? ''
  return typeof value === 'string' ? value : ''
}

function normalizeStatus(value: string): WageStatementStatus | '' {
  return value === 'draft' || value === 'checked' || value === 'released'
    ? value
    : ''
}

export function payrollFiltersFromQuery(
  query: QueryLike,
  fallback: WageStatementFilter = {},
): WageStatementFilter {
  const month = firstQueryValue(query.month)
  return {
    projectId: firstQueryValue(query.project) || fallback.projectId || '',
    month: /^\d{4}-\d{2}$/.test(month) ? month : fallback.month || '',
    crewId: firstQueryValue(query.crew) || fallback.crewId || '',
    status: normalizeStatus(firstQueryValue(query.status)) || fallback.status || '',
  }
}

export function payrollFilterQuery(filters: WageStatementFilter): Record<string, string> {
  return Object.fromEntries(
    [
      ['project', filters.projectId],
      ['month', filters.month],
      ['crew', filters.crewId],
      ['status', filters.status],
    ].filter((entry): entry is [string, string] => Boolean(entry[1])),
  )
}

export const PAYROLL_LIST_PATH = '/subcontract/payroll'

export function payrollListLocation(filters: WageStatementFilter) {
  return {
    path: PAYROLL_LIST_PATH,
    query: payrollFilterQuery(filters),
  }
}

/**
 * 台账载入完成后，是否还应该把已解析的筛选写回地址栏。
 *
 * 载入是异步的，期间用户完全可能已经点进建单页或详情页。这时再补一次
 * `replace` 会把人从目标页拉回列表，看起来就像点击失效。
 *
 * 只比对 `currentPath` 不够：用户点击后导航要到确认阶段才会更新 route，
 * 载入恰好在这个窗口内结束时读到的仍是列表路径。因此还要看路由离开钩子
 * 是否已经触发（`hasLeftPage`），它在导航确认前就能给出答案。
 */
export function shouldSyncPayrollListUrl(
  currentPath: string,
  hasLeftPage = false,
): boolean {
  return !hasLeftPage && currentPath === PAYROLL_LIST_PATH
}

export function payrollDraftLocation(filters: WageStatementFilter) {
  return {
    path: '/subcontract/payroll/new',
    query: payrollFilterQuery(filters),
  }
}
