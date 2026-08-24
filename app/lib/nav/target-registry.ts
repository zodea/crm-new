import type {
  EntityRefDTO,
  NavigationIntentDTO,
  NavigationUnavailableReasonDTO,
} from '~/types/read-model'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { isCustomerReturnContextId, validateCustomerReturnTo } from '~/lib/customer/return-context'
import { isProjectReturnContextId, validateProjectReturnTo } from '~/lib/nav/return-to'
import { appendProjectSupplierReturnContext, validateProjectSupplierReturnTo } from '~/lib/project-supplier/return-context'
import { isVerifiedProjectSupplierSourceTarget } from '~/lib/project-supplier/source-target-policy'
import { isDataOriginDTO } from '~/types/read-model'

export type NavigationTargetState
  = 'resolved' | 'missing' | 'forbidden' | 'not-connected' | 'unverified-target' | 'error'

export type NavigationTargetResolution
  = {
    state: 'resolved'
    label: string
    to: string
  }
  | {
    state: Exclude<NavigationTargetState, 'resolved'>
    label: string | null
    message: string
  }

interface ResolveNavigationTargetOptions {
  label?: string | null
  returnTo?: string
  returnContextId?: string
}

type ResolvedEntityRef = Extract<EntityRefDTO, { state: 'resolved' }>
type EntityTargetIntent = Extract<NavigationIntentDTO, { kind: 'entity-detail' | 'entity-subview' | 'source-record' }>
  & { subject: ResolvedEntityRef }
type TargetBuilder = (intent: EntityTargetIntent) => string

const STATE_MESSAGES: Record<Exclude<NavigationTargetState, 'resolved'>, string> = {
  'missing': '未记录稳定身份',
  'forbidden': '无查看权限',
  'not-connected': '详情待接入',
  'unverified-target': '目标待核验',
  'error': '目标解析失败',
}

function entityPath(prefix: string, intent: EntityTargetIntent): string {
  return `${prefix}/${encodeURIComponent(intent.subject.id)}`
}

function projectPath(intent: EntityTargetIntent): string {
  const path = entityPath('/project', intent)
  const dataOrigin = intent.filters.dataOrigin
  if (dataOrigin == null)
    return path
  if (!isDataOriginDTO(dataOrigin))
    throw new Error('invalid project data origin')
  return `${path}?origin=${dataOrigin}`
}

function customerPath(intent: EntityTargetIntent): string {
  const path = entityPath('/base/customer', intent)
  const dataOrigin = intent.filters.dataOrigin
  if (dataOrigin == null)
    return path
  if (!isDataOriginDTO(dataOrigin))
    throw new Error('invalid customer data origin')
  return `${path}?origin=${dataOrigin}`
}

function supplierPath(intent: EntityTargetIntent): string {
  const path = entityPath('/base/supplier', intent)
  const dataOrigin = intent.filters.dataOrigin
  if (dataOrigin == null)
    return path
  if (!isDataOriginDTO(dataOrigin))
    throw new Error('invalid supplier data origin')
  return `${path}?origin=${dataOrigin}`
}

function crewPath(intent: EntityTargetIntent): string {
  const path = entityPath('/base/crew', intent)
  const dataOrigin = intent.filters.dataOrigin
  if (dataOrigin == null)
    return path
  if (!isDataOriginDTO(dataOrigin))
    throw new Error('invalid crew data origin')
  return `${path}?origin=${dataOrigin}`
}

function workerPath(intent: EntityTargetIntent): string {
  const path = entityPath('/base/worker', intent)
  const dataOrigin = intent.filters.dataOrigin
  if (dataOrigin == null)
    return path
  if (!isDataOriginDTO(dataOrigin))
    throw new Error('invalid worker data origin')
  return `${path}?origin=${dataOrigin}`
}

function projectSupplierPath(intent: EntityTargetIntent): string {
  const supplierId = intent.filters.supplierId
  if (typeof supplierId !== 'string' || !supplierId)
    throw new Error('invalid supplier workbench context')
  const dataOrigin = intent.filters.dataOrigin
  if (!isDataOriginDTO(dataOrigin))
    throw new Error('invalid supplier workbench origin')
  const view = intent.view ?? 'overview'
  if (!['overview', 'contract', 'claim', 'ticket', 'payment', 'settlement'].includes(view))
    throw new Error('invalid supplier workbench view')
  const query = new URLSearchParams()
  if (dataOrigin !== 'real')
    query.set('origin', dataOrigin)
  query.set('tab', view)
  return `/project/${encodeURIComponent(intent.subject.id)}/supplier/${encodeURIComponent(supplierId)}?${query.toString()}`
}

function contractPath(intent: EntityTargetIntent): string {
  const path = entityPath('/contract', intent)
  if (intent.kind === 'source-record')
    return path
  if (intent.filters.contractKind !== '材采')
    return path
  const dataOrigin = intent.filters.dataOrigin
  if (dataOrigin == null)
    return path
  if (!isDataOriginDTO(dataOrigin))
    throw new Error('invalid contract data origin')
  return `${path}?${new URLSearchParams({ origin: dataOrigin, contractKind: 'material' }).toString()}`
}

function receiptPath(intent: EntityTargetIntent): string {
  const path = entityPath('/finance/receipt', intent)
  const dataOrigin = intent.filters.dataOrigin
  const customerId = intent.filters.customerId
  if (!isDataOriginDTO(dataOrigin) || typeof customerId !== 'string' || !customerId)
    throw new Error('invalid receipt relation context')
  return `${path}?origin=${dataOrigin}&customerId=${encodeURIComponent(customerId)}`
}

function quantityUnitPath(intent: EntityTargetIntent): string {
  const projectId = intent.filters.projectId
  if (typeof projectId !== 'string' || !projectId)
    throw new Error('invalid quantity unit project context')
  return withCrewWorkerFactContext(
    `/subcontract/quantity/${encodeURIComponent(projectId)}/${encodeURIComponent(intent.subject.id)}`,
    intent,
  )
}

function withCrewWorkerFactContext(path: string, intent: EntityTargetIntent): string {
  const dataOrigin = intent.filters.dataOrigin
  const ownerKind = intent.filters.ownerKind
  const ownerId = intent.filters.ownerId
  if (ownerKind == null && ownerId == null)
    return path
  if (!isDataOriginDTO(dataOrigin) || (ownerKind !== 'crew' && ownerKind !== 'worker') || typeof ownerId !== 'string' || !ownerId)
    throw new Error('invalid crew-worker fact context')
  const query = new URLSearchParams({ origin: dataOrigin, ownerKind, ownerId })
  return `${path}?${query.toString()}`
}

function hasCrewWorkerFactContext(intent: EntityTargetIntent): boolean {
  return isDataOriginDTO(intent.filters.dataOrigin)
    && (intent.filters.ownerKind === 'crew' || intent.filters.ownerKind === 'worker')
    && typeof intent.filters.ownerId === 'string'
    && intent.filters.ownerId.length > 0
}

const TARGET_REGISTRY = {
  'project:detail': projectPath,
  'project:supplier-workbench': projectSupplierPath,
  'customer:detail': customerPath,
  'supplier:detail': supplierPath,
  'crew:detail': crewPath,
  'worker:detail': workerPath,
  'contract:detail': contractPath,
  'invoice:detail': (intent: EntityTargetIntent) => entityPath('/finance/invoice', intent),
  'receipt:detail': receiptPath,
  'payment-application:detail': (intent: EntityTargetIntent) => `${entityPath('/finance/payment', intent)}/detail`,
  'quantity-unit:detail': quantityUnitPath,
  'wage-statement:detail': (intent: EntityTargetIntent) => withCrewWorkerFactContext(entityPath('/subcontract/payroll', intent), intent),
  'subcontract-document:penalty-detail': (intent: EntityTargetIntent) => withCrewWorkerFactContext(entityPath('/project/penalty', intent), intent),
} satisfies Record<string, TargetBuilder>

type RegisteredTargetKey = keyof typeof TARGET_REGISTRY

function unavailable(
  state: Exclude<NavigationTargetState, 'resolved'>,
  label: string | null,
): NavigationTargetResolution {
  return { state, label, message: STATE_MESSAGES[state] }
}

function unavailableReasonState(
  reason: NavigationUnavailableReasonDTO,
): Exclude<NavigationTargetState, 'resolved' | 'error'> {
  if (reason === 'missing-id')
    return 'missing'
  if (reason === 'forbidden')
    return 'forbidden'
  if (reason === 'unverified-target')
    return 'unverified-target'
  return 'not-connected'
}

function hasRegisteredEntity(entity: string): boolean {
  return Object.keys(TARGET_REGISTRY).some(key => key.startsWith(`${entity}:`))
}

export function registeredTargetKeys(): RegisteredTargetKey[] {
  return Object.keys(TARGET_REGISTRY).sort() as RegisteredTargetKey[]
}

export function resolveNavigationTarget(
  intent: NavigationIntentDTO,
  options: ResolveNavigationTargetOptions = {},
): NavigationTargetResolution {
  if (intent.kind === 'unavailable') {
    const state = unavailableReasonState(intent.reason)
    return unavailable(state, state === 'forbidden' ? null : options.label ?? null)
  }
  if (intent.kind === 'entity-list')
    return unavailable('unverified-target', options.label ?? null)

  if (intent.subject.state === 'missing')
    return unavailable('missing', null)
  if (intent.subject.state === 'forbidden')
    return unavailable('forbidden', null)
  if (intent.subject.id.trim() === '')
    return unavailable('missing', intent.subject.label)
  if (intent.kind === 'same-route-overlay')
    return unavailable('unverified-target', intent.subject.label)
  const key = `${intent.subject.entity}:${intent.variant ?? ''}`
  if (intent.kind === 'source-record') {
    const dataOrigin = intent.filters.dataOrigin
    const returnContext = validateProjectSupplierReturnTo(options.returnTo)
    if (!isDataOriginDTO(dataOrigin) || returnContext?.origin !== dataOrigin
      || !isVerifiedProjectSupplierSourceTarget({
        dataOrigin,
        entity: intent.subject.entity,
        variant: intent.variant,
      })) {
      return unavailable('unverified-target', intent.subject.label)
    }
  }
  if (key === 'subcontract-document:penalty-detail' && !hasCrewWorkerFactContext(intent as EntityTargetIntent))
    return unavailable('unverified-target', intent.subject.label)
  const builder = TARGET_REGISTRY[key as RegisteredTargetKey]
  if (!builder) {
    return unavailable(
      hasRegisteredEntity(intent.subject.entity) ? 'unverified-target' : 'not-connected',
      intent.subject.label,
    )
  }

  try {
    let to = builder(intent as EntityTargetIntent)
    if (intent.kind === 'source-record' && options.returnTo)
      to = appendProjectSupplierReturnContext(to, options.returnTo)
    if (key === 'project:detail' && options.returnTo && options.returnContextId) {
      const returnTo = validateProjectReturnTo(options.returnTo)
      if (!returnTo || !isProjectReturnContextId(options.returnContextId))
        throw new Error('invalid project return context')
      const separator = to.includes('?') ? '&' : '?'
      to = `${to}${separator}returnTo=${encodeURIComponent(returnTo)}&returnContext=${encodeURIComponent(options.returnContextId)}`
    }
    if (key === 'receipt:detail' && options.returnTo && options.returnContextId) {
      const returnTo = validateCustomerReturnTo(options.returnTo)
      if (returnTo && isCustomerReturnContextId(options.returnContextId))
        to = `${to}&returnTo=${encodeURIComponent(returnTo)}&returnContext=${encodeURIComponent(options.returnContextId)}`
    }
    if (options.returnTo && (key === 'crew:detail'
      || key === 'worker:detail'
      || key === 'project:detail'
      || key === 'quantity-unit:detail'
      || key === 'wage-statement:detail'
      || key === 'subcontract-document:penalty-detail')) {
      const returnTo = validateCrewWorkerReturnTo(options.returnTo)
      if (returnTo) {
        const separator = to.includes('?') ? '&' : '?'
        to = `${to}${separator}returnTo=${encodeURIComponent(returnTo)}`
      }
    }
    return {
      state: 'resolved',
      label: intent.subject.label,
      to,
    }
  }
  catch {
    return unavailable('error', intent.subject.label)
  }
}
