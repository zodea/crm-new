export const PRODUCTION_WBS_CAPABILITIES = ['schedule:read', 'schedule:write', 'schedule:import'] as const
/** Actual WBS source reads and domain commands; no unrelated owner adoption endpoint. */
export function isProductionWbsRoute(path: string, method = 'GET') {
  return method === 'GET'
    ? /^\/api\/read\/schedule\/(?:catalog|workspace|scope|binding|import|files)$/.test(path)
    : method === 'POST' && /^\/api\/commands\/schedule(?:\/(?:resolve|import(?:\/resolve)?|restore-import))?$/.test(path)
}
