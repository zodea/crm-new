import type { DataOriginDTO } from '~/types/read-model'
import { enumSelectionFromQuery, serializeEnumSelection } from '~/lib/util/enum-selection'
import { isDataOriginDTO } from '~/types/read-model'

export interface CustomerListNavigationState {
  search: string
  status: string | string[]
  sort: 'updated-desc' | 'name-asc' | 'name-desc'
  page: number
  pageSize: 10 | 20 | 50 | 100
}

export interface CustomerReturnOrigin {
  id: string
  returnTo: string
  tabKey: '/base/customer'
  anchorId: string
  scrollTop: number
  expiresAt: number
}

const ROUTE = '/base/customer'
const DETAIL_ROUTE = /^\/base\/customer\/([^/]+)$/
const DETAIL_QUERY = new Set(['origin', 'tab', 'returnTo', 'returnContext', 'relationContext'])
const DETAIL_TABS = new Set(['projects', 'contracts', 'receipts'])
const ID = /^[\w-]{8,64}$/
const ANCHOR = /^customer-row-[\w%.~-]+$/
const PREFIX = 'ruihang:customer-return:'
export const CUSTOMER_RETURN_CONTEXT_TTL = 30 * 60_000

export function isCustomerReturnContextId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function control(value: string): boolean {
  return [...value].some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)
}

function decodeDetailIdentity(value: string): string | null {
  try {
    const identity = decodeURIComponent(value)
    return identity.trim() && identity !== '.' && identity !== '..' && !control(identity)
      ? identity
      : null
  }
  catch {
    return null
  }
}

export function createCustomerDetailReturnTo(options: {
  customerId: string
  origin: DataOriginDTO
  tab: 'projects' | 'contracts' | 'receipts'
  returnTo?: string
  returnContext?: string
  relationContext?: string
}): string {
  const customerId = decodeDetailIdentity(encodeURIComponent(options.customerId))
  if (!customerId || !isDataOriginDTO(options.origin) || !DETAIL_TABS.has(options.tab))
    throw new Error('invalid customer detail return target')
  const query = new URLSearchParams({ origin: options.origin })
  if (options.tab !== 'projects')
    query.set('tab', options.tab)
  if (options.relationContext != null) {
    if (!isCustomerReturnContextId(options.relationContext))
      throw new Error('invalid customer project return context')
    query.set('relationContext', options.relationContext)
  }
  if (options.returnTo != null || options.returnContext != null) {
    const returnTo = validateCustomerReturnTo(options.returnTo)
    if (!returnTo || !isCustomerReturnContextId(options.returnContext))
      throw new Error('invalid customer list return context')
    query.set('returnTo', returnTo)
    query.set('returnContext', options.returnContext)
  }
  return `${ROUTE}/${encodeURIComponent(customerId)}?${query.toString()}`
}

export function validateCustomerDetailReturnTo(
  input: unknown,
  expectedOrigin?: unknown,
  expectedCustomerId?: unknown,
): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 4096
    || !input.startsWith('/') || input.startsWith('//') || input.includes('\\') || control(input)) {
    return null
  }
  let url: URL
  try {
    url = new URL(input, 'https://ruihang.invalid')
  }
  catch {
    return null
  }
  const match = DETAIL_ROUTE.exec(url.pathname)
  const customerId = match ? decodeDetailIdentity(match[1] ?? '') : null
  const origin = url.searchParams.get('origin')
  const tab = url.searchParams.get('tab') ?? 'projects'
  if (url.origin !== 'https://ruihang.invalid' || url.hash || !customerId
    || [...url.searchParams.keys()].some(key => !DETAIL_QUERY.has(key))
    || [...DETAIL_QUERY].some(key => url.searchParams.getAll(key).length > 1)
    || !isDataOriginDTO(origin) || (expectedOrigin != null && origin !== expectedOrigin)
    || (expectedCustomerId != null && customerId !== expectedCustomerId)
    || !DETAIL_TABS.has(tab)) {
    return null
  }
  try {
    return createCustomerDetailReturnTo({
      customerId,
      origin,
      tab: tab as 'projects' | 'contracts' | 'receipts',
      returnTo: url.searchParams.get('returnTo') ?? undefined,
      returnContext: url.searchParams.get('returnContext') ?? undefined,
      relationContext: url.searchParams.get('relationContext') ?? undefined,
    })
  }
  catch {
    return null
  }
}

export interface CustomerRelationReturnOrigin {
  returnTo: string
  targetEntity: 'project' | 'contract'
  targetId: string
  anchorId: string | null
  scrollTop: number
  scrollLeft: number
  expiresAt: number
}

const PROJECT_RETURN_PREFIX = 'ruihang:customer-relation-return:'

export function customerRelationReturnTo(returnTo: unknown, contextId: string): string | null {
  const canonical = validateCustomerDetailReturnTo(returnTo)
  if (!canonical || !isCustomerReturnContextId(contextId))
    return null
  const url = new URL(canonical, 'https://ruihang.invalid')
  url.searchParams.set('relationContext', contextId)
  return validateCustomerDetailReturnTo(`${url.pathname}${url.search}`)
}

export function saveCustomerRelationReturnOrigin(origin: CustomerRelationReturnOrigin, storage: Storage = sessionStorage) {
  const canonical = validateCustomerDetailReturnTo(origin.returnTo)
  const id = canonical && new URL(canonical, 'https://ruihang.invalid').searchParams.get('relationContext')
  if (!id)
    return
  try {
    storage.setItem(`${PROJECT_RETURN_PREFIX}${id}`, JSON.stringify(origin))
  }
  catch { /* 浏览器禁用存储时使用规范返回，不影响导航。 */ }
}

export function resolveCustomerRelationReturnOrigin(
  returnTo: unknown,
  expected: { targetEntity?: 'project' | 'contract', targetId?: string, origin?: DataOriginDTO },
  now = Date.now(),
  storage: Storage = sessionStorage,
): CustomerRelationReturnOrigin | null {
  const canonical = validateCustomerDetailReturnTo(returnTo, expected.origin)
  const id = canonical && new URL(canonical, 'https://ruihang.invalid').searchParams.get('relationContext')
  if (!id)
    return null
  try {
    const value = JSON.parse(storage.getItem(`${PROJECT_RETURN_PREFIX}${id}`) ?? 'null') as CustomerRelationReturnOrigin | null
    return value && value.returnTo === canonical && typeof value.targetId === 'string' && value.targetId.length > 0
      && (value.targetEntity === 'project' || value.targetEntity === 'contract')
      && (!expected.targetEntity || value.targetEntity === expected.targetEntity)
      && (value.anchorId === null || (typeof value.anchorId === 'string' && value.anchorId.length <= 512 && /^(?:project|contract|receipt):[\w%.~-]+$/.test(value.anchorId)))
      && (!expected.targetId || value.targetId === expected.targetId)
      && Number.isFinite(value.expiresAt) && value.expiresAt > now
      && Number.isFinite(value.scrollTop) && value.scrollTop >= 0
      && Number.isFinite(value.scrollLeft) && value.scrollLeft >= 0
      ? value
      : null
  }
  catch { return null }
}

export function createCustomerReturnOrigin(options: {
  contextId: string
  anchorId: string
  scrollTop: number
  now: number
  state: CustomerListNavigationState
}): CustomerReturnOrigin {
  if (!isCustomerReturnContextId(options.contextId) || !ANCHOR.test(options.anchorId) || options.scrollTop < 0)
    throw new Error('invalid customer return origin')
  const query = new URLSearchParams()
  if (options.state.search)
    query.set('search', options.state.search)
  const status = serializeEnumSelection(options.state.status)
  if (status)
    query.set('status', status)
  if (options.state.sort !== 'updated-desc')
    query.set('sort', options.state.sort)
  if (options.state.page !== 1)
    query.set('page', String(options.state.page))
  if (options.state.pageSize !== 10)
    query.set('pageSize', String(options.state.pageSize))
  query.set('nav', options.contextId)
  const returnTo = `${ROUTE}?${query.toString()}#${encodeURIComponent(options.anchorId)}`
  const validated = validateCustomerReturnTo(returnTo)
  if (!validated)
    throw new Error('invalid generated customer return target')
  return {
    id: options.contextId,
    returnTo: validated,
    tabKey: ROUTE,
    anchorId: options.anchorId,
    scrollTop: options.scrollTop,
    expiresAt: options.now + CUSTOMER_RETURN_CONTEXT_TTL,
  }
}

function positive(source: URLSearchParams, target: URLSearchParams, key: string, allowed?: number[]) {
  const raw = source.get(key)
  if (!raw || !/^\d+$/.test(raw))
    return
  const value = Number(raw)
  if (Number.isSafeInteger(value) && value > 0 && (!allowed || allowed.includes(value)))
    target.set(key, raw)
}

export function validateCustomerReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/')
    || value.startsWith('//') || value.includes('\\') || control(value)) {
    return null
  }
  let url: URL
  try {
    url = new URL(value, 'https://ruihang.invalid')
  }
  catch {
    return null
  }
  if (url.origin !== 'https://ruihang.invalid' || url.pathname !== ROUTE || !ANCHOR.test(url.hash.slice(1)))
    return null
  const query = new URLSearchParams()
  const search = url.searchParams.get('search')
  const statuses = url.searchParams.getAll('status')
  const status = serializeEnumSelection(enumSelectionFromQuery(statuses.length > 1 ? statuses : statuses[0]).filter(item => item.length <= 48))
  const sort = url.searchParams.get('sort')
  const nav = url.searchParams.get('nav')
  if (search && search.length <= 120)
    query.set('search', search)
  if (status)
    query.set('status', status)
  if (sort === 'name-asc' || sort === 'name-desc' || sort === 'updated-desc')
    query.set('sort', sort)
  positive(url.searchParams, query, 'page')
  positive(url.searchParams, query, 'pageSize', [10, 20, 50, 100])
  if (!nav || !ID.test(nav))
    return null
  query.set('nav', nav)
  return `${ROUTE}?${query.toString()}${url.hash}`
}

export function resolveCustomerReturnContext(options: {
  returnTo: unknown
  contextId: unknown
  now: number
  load: (id: string) => CustomerReturnOrigin | null
}): { to: string, origin: CustomerReturnOrigin | null } {
  const canonical = { to: ROUTE, origin: null }
  const to = validateCustomerReturnTo(options.returnTo)
  if (!to || !isCustomerReturnContextId(options.contextId))
    return canonical
  const origin = options.load(options.contextId)
  if (!origin || origin.id !== options.contextId || origin.returnTo !== to || origin.tabKey !== ROUTE
    || origin.expiresAt <= options.now || origin.scrollTop < 0) {
    return canonical
  }
  try {
    if (decodeURIComponent(to.slice(to.indexOf('#') + 1)) !== origin.anchorId)
      return canonical
  }
  catch {
    return canonical
  }
  return { to, origin }
}

export function newCustomerReturnContextId(): string {
  return `origin_${globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? Date.now().toString(36)}`
}

export function saveCustomerReturnOrigin(origin: CustomerReturnOrigin, storage: Storage = sessionStorage) {
  storage.setItem(`${PREFIX}${origin.id}`, JSON.stringify(origin))
}

export function loadCustomerReturnOrigin(id: string, storage: Storage = sessionStorage): CustomerReturnOrigin | null {
  const raw = storage.getItem(`${PREFIX}${id}`)
  if (!raw)
    return null
  try {
    const value = JSON.parse(raw) as CustomerReturnOrigin
    return value.id === id ? value : null
  }
  catch {
    return null
  }
}

function value(input: unknown): string | undefined {
  return typeof input === 'string' ? input : Array.isArray(input) && typeof input[0] === 'string' ? input[0] : undefined
}

export function customerListNavigationStateFromQuery(query: Record<string, unknown>): CustomerListNavigationState {
  const pageSize = Number(value(query.pageSize))
  const sort = value(query.sort)
  return {
    search: value(query.search)?.slice(0, 120) ?? '',
    status: enumSelectionFromQuery(query.status).filter(item => item.length <= 48),
    sort: sort === 'name-asc' || sort === 'name-desc' ? sort : 'updated-desc',
    page: Math.max(1, Number(value(query.page)) || 1),
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize as 10 | 20 | 50 | 100 : 10,
  }
}
