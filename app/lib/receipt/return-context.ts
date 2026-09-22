import type { DataOriginDTO } from '../../types/read-model'
import { validateConstructionContractDetailReturnTo } from '../construction-contract/return-context'
import { validateCustomerDetailReturnTo } from '../customer/return-context'
import { validateProjectJourneyReturnTo } from '../material-contract/return-context'
import { validateOwnerDocumentDetailReturnTo } from '../owner-document/return-context'
import { isStableRouteIdentity } from '../util/stable-route-identity'

export function validateReceiptReturnTo(input: unknown, origin: DataOriginDTO): string | null {
  if (typeof input !== 'string' || input.length > 8192 || !input.startsWith('/') || input.startsWith('//') || input.includes('\\') || Array.from(input).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return null
  const source = validateCustomerDetailReturnTo(input, origin)
    ?? validateConstructionContractDetailReturnTo(input, origin)
    ?? validateProjectJourneyReturnTo(input, origin)
    ?? validateOwnerDocumentDetailReturnTo(input, origin)
  if (source)
    return source
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid')
      return null
    const match = /^\/finance\/receipt(?:\/([^/]+))?$/.exec(url.pathname)
    if (!match || (match[1] && (['new', 'form'].includes(match[1]) || !isStableRouteIdentity(decodeURIComponent(match[1])))))
      return null
    if (url.searchParams.has('origin') && url.searchParams.get('origin') !== origin)
      return null
    if (match[1] && url.searchParams.get('origin') !== origin)
      return null
    const allowed = new Set(['origin', 'includeDemo', 'search', 'status', 'projectId', 'customerId', 'contractId', 'page', 'pageSize', 'returnTo', 'returnContext', 'nav'])
    if ([...url.searchParams.keys()].some(key => !allowed.has(key) || url.searchParams.getAll(key).length !== 1))
      return null
    if (url.hash && !/^#receipt-[\w%.:-]+$/.test(url.hash))
      return null
    return `${url.pathname}${url.search}${url.hash}`
  }
  catch { return null }
}

export function receiptFormPath(id: string | null, returnTo: string) {
  return `/finance/receipt/${id ? `form/${encodeURIComponent(id)}` : 'new'}?${new URLSearchParams({ origin: 'real', returnTo })}`
}

interface ReceiptListOrigin { returnTo: string, scrollTop: number, scrollLeft: number, expiresAt: number }
const LIST_ORIGIN_PREFIX = 'ruihang:receipt-list-return:'
const CONTEXT_ID = /^[\w-]{8,64}$/

export function receiptListReturnTo(fullPath: string, id: string, origin: DataOriginDTO, contextId: string): string {
  const url = new URL(fullPath, 'https://ruihang.invalid')
  url.searchParams.set('nav', contextId)
  url.hash = `receipt-${origin}-${encodeURIComponent(id)}`
  return validateReceiptReturnTo(`${url.pathname}${url.search}${url.hash}`, origin) ?? '/finance/receipt'
}

export function saveReceiptListOrigin(value: Omit<ReceiptListOrigin, 'expiresAt'>, storage: Storage = sessionStorage) {
  const id = new URL(value.returnTo, 'https://ruihang.invalid').searchParams.get('nav')
  if (!id || !CONTEXT_ID.test(id))
    return
  try {
    storage.setItem(`${LIST_ORIGIN_PREFIX}${id}`, JSON.stringify({
      ...value,
      expiresAt: Date.now() + 30 * 60_000,
    }))
  }
  catch { /* 存储不可用时，仍按筛选与稳定锚点返回。 */ }
}

export function loadReceiptListOrigin(fullPath: string, storage: Storage = sessionStorage): ReceiptListOrigin | null {
  try {
    const id = new URL(fullPath, 'https://ruihang.invalid').searchParams.get('nav')
    if (!id || !CONTEXT_ID.test(id))
      return null
    const value = JSON.parse(storage.getItem(`${LIST_ORIGIN_PREFIX}${id}`) ?? 'null') as ReceiptListOrigin | null
    return value?.returnTo === fullPath && value.expiresAt > Date.now() && Number.isFinite(value.scrollTop) && value.scrollTop >= 0 && Number.isFinite(value.scrollLeft) && value.scrollLeft >= 0 ? value : null
  }
  catch { return null }
}

export function saveReceiptSourceOrigin(value: Omit<ReceiptListOrigin, 'expiresAt'>, storage: Storage = sessionStorage) {
  try {
    storage.setItem(`ruihang:receipt-source-return:${value.returnTo}`, JSON.stringify({
      ...value,
      expiresAt: Date.now() + 30 * 60_000,
    }))
  }
  catch { /* 保存视图状态失败不影响业务导航。 */ }
}

export function loadReceiptSourceOrigin(fullPath: string, storage: Storage = sessionStorage): ReceiptListOrigin | null {
  try {
    const value = JSON.parse(storage.getItem(`ruihang:receipt-source-return:${fullPath}`) ?? 'null') as ReceiptListOrigin | null
    return value?.returnTo === fullPath && value.expiresAt > Date.now() && Number.isFinite(value.scrollTop) && value.scrollTop >= 0 && Number.isFinite(value.scrollLeft) && value.scrollLeft >= 0 ? value : null
  }
  catch { return null }
}
