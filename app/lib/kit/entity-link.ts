import type { NavigationTargetResolution } from '~/lib/nav/target-registry'
import type { DataOriginDTO, NavigationIntentDTO } from '~/types/read-model'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

export type EntityLinkType
  = | 'project'
    | 'supplier'
    | 'contract'
    | 'invoice'
    | 'customer'
    | 'crew'
    | 'worker'
    | 'quantity-unit'
    | 'wage-statement'
    | 'receipt'
    | 'subcontract-document'

export type EntityLinkResolution = NavigationTargetResolution | { state: 'empty', label: null }

export function resolveEntityLink(input: {
  type: EntityLinkType
  id?: string | null
  label?: string | null
  dataOrigin?: DataOriginDTO
}): EntityLinkResolution {
  const text = input.label ?? null
  if (text == null || text === '')
    return { state: 'empty', label: null }
  if (input.dataOrigin && !['project', 'customer', 'supplier', 'crew', 'worker'].includes(input.type))
    return { state: 'not-connected', label: text, message: '详情待接入' }
  if (input.id == null || input.id === '')
    return { state: 'missing', label: text, message: '未记录稳定身份' }

  const intent: NavigationIntentDTO = {
    kind: 'entity-detail',
    subject: {
      state: 'resolved',
      entity: input.type,
      id: input.id,
      label: text,
      no: null,
    },
    variant: 'detail',
    view: null,
    filters: input.dataOrigin ? { dataOrigin: input.dataOrigin } : {},
  }
  return resolveNavigationTarget(intent)
}
