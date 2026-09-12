import type { DataOriginDTO } from '../../types/read-model'
import { isDataOriginDTO } from '../../types/read-model'
import { SCHEDULE_DRILL_QUERY_KEYS, scheduleSourceQuery } from '../schedule/navigation'

export type QuantityRouteQueryValue = string | readonly (string | null)[] | null | undefined
export type QuantityRouteQuery = Record<string, QuantityRouteQueryValue>

export interface QuantityFilterContext {
  project: string
  building: string
  month: string
  view: 'trade' | 'crew'
  trade: string
  assignee: string
  origin?: DataOriginDTO
}

export const QUANTITY_FILTER_KEYS = [
  'project',
  'building',
  'month',
  'view',
  'trade',
  'assignee',
  'origin',
] as const

function stringValue(value: QuantityRouteQueryValue): string {
  return typeof value === 'string' ? value : ''
}

export function readQuantityOrigin(query: QuantityRouteQuery): DataOriginDTO | null {
  return query.origin === undefined ? 'real' : isDataOriginDTO(query.origin) ? query.origin : null
}

export function buildQuantityFilterQuery(context: QuantityFilterContext): Record<string, string> {
  return {
    project: context.project,
    building: context.building,
    month: context.month,
    view: context.view,
    trade: context.trade,
    assignee: context.assignee,
    ...(context.origin ? { origin: context.origin } : {}),
  }
}

export function readQuantityFilterQuery(query: QuantityRouteQuery): Partial<QuantityFilterContext> {
  const view = stringValue(query.view)
  return {
    project: stringValue(query.project),
    building: stringValue(query.building),
    month: stringValue(query.month),
    ...(view === 'trade' || view === 'crew' ? { view } : {}),
    trade: stringValue(query.trade),
    assignee: stringValue(query.assignee),
    ...(isDataOriginDTO(query.origin) ? { origin: query.origin } : {}),
  }
}

export function quantityMatrixReturnPath(query: QuantityRouteQuery): string {
  const params = new URLSearchParams()
  for (const key of QUANTITY_FILTER_KEYS) {
    if (key === 'origin' && !isDataOriginDTO(query.origin))
      continue
    const value = stringValue(query[key])
    if (value)
      params.set(key, value)
  }
  for (const [key, value] of Object.entries(scheduleSourceQuery(query)))
    params.set(key, value)
  const search = params.toString()
  return search ? `/subcontract/quantity?${search}` : '/subcontract/quantity'
}

export function quantityUnitReturnPath(projectId: string, query: QuantityRouteQuery): string {
  if (typeof query.returnTo === 'string' && query.returnTo.startsWith('/subcontract/quantity?')) {
    const target = new URL(query.returnTo, 'https://ruihang.invalid')
    const values = Object.fromEntries(target.searchParams)
    if (target.pathname === '/subcontract/quantity' && values.project === projectId
      && readQuantityOrigin(values) === readQuantityOrigin(query)
      && [...QUANTITY_FILTER_KEYS, ...SCHEDULE_DRILL_QUERY_KEYS].every(key => target.searchParams.getAll(key).length <= 1)) {
      return quantityMatrixReturnPath(values)
    }
  }
  return quantityMatrixReturnPath({ ...query, project: projectId })
}
