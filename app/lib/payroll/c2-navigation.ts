import type { DataOriginDTO } from '../../types/read-model'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollAEntryReturn } from './a-navigation'
import { PAYROLL_READ_QUERY_KEYS, payrollViewScope } from './central-navigation'

export const PAYROLL_C2_SOURCE_KEYS = ['payrollReturnTo', 'payrollSourceKind', 'payrollSourceId', 'payrollProject', 'payrollFormat'] as const
export function payrollDayworkReturn(value: unknown, origin: DataOriginDTO): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return null
  try {
    const url = new URL(value, 'https://payroll.invalid')
    const allowed: readonly string[] = [...PAYROLL_READ_QUERY_KEYS, ...PAYROLL_C2_SOURCE_KEYS, 'worker', 'workDate', 'record']
    if (url.origin !== 'https://payroll.invalid' || url.pathname !== '/subcontract/daywork' || url.hash || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1 || !allowed.includes(key)))
      return null
    const query = Object.fromEntries(url.searchParams)
    const scope = payrollViewScope(query)
    if (scope.origin !== origin || scope.error)
      return null
    if (url.searchParams.has('record') && (!isStableRouteIdentity(query.record) || !isStableRouteIdentity(query.worker) || !/^\d{4}-\d{2}-\d{2}$/.test(query.workDate || '')))
      return null
    if (url.searchParams.has('payrollFormat') && !payrollC2SourceContext(query, { kind: 'daywork', id: query.record || '', origin, projectId: scope.projectId }))
      return null
    return `${url.pathname}?${url.searchParams}`
  }
  catch { return null }
}
export function payrollC2WorkspaceReturn(value: unknown, origin: DataOriginDTO): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return null
  try {
    const url = new URL(value, 'https://payroll.invalid')
    if (url.origin !== 'https://payroll.invalid' || url.hash || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1))
      return null
    const format = url.searchParams.get('format')
    if (format !== 'C2')
      return null
    const read = payrollAEntryReturn(value, origin)
    if (read && url.pathname.startsWith('/subcontract/payroll'))
      return read
    const edit = /^\/subcontract\/payroll\/form\/([^/]+)$/.exec(url.pathname)
    if (url.pathname !== '/subcontract/payroll/new' && !edit)
      return null
    if (edit && !isStableRouteIdentity(decodeURIComponent(edit[1]!)))
      return null
    const allowed: readonly string[] = [...PAYROLL_READ_QUERY_KEYS, 'draftKey', 'returnTo', 'focus']
    if ([...url.searchParams.keys()].some(key => !allowed.includes(key)))
      return null
    const scope = payrollViewScope(Object.fromEntries(url.searchParams))
    if (scope.origin !== origin || scope.error || (!edit && !isStableRouteIdentity(url.searchParams.get('draftKey'))))
      return null
    const focus = url.searchParams.get('focus')
    if (focus && !isStableRouteIdentity(focus))
      return null
    const back = url.searchParams.get('returnTo')
    if (back && !payrollAEntryReturn(back, origin))
      return null
    return `${url.pathname}?${url.searchParams}`
  }
  catch { return null }
}
export function payrollC2SourceContext(query: Record<string, unknown>, expected: { kind: 'daywork' | 'worker' | 'crew', id: string, origin: DataOriginDTO, projectId?: string }) {
  const back = payrollC2WorkspaceReturn(query.payrollReturnTo, expected.origin)
  if (!back || query.payrollFormat !== 'C2' || query.payrollSourceKind !== expected.kind || query.payrollSourceId !== expected.id || !isStableRouteIdentity(query.payrollProject) || (expected.projectId !== undefined && query.payrollProject !== expected.projectId))
    return null
  if (PAYROLL_C2_SOURCE_KEYS.some(key => typeof query[key] !== 'string'))
    return null
  const url = new URL(back, 'https://payroll.invalid')
  const edit = /^\/subcontract\/payroll\/form\/([^/]+)$/.exec(url.pathname)
  const detail = /^\/subcontract\/payroll\/([^/]+)$/.exec(url.pathname)
  const statementId = edit?.[1] ?? (detail && !['new', 'sources', 'config'].includes(detail[1]!) ? detail[1]! : null)
  const draftKey = statementId ? null : url.searchParams.get('draftKey')
  if ((!statementId && !isStableRouteIdentity(draftKey)) || (statementId && !isStableRouteIdentity(decodeURIComponent(statementId))))
    return null
  return { returnTo: back, kind: expected.kind, id: expected.id, projectId: String(query.payrollProject), statementId: statementId ? decodeURIComponent(statementId) : null, draftKey }
}
