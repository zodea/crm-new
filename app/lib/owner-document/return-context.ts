import type { OwnerCommercialDocumentKind } from './central-repository'
import type { DataOriginDTO } from '~/types/read-model'
import { validateConstructionContractDetailReturnTo } from '~/lib/construction-contract/return-context'
import { validateProjectJourneyReturnTo } from '~/lib/material-contract/return-context'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { isDataOriginDTO } from '~/types/read-model'

export interface OwnerDocumentListNavigationState {
  search: string
  projectId: string | null
  contractId: string | null
  status: string | null
  documentType: string | null
  origin: DataOriginDTO | null
  page: number
  pageSize: 10 | 20 | 50 | 100
  variant?: 'acceptance' | 'warranty' | null
  returnTo?: string | null
}

export interface OwnerDocumentReturnOrigin {
  id: string
  returnTo: string
  anchorId: string
  scrollTop: number
  expiresAt: number
}

const CONTEXT_ID = /^[\w-]{8,64}$/
const STORAGE_PREFIX = 'ruihang:owner-document-return:'
const TTL = 30 * 60_000

function route(kind: OwnerCommercialDocumentKind): string {
  return kind === 'owner_change'
    ? '/owner/change'
    : kind === 'owner_report'
      ? '/owner/report'
      : kind === 'acceptance'
        ? '/owner/acceptance'
        : kind === 'final_settlement'
          ? '/owner/final-settlement'
          : '/owner/penalty'
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
  const normalized = value(input)?.trim() ?? ''
  return normalized && normalized.length <= maxLength
    && ![...normalized].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    ? normalized
    : null
}

export function isOwnerDocumentReturnContextId(input: unknown): input is string {
  return typeof input === 'string' && CONTEXT_ID.test(input)
}

export function newOwnerDocumentReturnContextId(): string {
  return `origin_${crypto.randomUUID().replaceAll('-', '')}`
}

export function ownerDocumentListNavigationStateFromQuery(
  query: Record<string, unknown>,
): OwnerDocumentListNavigationState {
  const pageSize = positiveInteger(query.pageSize, 20)
  const origin = value(query.origin)
  return {
    search: optionalText(query.search, 120) ?? '',
    projectId: optionalText(query.projectId, 240),
    contractId: optionalText(query.contractId, 240),
    status: optionalText(query.status, 80),
    documentType: optionalText(query.documentType, 120),
    origin: isDataOriginDTO(origin) ? origin : null,
    page: positiveInteger(query.page, 1),
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize as 10 | 20 | 50 | 100 : 20,
    variant: value(query.variant) === 'warranty' ? 'warranty' : value(query.variant) === 'acceptance' ? 'acceptance' : null,
    returnTo: validateConstructionContractDetailReturnTo(value(query.returnTo))
      ?? validateProjectJourneyReturnTo(value(query.returnTo)),
  }
}

function params(state: OwnerDocumentListNavigationState, contextId: string): URLSearchParams {
  const query = new URLSearchParams()
  if (state.search)
    query.set('search', state.search)
  if (state.projectId)
    query.set('projectId', state.projectId)
  if (state.contractId)
    query.set('contractId', state.contractId)
  if (state.status)
    query.set('status', state.status)
  if (state.documentType)
    query.set('documentType', state.documentType)
  if (state.origin)
    query.set('origin', state.origin)
  if (state.page !== 1)
    query.set('page', String(state.page))
  if (state.pageSize !== 20)
    query.set('pageSize', String(state.pageSize))
  if (state.variant)
    query.set('variant', state.variant)
  if (state.returnTo)
    query.set('returnTo', state.returnTo)
  query.set('nav', contextId)
  return query
}

export function validateOwnerDocumentListReturnTo(
  input: unknown,
  kind: OwnerCommercialDocumentKind,
  expectedOrigin?: unknown,
): string | null {
  if (typeof input !== 'string' || input.length > 131_072 || !input.startsWith('/') || input.startsWith('//') || input.includes('\\'))
    return null
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid' || url.pathname !== route(kind))
      return null
    const anchorId = decodeURIComponent(url.hash.slice(1))
    if (!/^owner-document-row-[\w.~:/-]+$/.test(anchorId))
      return null
    const state = ownerDocumentListNavigationStateFromQuery(Object.fromEntries(url.searchParams))
    if (isDataOriginDTO(expectedOrigin) && state.origin !== null && state.origin !== expectedOrigin)
      return null
    const contextId = url.searchParams.get('nav')
    if (!isOwnerDocumentReturnContextId(contextId))
      return null
    return `${route(kind)}?${params(state, contextId).toString()}#${encodeURIComponent(anchorId)}`
  }
  catch {
    return null
  }
}

export function validateOwnerDocumentJourneyReturnTo(
  input: unknown,
  kind: OwnerCommercialDocumentKind,
  expectedOrigin: unknown,
): string | null {
  return validateOwnerDocumentListReturnTo(input, kind, expectedOrigin)
    ?? validateConstructionContractDetailReturnTo(input, expectedOrigin)
    ?? validateProjectJourneyReturnTo(input, expectedOrigin)
}

export function validateOwnerDocumentDetailReturnTo(
  input: unknown,
  expectedOrigin: unknown,
): string | null {
  if (typeof input !== 'string' || input.length > 131_072 || !input.startsWith('/') || input.startsWith('//') || input.includes('\\'))
    return null
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    const match = url.pathname.match(/^\/owner\/(change|report|acceptance|final-settlement|penalty)\/([^/]+)$/)
    if (url.origin !== 'https://ruihang.invalid' || !match)
      return null
    const id = decodeURIComponent(match[2]!)
    if (!isStableRouteIdentity(id) || id.includes('/') || id.includes('\\'))
      return null
    const origin = url.searchParams.get('origin') ?? 'real'
    if (!isDataOriginDTO(origin) || (isDataOriginDTO(expectedOrigin) && origin !== expectedOrigin))
      return null
    const kind: OwnerCommercialDocumentKind = match[1] === 'change'
      ? 'owner_change'
      : match[1] === 'report'
        ? 'owner_report'
        : match[1] === 'acceptance'
          ? 'acceptance'
          : match[1] === 'final-settlement'
            ? 'final_settlement'
            : 'owner_penalty'
    const nested = url.searchParams.get('returnTo')
    const validatedNested = nested ? validateOwnerDocumentJourneyReturnTo(nested, kind, origin) : null
    if (nested && !validatedNested)
      return null
    const contextId = url.searchParams.get('returnContext')
    if (contextId && (!validatedNested || !isOwnerDocumentReturnContextId(contextId)))
      return null
    const query = new URLSearchParams({ origin })
    if (kind === 'acceptance') {
      const variant = url.searchParams.get('variant') ?? 'acceptance'
      if (variant !== 'acceptance' && variant !== 'warranty')
        return null
      query.set('variant', variant)
    }
    if (validatedNested)
      query.set('returnTo', validatedNested)
    if (contextId)
      query.set('returnContext', contextId)
    return `${url.pathname}?${query.toString()}`
  }
  catch {
    return null
  }
}

export function createOwnerDocumentReturnOrigin(options: {
  kind: OwnerCommercialDocumentKind
  contextId: string
  rowIdentity: string
  scrollTop: number
  now: number
  state: OwnerDocumentListNavigationState
}): OwnerDocumentReturnOrigin {
  if (!isOwnerDocumentReturnContextId(options.contextId) || !options.rowIdentity
    || !Number.isFinite(options.scrollTop) || options.scrollTop < 0) {
    throw new Error('invalid owner document return context')
  }
  const anchorId = `owner-document-row-${options.rowIdentity}`
  const returnTo = `${route(options.kind)}?${params(options.state, options.contextId).toString()}#${encodeURIComponent(anchorId)}`
  const validated = validateOwnerDocumentListReturnTo(returnTo, options.kind)
  if (!validated)
    throw new Error('invalid generated owner document return target')
  return { id: options.contextId, returnTo: validated, anchorId, scrollTop: options.scrollTop, expiresAt: options.now + TTL }
}

export function saveOwnerDocumentReturnOrigin(origin: OwnerDocumentReturnOrigin, storage: Storage = sessionStorage) {
  storage.setItem(`${STORAGE_PREFIX}${origin.id}`, JSON.stringify(origin))
}

export function loadOwnerDocumentReturnOrigin(id: string, storage: Storage = sessionStorage): OwnerDocumentReturnOrigin | null {
  const raw = storage.getItem(`${STORAGE_PREFIX}${id}`)
  if (!raw)
    return null
  try {
    const parsed = JSON.parse(raw) as OwnerDocumentReturnOrigin
    return parsed.id === id && typeof parsed.returnTo === 'string' && typeof parsed.anchorId === 'string'
      && typeof parsed.scrollTop === 'number' && typeof parsed.expiresAt === 'number'
      ? parsed
      : null
  }
  catch {
    return null
  }
}

export function resolveOwnerDocumentReturnContext(options: {
  kind: OwnerCommercialDocumentKind
  returnTo: unknown
  contextId: unknown
  origin: unknown
  now: number
  load: (id: string) => OwnerDocumentReturnOrigin | null
}) {
  const fallback = route(options.kind)
  const to = validateOwnerDocumentJourneyReturnTo(options.returnTo, options.kind, options.origin) ?? fallback
  if (!isOwnerDocumentReturnContextId(options.contextId))
    return { to, origin: null }
  const stored = options.load(options.contextId)
  if (!stored || stored.returnTo !== to || stored.expiresAt <= options.now || stored.scrollTop < 0)
    return { to, origin: null }
  return { to, origin: stored }
}
