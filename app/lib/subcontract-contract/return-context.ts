import type { DataOriginDTO } from '~/types/read-model'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { isDataOriginDTO } from '~/types/read-model'

export interface SubcontractContractListNavigationState {
  search: string
  projectId: string | null
  supplierId: string | null
  status: string | null
  subKind: string | null
  origin: DataOriginDTO | null
  page: number
  pageSize: 10 | 20 | 50 | 100
}

export interface SubcontractContractReturnOrigin {
  id: string
  returnTo: string
  anchorId: string
  scrollTop: number
  expiresAt: number
}

const ROUTE = '/contract/subcontract'
const CONTEXT_ID = /^[\w-]{8,64}$/
const STORAGE_PREFIX = 'ruihang:subcontract-contract-return:'
const TTL = 30 * 60_000

function value(input: unknown): string | undefined {
  return typeof input === 'string' ? input : Array.isArray(input) && typeof input[0] === 'string' ? input[0] : undefined
}

function optionalText(input: unknown, maxLength: number): string | null {
  const text = value(input)?.trim() ?? ''
  return text && text.length <= maxLength && ![...text].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127) ? text : null
}

function positiveInteger(input: unknown, fallback: number): number {
  const raw = value(input)
  if (!raw || !/^\d+$/.test(raw))
    return fallback
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function isSubcontractContractReturnContextId(input: unknown): input is string {
  return typeof input === 'string' && CONTEXT_ID.test(input)
}

export function newSubcontractContractReturnContextId(): string {
  return `origin_${crypto.randomUUID().replaceAll('-', '')}`
}

export function subcontractContractListNavigationStateFromQuery(query: Record<string, unknown>): SubcontractContractListNavigationState {
  const pageSize = positiveInteger(query.pageSize, 10)
  const origin = value(query.origin)
  return {
    search: optionalText(query.search, 120) ?? '',
    projectId: optionalText(query.projectId, 240),
    supplierId: optionalText(query.supplierId, 240),
    status: optionalText(query.status, 80),
    subKind: optionalText(query.subKind, 80),
    origin: isDataOriginDTO(origin) ? origin : null,
    page: positiveInteger(query.page, 1),
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize as 10 | 20 | 50 | 100 : 10,
  }
}

function searchParams(state: SubcontractContractListNavigationState, contextId: string) {
  const query = new URLSearchParams()
  for (const [key, entry] of Object.entries(state)) {
    if (entry != null && entry !== '' && !(key === 'page' && entry === 1) && !(key === 'pageSize' && entry === 10))
      query.set(key, String(entry))
  }
  query.set('nav', contextId)
  return query
}

export function validateSubcontractContractReturnTo(input: unknown, expectedOrigin?: unknown): string | null {
  if (typeof input !== 'string' || input.length > 131_072 || !input.startsWith('/') || input.startsWith('//') || input.includes('\\'))
    return null
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid' || url.pathname !== ROUTE)
      return null
    const anchorId = decodeURIComponent(url.hash.slice(1))
    if (!/^subcontract-contract-row-[\w.~:/-]+$/.test(anchorId))
      return null
    const state = subcontractContractListNavigationStateFromQuery(Object.fromEntries(url.searchParams))
    if (isDataOriginDTO(expectedOrigin) && state.origin !== null && state.origin !== expectedOrigin)
      return null
    const contextId = url.searchParams.get('nav')
    if (!contextId || !CONTEXT_ID.test(contextId))
      return null
    return `${ROUTE}?${searchParams(state, contextId).toString()}#${encodeURIComponent(anchorId)}`
  }
  catch {
    return null
  }
}

export function validateSubcontractContractDetailReturnTo(input: unknown, expectedOrigin?: unknown): string | null {
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//') || input.includes('\\'))
    return null
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid' || !/^\/contract\/[^/]+$/.test(url.pathname) || url.searchParams.get('contractKind') !== 'subcontract' || !isDataOriginDTO(url.searchParams.get('origin')))
      return null
    const origin = url.searchParams.get('origin') as DataOriginDTO
    if (isDataOriginDTO(expectedOrigin) && origin !== expectedOrigin)
      return null
    const tab = url.searchParams.get('tab')
    if (tab && !['info', 'supplements', 'changes', 'invoices', 'payments', 'settlements', 'penalties', 'material-uses'].includes(tab))
      return null
    const focus = url.searchParams.get('focus')
    if (focus && (!['changes', 'settlements'].includes(tab ?? '') || !isStableRouteIdentity(focus)))
      return null
    const returnTo = url.searchParams.get('returnTo')
    const validatedListReturnTo = returnTo ? validateSubcontractContractReturnTo(returnTo, origin) : null
    if (returnTo && !validatedListReturnTo)
      return null
    const query = new URLSearchParams({ origin, contractKind: 'subcontract' })
    if (tab && tab !== 'info')
      query.set('tab', tab)
    if (focus)
      query.set('focus', focus)
    if (validatedListReturnTo)
      query.set('returnTo', validatedListReturnTo)
    return `${url.pathname}?${query.toString()}`
  }
  catch {
    return null
  }
}

export function createSubcontractContractReturnOrigin(options: { contextId: string, rowIdentity: string, scrollTop: number, now: number, state: SubcontractContractListNavigationState }): SubcontractContractReturnOrigin {
  if (!CONTEXT_ID.test(options.contextId) || !options.rowIdentity || !Number.isFinite(options.scrollTop) || options.scrollTop < 0)
    throw new Error('invalid subcontract contract return context')
  const anchorId = `subcontract-contract-row-${options.rowIdentity}`
  const returnTo = `${ROUTE}?${searchParams(options.state, options.contextId).toString()}#${encodeURIComponent(anchorId)}`
  return { id: options.contextId, returnTo, anchorId, scrollTop: options.scrollTop, expiresAt: options.now + TTL }
}

export function saveSubcontractContractReturnOrigin(origin: SubcontractContractReturnOrigin, storage: Storage = sessionStorage) {
  storage.setItem(`${STORAGE_PREFIX}${origin.id}`, JSON.stringify(origin))
}

export function loadSubcontractContractReturnOrigin(id: string, storage: Storage = sessionStorage): SubcontractContractReturnOrigin | null {
  try {
    const parsed = JSON.parse(storage.getItem(`${STORAGE_PREFIX}${id}`) ?? 'null') as SubcontractContractReturnOrigin | null
    return parsed?.id === id && parsed.expiresAt > 0 ? parsed : null
  }
  catch {
    return null
  }
}

export function resolveSubcontractContractReturnContext(options: { returnTo: unknown, contextId: unknown, now: number, load: (id: string) => SubcontractContractReturnOrigin | null }) {
  if (!isSubcontractContractReturnContextId(options.contextId))
    return { to: ROUTE, origin: null }
  const origin = options.load(options.contextId)
  const validated = validateSubcontractContractReturnTo(options.returnTo)
  const storedRoute = origin?.returnTo.split('#')[0]
  const requestedRoute = typeof options.returnTo === 'string' && options.returnTo === storedRoute ? options.returnTo : null
  const to = validated ?? requestedRoute ?? ROUTE
  const matchesOrigin = origin?.returnTo === validated || storedRoute === requestedRoute
  return !origin || !matchesOrigin || origin.expiresAt <= options.now || origin.scrollTop < 0 ? { to, origin: null } : { to, origin }
}
