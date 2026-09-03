import type { DataOriginDTO } from '~/types/read-model'
import { isProjectReturnContextId, validateProjectReturnTo } from '~/lib/nav/return-to'
import { isDataOriginDTO } from '~/types/read-model'

export interface MaterialContractListNavigationState {
  search: string
  projectId: string | null
  supplierId: string | null
  status: string | null
  origin: DataOriginDTO | null
  page: number
  pageSize: 10 | 20 | 50 | 100
  returnTo: string | null
}

export interface MaterialContractReturnOrigin {
  id: string
  returnTo: string
  anchorId: string
  scrollTop: number
  expiresAt: number
}

export interface MaterialContractJourneyReturnOrigin {
  id: string
  returnTo: string
  anchorId: string
  scrollTop: number
  expiresAt: number
}

interface CreateMaterialContractJourneyReturnOriginOptions {
  contextId: string
  returnTo: string
  anchorId: string
  scrollTop: number
  now: number
}

interface ResolveMaterialContractJourneyReturnOriginOptions {
  returnTo: unknown
  contextId: unknown
  now: number
  load: (id: string) => MaterialContractJourneyReturnOrigin | null
}

interface CreateMaterialContractReturnOriginOptions {
  contextId: string
  rowIdentity: string
  scrollTop: number
  now: number
  state: MaterialContractListNavigationState
}

interface ResolveMaterialContractReturnContextOptions {
  returnTo: unknown
  contextId: unknown
  now: number
  load: (id: string) => MaterialContractReturnOrigin | null
}

const ROUTE = '/contract/material'
const CONTEXT_ID = /^[\w-]{8,64}$/
const ROW_ANCHOR = /^#material-contract-row-[\w%.~:/-]+$/
const STORAGE_PREFIX = 'ruihang:material-contract-return:'
const JOURNEY_STORAGE_PREFIX = 'ruihang:material-contract-journey-return:'
const PROJECT_MATERIAL_ANCHOR = 'project-material-contract-link'
const PROJECT_OWNER_DOCUMENT_CARD_ANCHOR = /^project-owner-document-card-(?:change|report|acceptance|warranty|final-settlement|penalty|sub-change)$/
const SUPPLIER_FACT_ANCHOR = /^material-contract-supplier-fact-(?:contracts|settlements|invoices|payments)$/
const TTL = 30 * 60_000

export function isMaterialContractReturnContextId(input: unknown): input is string {
  return typeof input === 'string' && CONTEXT_ID.test(input)
}

export function newMaterialContractReturnContextId(): string {
  return `origin_${crypto.randomUUID().replaceAll('-', '')}`
}

export function isProjectOwnerDocumentCardAnchor(input: string): boolean {
  return PROJECT_OWNER_DOCUMENT_CARD_ANCHOR.test(input)
}

function value(input: unknown): string | undefined {
  return typeof input === 'string'
    ? input
    : Array.isArray(input) && typeof input[0] === 'string' ? input[0] : undefined
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
  return text && text.length <= maxLength && !hasControlCharacter(text) ? text : null
}

function hasControlCharacter(input: string): boolean {
  return [...input].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

export function validateProjectJourneyReturnTo(input: unknown, expectedOrigin?: unknown): string | null {
  if (typeof input !== 'string' || input.length > 131_072 || !input.startsWith('/') || input.startsWith('//') || input.includes('\\'))
    return null
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid' || !/^\/project\/[^/]+$/.test(url.pathname))
      return null
    const inputOrigin = url.searchParams.get('origin')
    if (inputOrigin !== null && !isDataOriginDTO(inputOrigin))
      return null
    const origin = inputOrigin ?? (expectedOrigin === 'real' ? 'real' : null)
    if (isDataOriginDTO(expectedOrigin) && origin !== expectedOrigin)
      return null
    const returnTo = url.searchParams.get('returnTo')
    const returnContext = url.searchParams.get('returnContext')
    const materialJourney = url.searchParams.get('materialJourney')
    const ownerJourney = url.searchParams.get('ownerJourney')
    if ((returnTo === null) !== (returnContext === null))
      return null
    if (returnTo !== null && (!validateProjectReturnTo(returnTo) || !isProjectReturnContextId(returnContext)))
      return null
    const anchor = decodeURIComponent(url.hash.slice(1))
    if (materialJourney !== null && ownerJourney !== null)
      return null
    if (materialJourney !== null && (!CONTEXT_ID.test(materialJourney) || anchor !== PROJECT_MATERIAL_ANCHOR))
      return null
    if (ownerJourney !== null && (!CONTEXT_ID.test(ownerJourney) || !isProjectOwnerDocumentCardAnchor(anchor)))
      return null
    if (anchor
      && anchor !== 'project-detail-title'
      && anchor !== PROJECT_MATERIAL_ANCHOR
      && !isProjectOwnerDocumentCardAnchor(anchor)) {
      return null
    }
    const query = new URLSearchParams()
    if (origin)
      query.set('origin', origin)
    if (returnTo && returnContext) {
      query.set('returnTo', returnTo)
      query.set('returnContext', returnContext)
    }
    if (materialJourney)
      query.set('materialJourney', materialJourney)
    if (ownerJourney)
      query.set('ownerJourney', ownerJourney)
    return `${url.pathname}${query.size ? `?${query.toString()}` : ''}${anchor ? `#${anchor}` : ''}`
  }
  catch {
    return null
  }
}

export function validateMaterialContractDetailJourneyReturnTo(input: unknown, expectedOrigin?: unknown): string | null {
  if (typeof input !== 'string' || input.length > 131_072 || !input.startsWith('/') || input.startsWith('//') || input.includes('\\'))
    return null
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid'
      || !/^\/contract\/[^/]+$/.test(url.pathname)
      || url.searchParams.get('contractKind') !== 'material'
      || !isDataOriginDTO(url.searchParams.get('origin'))) {
      return null
    }
    const origin = url.searchParams.get('origin') as DataOriginDTO
    if (isDataOriginDTO(expectedOrigin) && origin !== expectedOrigin)
      return null
    const tab = url.searchParams.get('tab')
    if (tab && !['info', 'lines', 'materials', 'invoices', 'payments', 'settlements', 'penalties'].includes(tab))
      return null
    const returnTo = url.searchParams.get('returnTo')
    if (returnTo && !validateMaterialContractReturnTo(returnTo, origin))
      return null
    const supplierFactJourney = url.searchParams.get('supplierFactJourney')
    const anchor = decodeURIComponent(url.hash.slice(1))
    if (supplierFactJourney !== null && (!CONTEXT_ID.test(supplierFactJourney) || !SUPPLIER_FACT_ANCHOR.test(anchor)))
      return null
    if (anchor && !SUPPLIER_FACT_ANCHOR.test(anchor))
      return null
    const query = new URLSearchParams({
      origin,
      contractKind: 'material',
    })
    if (tab && tab !== 'info')
      query.set('tab', tab)
    if (returnTo)
      query.set('returnTo', returnTo)
    if (supplierFactJourney)
      query.set('supplierFactJourney', supplierFactJourney)
    return `${url.pathname}?${query.toString()}${anchor ? `#${anchor}` : ''}`
  }
  catch {
    return null
  }
}

export function materialContractListNavigationStateFromQuery(
  query: Record<string, unknown>,
): MaterialContractListNavigationState {
  const pageSize = positiveInteger(query.pageSize, 10)
  const origin = value(query.origin)
  return {
    search: optionalText(query.search, 120) ?? '',
    projectId: optionalText(query.projectId, 240),
    supplierId: optionalText(query.supplierId, 240),
    status: optionalText(query.status, 80),
    origin: isDataOriginDTO(origin) ? origin : null,
    page: positiveInteger(query.page, 1),
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize as 10 | 20 | 50 | 100 : 10,
    returnTo: validateProjectJourneyReturnTo(value(query.returnTo), origin),
  }
}

function materialContractListSearchParams(
  state: MaterialContractListNavigationState,
  contextId: string,
): URLSearchParams {
  const query = new URLSearchParams()
  if (state.search)
    query.set('search', state.search)
  if (state.projectId)
    query.set('projectId', state.projectId)
  if (state.supplierId)
    query.set('supplierId', state.supplierId)
  if (state.status)
    query.set('status', state.status)
  if (state.origin)
    query.set('origin', state.origin)
  if (state.page !== 1)
    query.set('page', String(state.page))
  if (state.pageSize !== 10)
    query.set('pageSize', String(state.pageSize))
  if (state.returnTo)
    query.set('returnTo', state.returnTo)
  query.set('nav', contextId)
  return query
}

export function createMaterialContractReturnOrigin(
  options: CreateMaterialContractReturnOriginOptions,
): MaterialContractReturnOrigin {
  if (!CONTEXT_ID.test(options.contextId))
    throw new Error('invalid material contract return context id')
  if (!options.rowIdentity || options.rowIdentity.length > 480 || hasControlCharacter(options.rowIdentity))
    throw new Error('invalid material contract row identity')
  if (!Number.isFinite(options.scrollTop) || options.scrollTop < 0)
    throw new Error('invalid material contract scroll position')
  const state = options.state
  const query = materialContractListSearchParams(state, options.contextId)
  const anchorId = `material-contract-row-${options.rowIdentity}`
  const returnTo = `${ROUTE}?${query.toString()}#${encodeURIComponent(anchorId)}`
  const validated = validateMaterialContractReturnTo(returnTo)
  if (!validated)
    throw new Error('invalid generated material contract return target')
  return {
    id: options.contextId,
    returnTo: validated,
    anchorId,
    scrollTop: options.scrollTop,
    expiresAt: options.now + TTL,
  }
}

export function validateMaterialContractReturnTo(input: unknown, expectedOrigin?: unknown): string | null {
  if (typeof input !== 'string' || input.length > 131_072 || !input.startsWith('/') || input.startsWith('//') || input.includes('\\'))
    return null
  try {
    const url = new URL(input, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid' || url.pathname !== ROUTE || !ROW_ANCHOR.test(url.hash))
      return null
    const anchorId = decodeURIComponent(url.hash.slice(1))
    if (!/^material-contract-row-[\w.~:/-]+$/.test(anchorId))
      return null
    const state = materialContractListNavigationStateFromQuery(Object.fromEntries(url.searchParams))
    if (isDataOriginDTO(expectedOrigin) && state.origin !== expectedOrigin)
      return null
    const contextId = url.searchParams.get('nav')
    if (!contextId || !CONTEXT_ID.test(contextId))
      return null
    const query = materialContractListSearchParams(state, contextId)
    return `${ROUTE}?${query.toString()}#${encodeURIComponent(anchorId)}`
  }
  catch {
    return null
  }
}

export function createMaterialContractJourneyReturnOrigin(
  options: CreateMaterialContractJourneyReturnOriginOptions,
): MaterialContractJourneyReturnOrigin {
  if (!CONTEXT_ID.test(options.contextId))
    throw new Error('invalid material contract journey context id')
  if (options.anchorId !== PROJECT_MATERIAL_ANCHOR && !SUPPLIER_FACT_ANCHOR.test(options.anchorId))
    throw new Error('invalid material contract journey anchor')
  if (!Number.isFinite(options.scrollTop) || options.scrollTop < 0)
    throw new Error('invalid material contract journey scroll position')
  const url = new URL(options.returnTo, 'https://ruihang.invalid')
  const origin = url.searchParams.get('origin')
  const validated = validateProjectJourneyReturnTo(options.returnTo, origin)
    ?? validateMaterialContractDetailJourneyReturnTo(options.returnTo, origin)
  if (!validated || decodeURIComponent(new URL(validated, 'https://ruihang.invalid').hash.slice(1)) !== options.anchorId)
    throw new Error('invalid material contract journey return target')
  return {
    id: options.contextId,
    returnTo: validated,
    anchorId: options.anchorId,
    scrollTop: options.scrollTop,
    expiresAt: options.now + TTL,
  }
}

export function saveMaterialContractJourneyReturnOrigin(
  origin: MaterialContractJourneyReturnOrigin,
  storage: Storage = sessionStorage,
): void {
  storage.setItem(`${JOURNEY_STORAGE_PREFIX}${origin.id}`, JSON.stringify(origin))
}

export function loadMaterialContractJourneyReturnOrigin(
  id: string,
  storage: Storage = sessionStorage,
): MaterialContractJourneyReturnOrigin | null {
  const raw = storage.getItem(`${JOURNEY_STORAGE_PREFIX}${id}`)
  if (!raw)
    return null
  try {
    const value = JSON.parse(raw) as Partial<MaterialContractJourneyReturnOrigin>
    return value.id === id
      && CONTEXT_ID.test(id)
      && typeof value.returnTo === 'string'
      && typeof value.anchorId === 'string'
      && (value.anchorId === PROJECT_MATERIAL_ANCHOR || SUPPLIER_FACT_ANCHOR.test(value.anchorId))
      && typeof value.scrollTop === 'number'
      && typeof value.expiresAt === 'number'
      ? value as MaterialContractJourneyReturnOrigin
      : null
  }
  catch {
    return null
  }
}

export function resolveMaterialContractJourneyReturnOrigin(
  options: ResolveMaterialContractJourneyReturnOriginOptions,
): MaterialContractJourneyReturnOrigin | null {
  if (typeof options.returnTo !== 'string' || !CONTEXT_ID.test(String(options.contextId ?? '')))
    return null
  const origin = options.load(String(options.contextId))
  if (!origin || origin.returnTo !== options.returnTo || origin.expiresAt <= options.now || origin.scrollTop < 0)
    return null
  return origin
}

export function saveMaterialContractReturnOrigin(
  origin: MaterialContractReturnOrigin,
  storage: Storage = sessionStorage,
) {
  storage.setItem(`${STORAGE_PREFIX}${origin.id}`, JSON.stringify(origin))
}

export function loadMaterialContractReturnOrigin(
  id: string,
  storage: Storage = sessionStorage,
): MaterialContractReturnOrigin | null {
  const raw = storage.getItem(`${STORAGE_PREFIX}${id}`)
  if (!raw)
    return null
  try {
    const value = JSON.parse(raw) as Partial<MaterialContractReturnOrigin>
    return value.id === id
      && typeof value.returnTo === 'string'
      && typeof value.anchorId === 'string'
      && typeof value.scrollTop === 'number'
      && typeof value.expiresAt === 'number'
      ? value as MaterialContractReturnOrigin
      : null
  }
  catch {
    return null
  }
}

export function resolveMaterialContractReturnContext(
  options: ResolveMaterialContractReturnContextOptions,
): { to: string, origin: MaterialContractReturnOrigin | null } {
  const to = validateMaterialContractReturnTo(options.returnTo) ?? ROUTE
  if (!CONTEXT_ID.test(String(options.contextId ?? '')))
    return { to, origin: null }
  const origin = options.load(String(options.contextId))
  if (!origin || origin.returnTo !== to || origin.expiresAt <= options.now || origin.scrollTop < 0)
    return { to, origin: null }
  return { to, origin }
}
