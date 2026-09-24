const STABLE_ROUTE_IDENTITY = /^[\w.~:/-]+$/

export function isStableRouteIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && STABLE_ROUTE_IDENTITY.test(value)
}
