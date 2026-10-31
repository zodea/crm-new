import type { DataOriginDTO, EntityKindDTO } from '../../types/read-model'

const VERIFIED_DEMO_SOURCE_TARGETS = new Set([
  'contract:detail',
])

export function isVerifiedProjectSupplierSourceTarget(input: {
  dataOrigin: DataOriginDTO
  entity: EntityKindDTO
  variant: string | null
}): boolean {
  return input.dataOrigin === 'demo'
    && VERIFIED_DEMO_SOURCE_TARGETS.has(`${input.entity}:${input.variant ?? ''}`)
}
