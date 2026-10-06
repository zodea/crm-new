import type { ContractListFilter } from '../contract/list-filters'
import type { DataOriginDTO } from '~/types/read-model'
import { validateCustomerDetailReturnTo } from '~/lib/customer/return-context'
import { validateProjectJourneyReturnTo } from '~/lib/material-contract/return-context'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { isDataOriginDTO } from '~/types/read-model'
import { parseContractListFilter, serializeContractListFilter } from '../contract/list-filters'

export interface ConstructionContractListNavigationState {
  search: string
  projectId: string | null
  customerId: string | null
  status: ContractListFilter
  origin: DataOriginDTO | null
  page: number
  pageSize: 10 | 20 | 50 | 100
}

export interface ConstructionContractReturnOrigin {
  id: string
  returnTo: string
  anchorId: string
  scrollTop: number
  expiresAt: number
}

const ROUTE = '/contract/construction'
const CONTEXT_ID = /^[\w-]{8,64}$/
const STORAGE_PREFIX = 'ruihang:construction-contract-return:'
const TTL = 30 * 60_000

export function isConstructionContractReturnContextId(input: unknown): input is string {
  return typeof input === 'string' && CONTEXT_ID.test(input)
}

export function newConstructionContractReturnContextId(): string {
  return `origin_${crypto.randomUUID().replaceAll('-', '')}`
}

function value(input: unknown): string | undefined {
  return typeof input === 'string' ? input : Array.isArray(input) && typeof input[0] === 'string' ? input[0] : undefined
}

function positiveInteger(input: unknown, fallback: number): number {
  const raw = value(input)
  if (!raw || !/^\d+$/.test(raw))
    return fallback
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function optionalText(input: unknown, maxLength: number): string | null {
  const text = value(input)?.trim() ?? ''
  return text && text.length <= maxLength && ![...text].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    ? text
    : null
}

export function constructionContractListNavigationStateFromQuery(
  query: Record<string, unknown>,
): ConstructionContractListNavigationState {
  const pageSize = positiveInteger(query.pageSize, 10)
  const origin = value(query.origin)
  return {
    search: optionalText(query.search, 120) ?? '',
    projectId: optionalText(query.projectId, 240),
    customerId: optionalText(query.customerId, 240),
    status: parseContractListFilter(query.status),
    origin: isDataOriginDTO(origin) ? origin : null,
    page: positiveInteger(query.page, 1),
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize as 10 | 20 | 50 | 100 : 10,
  }
}

function searchParams(state: ConstructionContractListNavigationState, contextId: string) {
  const query = new URLSearchParams()
  if (state.search)
    query.set('search', state.search)
  if (state.projectId)
    query.set('projectId', state.projectId)
  if (state.customerId)
    query.set('customerId', state.customerId)
  if (state.status)
    query.set('status', serializeContractListFilter(state.status))
  if (state.origin)
    query.set('origin', state.origin)
  if (state.page !== 1)
    query.set('page', String(state.page))
  if (state.pageSize !== 10)
    query.set('pageSize', String(state.pageSize))
  query.set('nav', contextId)
  return query
}

export function validateConstructionContractReturnTo(input: unknown, expectedOrigin?: unknown): string | null {
  if (typeof input !== 'string' || input.length > 131_072 || !input.startsWith('/') || input.startsWith('//') || input.includes('\\'))
    return null
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid' || url.pathname !== ROUTE)
      return null
    const anchorId = decodeURIComponent(url.hash.slice(1))
    if (!/^construction-contract-row-[\w.~:/-]+$/.test(anchorId))
      return null
    const state = constructionContractListNavigationStateFromQuery(Object.fromEntries(url.searchParams))
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

export function validateConstructionContractProjectReturnTo(input: unknown, projectId: string | null, origin: DataOriginDTO): string | null {
  if (!projectId || !isStableRouteIdentity(projectId))
    return null
  const validated = validateProjectJourneyReturnTo(input, origin)
  if (!validated)
    return null
  try {
    const url = new URL(validated, 'https://ruihang.invalid')
    return decodeURIComponent(url.pathname.slice('/project/'.length)) === projectId ? validated : null
  }
  catch { return null }
}

export function validateConstructionContractDetailReturnTo(input: unknown, expectedOrigin?: unknown): string | null {
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//') || input.includes('\\'))
    return null
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid' || !/^\/contract\/[^/]+$/.test(url.pathname)
      || url.searchParams.get('contractKind') !== 'construction' || !isDataOriginDTO(url.searchParams.get('origin'))) {
      return null
    }
    const origin = url.searchParams.get('origin') as DataOriginDTO
    if (isDataOriginDTO(expectedOrigin) && origin !== expectedOrigin)
      return null
    const tab = url.searchParams.get('tab')
    if (tab && !['info', 'supplements', 'changes', 'settlements', 'invoices', 'receipts', 'acceptance'].includes(tab))
      return null
    const focus = url.searchParams.get('focus')
    if (focus && (!['supplements', 'settlements', 'acceptance'].includes(tab ?? '') || !isStableRouteIdentity(focus)))
      return null
    const focusView = url.searchParams.get('focusView')
    if (focusView && (tab !== 'acceptance' || !focus || (focusView !== 'acceptance' && focusView !== 'warranty')))
      return null
    const anchorId = decodeURIComponent(url.hash.slice(1))
    const receiptAnchor = tab === 'receipts' && anchorId.startsWith('construction-contract-receipt-') && isStableRouteIdentity(anchorId.slice('construction-contract-receipt-'.length))
    if (anchorId && !receiptAnchor && (!focus || !focusView || anchorId !== `construction-contract-fact-${focusView}-${focus}`))
      return null
    const returnTo = url.searchParams.get('returnTo')
    const validatedListReturnTo = returnTo
      ? validateConstructionContractReturnTo(returnTo, origin) ?? validateCustomerDetailReturnTo(returnTo, origin) ?? validateProjectJourneyReturnTo(returnTo, origin)
      : null
    if (returnTo && !validatedListReturnTo)
      return null
    if (validatedListReturnTo) {
      const listOrigin = new URL(validatedListReturnTo, 'https://ruihang.invalid').searchParams.get('origin')
      if (listOrigin && listOrigin !== origin)
        return null
    }
    const query = new URLSearchParams({ origin, contractKind: 'construction' })
    if (tab && tab !== 'info')
      query.set('tab', tab)
    if (focus)
      query.set('focus', focus)
    if (focusView)
      query.set('focusView', focusView)
    if (validatedListReturnTo)
      query.set('returnTo', validatedListReturnTo)
    return `${url.pathname}?${query.toString()}${anchorId ? `#${encodeURIComponent(anchorId)}` : ''}`
  }
  catch {
    return null
  }
}

export function createConstructionContractReturnOrigin(options: {
  contextId: string
  rowIdentity: string
  scrollTop: number
  now: number
  state: ConstructionContractListNavigationState
}): ConstructionContractReturnOrigin {
  if (!CONTEXT_ID.test(options.contextId) || !options.rowIdentity || !Number.isFinite(options.scrollTop) || options.scrollTop < 0)
    throw new Error('invalid construction contract return context')
  const anchorId = `construction-contract-row-${options.rowIdentity}`
  const returnTo = `${ROUTE}?${searchParams(options.state, options.contextId).toString()}#${encodeURIComponent(anchorId)}`
  const validated = validateConstructionContractReturnTo(returnTo)
  if (!validated)
    throw new Error('invalid generated construction contract return target')
  return { id: options.contextId, returnTo: validated, anchorId, scrollTop: options.scrollTop, expiresAt: options.now + TTL }
}

export function saveConstructionContractReturnOrigin(origin: ConstructionContractReturnOrigin, storage: Storage = sessionStorage) {
  storage.setItem(`${STORAGE_PREFIX}${origin.id}`, JSON.stringify(origin))
}

export function loadConstructionContractReturnOrigin(id: string, storage: Storage = sessionStorage): ConstructionContractReturnOrigin | null {
  const raw = storage.getItem(`${STORAGE_PREFIX}${id}`)
  if (!raw)
    return null
  try {
    const parsed = JSON.parse(raw) as ConstructionContractReturnOrigin
    return parsed.id === id && typeof parsed.returnTo === 'string' && typeof parsed.anchorId === 'string'
      && typeof parsed.scrollTop === 'number' && typeof parsed.expiresAt === 'number'
      ? parsed
      : null
  }
  catch {
    return null
  }
}

export function resolveConstructionContractReturnContext(options: {
  returnTo: unknown
  contextId: unknown
  now: number
  load: (id: string) => ConstructionContractReturnOrigin | null
}) {
  const to = validateConstructionContractReturnTo(options.returnTo) ?? ROUTE
  if (!isConstructionContractReturnContextId(options.contextId))
    return { to, origin: null }
  const origin = options.load(options.contextId)
  if (!origin || origin.returnTo !== to || origin.expiresAt <= options.now || origin.scrollTop < 0)
    return { to, origin: null }
  return { to, origin }
}
