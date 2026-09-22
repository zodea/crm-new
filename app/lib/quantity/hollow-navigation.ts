import type { DataOriginDTO } from '../../types/read-model'
import type { QuantityUnitReadQuery } from './central-contract'
import { isDataOriginDTO } from '../../types/read-model'
import { payrollSourceContext, payrollSourceQuery } from '../payroll/a-navigation'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { isQuantitySourceIdentity } from './migration-identity'
import { quantityUnitReturnPath } from './navigation'

export function quantityHollowQuery(projectId: unknown, unitId: unknown, origin: unknown): QuantityUnitReadQuery | null {
  return isStableRouteIdentity(projectId) && isQuantitySourceIdentity(unitId, 'units') && isDataOriginDTO(origin)
    ? { projectId, unitId, origin, includeDemo: origin === 'demo' }
    : null
}

export function quantityHollowPath(scope: { projectId: string, unitId: string, origin: DataOriginDTO }, mode: 'unit' | 'new' | 'detail' | 'form', recordId?: string | null) {
  if (!quantityHollowQuery(scope.projectId, scope.unitId, scope.origin))
    throw new Error('原户身份无效')
  const base = `/subcontract/quantity/${encodeURIComponent(scope.projectId)}/${encodeURIComponent(scope.unitId)}`
  if (mode === 'unit')
    return base
  if (mode === 'new')
    return `${base}/hollow/new`
  if (!isQuantitySourceIdentity(recordId, 'quantity_hollow_records'))
    throw new Error('空鼓记录身份无效')
  return `${base}/hollow/${mode === 'form' ? 'form/' : ''}${encodeURIComponent(recordId)}`
}

/** 仅保留经过原工资返回验证的来源上下文；矩阵返回仍由既有 helper 核项目。 */
export function quantityHollowSourceQuery(scope: QuantityUnitReadQuery, query: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = { origin: scope.origin }
  if (payrollSourceContext(query, { kind: 'quantity-unit', id: scope.unitId, origin: scope.origin, projectId: scope.projectId }))
    Object.assign(result, payrollSourceQuery(query))
  if (typeof query.returnTo === 'string') {
    const matrix = quantityUnitReturnPath(scope.projectId, { origin: scope.origin, returnTo: query.returnTo })
    result.returnTo = matrix
  }
  return result
}

/** 仅保留用户当前刷新的工作地址；不把写页加入只读页签恢复集合。 */
export function isQuantityHollowWorkPath(fullPath: string): boolean {
  try {
    if (!fullPath.startsWith('/') || fullPath.startsWith('//') || fullPath.includes('\\') || fullPath.length > 8192)
      return false
    const url = new URL(fullPath, 'https://quantity.invalid')
    if (url.origin !== 'https://quantity.invalid' || fullPath.split(/[?#]/)[0] !== url.pathname || !['', '#section-responsibility', '#section-inspection', '#section-evidence'].includes(url.hash))
      return false
    const match = /^\/subcontract\/quantity\/([^/]+)\/([^/]+)\/hollow\/(new|form\/([^/]+))$/.exec(url.pathname)
    if (!match || url.searchParams.get('origin') !== 'real')
      return false
    const scope = quantityHollowQuery(decodeURIComponent(match[1]!), decodeURIComponent(match[2]!), 'real')
    if (!scope)
      return false
    const mode = match[3] === 'new' ? 'new' : 'form'
    const recordId = mode === 'form' ? decodeURIComponent(match[4]!) : null
    if (quantityHollowPath(scope, mode, recordId) !== url.pathname)
      return false
    const query = Object.fromEntries(url.searchParams)
    const allowed = quantityHollowSourceQuery(scope, query)
    if (mode === 'new') {
      if (!isStableRouteIdentity(query.draftKey))
        return false
      allowed.draftKey = query.draftKey
    }
    return [...url.searchParams].every(([key, value]) => url.searchParams.getAll(key).length === 1 && allowed[key] === value)
  }
  catch { return false }
}
