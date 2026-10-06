export interface ProjectReturnOrigin {
  id: string
  returnTo: string
  tabKey: '/project'
  anchorId: string
  scrollTop: number
  expiresAt: number
}

export interface ProjectListNavigationState {
  search: string
  phase: string
  sort: 'updated-desc' | 'name-asc'
  page: number
  pageSize: 10 | 20 | 50 | 100
  filters: {
    statuses: string[]
    plannedEnds: string[]
    managers: string[]
    customerIds: string[]
  }
}

interface CreateProjectReturnOriginOptions {
  contextId: string
  anchorId: string
  scrollTop: number
  now: number
  state: ProjectListNavigationState
}

interface ResolveProjectReturnContextOptions {
  returnTo: unknown
  contextId: unknown
  now: number
  load: (id: string) => ProjectReturnOrigin | null
}

const PROJECT_ROUTE = '/project'
const CONTEXT_ID = /^[\w-]{8,64}$/
const ROW_ANCHOR = /^#project-row-[\w%.~-]+$/
const MULTI_VALUE_KEYS = ['status', 'plannedEnd', 'manager', 'customer'] as const
const MAX_RETURN_TO_LENGTH = 131_072
export const PROJECT_RETURN_CONTEXT_TTL = 30 * 60_000
const PROJECT_RETURN_STORAGE_PREFIX = 'ruihang:project-return:'

function isSafeText(value: string, maxLength: number): boolean {
  return value.length <= maxLength && !hasControlCharacter(value)
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function appendText(
  source: URLSearchParams,
  target: URLSearchParams,
  key: string,
  maxLength: number,
) {
  const value = source.get(key)
  if (value != null && isSafeText(value, maxLength))
    target.set(key, value)
}

function appendPositiveInteger(
  source: URLSearchParams,
  target: URLSearchParams,
  key: string,
  allowed?: readonly number[],
) {
  const raw = source.get(key)
  if (raw == null || !/^\d+$/.test(raw))
    return
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000)
    return
  if (allowed && !allowed.includes(value))
    return
  target.set(key, String(value))
}

export function createProjectReturnOrigin(
  options: CreateProjectReturnOriginOptions,
): ProjectReturnOrigin {
  if (!CONTEXT_ID.test(options.contextId))
    throw new Error('invalid project return context id')
  if (!options.anchorId.startsWith('project-row-') || !isSafeText(options.anchorId, 240))
    throw new Error('invalid project return anchor')
  if (!Number.isFinite(options.scrollTop) || options.scrollTop < 0)
    throw new Error('invalid project return scroll position')

  const query = new URLSearchParams()
  if (options.state.search)
    query.set('search', options.state.search)
  if (options.state.phase !== 'all')
    query.set('phase', options.state.phase)
  if (options.state.sort !== 'updated-desc')
    query.set('sort', options.state.sort)
  if (options.state.page !== 1)
    query.set('page', String(options.state.page))
  if (options.state.pageSize !== 10)
    query.set('pageSize', String(options.state.pageSize))
  for (const value of options.state.filters.statuses)
    query.append('status', value)
  for (const value of options.state.filters.plannedEnds)
    query.append('plannedEnd', value)
  for (const value of options.state.filters.managers)
    query.append('manager', value)
  for (const value of options.state.filters.customerIds)
    query.append('customer', value)
  query.set('nav', options.contextId)

  const returnTo = `${PROJECT_ROUTE}?${query.toString()}#${encodeURIComponent(options.anchorId)}`
  const validated = validateProjectReturnTo(returnTo)
  if (!validated)
    throw new Error('invalid generated project return target')

  return {
    id: options.contextId,
    returnTo: validated,
    tabKey: PROJECT_ROUTE,
    anchorId: options.anchorId,
    scrollTop: options.scrollTop,
    expiresAt: options.now + PROJECT_RETURN_CONTEXT_TTL,
  }
}

function queryValues(value: unknown): string[] {
  if (typeof value === 'string')
    return [value]
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string')
  return []
}

function queryValue(value: unknown): string | undefined {
  return queryValues(value)[0]
}

function positiveInteger(value: unknown, fallback: number): number {
  const raw = queryValue(value)
  if (!raw || !/^\d+$/.test(raw))
    return fallback
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1_000_000
    ? parsed
    : fallback
}

export function projectListNavigationStateFromQuery(
  query: Record<string, unknown>,
): ProjectListNavigationState {
  const sort = queryValue(query.sort)
  const pageSize = positiveInteger(query.pageSize, 10)
  return {
    search: queryValue(query.search)?.slice(0, 120) ?? '',
    phase: queryValue(query.phase)?.slice(0, 48) || 'all',
    sort: sort === 'name-asc' ? 'name-asc' : 'updated-desc',
    page: positiveInteger(query.page, 1),
    pageSize: pageSize === 20 || pageSize === 50 || pageSize === 100 ? pageSize : 10,
    filters: {
      statuses: queryValues(query.status).slice(0, 20),
      plannedEnds: queryValues(query.plannedEnd).slice(0, 20),
      managers: queryValues(query.manager).slice(0, 20),
      customerIds: queryValues(query.customer).slice(0, 20),
    },
  }
}

export function isProjectReturnContextId(value: unknown): value is string {
  return typeof value === 'string' && CONTEXT_ID.test(value)
}

export function newProjectReturnContextId(): string {
  const uuid = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
  if (uuid)
    return `origin_${uuid}`
  return `origin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`
}

export function saveProjectReturnOrigin(origin: ProjectReturnOrigin, storage: Storage = sessionStorage) {
  storage.setItem(`${PROJECT_RETURN_STORAGE_PREFIX}${origin.id}`, JSON.stringify(origin))
}

export function loadProjectReturnOrigin(
  id: string,
  storage: Storage = sessionStorage,
): ProjectReturnOrigin | null {
  const raw = storage.getItem(`${PROJECT_RETURN_STORAGE_PREFIX}${id}`)
  if (!raw)
    return null
  try {
    const value = JSON.parse(raw) as Partial<ProjectReturnOrigin>
    if (value.id !== id
      || typeof value.returnTo !== 'string'
      || value.tabKey !== PROJECT_ROUTE
      || typeof value.anchorId !== 'string'
      || typeof value.scrollTop !== 'number'
      || typeof value.expiresAt !== 'number') {
      return null
    }
    return value as ProjectReturnOrigin
  }
  catch {
    return null
  }
}

export function validateProjectReturnTo(value: unknown): string | null {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_RETURN_TO_LENGTH
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || hasControlCharacter(value)) {
    return null
  }

  let url: URL
  try {
    url = new URL(value, 'https://ruihang.invalid')
  }
  catch {
    return null
  }

  if (url.origin !== 'https://ruihang.invalid'
    || url.username
    || url.password
    || url.pathname !== PROJECT_ROUTE
    || !ROW_ANCHOR.test(url.hash)) {
    return null
  }

  const query = new URLSearchParams()
  appendText(url.searchParams, query, 'search', 120)
  appendText(url.searchParams, query, 'phase', 48)

  const sort = url.searchParams.get('sort')
  if (sort === 'updated-desc' || sort === 'name-asc')
    query.set('sort', sort)

  appendPositiveInteger(url.searchParams, query, 'page')
  appendPositiveInteger(url.searchParams, query, 'pageSize', [10, 20, 50, 100])

  for (const key of MULTI_VALUE_KEYS) {
    for (const item of url.searchParams.getAll(key).slice(0, 20)) {
      if (isSafeText(item, 120))
        query.append(key, item)
    }
  }

  const contextId = url.searchParams.get('nav')
  if (!contextId || !CONTEXT_ID.test(contextId))
    return null
  query.set('nav', contextId)

  const search = query.toString()
  return `${PROJECT_ROUTE}${search ? `?${search}` : ''}${url.hash}`
}

export function resolveProjectReturnContext(
  options: ResolveProjectReturnContextOptions,
): { to: string, origin: ProjectReturnOrigin | null } {
  const canonical = { to: PROJECT_ROUTE, origin: null }
  const returnTo = validateProjectReturnTo(options.returnTo)
  if (!returnTo || typeof options.contextId !== 'string' || !CONTEXT_ID.test(options.contextId))
    return canonical

  const origin = options.load(options.contextId)
  if (!origin
    || origin.id !== options.contextId
    || origin.returnTo !== returnTo
    || origin.tabKey !== PROJECT_ROUTE
    || !Number.isFinite(origin.scrollTop)
    || origin.scrollTop < 0
    || !Number.isFinite(origin.expiresAt)
    || origin.expiresAt <= options.now) {
    return canonical
  }

  const encodedAnchor = returnTo.slice(returnTo.indexOf('#') + 1)
  try {
    if (decodeURIComponent(encodedAnchor) !== origin.anchorId)
      return canonical
  }
  catch {
    return canonical
  }

  return { to: returnTo, origin }
}
