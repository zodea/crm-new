import type { PayrollActualRef } from './central-actual-contract'
import type { DataOriginDTO } from '~/types/read-model'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { validateProjectJourneyReturnTo } from '~/lib/material-contract/return-context'
import { TARGET_COST_SOURCE_QUERY_KEYS, targetCostReturnTo, targetCostSourceContext } from '~/lib/target-cost/navigation'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { payrollAEntryReturn } from './a-navigation'
import { payrollWorkbookReturn } from './workbook-navigation'

export function payrollAdjustmentReturn(value: unknown, origin: DataOriginDTO, depth = 0): string | null {
  if (depth > 4 || typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return null
  try {
    const url = new URL(value, 'https://payroll.invalid')
    if (url.origin !== 'https://payroll.invalid' || url.searchParams.getAll('origin').length > 1 || (url.searchParams.get('origin') ?? 'real') !== origin)
      return null
    if (origin === 'real' && url.pathname === '/subcontract/payroll/workbooks')
      return payrollWorkbookReturn(value)
    const originalProjectReturn = validateProjectJourneyReturnTo(value, origin)
    if (originalProjectReturn)
      return originalProjectReturn
    if (url.hash && url.hash !== '#payroll-actual-section')
      return null
    const anchor = url.hash
    const withoutAnchor = value.split('#')[0]!
    const projectReturn = validateProjectJourneyReturnTo(withoutAnchor, origin)
    if (projectReturn)
      return `${projectReturn}${anchor}`
    const ledger = url.pathname === '/subcontract/payroll/payments'
    const nested = url.searchParams.get('returnTo')
    if (url.searchParams.getAll('returnTo').length > 1)
      return null
    const base = new URL(url)
    base.searchParams.delete('returnTo')
    const basePath = `${base.pathname}${base.search}${base.hash}`
    const legacy = (!ledger && payrollAEntryReturn(basePath, origin)) || validateCrewWorkerReturnTo(basePath)
    if (legacy) {
      if (!nested)
        return legacy
      const back = payrollAdjustmentReturn(nested, origin, depth + 1)
      if (!back)
        return null
      const result = new URL(legacy, 'https://payroll.invalid')
      result.searchParams.set('returnTo', back)
      return `${result.pathname}${result.search}${result.hash}`
    }
    const budget = targetCostReturnTo(value, origin)
    if (budget)
      return budget
    const detail = /^\/subcontract\/payroll\/(?:adjustments|payments)\/([^/]+)$/.exec(url.pathname)
    const project = /^\/project\/([^/]+)$/.exec(url.pathname)
    if (detail ? !isStableRouteIdentity(decodeURIComponent(detail[1]!)) || ['new', 'form', 'reversal'].includes(detail[1]!) : project ? !isStableRouteIdentity(decodeURIComponent(project[1]!)) : !ledger && url.pathname !== '/finance/payment-management')
      return null
    const keys = ['origin', 'project', 'projectId', 'tab', 'returnTo', ...(ledger ? ['statementId', ...TARGET_COST_SOURCE_QUERY_KEYS] : url.pathname === '/finance/payment-management' ? ['payrollProject'] : [])]
    if ([...url.searchParams.keys()].some(key => !keys.includes(key) || url.searchParams.getAll(key).length !== 1))
      return null
    if (['project', 'projectId', 'statementId', 'payrollProject'].some(key => url.searchParams.has(key) && !isStableRouteIdentity(url.searchParams.get(key))))
      return null
    if (ledger && TARGET_COST_SOURCE_QUERY_KEYS.some(key => url.searchParams.has(key))) {
      const context = targetCostSourceContext(url.pathname, Object.fromEntries(url.searchParams))
      if (!context || (url.searchParams.has('projectId') && url.searchParams.get('projectId') !== context.projectId))
        return null
    }
    if (url.searchParams.has('returnTo')) {
      const back = payrollAdjustmentReturn(url.searchParams.get('returnTo'), origin, depth + 1)
      if (!back)
        return null
      url.searchParams.set('returnTo', back)
    }
    return `${url.pathname}${url.search}${anchor}`
  }
  catch { return null }
}

export function payrollAdjustmentLocation(id: string, origin: DataOriginDTO, returnTo?: string, edit = false) {
  return { path: `/subcontract/payroll/adjustments/${edit ? 'form/' : ''}${encodeURIComponent(id)}`, query: { origin, ...(returnTo ? { returnTo: payrollAdjustmentReturn(returnTo, origin) ?? '' } : {}) } }
}
export function payrollActualLocation(ref: PayrollActualRef, origin: DataOriginDTO, returnTo?: string) {
  return { path: ref.kind === 'released-statement' ? `/subcontract/payroll/${encodeURIComponent(ref.statementId)}` : `/subcontract/payroll/payments/${encodeURIComponent(ref.eventId)}`, query: { origin, ...(returnTo ? { returnTo: payrollAdjustmentReturn(returnTo, origin) ?? '' } : {}) } }
}
export function payrollActualRefQuery(ref: PayrollActualRef) {
  return ref.kind === 'released-statement' ? { statementId: ref.statementId } : { eventId: ref.eventId }
}
