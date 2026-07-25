export type BoqCatalogScopeKind = 'all' | 'section' | 'trade' | 'item'

export function boqCatalogScopeKey(
  kind: BoqCatalogScopeKind,
  lineIds: readonly string[] = [],
): string {
  if (kind === 'all')
    return 'all'
  return `${kind}:${JSON.stringify([...lineIds].sort())}`
}

export function boqCatalogScopeLineIds(
  scopeKey: string,
  catalog: readonly {
    lineIds: readonly string[]
    trades: readonly {
      lineIds: readonly string[]
      items: readonly { lineIds: readonly string[] }[]
    }[]
  }[],
): ReadonlySet<string> | null {
  if (scopeKey === 'all')
    return null
  for (const section of catalog) {
    if (boqCatalogScopeKey('section', section.lineIds) === scopeKey)
      return new Set(section.lineIds)
    for (const trade of section.trades) {
      if (boqCatalogScopeKey('trade', trade.lineIds) === scopeKey)
        return new Set(trade.lineIds)
      for (const item of trade.items) {
        if (boqCatalogScopeKey('item', item.lineIds) === scopeKey)
          return new Set(item.lineIds)
      }
    }
  }
  return new Set()
}
