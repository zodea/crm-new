export const PRODUCTION_MATERIAL_CONTRACT_CAPABILITIES = ['material-contract:read', 'material-contract:write', 'material-contract:sensitive:read'] as const

export function isProductionMaterialContractRoute(method: string, path: string): boolean {
  const id = String.raw`[A-Za-z0-9][\w-]{2,79}`
  if (method === 'GET') {
    if (['/api/read/material-contracts', '/api/read/material-contracts/form-context', '/api/read/material-contracts/prices'].includes(path))
      return true
    return new RegExp(`^/api/read/material-contracts/${id}(?:/form|/files/${id})?$`).test(path)
  }
  if (method === 'POST')
    return ['/api/commands/material-contracts', '/api/commands/material-contracts/resolve'].includes(path)
  return method === 'PUT' && new RegExp(`^/api/commands/material-contracts/${id}$`).test(path)
}
