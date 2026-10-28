import { isStableRouteIdentity } from '../../app/lib/util/stable-route-identity'

export const PRODUCTION_PAYROLL_CAPABILITIES = ['payroll:read', 'payroll:write', 'core:migration:write'] as const

/** Existing payroll routes retain their format-specific codecs and authorization. */
export function isProductionPayrollRoute(method: string, path: string): boolean {
  if (method === 'GET') {
    if (path === '/api/read/payroll')
      return true
    const match = /^\/api\/read\/payroll\/([^/]+)$/.exec(path)
    if (!match)
      return false
    try {
      return isStableRouteIdentity(decodeURIComponent(match[1]!))
    }
    catch { return false }
  }
  if (method !== 'POST')
    return false
  return /^\/api\/commands\/payroll-(?:a|a-fees|a-rounding|attendance|c1|c2|daywork|adjustment|hollow|batch|numbering|workbook|workbook-resolve|resolve|import|import-resolve)$/.test(path)
    || /^\/api\/read\/payroll\/(?:a-form|a-fee-config|adjustment-form|adjustment-detail|actual-reversal-form|actual-payment-form|actual-payment-detail|actual-ledger|adjustment-history|batch-preview|c1-form|c2-form|daywork-form|hollow-config|numbering|release-adjustments|workbook-archive|workbook-archives|workbook-preview)$/.test(path)
}
