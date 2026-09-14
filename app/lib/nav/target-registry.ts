import type {
  EntityRefDTO,
  NavigationIntentDTO,
  NavigationUnavailableReasonDTO,
} from '~/types/read-model'
import { auxiliaryDetailPath } from '~/lib/auxiliary-contract/contract'
import { validateAuxiliaryDetailReturnTo, validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { validateConstructionContractReturnTo } from '~/lib/construction-contract/return-context'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { isCustomerReturnContextId, validateCustomerDetailReturnTo, validateCustomerReturnTo } from '~/lib/customer/return-context'
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
import { payrollAWorkspaceReturn } from '~/lib/payroll/a-navigation'
import { payrollAdjustmentReturn } from '~/lib/payroll/adjustment-navigation'
import { payrollC1WorkspaceReturn } from '~/lib/payroll/c1-navigation'
import { payrollC2WorkspaceReturn } from '~/lib/payroll/c2-navigation'
import { payrollReadLocation, payrollViewScope } from '~/lib/payroll/central-navigation'
import {
  appendProjectSupplierReturnContext,
  validateProjectSupplierIdentityReturnTo,
  validateProjectSupplierReturnTo,
} from '~/lib/project-supplier/return-context'
import { isVerifiedProjectSupplierSourceTarget } from '~/lib/project-supplier/source-target-policy'
import { isQuantitySourceIdentity } from '~/lib/quantity/migration-identity'
import { validateReceiptReturnTo } from '~/lib/receipt/return-context'
import { validateSubcontractContractReturnTo } from '~/lib/subcontract-contract/return-context'
import { validateSupplierDetailReturnTo, validateSupplierReturnTo } from '~/lib/supplier/return-context'
import { TARGET_COST_LIST_PATH, targetCostReturnTo, targetCostSourceLocation } from '~/lib/target-cost/navigation'
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
  if (intent.variant === 'other_expense' || intent.variant === 'company_expense') {
    if (!isDataOriginDTO(intent.filters.dataOrigin) || intent.filters.contractKind !== intent.variant)
      throw new Error('invalid auxiliary contract source')
    return auxiliaryDetailPath(intent.variant, intent.subject.id, intent.filters.dataOrigin)
  }
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
  if (intent.variant === 'subcontract-document-source') {
    if (kind !== '分包' || dataOrigin !== 'real' || !isStableRouteIdentity(intent.view)
      || !['changes', 'settlements', 'penalties'].includes(String(intent.filters.subcontractTab))) {
      throw new Error('invalid subcontract document source focus')
    }
    return `${path}?${new URLSearchParams({
      origin: 'real',
      contractKind: 'subcontract',
      tab: String(intent.filters.subcontractTab),
      focus: intent.view,
    }).toString()}`
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
  if (!isDataOriginDTO(dataOrigin) || (customerId != null && customerId !== '' && !isStableRouteIdentity(customerId)))
    throw new Error('invalid receipt relation context')
  const query = new URLSearchParams({ origin: dataOrigin })
  if (typeof customerId === 'string' && customerId)
    query.set('customerId', customerId)
  return `${path}?${query}`
}

function ownerDocumentPath(intent: EntityTargetIntent): string {
  const dataOrigin = intent.filters.dataOrigin
  if (!isDataOriginDTO(dataOrigin)
    || !['change', 'report', 'acceptance', 'warranty', 'final-settlement', 'penalty'].includes(intent.variant ?? '')) {
    throw new Error('invalid owner document detail context')
  }
  const acceptance = intent.variant === 'acceptance' || intent.variant === 'warranty'
  const path = entityPath(acceptance ? '/owner/acceptance' : `/owner/${intent.variant}`, intent)
  const query = new URLSearchParams({ origin: dataOrigin })
  if (acceptance)
    query.set('variant', intent.variant!)
  return `${path}?${query.toString()}`
}

function subcontractDocumentPath(intent: EntityTargetIntent): string {
  const dataOrigin = intent.filters.dataOrigin
  if (!isDataOriginDTO(dataOrigin) || !['change', 'settlement', 'penalty'].includes(String(intent.variant)))
    throw new Error('invalid subcontract document detail context')
  return `${entityPath(intent.variant === 'penalty' ? '/project/penalty' : `/subcontract/${intent.variant}`, intent)}?origin=${dataOrigin}`
}

function quantityUnitPath(intent: EntityTargetIntent): string {
  const projectId = intent.filters.projectId
  if (typeof projectId !== 'string' || !projectId)
    throw new Error('invalid quantity unit project context')
  const target = withCrewWorkerFactContext(
    `/subcontract/quantity/${encodeURIComponent(projectId)}/${encodeURIComponent(intent.subject.id)}`,
    intent,
  )
  if (!hasCrewWorkerFactContext(intent) && isDataOriginDTO(intent.filters.dataOrigin)) {
    const query = new URLSearchParams({ origin: intent.filters.dataOrigin })
    for (const [key, table] of [['stageId', 'construction_stages'], ['itemId', 'items'], ['completionId', 'unit_stage_completions']] as const) {
      if (isQuantitySourceIdentity(intent.filters[key], table))
        query.set(key, String(intent.filters[key]))
    }
    return `${target}?${query}`
  }
  return target
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
  'target-cost:detail': (intent: EntityTargetIntent) => {
    if (!isDataOriginDTO(intent.filters.dataOrigin))
      throw new Error('invalid target cost origin')
    return `${entityPath(TARGET_COST_LIST_PATH, intent)}?origin=${intent.filters.dataOrigin}`
  },
  'settlement:other_settlement': (intent: EntityTargetIntent) => {
    if (intent.filters.dataOrigin !== 'real')
      throw new Error('invalid settlement origin')
    return `${entityPath('/contract/other-settlement', intent)}?origin=real`
  },
  'project:detail': projectPath,
  'project:supplier-workbench': projectSupplierPath,
  'customer:detail': customerPath,
  'supplier:detail': supplierPath,
  'supplier:credentials': (intent: EntityTargetIntent) => {
    const origin = intent.filters.dataOrigin
    if (!isDataOriginDTO(origin) || !isStableRouteIdentity(intent.subject.id))
      throw new Error('invalid supplier credential identity or origin')
    return `${entityPath('/base/supplier/credential', intent)}?origin=${origin}`
  },
  'crew:detail': crewPath,
  'worker:detail': workerPath,
  'contract:detail': contractPath,
  'contract:other_expense': contractPath,
  'contract:company_expense': contractPath,
  'contract:supplement': contractPath,
  'contract:owner-document-source': contractPath,
  'contract:subcontract-document-source': contractPath,
  'contract:boq': contractBoqPath,
  'owner-document:change': ownerDocumentPath,
  'owner-document:report': ownerDocumentPath,
  'owner-document:acceptance': ownerDocumentPath,
  'owner-document:warranty': ownerDocumentPath,
  'owner-document:final-settlement': ownerDocumentPath,
  'owner-document:penalty': ownerDocumentPath,
  'subcontract-document:change': subcontractDocumentPath,
  'subcontract-document:settlement': subcontractDocumentPath,
  'subcontract-document:penalty': subcontractDocumentPath,
  'invoice:detail': (intent: EntityTargetIntent) => entityPath('/finance/invoice', intent),
  'receipt:detail': receiptPath,
  'delivery-record:detail': (intent: EntityTargetIntent) => {
    if (!isDataOriginDTO(intent.filters.dataOrigin))
      throw new Error('invalid delivery origin')
    return `${entityPath('/material/delivery/archive', intent)}?origin=${intent.filters.dataOrigin}`
  },
  'payment-application:detail': (intent: EntityTargetIntent) => `${entityPath('/finance/payment', intent)}/detail`,
  'process-library:detail': (intent: EntityTargetIntent) => {
    const origin = intent.filters.dataOrigin
    if (!isDataOriginDTO(origin))
      throw new Error('invalid process library data origin')
    return `${entityPath('/schedule/process-library', intent)}?origin=${origin}`
  },
  'quantity-unit:detail': quantityUnitPath,
  'attendance:matrix': (intent: EntityTargetIntent) => {
    const { projectId, dataOrigin, month, crewId, workerId, workDate, recordId } = intent.filters
    if (!isStableRouteIdentity(projectId) || !isDataOriginDTO(dataOrigin) || !isStableRouteIdentity(workerId) || recordId !== intent.subject.id || typeof month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || typeof workDate !== 'string' || !workDate.startsWith(`${month}-`))
      throw new Error('invalid attendance source')
    return `/subcontract/attendance?${new URLSearchParams({ origin: dataOrigin, project: projectId, month, ...(typeof crewId === 'string' && crewId ? { crew: crewId } : {}), worker: workerId, workDate, record: intent.subject.id })}`
  },
  'daywork:ledger': (intent: EntityTargetIntent) => {
    const { projectId, dataOrigin, month, crewId, workerId, workDate } = intent.filters
    if (!isStableRouteIdentity(projectId) || !isDataOriginDTO(dataOrigin) || !isStableRouteIdentity(workerId) || typeof month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || typeof workDate !== 'string' || !workDate.startsWith(`${month}-`))
      throw new Error('invalid daywork source')
    return `/subcontract/daywork?${new URLSearchParams({ origin: dataOrigin, project: projectId, month, ...(typeof crewId === 'string' && crewId ? { crew: crewId } : {}), worker: workerId, workDate, record: intent.subject.id })}`
  },
  'wage-statement:detail': (intent: EntityTargetIntent) => {
    const path = entityPath('/subcontract/payroll', intent)
    if (intent.filters.ownerKind != null || intent.filters.ownerId != null)
      return withCrewWorkerFactContext(path, intent)
    const scope = payrollViewScope({ ...intent.filters, origin: intent.filters.dataOrigin })
    if (scope.error)
      throw new Error('invalid payroll read context')
    return payrollReadLocation(path, scope)
  },
  'wage-adjustment:detail': (intent: EntityTargetIntent) => {
    if (intent.filters.dataOrigin !== 'real')
      throw new Error('invalid payroll adjustment origin')
    return `${entityPath('/subcontract/payroll/adjustments', intent)}?origin=real`
  },
  'wage-actual:detail': (intent: EntityTargetIntent) => {
    if (intent.filters.dataOrigin !== 'real')
      throw new Error('invalid payroll actual origin')
    return `${entityPath('/subcontract/payroll/payments', intent)}?origin=real`
  },
  'subcontract-document:penalty-detail': (intent: EntityTargetIntent) => withCrewWorkerFactContext(entityPath('/project/penalty', intent), intent),
} satisfies Record<string, TargetBuilder>

const LIST_TARGET_REGISTRY = {
  'wage-statement:actual-ledger': (intent: ListTargetIntent) => {
    const { projectId, dataOrigin, costCategory } = intent.filters
    if (!isStableRouteIdentity(projectId) || dataOrigin !== 'real' || costCategory !== '工人工资')
      throw new Error('invalid payroll actual source identity')
    return `/subcontract/payroll/payments?${new URLSearchParams({ project: projectId, origin: dataOrigin })}`
  },
  'contract:subcontract': (intent: ListTargetIntent) => budgetSourceListPath('/contract/subcontract', intent),
  'contract:other_expense': (intent: ListTargetIntent) => budgetSourceListPath('/contract/other-expense', intent),
  'subcontract-document:settlement': (intent: ListTargetIntent) => budgetSourceListPath('/subcontract/settlement', intent),
  'settlement:other_settlement': (intent: ListTargetIntent) => budgetSourceListPath('/contract/other-settlement', intent),
  'contract:material': (intent: ListTargetIntent) => {
    const projectId = intent.filters.projectId
    const dataOrigin = intent.filters.dataOrigin
    if (typeof projectId !== 'string' || !projectId || !isDataOriginDTO(dataOrigin))
      throw new Error('invalid project material contract list context')
    return `/contract/material?${new URLSearchParams({ projectId, origin: dataOrigin }).toString()}`
  },
} satisfies Record<string, ListTargetBuilder>

function budgetSourceListPath(path: string, intent: ListTargetIntent): string {
  const { projectId, dataOrigin, costCategory } = intent.filters
  if (!isStableRouteIdentity(projectId) || !isDataOriginDTO(dataOrigin))
    throw new Error('invalid budget source identity')
  const query = new URLSearchParams({ projectId, origin: dataOrigin })
  if (path === '/contract/subcontract' && (costCategory === '专业分包' || costCategory === '合同劳务'))
    query.set('subKind', costCategory === '合同劳务' ? '劳务' : '专业')
  return `${path}?${query}`
}

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
      const origin = intent.filters.dataOrigin
      const budgetReturn = isDataOriginDTO(origin) ? targetCostReturnTo(options.returnTo, origin) : null
      if (budgetReturn && isDataOriginDTO(origin)) {
        const budget = new URL(budgetReturn, 'https://ruihang.invalid')
        const id = decodeURIComponent(budget.pathname.slice(`${TARGET_COST_LIST_PATH}/`.length))
        const path = new URL(to, 'https://ruihang.invalid')
        const source = targetCostSourceLocation(path.pathname, { id, projectId: typeof intent.filters.projectId === 'string' ? intent.filters.projectId : null, origin, returnTo: budgetReturn })
        if (source) {
          for (const [key, value] of Object.entries(source.query))
            path.searchParams.set(key, value)
          to = `${path.pathname}${path.search}`
        }
      }
      const labels: Record<string, string> = { 'contract:material': '材料采购合同', 'contract:subcontract': '分包合同', 'contract:other_expense': '其他支出合同', 'subcontract-document:settlement': '分包结算', 'settlement:other_settlement': '其他支出结算' }
      return { state: 'resolved', label: labels[key] ?? '来源记录', to }
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
    const attendanceReturn = key === 'attendance:matrix' && isDataOriginDTO(dataOrigin) && payrollC1WorkspaceReturn(options.returnTo, dataOrigin)
    const dayworkReturn = key === 'daywork:ledger' && isDataOriginDTO(dataOrigin) && payrollC2WorkspaceReturn(options.returnTo, dataOrigin)
    if (!attendanceReturn && !dayworkReturn && (!isDataOriginDTO(dataOrigin) || returnContext?.origin !== dataOrigin
      || !isVerifiedProjectSupplierSourceTarget({
        dataOrigin,
        entity: intent.subject.entity,
        variant: intent.variant,
      }))) {
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
    if ((key === 'target-cost:detail' || key === 'project:detail') && options.returnTo && isDataOriginDTO(intent.filters.dataOrigin)) {
      const validated = targetCostReturnTo(options.returnTo, intent.filters.dataOrigin)
      if (validated)
        to += `&returnTo=${encodeURIComponent(validated)}`
    }
    if (['supplier:credentials', 'supplier:detail'].includes(key) && options.returnTo) {
      const detailReturn = key === 'supplier:credentials' ? validateSupplierDetailReturnTo(options.returnTo, intent.filters.dataOrigin, intent.subject.id) : null
      const listReturn = validateSupplierReturnTo(options.returnTo)
      if (detailReturn) {
        to = `${to}&returnTo=${encodeURIComponent(detailReturn)}`
      }
      else if (listReturn) {
        const url = new URL(listReturn, 'https://ruihang.invalid')
        const identity = decodeURIComponent(decodeURIComponent(url.hash.slice(1))).replace(/^supplier-row-/, '')
        if (identity === `${intent.filters.dataOrigin}:${intent.subject.id}`)
          to = `${to}${to.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(listReturn)}`
      }
    }
    if (options.returnTo && (key === 'crew:detail' || key === 'project:detail' || key === 'customer:detail' || key === 'supplier:detail'
      || key === 'contract:detail' || key === 'contract:owner-document-source' || key === 'contract:subcontract-document-source')) {
      const ownerReturnTo = validateOwnerDocumentDetailReturnTo(options.returnTo, intent.filters.dataOrigin)
      if (ownerReturnTo) {
        const separator = to.includes('?') ? '&' : '?'
        to = `${to}${separator}returnTo=${encodeURIComponent(ownerReturnTo)}`
      }
    }
    if ((key === 'project:detail' || (key === 'contract:detail' && intent.filters.contractKind === '施工')) && options.returnTo) {
      const customerId = intent.filters.customerId
      const customerReturnTo = typeof customerId === 'string'
        ? validateCustomerDetailReturnTo(options.returnTo, intent.filters.dataOrigin, customerId)
        : null
      if (customerReturnTo) {
        const separator = to.includes('?') ? '&' : '?'
        to = `${to}${separator}returnTo=${encodeURIComponent(customerReturnTo)}`
      }
    }
    if ((key === 'project:detail' || key === 'supplier:detail') && options.returnTo) {
      const entityIntent = intent as EntityTargetIntent
      const dataOrigin = entityIntent.filters.dataOrigin
      const projectSupplierReturnTo = isDataOriginDTO(dataOrigin)
        ? validateProjectSupplierIdentityReturnTo(options.returnTo, {
            entity: key === 'project:detail' ? 'project' : 'supplier',
            id: entityIntent.subject.id,
            origin: dataOrigin,
          })
        : null
      if (projectSupplierReturnTo) {
        const separator = to.includes('?') ? '&' : '?'
        to = `${to}${separator}returnTo=${encodeURIComponent(projectSupplierReturnTo)}`
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
    if (options.returnTo && (key === 'settlement:other_settlement' || key === 'contract:other_expense' || key === 'contract:company_expense' || key === 'project:detail' || key === 'supplier:detail')) {
      const validated = key.startsWith('contract:') || key === 'settlement:other_settlement' ? validateAuxiliaryReturnTo(options.returnTo, intent.filters.dataOrigin) : validateAuxiliaryDetailReturnTo(options.returnTo, intent.filters.dataOrigin)
      if (validated && !to.includes('returnTo='))
        to += `${to.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(validated)}`
    }
    if (intent.kind === 'source-record' && !['attendance:matrix', 'daywork:ledger'].includes(key) && options.returnTo)
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
      const dataOrigin = entityIntent.filters.dataOrigin
      const returnTo = isDataOriginDTO(dataOrigin) ? validateReceiptReturnTo(options.returnTo, dataOrigin) : null
      if (returnTo && !to.includes('returnTo='))
        to = `${to}&returnTo=${encodeURIComponent(returnTo)}`
    }
    if ((key === 'owner-document:change' || key === 'owner-document:report'
      || key === 'owner-document:acceptance' || key === 'owner-document:warranty'
      || key === 'owner-document:final-settlement' || key === 'owner-document:penalty'
      || key === 'subcontract-document:change' || key === 'subcontract-document:settlement' || key === 'subcontract-document:penalty') && options.returnTo) {
      const entityIntent = intent as EntityTargetIntent
      const kind = key === 'subcontract-document:penalty'
        ? 'project_penalty'
        : key === 'subcontract-document:settlement'
          ? 'sub_settlement'
          : key === 'subcontract-document:change'
            ? 'sub_change'
            : key === 'owner-document:change'
              ? 'owner_change'
              : key === 'owner-document:report'
                ? 'owner_report'
                : key === 'owner-document:final-settlement'
                  ? 'final_settlement'
                  : key === 'owner-document:penalty'
                    ? 'owner_penalty'
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
      || key === 'wage-adjustment:detail'
      || key === 'wage-actual:detail'
      || key === 'subcontract-document:penalty-detail')) {
      const returnTo = ['wage-statement:detail', 'wage-adjustment:detail', 'wage-actual:detail'].includes(key)
        ? isDataOriginDTO(intent.filters.dataOrigin) && payrollAdjustmentReturn(options.returnTo, intent.filters.dataOrigin)
        : validateCrewWorkerReturnTo(options.returnTo)
      if (returnTo) {
        const separator = to.includes('?') ? '&' : '?'
        to = `${to}${separator}returnTo=${encodeURIComponent(returnTo)}`
      }
    }
    if (options.returnTo && ['quantity-unit:detail', 'worker:detail', 'crew:detail'].includes(key) && isDataOriginDTO(intent.filters.dataOrigin) && isStableRouteIdentity(intent.filters.projectId)) {
      const back = payrollAWorkspaceReturn(options.returnTo, intent.filters.dataOrigin)
      if (back) {
        const target = new URL(to, 'https://payroll.invalid')
        target.searchParams.delete('returnTo')
        target.searchParams.set('payrollReturnTo', back)
        target.searchParams.set('payrollProject', String(intent.filters.projectId))
        target.searchParams.set('payrollSourceKind', intent.subject.entity)
        target.searchParams.set('payrollSourceId', intent.subject.id)
        to = `${target.pathname}?${target.searchParams}`
      }
    }
    if (options.returnTo && ['attendance:matrix', 'worker:detail', 'crew:detail'].includes(key) && isDataOriginDTO(intent.filters.dataOrigin) && isStableRouteIdentity(intent.filters.projectId)) {
      const back = payrollC1WorkspaceReturn(options.returnTo, intent.filters.dataOrigin)
      if (back) {
        const target = new URL(to, 'https://payroll.invalid')
        target.searchParams.delete('returnTo')
        target.searchParams.set('payrollReturnTo', back)
        target.searchParams.set('payrollProject', intent.filters.projectId)
        target.searchParams.set('payrollSourceKind', intent.subject.entity)
        target.searchParams.set('payrollSourceId', intent.subject.id)
        target.searchParams.set('payrollFormat', 'C1')
        to = `${target.pathname}?${target.searchParams}`
      }
    }
    if (options.returnTo && ['daywork:ledger', 'worker:detail', 'crew:detail'].includes(key) && isDataOriginDTO(intent.filters.dataOrigin) && isStableRouteIdentity(intent.filters.projectId)) {
      const back = payrollC2WorkspaceReturn(options.returnTo, intent.filters.dataOrigin)
      if (back) {
        const target = new URL(to, 'https://payroll.invalid')
        target.searchParams.delete('returnTo')
        target.searchParams.set('payrollReturnTo', back)
        target.searchParams.set('payrollProject', intent.filters.projectId)
        target.searchParams.set('payrollSourceKind', intent.subject.entity)
        target.searchParams.set('payrollSourceId', intent.subject.id)
        target.searchParams.set('payrollFormat', 'C2')
        to = `${target.pathname}?${target.searchParams}`
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
