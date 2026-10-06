export const PRODUCTION_MATERIAL_QUOTATION_CAPABILITIES = ['material-quotation:read', 'material-quotation:write'] as const
export function isProductionMaterialQuotationRoute(method: string, path: string): boolean {
  if (method === 'GET')
    return /^\/api\/read\/material-quotations(?:\/context|\/import-context|\/imports|\/[^/]+\/files\/[^/]+)?$/.test(path)
  return method === 'POST' && /^\/api\/commands\/material-quotations(?:\/resolve|\/import|\/import\/resolve)?$/.test(path)
}
