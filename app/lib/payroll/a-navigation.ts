import type { DataOriginDTO } from '../../types/read-model'
import type { PayrollAFeeConfigScope } from './central-a-fees-contract'
import { isQuantitySourceIdentity } from '../quantity/migration-identity'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollAdjustmentReturn } from './adjustment-navigation'
import { PAYROLL_READ_QUERY_KEYS, payrollReturnTo, payrollViewScope } from './central-navigation'

export const PAYROLL_A_CONFIG_PATH = '/subcontract/payroll/config'
export const PAYROLL_SOURCE_KEYS = ['payrollReturnTo', 'payrollSourceKind', 'payrollSourceId', 'payrollProject'] as const
export type PayrollSourceKind = 'quantity-unit' | 'quantity-project' | 'worker' | 'crew'
export interface PayrollSourceContext { returnTo: string, kind: PayrollSourceKind, id: string, projectId: string, statementId: string | null, draftKey: string | null, configScope?: PayrollAFeeConfigScope }

export function payrollAEntryReturn(value: unknown, origin: DataOriginDTO | null, projectId?: string, depth = 0): string | null {
  if (typeof value !== 'string' || !origin || depth > 4)
    return null
  try {
    const url = new URL(value, 'https://payroll.invalid')
    const payroll = payrollReturnTo(value, origin)
    if (payroll) {
      const keys: readonly string[] = [...PAYROLL_READ_QUERY_KEYS, 'focus', 'returnTo']
      if ([...url.searchParams.keys()].some(key => !keys.includes(key)))
        return null
      const result = new URL(payroll, 'https://payroll.invalid')
      const focus = url.searchParams.get('focus')
      if (focus) {
        if (!isStableRouteIdentity(focus))
          return null
        result.searchParams.set('focus', focus)
      }
      const nested = url.searchParams.get('returnTo')
      if (nested) {
        const back = payrollAEntryReturn(nested, origin, projectId, depth + 1)
        if (!back)
          return null
        result.searchParams.set('returnTo', back)
      }
      return `${result.pathname}?${result.searchParams}`
    }
    const allowed = ['origin', 'project', 'building', 'month', 'view', 'trade', 'assignee']
    if (!value.startsWith('/') || url.origin !== 'https://payroll.invalid' || url.pathname !== '/subcontract/quantity' || url.hash || (url.searchParams.get('origin') ?? 'real') !== origin)
      return null
    if (!isStableRouteIdentity(url.searchParams.get('project')) || (projectId && url.searchParams.get('project') !== projectId))
      return null
    if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1))
      return null
    if (url.searchParams.has('view') && !['trade', 'crew'].includes(url.searchParams.get('view')!))
      return null
    return `${url.pathname}?${url.searchParams}`
  }
  catch { return null }
}

export function payrollSourceQuery(query: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(PAYROLL_SOURCE_KEYS.flatMap(key => typeof query[key] === 'string' ? [[key, query[key]]] : []))
}

export function payrollSourceContext(query: Record<string, unknown>, expected: { kind: PayrollSourceKind, id: string, origin: DataOriginDTO, projectId?: string }): PayrollSourceContext | null {
  const validSourceId = expected.kind === 'quantity-unit' ? isQuantitySourceIdentity(expected.id, 'units') : isStableRouteIdentity(expected.id)
  if (PAYROLL_SOURCE_KEYS.some(key => typeof query[key] !== 'string') || query.payrollSourceKind !== expected.kind || query.payrollSourceId !== expected.id || !validSourceId || !isStableRouteIdentity(query.payrollProject))
    return null
  if (expected.projectId && query.payrollProject !== expected.projectId)
    return null
  const returnTo = payrollAWorkspaceReturn(query.payrollReturnTo, expected.origin)
  if (!returnTo)
    return null
  const url = new URL(returnTo, 'https://payroll.invalid')
  const edit = /^\/subcontract\/payroll\/form\/([^/]+)$/.exec(url.pathname)
  const detail = /^\/subcontract\/payroll\/([^/]+)$/.exec(url.pathname)
  const statementId = edit ? decodeURIComponent(edit[1]!) : detail && !['new', 'config', 'sources'].includes(detail[1]!) ? decodeURIComponent(detail[1]!) : null
  const draftKey = url.pathname === '/subcontract/payroll/new' ? url.searchParams.get('draftKey') : null
  if (url.pathname === PAYROLL_A_CONFIG_PATH) {
    if (url.searchParams.get('project') !== query.payrollProject)
      return null
    const managementBookId = url.searchParams.get('managementBookId')
    return { returnTo, kind: expected.kind, id: expected.id, projectId: String(query.payrollProject), statementId: null, draftKey: null, configScope: { projectId: String(query.payrollProject), month: url.searchParams.get('month')!, crewId: url.searchParams.get('crew') || null, leaderWorkerId: url.searchParams.get('leader') || null, book: managementBookId ? { bookPurpose: 'management', managementBookId } : { bookPurpose: 'ordinary', managementBookId: null } } }
  }
  if (!statementId && !draftKey)
    return null
  return { returnTo, kind: expected.kind, id: expected.id, projectId: String(query.payrollProject), statementId, draftKey }
}

/** 写态返回仅供当前打开的工作页，不加入只读冷恢复白名单。 */
export function payrollAWorkspaceReturn(value: unknown, origin: DataOriginDTO | null): string | null {
  if (!origin || typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return null
  const readPath = payrollAEntryReturn(value, origin)
  try {
    const url = new URL(value, 'https://payroll.invalid')
    if (url.origin !== 'https://payroll.invalid' || url.hash)
      return null
    if (readPath && url.pathname.startsWith('/subcontract/payroll'))
      return readPath
    if (url.pathname === PAYROLL_A_CONFIG_PATH) {
      const keys = ['origin', 'project', 'month', 'crew', 'leader', 'managementBookId', 'focus', 'returnTo']
      if ([...url.searchParams.keys()].some(key => !keys.includes(key) || url.searchParams.getAll(key).length !== 1) || (url.searchParams.get('origin') ?? 'real') !== origin || !isStableRouteIdentity(url.searchParams.get('project')) || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(url.searchParams.get('month') ?? ''))
        return null
      if (['crew', 'leader', 'managementBookId', 'focus'].some(key => url.searchParams.has(key) && url.searchParams.get(key) !== '' && (!isStableRouteIdentity(url.searchParams.get(key)) || /[\\/]/.test(url.searchParams.get(key)!))))
        return null
      const back = url.searchParams.get('returnTo')
      // 配置只返回原工资工作页或其受限只读宿主，禁止配置嵌套自身。
      if (back) {
        const nested = new URL(back, 'https://payroll.invalid')
        if (nested.pathname === PAYROLL_A_CONFIG_PATH || !payrollAWorkspaceReturn(back, origin))
          return null
      }
      return `${url.pathname}?${url.searchParams}`
    }
    if (url.pathname.startsWith('/subcontract/payroll/') && payrollAdjustmentReturn(value, origin))
      return payrollAdjustmentReturn(value, origin)
    const edit = /^\/subcontract\/payroll\/form\/([^/]+)$/.exec(url.pathname)
    if (url.pathname !== '/subcontract/payroll/new' && !edit)
      return null
    if (edit && !isStableRouteIdentity(decodeURIComponent(edit[1]!)))
      return null
    for (const key of url.searchParams.keys()) {
      if (url.searchParams.getAll(key).length !== 1 || !['origin', 'draftKey', 'returnTo', 'project', 'month', 'crew', 'focus'].includes(key))
        return null
    }
    if (payrollViewScope(Object.fromEntries(url.searchParams)).origin !== origin)
      return null
    if (!edit && !isStableRouteIdentity(url.searchParams.get('draftKey')))
      return null
    const back = url.searchParams.get('returnTo')
    if (back && !payrollAdjustmentReturn(back, origin))
      return null
    return `${url.pathname}?${url.searchParams}`
  }
  catch { return null }
}
