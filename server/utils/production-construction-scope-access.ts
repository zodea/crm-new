export const PRODUCTION_CONSTRUCTION_SCOPE_CAPABILITIES = ['construction-scope:read', 'construction-scope:write'] as const
export function isProductionConstructionScopeRoute(method: string, path: string) {
  return method === 'GET' ? /^\/api\/read\/construction-scope(?:\/spending)?$/.test(path) : method === 'POST' && /^\/api\/commands\/construction-scope(?:\/resolve)?$/.test(path)
}
