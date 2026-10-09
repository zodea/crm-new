export const PRODUCTION_QUANTITY_CAPABILITIES = ['quantity:read', 'quantity:write'] as const

export function isProductionQuantityRoute(method: string, path: string): boolean {
  if (method === 'GET')
    return /^\/api\/read\/quantity\/(?:workspace|variance|templates|stages|region|photo|hollow|completion|boq|batch-plan|assignments|import)$/.test(path)
  return method === 'POST' && /^\/api\/commands\/quantity(?:\/(?:resolve|import(?:\/(?:restore|resolve))?))?$/.test(path)
}
