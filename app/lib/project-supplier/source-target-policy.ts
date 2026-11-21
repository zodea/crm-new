import type { DataOriginDTO, EntityKindDTO } from '../../types/read-model'

export function isVerifiedProjectSupplierSourceTarget(input: {
  dataOrigin: DataOriginDTO
  entity: EntityKindDTO
  variant: string | null
}): boolean {
  return input.dataOrigin === 'demo'
    && input.entity === 'contract'
    && input.variant === 'detail'
}
