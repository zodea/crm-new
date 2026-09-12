import type { DataOriginDTO } from '../../types/read-model'
import type { PayrollQuery } from './central-contract'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollFiltersFromQuery } from './navigation'

export interface PayrollViewScope { origin: DataOriginDTO | null, projectId: string, month: string, crewId: string, status: string, dayworkStatus: string, format: string, deleted: string, search: string, tab: string, error: string }
export const PAYROLL_READ_QUERY_KEYS = ['origin', 'project', 'month', 'crew', 'status', 'dayworkStatus', 'format', 'deleted', 'search', 'tab'] as const
const paths = new Set(['/subcontract/payroll', '/subcontract/payroll/sources', '/subcontract/attendance', '/subcontract/daywork'])
export function payrollStatusSelection(value: string): string[] {
  const status = payrollFiltersFromQuery({ status: value }).status
  return Array.isArray(status) ? status : status ? [status] : []
}
export function payrollStatusQuery(statuses: readonly string[]): string {
  const selected = payrollStatusSelection(JSON.stringify(statuses))
  return selected.length > 1 ? JSON.stringify(selected) : selected[0] || ''
}
export function payrollViewScope(query: Record<string, unknown>): PayrollViewScope {
  const one = (key: string) => typeof query[key] === 'string' ? query[key] : ''
  const requestedOrigin = one('origin')
  const origin = query.origin == null ? 'real' : requestedOrigin === 'real' || requestedOrigin === 'demo' ? requestedOrigin : null
  const scope: PayrollViewScope = { origin, projectId: one('project'), month: one('month'), crewId: one('crew'), status: one('status'), dayworkStatus: one('dayworkStatus'), format: one('format'), deleted: one('deleted'), search: one('search'), tab: one('tab'), error: '' }
  scope.status = payrollStatusQuery(payrollStatusSelection(scope.status))
  if (!origin || PAYROLL_READ_QUERY_KEYS.some(key => Array.isArray(query[key])))
    scope.error = '工资来源参数无效，请从工资台账重新打开。'
  else if ((scope.projectId && !isStableRouteIdentity(scope.projectId)) || (scope.crewId && !isStableRouteIdentity(scope.crewId)))
    scope.error = '项目或班组身份无效，不能改用其他记录。'
  else if (scope.month && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(scope.month))
    scope.error = '月份无效，请重新选择。'
  return scope
}
export function payrollReadQuery(scope: PayrollViewScope, includeDemo: boolean): PayrollQuery {
  if (!scope.origin || scope.error)
    throw new Error(scope.error || '工资来源无效')
  return { origin: scope.origin, includeDemo, ...(scope.projectId ? { projectId: scope.projectId } : {}), ...(scope.month ? { month: scope.month } : {}), ...(scope.crewId ? { crewId: scope.crewId } : {}) }
}
export function payrollViewQuery(scope: PayrollViewScope): Record<string, string> {
  return Object.fromEntries(Object.entries({ origin: scope.origin, project: scope.projectId, month: scope.month, crew: scope.crewId, status: scope.status, dayworkStatus: scope.dayworkStatus, format: scope.format, deleted: scope.deleted, search: scope.search, tab: scope.tab }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''))
}
export function payrollReadLocation(path: string, scope: PayrollViewScope): string {
  return `${path}?${new URLSearchParams(payrollViewQuery(scope))}`
}
export function payrollReturnTo(value: unknown, origin: DataOriginDTO | null): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || !origin)
    return null
  try {
    const url = new URL(value, 'https://payroll.invalid')
    if (url.origin !== 'https://payroll.invalid' || url.hash || (!paths.has(url.pathname) && !/^\/subcontract\/payroll\/[^/]+$/.test(url.pathname)) || /\/(?:new|form)$/.test(url.pathname))
      return null
    const query: Record<string, unknown> = {}
    for (const key of url.searchParams.keys()) {
      if (url.searchParams.getAll(key).length !== 1)
        return null
      query[key] = url.searchParams.get(key)
    }
    const scope = payrollViewScope(query)
    if (!paths.has(url.pathname) && !isStableRouteIdentity(decodeURIComponent(url.pathname.split('/').at(-1) ?? '')))
      return null
    return scope.origin === origin && !scope.error ? payrollReadLocation(url.pathname, scope) : null
  }
  catch { return null }
}

export function payrollSourceReturnTo(value: unknown, scope: PayrollViewScope): string {
  const target = payrollReturnTo(value, scope.origin)
  return payrollReadLocation(target ? new URL(target, 'https://payroll.invalid').pathname : '/subcontract/payroll', scope)
}
