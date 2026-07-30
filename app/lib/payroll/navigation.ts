import type { WageStatementFilter, WageStatementStatus } from './statements'

type QueryValue = string | null | undefined | readonly (string | null)[]
type QueryLike = Record<string, QueryValue>

function firstQueryValue(value: QueryValue): string {
  if (Array.isArray(value))
    return value.find(item => typeof item === 'string') ?? ''
  return typeof value === 'string' ? value : ''
}

function normalizeStatus(value: string): WageStatementStatus | '' {
  return value === 'draft' || value === 'checked' || value === 'released'
    ? value
    : ''
}

export function payrollFiltersFromQuery(
  query: QueryLike,
  fallback: WageStatementFilter = {},
): WageStatementFilter {
  const month = firstQueryValue(query.month)
  return {
    projectId: firstQueryValue(query.project) || fallback.projectId || '',
    month: /^\d{4}-\d{2}$/.test(month) ? month : fallback.month || '',
    crewId: firstQueryValue(query.crew) || fallback.crewId || '',
    status: normalizeStatus(firstQueryValue(query.status)) || fallback.status || '',
  }
}

export function payrollFilterQuery(filters: WageStatementFilter): Record<string, string> {
  return Object.fromEntries(
    [
      ['project', filters.projectId],
      ['month', filters.month],
      ['crew', filters.crewId],
      ['status', filters.status],
    ].filter((entry): entry is [string, string] => Boolean(entry[1])),
  )
}

export function payrollListLocation(filters: WageStatementFilter) {
  return {
    path: '/subcontract/payroll',
    query: payrollFilterQuery(filters),
  }
}

export function payrollDraftLocation(filters: WageStatementFilter) {
  return {
    path: '/subcontract/payroll/new',
    query: payrollFilterQuery(filters),
  }
}
