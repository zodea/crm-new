export const PRODUCTION_SUBCONTRACT_CONTRACT_CAPABILITIES = ['subcontract-contract:read', 'subcontract-contract:write', 'subcontract-contract:import'] as const
export function isProductionSubcontractContractRoute(path: string, method = 'GET') {
  return method === 'GET'
    ? /^\/api\/read\/subcontract-contracts(?:\/[a-z0-9][\w-]{2,79}(?:\/(?:form|files\/[a-z0-9][\w-]{2,79}))?)?$/i.test(path)
    : method === 'POST'
      ? /^\/api\/commands\/subcontract-contracts(?:\/(?:resolve|import(?:\/resolve)?|restore-import))?$/.test(path)
      : method === 'PUT' && /^\/api\/commands\/subcontract-contracts\/[a-z0-9][\w-]{2,79}$/i.test(path) && !/\/(?:resolve|import|restore-import)$/.test(path)
}
