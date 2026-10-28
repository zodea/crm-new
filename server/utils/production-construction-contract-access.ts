export const PRODUCTION_CONSTRUCTION_CONTRACT_CAPABILITIES = ['construction-contract:read', 'construction-contract:write', 'construction-contract:import'] as const
export function isProductionConstructionContractRoute(path: string, method = 'GET') {
  return method === 'GET'
    ? /^\/api\/read\/construction-contracts(?:\/[a-z0-9][\w-]{2,79}(?:\/(?:form|files\/[a-z0-9][\w-]{2,79}))?)?$/i.test(path)
    : method === 'POST'
      ? /^\/api\/commands\/construction-contracts(?:\/(?:resolve|import(?:\/resolve)?|restore-import))?$/.test(path)
      : method === 'PUT' && /^\/api\/commands\/construction-contracts\/[a-z0-9][\w-]{2,79}$/i.test(path) && !/\/(?:resolve|import|restore-import)$/.test(path)
}
