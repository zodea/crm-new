import type { QuantityMigrationTable } from './migration-graph'
import { isStableRouteIdentity } from '../util/stable-route-identity'

/** 与 mapQuantityMigrationGraph 的物理 ID 编码一致；只校验形状，归属仍由原图/关系证明。 */
export function isQuantitySourceIdentity(value: unknown, table: QuantityMigrationTable): value is string {
  if (isStableRouteIdentity(value))
    return true
  if (typeof value !== 'string' || value.length > 256)
    return false
  const matched = /^core-quantity_projects-[a-f0-9]{24}:([a-z_]+):(.+)$/.exec(value)
  if (!matched || matched[1] !== table)
    return false
  try {
    const original = decodeURIComponent(matched[2]!)
    return original.trim().length > 0 && encodeURIComponent(original) === matched[2]
  }
  catch { return false }
}
