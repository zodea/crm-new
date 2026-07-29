export interface MasterDataCapabilities {
  trades: string[]
  itemNames: string[]
}

function normalizeCapabilityValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeCapabilityList(values: readonly unknown[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const item = normalizeCapabilityValue(value)
    if (!item || seen.has(item))
      continue
    seen.add(item)
    normalized.push(item)
  }
  return normalized
}

export function parseCapabilityColumn(value: unknown): string[] {
  if (Array.isArray(value))
    return normalizeCapabilityList(value)
  if (typeof value !== 'string' || !value.trim())
    return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? normalizeCapabilityList(parsed) : []
  }
  catch {
    return []
  }
}

export function effectiveMasterDataCapabilities(
  primaryTrade: unknown,
  capabilityTrades: readonly unknown[] | unknown,
  capabilityItems: readonly unknown[] | unknown,
): MasterDataCapabilities {
  const trades = normalizeCapabilityList([
    normalizeCapabilityValue(primaryTrade),
    ...(Array.isArray(capabilityTrades)
      ? capabilityTrades
      : parseCapabilityColumn(capabilityTrades)),
  ])
  const itemNames = Array.isArray(capabilityItems)
    ? normalizeCapabilityList(capabilityItems)
    : parseCapabilityColumn(capabilityItems)
  return { trades, itemNames }
}

export function capabilityAllowsTrade(
  capability: MasterDataCapabilities,
  trade: string,
): boolean {
  const target = normalizeCapabilityValue(trade)
  return Boolean(target) && capability.trades.includes(target)
}

export function capabilityAllowsItem(
  capability: MasterDataCapabilities,
  trade: string,
  itemName: string,
): boolean {
  if (!capabilityAllowsTrade(capability, trade))
    return false
  if (!capability.itemNames.length)
    return true
  return capability.itemNames.includes(normalizeCapabilityValue(itemName))
}

export function capabilityCoversItems(
  capability: MasterDataCapabilities,
  trade: string,
  itemNames: readonly string[],
): boolean {
  if (!capabilityAllowsTrade(capability, trade))
    return false
  if (!capability.itemNames.length)
    return true
  const targets = normalizeCapabilityList(itemNames)
  return targets.length > 0 && targets.every(itemName => capability.itemNames.includes(itemName))
}
