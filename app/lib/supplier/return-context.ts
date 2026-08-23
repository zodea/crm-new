import type { SupplierListSort } from './repository'

export interface SupplierListNavigationState {
  search: string
  category: string
  credentialStatus: string
  sort: SupplierListSort
  page: number
  pageSize: 10 | 20 | 50 | 100
}

const ROUTE = '/base/supplier'
const ANCHOR = /^supplier-row-[\w%.~-]+$/

function value(input: unknown): string | undefined {
  return typeof input === 'string' ? input : Array.isArray(input) && typeof input[0] === 'string' ? input[0] : undefined
}

export function supplierListNavigationStateFromQuery(query: Record<string, unknown>): SupplierListNavigationState {
  const sort = value(query.sort)
  const pageSize = Number(value(query.pageSize))
  return {
    search: value(query.search)?.slice(0, 120) ?? '',
    category: value(query.category)?.slice(0, 48) || 'all',
    credentialStatus: value(query.credentialStatus)?.slice(0, 48) || 'all',
    sort: ['name-asc', 'name-desc', 'category-asc'].includes(String(sort)) ? sort as SupplierListSort : 'updated-desc',
    page: Math.max(1, Number(value(query.page)) || 1),
    pageSize: [10, 20, 50, 100].includes(pageSize) ? pageSize as 10 | 20 | 50 | 100 : 10,
  }
}

export function createSupplierReturnTo(identity: string, state: SupplierListNavigationState): string {
  const query = new URLSearchParams()
  if (state.search)
    query.set('search', state.search)
  if (state.category !== 'all')
    query.set('category', state.category)
  if (state.credentialStatus !== 'all')
    query.set('credentialStatus', state.credentialStatus)
  if (state.sort !== 'updated-desc')
    query.set('sort', state.sort)
  if (state.page !== 1)
    query.set('page', String(state.page))
  if (state.pageSize !== 10)
    query.set('pageSize', String(state.pageSize))
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
    return createSupplierReturnTo(identity, supplierListNavigationStateFromQuery(Object.fromEntries(url.searchParams)))
  }
  catch {
    return null
  }
}
