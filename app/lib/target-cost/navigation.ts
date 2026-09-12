import type { DataOriginDTO } from '~/types/read-model'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'

export const TARGET_COST_LIST_PATH = '/project/target-cost'
export const TARGET_COST_FILTER_KEYS = ['search', 'project', 'baseline', 'status', 'page', 'pageSize', 'sort', 'deleted'] as const
const hasControlCharacters = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)

export function targetCostOrigin(value: unknown): DataOriginDTO | null {
  return value == null || value === 'real' ? 'real' : value === 'demo' ? 'demo' : null
}

export function targetCostListQuery(query: Record<string, unknown>): Record<string, string | string[]> {
  const origin = targetCostOrigin(query.origin)
  if (!origin)
    return {}
  const result: Record<string, string | string[]> = { origin }
  for (const key of TARGET_COST_FILTER_KEYS) {
    const raw = query[key]
    const values = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string' && value.length > 0 && !hasControlCharacters(value))
    if (!values.length)
      continue
    if (key === 'page' || key === 'pageSize') {
      if (values.length === 1 && /^\d+$/.test(values[0]!) && Number(values[0]) > 0)
        result[key] = values[0]!
    }
    else if (key === 'baseline' || key === 'status') {
      const allowed = key === 'baseline' ? ['baseline', 'history'] : ['draft', 'submitted']
      const selected = [...new Set(values.filter(value => allowed.includes(value)))]
      if (selected.length)
        result[key] = selected
    }
    else if (values.length === 1) {
      result[key] = values[0]!
    }
  }
  return result
}

export function targetCostListPath(query: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(targetCostListQuery(query))) {
    for (const item of Array.isArray(value) ? value : [value])
      params.append(key, item)
  }
  return `${TARGET_COST_LIST_PATH}?${params}`
}

export function targetCostReturnTo(value: unknown, origin: DataOriginDTO, depth = 0): string | null {
  if (depth > 1)
    return null
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || hasControlCharacters(value))
    return null
  try {
    const url = new URL(value, 'https://ruihang.invalid')
    if (url.origin !== 'https://ruihang.invalid' || url.searchParams.getAll('origin').length > 1 || targetCostOrigin(url.searchParams.get('origin')) !== origin)
      return null
    if (url.pathname === TARGET_COST_LIST_PATH) {
      const query: Record<string, unknown> = {}
      for (const key of ['origin', ...TARGET_COST_FILTER_KEYS]) {
        const values = url.searchParams.getAll(key)
        if (values.length)
          query[key] = values.length > 1 ? values : values[0]
      }
      return targetCostListPath(query)
    }
    const match = url.pathname.match(/^\/project\/target-cost\/([^/]+)$/)
    if (!match || ['form', 'new', 'edit'].includes(match[1]!) || !isStableRouteIdentity(decodeURIComponent(match[1]!)))
      return null
    const query = new URLSearchParams({ origin })
    if (url.searchParams.get('tab') === 'comparison')
      query.set('tab', 'comparison')
    const parent = depth === 0 && url.searchParams.getAll('returnTo').length === 1 ? targetCostReturnTo(url.searchParams.get('returnTo'), origin, depth + 1) : null
    if (parent && new URL(parent, 'https://ruihang.invalid').pathname === TARGET_COST_LIST_PATH)
      query.set('returnTo', parent)
    return `${TARGET_COST_LIST_PATH}/${encodeURIComponent(decodeURIComponent(match[1]!))}?${query}`
  }
  catch {
    return null
  }
}

export const TARGET_COST_SOURCE_PATHS = ['/contract/material', '/contract/subcontract', '/contract/other-expense', '/contract/other-settlement', '/subcontract/settlement'] as const
export const TARGET_COST_SOURCE_QUERY_KEYS = ['budgetId', 'budgetProject', 'budgetReturnTo'] as const

export function targetCostSourceContext(path: string, query: Record<string, unknown>) {
  const origin = targetCostOrigin(query.origin)
  if (!(TARGET_COST_SOURCE_PATHS as readonly string[]).includes(path) || !origin || !isStableRouteIdentity(query.budgetId) || !isStableRouteIdentity(query.budgetProject))
    return null
  const returnTo = targetCostReturnTo(query.budgetReturnTo, origin)
  if (!returnTo || decodeURIComponent(new URL(returnTo, 'https://ruihang.invalid').pathname) !== `${TARGET_COST_LIST_PATH}/${query.budgetId}`)
    return null
  return { id: query.budgetId, projectId: query.budgetProject, origin, returnTo }
}

export function targetCostSourceLocation(path: string, input: { id: string, projectId: string | null, origin: DataOriginDTO, returnTo: string }) {
  if (!(TARGET_COST_SOURCE_PATHS as readonly string[]).includes(path) || !input.projectId)
    return null
  const query = { origin: input.origin, projectId: input.projectId, budgetId: input.id, budgetProject: input.projectId, budgetReturnTo: input.returnTo }
  return targetCostSourceContext(path, query) ? { path, query } : null
}

export function targetCostLocation(id: string, origin: DataOriginDTO, returnTo?: string, edit = false) {
  const query: Record<string, string> = { origin }
  const validated = targetCostReturnTo(returnTo, origin)
  if (validated)
    query.returnTo = validated
  return { path: `${TARGET_COST_LIST_PATH}${edit ? '/form' : ''}/${encodeURIComponent(id)}`, query }
}
