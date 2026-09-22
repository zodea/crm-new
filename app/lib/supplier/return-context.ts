import type { SupplierListColumnFilters, SupplierListSort } from './read-contract'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { isDataOriginDTO } from '~/types/read-model'
import { SUPPLIER_LIST_NUMERIC_FIELDS } from './read-contract'
import { normalizeSupplierEnumSelection, parseSupplierColumnFilters, serializeSupplierEnumSelection } from './read-query'

export interface SupplierListNavigationState {
  search: string
  category: string | string[]
  credentialStatus: string | string[]
  sort: SupplierListSort
  page: number
  pageSize: 10 | 20 | 50 | 100
  columnFilters?: SupplierListColumnFilters
}

export interface SupplierDetailJourneyReturnOrigin {
  id: string
  returnTo: string
  anchorId: string
  scrollTop: number
  expiresAt: number
}

const ROUTE = '/base/supplier'
const ANCHOR = /^supplier-row-[\w%.~-]+$/
const DETAIL_JOURNEY_CONTEXT_ID = /^[\w-]{8,64}$/
const DETAIL_JOURNEY_ANCHOR = 'supplier-subcontract-change-link'
const DETAIL_JOURNEY_STORAGE_PREFIX = 'ruihang:supplier-detail-journey-return:'
const DETAIL_JOURNEY_TTL = 30 * 60_000

function value(input: unknown): string | undefined {
  return typeof input === 'string' ? input : Array.isArray(input) && typeof input[0] === 'string' ? input[0] : undefined
}

function enumSelection(input: unknown): string[] {
  try {
    return normalizeSupplierEnumSelection(input)
  }
  catch {
    return []
  }
}

export function supplierListNavigationStateFromQuery(query: Record<string, unknown>): SupplierListNavigationState {
  const sort = value(query.sort)
  const pageSize = Number(value(query.pageSize))
  const page = Number(value(query.page))
  const sortKeys = ['name-asc', 'name-desc', 'category-asc', ...SUPPLIER_LIST_NUMERIC_FIELDS.flatMap(field => [`${field}-asc`, `${field}-desc`])]
  let columnFilters: SupplierListColumnFilters = {}
  try {
    columnFilters = parseSupplierColumnFilters(value(query.columnFilters)) ?? {}
  }
  catch { /* 无效返回链接不携带列筛选。 */ }
  return {
    search: value(query.search)?.slice(0, 120) ?? '',
    category: enumSelection(query.category),
    credentialStatus: enumSelection(query.credentialStatus),
    sort: sortKeys.includes(String(sort)) ? sort as SupplierListSort : 'updated-desc',
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize as 10 | 20 | 50 | 100 : 20,
    ...(Object.keys(columnFilters).length ? { columnFilters } : {}),
  }
}

export function createSupplierReturnTo(identity: string, state: SupplierListNavigationState): string {
  const query = new URLSearchParams()
  if (state.search)
    query.set('search', state.search)
  const category = serializeSupplierEnumSelection(state.category)
  const credentialStatus = serializeSupplierEnumSelection(state.credentialStatus)
  if (category)
    query.set('category', category)
  if (credentialStatus)
    query.set('credentialStatus', credentialStatus)
  if (state.sort !== 'updated-desc')
    query.set('sort', state.sort)
  if (state.page !== 1)
    query.set('page', String(state.page))
  if (state.pageSize !== 20)
    query.set('pageSize', String(state.pageSize))
  const columnFilters = parseSupplierColumnFilters(state.columnFilters)
  if (columnFilters)
    query.set('columnFilters', JSON.stringify(columnFilters))
  const anchor = `supplier-row-${encodeURIComponent(identity)}`
  return `${ROUTE}?${query.toString()}#${encodeURIComponent(anchor)}`
}

export function validateSupplierReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return null
  try {
    const url = new URL(value, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid' || url.pathname !== ROUTE || !ANCHOR.test(url.hash.slice(1)))
      return null
    const encodedIdentity = decodeURIComponent(url.hash.slice(1)).replace(/^supplier-row-/, '')
    const identity = decodeURIComponent(encodedIdentity)
    const query: Record<string, unknown> = Object.fromEntries(url.searchParams)
    for (const field of ['category', 'credentialStatus']) {
      if (url.searchParams.getAll(field).length > 1)
        query[field] = url.searchParams.getAll(field)
    }
    return createSupplierReturnTo(identity, supplierListNavigationStateFromQuery(query))
  }
  catch {
    return null
  }
}

export function validateSupplierDetailReturnTo(
  value: unknown,
  expectedOrigin?: unknown,
  expectedSupplierId?: string,
): string | null {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return null
  try {
    const url = new URL(value, 'https://ruihang.invalid')
    const match = url.pathname.match(/^\/base\/supplier\/([^/]+)$/)
    if (url.origin !== 'https://ruihang.invalid' || !match)
      return null
    const supplierId = decodeURIComponent(match[1]!)
    if (!isStableRouteIdentity(supplierId) || supplierId.includes('/') || supplierId.includes('\\')
      || (expectedSupplierId && supplierId !== expectedSupplierId)) {
      return null
    }
    const origin = url.searchParams.get('origin') ?? 'real'
    if (!isDataOriginDTO(origin) || (isDataOriginDTO(expectedOrigin) && origin !== expectedOrigin))
      return null
    const nested = url.searchParams.get('returnTo')
    const validatedNested = nested ? validateSupplierReturnTo(nested) : null
    if (nested && !validatedNested)
      return null
    const journeyContext = url.searchParams.get('subChangeJourney')
    const anchor = decodeURIComponent(url.hash.slice(1))
    if ((journeyContext === null) !== (anchor === ''))
      return null
    if (journeyContext !== null
      && (!DETAIL_JOURNEY_CONTEXT_ID.test(journeyContext) || anchor !== DETAIL_JOURNEY_ANCHOR)) {
      return null
    }
    const query = new URLSearchParams({ origin })
    if (validatedNested)
      query.set('returnTo', validatedNested)
    if (journeyContext)
      query.set('subChangeJourney', journeyContext)
    return `/base/supplier/${encodeURIComponent(supplierId)}?${query.toString()}${anchor ? `#${anchor}` : ''}`
  }
  catch {
    return null
  }
}

export function newSupplierDetailJourneyReturnContextId(): string {
  return `origin_${crypto.randomUUID().replaceAll('-', '')}`
}

export function createSupplierDetailJourneyReturnOrigin(options: {
  contextId: string
  returnTo: string
  anchorId: string
  scrollTop: number
  now: number
}): SupplierDetailJourneyReturnOrigin {
  const validated = validateSupplierDetailReturnTo(options.returnTo)
  const url = validated ? new URL(validated, 'https://ruihang.invalid') : null
  if (!DETAIL_JOURNEY_CONTEXT_ID.test(options.contextId)
    || options.anchorId !== DETAIL_JOURNEY_ANCHOR
    || !Number.isFinite(options.scrollTop)
    || options.scrollTop < 0
    || !url
    || url.searchParams.get('subChangeJourney') !== options.contextId
    || decodeURIComponent(url.hash.slice(1)) !== options.anchorId) {
    throw new Error('invalid supplier detail journey return context')
  }
  return {
    id: options.contextId,
    returnTo: validated!,
    anchorId: options.anchorId,
    scrollTop: options.scrollTop,
    expiresAt: options.now + DETAIL_JOURNEY_TTL,
  }
}

export function saveSupplierDetailJourneyReturnOrigin(
  origin: SupplierDetailJourneyReturnOrigin,
  storage: Storage = sessionStorage,
): void {
  storage.setItem(`${DETAIL_JOURNEY_STORAGE_PREFIX}${origin.id}`, JSON.stringify(origin))
}

export function loadSupplierDetailJourneyReturnOrigin(
  id: string,
  storage: Storage = sessionStorage,
): SupplierDetailJourneyReturnOrigin | null {
  const raw = storage.getItem(`${DETAIL_JOURNEY_STORAGE_PREFIX}${id}`)
  if (!raw)
    return null
  try {
    const parsed = JSON.parse(raw) as SupplierDetailJourneyReturnOrigin
    return parsed.id === id && typeof parsed.returnTo === 'string' && typeof parsed.anchorId === 'string'
      && typeof parsed.scrollTop === 'number' && typeof parsed.expiresAt === 'number'
      ? parsed
      : null
  }
  catch {
    return null
  }
}

export function resolveSupplierDetailJourneyReturnOrigin(options: {
  returnTo: unknown
  contextId: unknown
  now: number
  load: (id: string) => SupplierDetailJourneyReturnOrigin | null
}): SupplierDetailJourneyReturnOrigin | null {
  if (!DETAIL_JOURNEY_CONTEXT_ID.test(String(options.contextId ?? '')))
    return null
  const validated = validateSupplierDetailReturnTo(options.returnTo)
  const stored = options.load(String(options.contextId))
  if (!validated || !stored || stored.returnTo !== validated
    || stored.id !== options.contextId || stored.anchorId !== DETAIL_JOURNEY_ANCHOR
    || stored.expiresAt <= options.now || stored.scrollTop < 0) {
    return null
  }
  return stored
}
