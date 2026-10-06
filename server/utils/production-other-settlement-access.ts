export const PRODUCTION_OTHER_SETTLEMENT_CAPABILITIES = ['other-settlement:read', 'other-settlement:write'] as const
export function isProductionOtherSettlementRoute(method: string, path: string) {
  if (method === 'GET')
    return /^\/api\/read\/other-settlements(?:\/[^/]+(?:\/source|\/files\/[^/]+)?)?$/.test(path)
  return method === 'POST' && /^\/api\/commands\/other-settlements(?:\/resolve|\/preview|\/import|\/import\/resolve)?$/.test(path)
}
