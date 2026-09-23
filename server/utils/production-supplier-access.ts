export const PRODUCTION_SUPPLIER_CAPABILITIES = ['supplier:list:read', 'supplier:write', 'supplier:sensitive:read', 'supplier-credential:read', 'supplier-credential:write', 'supplier:persistent:write'] as const

export function isProductionSupplierRoute(method: string, path: string): boolean {
  const id = String.raw`[A-Za-z0-9][\w-]{2,79}`
  if (method === 'GET')
    return new RegExp(`^/api/read/(?:suppliers|suppliers/${id}(?:/form)?|supplier-credentials/${id}(?:/files/${id})?)$`).test(path)
  if (method === 'POST')
    return ['/api/commands/suppliers', '/api/commands/suppliers/import', '/api/commands/supplier-credentials', '/api/commands/supplier-resolve'].includes(path) || new RegExp(`^/api/commands/suppliers/${id}/taxpayer-verification$`).test(path)
  return method === 'PUT' && new RegExp(`^/api/commands/suppliers/${id}$`).test(path)
}
