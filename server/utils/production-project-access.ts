export const PRODUCTION_PROJECT_CAPABILITIES = ['project:list:read', 'project:write', 'project:original:write', 'project:lifecycle:write'] as const
/** Exact production routes. No development fixture, arbitrary owner or demo route is allowed. */
export function isProductionProjectRoute(method: string, path: string): boolean {
  const id = String.raw`[A-Za-z0-9][\w-]{2,79}`
  if (method === 'GET')
    return new RegExp(`^/api/read/(?:projects|projects-deleted|projects/${id}(?:/(?:form|lifecycle|audit|files/${id}))?)$`).test(path)
  if (method === 'POST')
    return path === '/api/commands/projects' || path === '/api/commands/project-resolve' || new RegExp(`^/api/commands/projects/${id}/lifecycle$`).test(path)
  return method === 'PUT' && new RegExp(`^/api/commands/projects/${id}$`).test(path)
}
