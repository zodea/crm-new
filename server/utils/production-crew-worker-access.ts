export const PRODUCTION_CREW_WORKER_CAPABILITIES = ['crew:list:read', 'crew:write', 'worker:list:read', 'worker:write', 'worker:sensitive:read', 'payroll:read', 'core:migration:write'] as const

export function isProductionCrewWorkerRoute(method: string, path: string): boolean {
  const id = String.raw`[A-Za-z0-9][\w-]{2,79}`
  if (method === 'GET')
    return new RegExp(`^/api/read/(?:crews|workers|(?:crews|workers)/${id}(?:/form)?|crew-worker-facts/(?:assignment|wage|penalty)/${id}|worker-roster/(?:profile|file|archives|archive)|crew-worker/import)$`).test(path)
  if (method === 'POST')
    return ['/api/commands/crews', '/api/commands/workers', '/api/commands/crews/resolve', '/api/commands/workers/resolve', '/api/commands/worker-roster', '/api/commands/worker-roster-resolve', '/api/read/worker-roster/preview', '/api/commands/crew-worker/import', '/api/commands/crew-worker/import/resolve'].includes(path)
  return method === 'PUT' && new RegExp(`^/api/commands/(?:crews|workers)/${id}$`).test(path)
}
