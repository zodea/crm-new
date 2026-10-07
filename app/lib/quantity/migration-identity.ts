import type { QuantityHollowTable } from './central-hollow-schema'
import type { QuantityMigrationTable } from './migration-graph'
import { isStableRouteIdentity } from '../util/stable-route-identity'

/** 与 mapQuantityMigrationGraph 的物理 ID 编码一致；只校验形状，归属仍由原图/关系证明。 */
export function isQuantitySourceIdentity(value: unknown, table: QuantityMigrationTable | QuantityHollowTable): value is string {
  if (isStableRouteIdentity(value) && !value.startsWith('core-quantity_projects-') && !/^qty-[a-f0-9]{16,}-/.test(value))
    return true
  if (typeof value !== 'string' || value.length > 2048)
    return false
  const formal = /^qty-[a-f0-9]{64}-([^:]+):([a-z_]+):(.+)$/.exec(value)
  if (formal) {
    if (formal[2] !== table)
      return false
    try {
      return [formal[1]!, formal[3]!].every((encoded) => {
        const original = decodeURIComponent(encoded)
        return original.trim().length > 0 && encodeURIComponent(original) === encoded
      })
    }
    catch { return false }
  }
  const matched = /^core-quantity_projects-[a-f0-9]{24}:([a-z_]+):(.+)$/.exec(value)
  if (!matched || matched[1] !== table)
    return false
  try {
    const original = decodeURIComponent(matched[2]!)
    return original.trim().length > 0 && encodeURIComponent(original) === matched[2]
  }
  catch { return false }
}
