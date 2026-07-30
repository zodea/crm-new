export type QuantityRouteQueryValue = string | readonly (string | null)[] | null | undefined
export type QuantityRouteQuery = Record<string, QuantityRouteQueryValue>

export interface QuantityFilterContext {
  project: string
  building: string
  month: string
  view: 'trade' | 'crew'
  trade: string
  assignee: string
}

const FILTER_KEYS = [
  'project',
  'building',
  'month',
  'view',
  'trade',
  'assignee',
] as const

function stringValue(value: QuantityRouteQueryValue): string {
  return typeof value === 'string' ? value : ''
}

export function buildQuantityFilterQuery(context: QuantityFilterContext): Record<keyof QuantityFilterContext, string> {
  return {
    project: context.project,
    building: context.building,
    month: context.month,
    view: context.view,
    trade: context.trade,
    assignee: context.assignee,
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
  }
}

export function quantityMatrixReturnPath(query: QuantityRouteQuery): string {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = stringValue(query[key])
    if (value)
      params.set(key, value)
  }
  const search = params.toString()
  return search ? `/subcontract/quantity?${search}` : '/subcontract/quantity'
}
