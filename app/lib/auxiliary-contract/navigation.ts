import { isDataOriginDTO } from '../../types/read-model'
import { validateProjectReturnTo } from '../nav/return-to'
import { validateSupplierReturnTo } from '../supplier/return-context'

export function validateAuxiliaryReturnTo(input: unknown, expectedOrigin: unknown = 'real', depth = 0): string | null {
  if (typeof input !== 'string' || input.length > 16000 || depth > 4 || !input.startsWith('/') || input.startsWith('//') || input.includes('\\') || [...input].some(char => char.charCodeAt(0) < 32) || /(?:^|\/)\.\.(?:\/|$)/.test(input))
    return null
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid')
      return null
    const origin = url.searchParams.get('origin')
    if (origin !== null && (!isDataOriginDTO(origin) || origin !== expectedOrigin))
      return null
    if (url.pathname === '/project')
      return validateProjectReturnTo(input)
    if (url.pathname === '/base/supplier')
      return validateSupplierReturnTo(input)
    const auxiliary = /^\/contract\/(other-expense|company-expense|other-settlement)(?:\/([\w-]+))?$/.exec(url.pathname)
    const related = /^\/(?:project\/[\w-]+(?:\/supplier\/[\w-]+)?|base\/supplier\/[\w-]+)$/.test(url.pathname)
    if (!auxiliary && !related)
      return null
    if (auxiliary?.[2] === 'form')
      return null
    if (related && origin !== expectedOrigin)
      return null
    if (auxiliary?.[1] === 'company-expense' && ['projectId', 'supplierId', 'project', 'supplier'].some(key => url.searchParams.has(key)))
      return null
    const keys = new Set(['origin', 'search', 'page', 'pageSize', 'category', 'status', 'projectId', 'supplierId', 'contractId', 'fact', 'sourceTrail', 'project', 'supplier', 'tab', 'returnTo', 'nav', 'focus', 'returnContext'])
    if ([...url.searchParams.keys()].some(key => !keys.has(key)))
      return null
    let normalized = input
    if (url.searchParams.has('returnTo')) {
      const nested = validateAuxiliaryReturnTo(url.searchParams.get('returnTo'), expectedOrigin, depth + 1)
      if (!nested)
        return null
      if (nested !== url.searchParams.get('returnTo')) {
        url.searchParams.set('returnTo', nested)
        normalized = `${url.pathname}${url.search}${url.hash}`
      }
    }
    if (url.hash && !/^#[\w:.-]+$/.test(url.hash))
      return null
    return normalized
  }
  catch {
    return null
  }
}
export function validateAuxiliaryDetailReturnTo(input: unknown, origin: unknown = 'real'): string | null {
  const valid = validateAuxiliaryReturnTo(input, origin)
  return valid && /^\/contract\/(?:other-expense|company-expense|other-settlement)\/[\w-]+\?/.test(valid) ? valid : null
}
