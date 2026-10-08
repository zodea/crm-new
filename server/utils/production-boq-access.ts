export const PRODUCTION_BOQ_CAPABILITIES = ['boq:read', 'boq:write', 'boq:import', 'core:migration:write', 'owner-document:read', 'owner-document:write'] as const

/** Only the implemented BOQ owner and its original-number recovery are admitted. */
export function isProductionBoqRoute(method: string, path: string): boolean {
  if (method === 'GET')
    return /^\/api\/read\/boq\/(?:catalog|workspace|items|import|building-context|files)$/.test(path)
  return method === 'POST' && ['/api/commands/boq', '/api/commands/boq-building', '/api/commands/boq/resolve', '/api/commands/boq/import', '/api/commands/boq/import/preflight', '/api/commands/boq/import/restore', '/api/commands/boq/import/resolve'].includes(path)
}
