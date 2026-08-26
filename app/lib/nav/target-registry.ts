import type {
  EntityRefDTO,
  NavigationIntentDTO,
  NavigationUnavailableReasonDTO,
} from '~/types/read-model'
import { validateConstructionContractReturnTo } from '~/lib/construction-contract/return-context'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { isCustomerReturnContextId, validateCustomerReturnTo } from '~/lib/customer/return-context'
import {
  validateMaterialContractDetailJourneyReturnTo,
  validateProjectJourneyReturnTo,
} from '~/lib/material-contract/return-context'
import { isProjectReturnContextId, validateProjectReturnTo } from '~/lib/nav/return-to'
import {
  isOwnerDocumentReturnContextId,
  validateOwnerDocumentDetailReturnTo,
  validateOwnerDocumentJourneyReturnTo,
} from '~/lib/owner-document/return-context'
import { appendProjectSupplierReturnContext, validateProjectSupplierReturnTo } from '~/lib/project-supplier/return-context'
import { isVerifiedProjectSupplierSourceTarget } from '~/lib/project-supplier/source-target-policy'
import { validateSubcontractContractReturnTo } from '~/lib/subcontract-contract/return-context'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
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
type ListTargetIntent = Extract<NavigationIntentDTO, { kind: 'entity-list' }>
type ListTargetBuilder = (intent: ListTargetIntent) => string

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
  const query = new URLSearchParams({ origin: dataOrigin })
  if (intent.view != null) {
    if (!['projects', 'contracts', 'settlements', 'invoices', 'payments'].includes(intent.view))
      throw new Error('invalid supplier detail view')
    if (intent.view !== 'projects')
      query.set('tab', intent.view)
  }
  return `${path}?${query.toString()}`
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
  const kind = intent.filters.contractKind
  const dataOrigin = intent.filters.dataOrigin
  if (intent.variant === 'owner-document-source') {
    if (kind !== '施工' || dataOrigin !== 'real' || !isStableRouteIdentity(intent.view))
      throw new Error('invalid owner document source focus')
    const ownerTab = intent.filters.ownerTab
    if (ownerTab !== 'changes' && ownerTab !== 'settlements' && ownerTab !== 'acceptance')
      throw new Error('invalid owner document source tab')
    const query = new URLSearchParams({
      origin: 'real',
      contractKind: 'construction',
      tab: ownerTab,
      focus: intent.view,
    })
    const ownerView = intent.filters.ownerView
    if (ownerTab === 'acceptance') {
      if (ownerView !== 'acceptance' && ownerView !== 'warranty')
        throw new Error('invalid owner document source view')
      query.set('focusView', ownerView)
    }
    return `${path}?${query.toString()}`
  }
  if (intent.variant === 'supplement') {
    if ((kind !== '施工' && kind !== '分包')
      || !isDataOriginDTO(dataOrigin)
      || !isStableRouteIdentity(intent.view)) {
      throw new Error('invalid contract supplement focus')
    }
    const query = new URLSearchParams({
      origin: dataOrigin,
      contractKind: kind === '施工' ? 'construction' : 'subcontract',
      tab: kind === '分包' ? 'changes' : 'supplements',
      focus: intent.view,
    })
    return `${path}?${query.toString()}`
  }
  if (kind !== '材采' && kind !== '施工' && kind !== '分包')
    return path
  if (dataOrigin == null)
    return path
  if (!isDataOriginDTO(dataOrigin))
    throw new Error('invalid contract data origin')
  const query = new URLSearchParams({
    origin: dataOrigin,
    contractKind: kind === '材采' ? 'material' : kind === '施工' ? 'construction' : 'subcontract',
  })
  return `${path}?${query.toString()}`
}

function contractBoqPath(intent: EntityTargetIntent): string {
  const projectId = intent.filters.projectId
  const contractKind = intent.filters.contractKind
  const dataOrigin = intent.filters.dataOrigin
  if (typeof projectId !== 'string' || !projectId || contractKind !== '施工' || dataOrigin !== 'real')
    throw new Error('invalid construction contract BOQ context')
  const tab = intent.filters.boqTab
  if (tab != null && tab !== 'lines' && tab !== 'changes' && tab !== 'monthly')
    throw new Error('invalid construction contract BOQ tab')
  const query = new URLSearchParams({ project: projectId, contract: intent.subject.id })
  if (typeof tab === 'string' && tab !== 'lines')
    query.set('tab', tab)
  if (intent.view)
    query.set('focus', intent.view)
  return `/contract/boq?${query.toString()}`
}

function receiptPath(intent: EntityTargetIntent): string {
  const path = entityPath('/finance/receipt', intent)
  const dataOrigin = intent.filters.dataOrigin
  const customerId = intent.filters.customerId
  if (!isDataOriginDTO(dataOrigin) || typeof customerId !== 'string' || !customerId)
    throw new Error('invalid receipt relation context')
  return `${path}?origin=${dataOrigin}&customerId=${encodeURIComponent(customerId)}`
}

function ownerDocumentPath(intent: EntityTargetIntent): string {
  const dataOrigin = intent.filters.dataOrigin
  if (!isDataOriginDTO(dataOrigin)
    || !['change', 'report', 'acceptance', 'warranty', 'final-settlement'].includes(intent.variant ?? '')) {
    throw new Error('invalid owner document detail context')
  }
  const acceptance = intent.variant === 'acceptance' || intent.variant === 'warranty'
  const path = entityPath(acceptance ? '/owner/acceptance' : `/owner/${intent.variant}`, intent)
  const query = new URLSearchParams({ origin: dataOrigin })
  if (acceptance)
    query.set('variant', intent.variant!)
  return `${path}?${query.toString()}`
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
  'contract:supplement': contractPath,
  'contract:owner-document-source': contractPath,
  'contract:boq': contractBoqPath,
  'owner-document:change': ownerDocumentPath,
  'owner-document:report': ownerDocumentPath,
  'owner-document:acceptance': ownerDocumentPath,
  'owner-document:warranty': ownerDocumentPath,
  'owner-document:final-settlement': ownerDocumentPath,
  'invoice:detail': (intent: EntityTargetIntent) => entityPath('/finance/invoice', intent),
  'receipt:detail': receiptPath,
  'payment-application:detail': (intent: EntityTargetIntent) => `${entityPath('/finance/payment', intent)}/detail`,
  'quantity-unit:detail': quantityUnitPath,
  'wage-statement:detail': (intent: EntityTargetIntent) => withCrewWorkerFactContext(entityPath('/subcontract/payroll', intent), intent),
  'subcontract-document:penalty-detail': (intent: EntityTargetIntent) => withCrewWorkerFactContext(entityPath('/project/penalty', intent), intent),
} satisfies Record<string, TargetBuilder>

const LIST_TARGET_REGISTRY = {
  'contract:material': (intent: ListTargetIntent) => {
    const projectId = intent.filters.projectId
    const dataOrigin = intent.filters.dataOrigin
    if (typeof projectId !== 'string' || !projectId || !isDataOriginDTO(dataOrigin))
      throw new Error('invalid project material contract list context')
    return `/contract/material?${new URLSearchParams({ projectId, origin: dataOrigin }).toString()}`
  },
} satisfies Record<string, ListTargetBuilder>

type RegisteredTargetKey = keyof typeof TARGET_REGISTRY

function unavailable(
  state: Exclude<NavigationTargetState, 'resolved'>,
  label: string | null,
): NavigationTargetResolution {
  return { state, label, message: STATE_MESSAGES[state] }
}

function unavailableReasonState(
  reason: NavigationUnavailableReasonDTO,
): Exclude<NavigationTargetState, 'resolved'> {
  if (reason === 'error')
    return 'error'
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
  if (intent.kind === 'entity-list') {
    const key = `${intent.entity}:${intent.variant ?? ''}`
    const builder = LIST_TARGET_REGISTRY[key as keyof typeof LIST_TARGET_REGISTRY]
    if (!builder)
      return unavailable('unverified-target', options.label ?? null)
    try {
      let to = builder(intent)
      const returnTo = validateProjectJourneyReturnTo(options.returnTo, intent.filters.dataOrigin)
      if (returnTo)
        to = `${to}&returnTo=${encodeURIComponent(returnTo)}`
      return { state: 'resolved', label: '材料采购合同', to }
    }
    catch {
      return unavailable('error', options.label ?? null)
    }
  }

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
    if (options.returnTo && (key === 'project:detail' || key === 'customer:detail'
      || key === 'contract:detail' || key === 'contract:owner-document-source')) {
      const ownerReturnTo = validateOwnerDocumentDetailReturnTo(options.returnTo, intent.filters.dataOrigin)
      if (ownerReturnTo) {
        const separator = to.includes('?') ? '&' : '?'
        to = `${to}${separator}returnTo=${encodeURIComponent(ownerReturnTo)}`
      }
    }
    if (key === 'contract:supplement' && options.returnTo) {
      const entityIntent = intent as EntityTargetIntent
      const dataOrigin = entityIntent.filters.dataOrigin
      const contractKind = entityIntent.filters.contractKind
      const returnTo = contractKind === '施工'
        ? validateConstructionContractReturnTo(options.returnTo, dataOrigin)
        : contractKind === '分包'
          ? validateSubcontractContractReturnTo(options.returnTo, dataOrigin)
          : null
      const ownerReturnTo = validateOwnerDocumentDetailReturnTo(options.returnTo, dataOrigin)
      if (returnTo)
        to = `${to}&returnTo=${encodeURIComponent(returnTo)}`
      else if (ownerReturnTo)
        to = `${to}&returnTo=${encodeURIComponent(ownerReturnTo)}`
    }
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
    if (key === 'supplier:detail' && options.returnTo) {
      const returnTo = validateMaterialContractDetailJourneyReturnTo(options.returnTo, intent.filters.dataOrigin)
      if (returnTo)
        to = `${to}&returnTo=${encodeURIComponent(returnTo)}`
    }
    if (key === 'receipt:detail' && options.returnTo) {
      const entityIntent = intent as EntityTargetIntent
      const ownerReturnTo = validateOwnerDocumentDetailReturnTo(options.returnTo, entityIntent.filters.dataOrigin)
      if (ownerReturnTo && !to.includes('returnTo='))
        to = `${to}&returnTo=${encodeURIComponent(ownerReturnTo)}`
    }
    if ((key === 'owner-document:change' || key === 'owner-document:report'
      || key === 'owner-document:acceptance' || key === 'owner-document:warranty'
      || key === 'owner-document:final-settlement') && options.returnTo) {
      const entityIntent = intent as EntityTargetIntent
      const kind = key === 'owner-document:change'
        ? 'owner_change'
        : key === 'owner-document:report'
          ? 'owner_report'
          : key === 'owner-document:final-settlement'
            ? 'final_settlement'
            : 'acceptance'
      const returnTo = validateOwnerDocumentJourneyReturnTo(options.returnTo, kind, entityIntent.filters.dataOrigin)
      if (returnTo) {
        to = `${to}&returnTo=${encodeURIComponent(returnTo)}`
        if (isOwnerDocumentReturnContextId(options.returnContextId))
          to = `${to}&returnContext=${encodeURIComponent(options.returnContextId)}`
      }
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
