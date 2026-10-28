export const PRODUCTION_TARGET_COST_CAPABILITIES = ['target-cost:read', 'target-cost:write', 'target-cost:import'] as const

export function isProductionTargetCostRoute(method: string, path: string): boolean {
  const id = String.raw`[A-Za-z0-9][\w-]{2,79}`
  if (method === 'GET')
    return new RegExp(`^/api/read/target-costs(?:/${id}(?:/files/${id})?)?$`).test(path)
  return method === 'POST' && /^\/api\/commands\/target-costs(?:\/resolve|\/import(?:\/(?:preflight|restore|resolve))?)?$/.test(path)
}
