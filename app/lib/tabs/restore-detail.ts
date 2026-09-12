import type { RestorableTabPath, TabRestoreResult } from './restoration-contract'
import type { RestoredDetailPath } from './restore-target'
import type { OwnerCommercialDocumentKind } from '~/lib/owner-document/central-repository'
import type { DomainRepositories } from '~/plugins/repositories'
import type { DataOriginDTO, EntityKindDTO, EntityRefDTO, NavigationIntentDTO } from '~/types/read-model'
import { parseConstructionContractDetailQuery } from '~/lib/construction-contract/read-page'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { readRestoredCrewWorkerFact } from './restore-crew-worker'
import { checkRestoreAbort, restoreProblem } from './restore-problem'
import { readRestoredQuantityUnit } from './restore-quantity'

export interface RestoreDetailOptions {
  repositories: DomainRepositories
  includeDemo: () => boolean
  capabilities: () => readonly string[]
  detail: RestoredDetailPath
  path: RestorableTabPath
  url: URL
  signal?: AbortSignal
}

export interface LoadedTarget {
  subject: EntityRefDTO
  origin: DataOriginDTO
  capability: string
  capabilities: readonly string[]
  sourceVersion: string | null
  variant: string
  filters?: Record<string, string>
  view?: string | null
}

function reference(entity: EntityKindDTO, id: string, label: string): EntityRefDTO {
  return { state: 'resolved', entity, id, label, no: null }
}

const DOCUMENT_KINDS: Record<string, OwnerCommercialDocumentKind> = {
  'owner-document/change': 'owner_change',
  'owner-document/report': 'owner_report',
  'owner-document/acceptance': 'acceptance',
  'owner-document/final-settlement': 'final_settlement',
  'owner-document/penalty': 'owner_penalty',
  'subcontract-document/change': 'sub_change',
  'subcontract-document/settlement': 'sub_settlement',
  'subcontract-document/penalty': 'project_penalty',
}

async function load(options: RestoreDetailOptions): Promise<LoadedTarget | TabRestoreResult> {
  const { repositories: repos, detail, path, url } = options
  const origin = path.origin!
  const query = { id: detail.id, origin, includeDemo: options.includeDemo() }
  const capabilities = options.capabilities()
  const family = detail.family
  if (family === 'crew-worker-fact' && detail.kind === 'assignment' && !url.searchParams.has('ownerKind') && !url.searchParams.has('ownerId'))
    return readRestoredQuantityUnit(options)
  if (family === 'crew-worker-fact' || (family === 'subcontract-document' && detail.kind === 'penalty' && (url.searchParams.has('ownerKind') || url.searchParams.has('ownerId'))))
    return readRestoredCrewWorkerFact(options)
  const contractKind = url.searchParams.get('contractKind')
  const capability = family === 'contract'
    ? `${contractKind}-contract:read`
    : family === 'schedule-project'
      ? 'project:list:read'
      : family === 'auxiliary'
        ? 'auxiliary-contract:read'
        : family === 'receipt'
          ? 'receipt:read'
          : ['project', 'customer', 'supplier', 'crew', 'worker'].includes(family)
              ? `${family}:list:read`
              : `${family}:read`
  if (family === 'unconnected' || (family === 'contract' && (!['material', 'construction', 'subcontract'].includes(contractKind ?? '') || !url.searchParams.has('origin'))))
    return restoreProblem('not-connected')
  if (!capabilities.includes(capability))
    return restoreProblem('forbidden')
  const common = { capability, variant: 'detail' }
  if (family === 'project' || family === 'schedule-project') {
    const dto = await repos.projectList.get(query)
    return { ...common, ...dto, subject: dto.item.project, origin: dto.item.dataOrigin }
  }
  if (family === 'customer') {
    const dto = await repos.customerRead.get(query)
    return { ...common, ...dto, subject: reference('customer', dto.customer.id, dto.customer.name), origin: dto.dataOrigin }
  }
  if (family === 'supplier') {
    const dto = await repos.supplierRead.get(query)
    return { ...common, ...dto, subject: reference('supplier', dto.supplier.id, dto.supplier.name), origin: dto.dataOrigin }
  }
  if (family === 'crew') {
    const dto = await repos.crewWorkerRead.getCrew(query)
    return { ...common, ...dto, subject: reference('crew', dto.crew.id, dto.crew.name), origin: dto.dataOrigin }
  }
  if (family === 'worker') {
    const dto = await repos.crewWorkerRead.getWorker(query)
    return { ...common, ...dto, subject: reference('worker', dto.worker.id, dto.worker.name), origin: dto.dataOrigin }
  }
  if (family === 'project-supplier') {
    const dto = await repos.projectSupplierRead.get({ projectId: detail.id, supplierId: detail.secondId!, origin, includeDemo: query.includeDemo })
    if (dto.supplier.id !== detail.secondId || dto.project.id !== detail.id)
      return restoreProblem('mismatch')
    return { ...common, ...dto, subject: { ...dto.project, label: `${dto.project.label} · ${dto.supplier.label}` }, origin: dto.dataOrigin, variant: 'supplier-workbench', view: url.searchParams.get('tab'), filters: { supplierId: detail.secondId! } }
  }
  if (family === 'contract') {
    const focusId = url.searchParams.get('focus')
    if (focusId != null && !isStableRouteIdentity(focusId))
      return restoreProblem('mismatch')
    const focusScopes: Record<string, string> = { supplements: 'supplement', changes: 'change', settlements: 'settlement', acceptance: 'acceptance' }
    const focusScope = focusScopes[url.searchParams.get('tab') ?? ''] ?? null
    const focusView = url.searchParams.get('focusView')
    const dto = contractKind === 'material'
      ? await repos.materialContractRead.get(query)
      : contractKind === 'construction'
        ? await repos.constructionContractRead.get(parseConstructionContractDetailQuery(detail.id, {
            ...query,
            focusId: focusScope ? focusId : null,
            focusScope: focusId ? focusScope : null,
            focusView: focusScope === 'acceptance' && focusId && (focusView === 'acceptance' || focusView === 'warranty') ? focusView : null,
          }))
        : await repos.subcontractContractRead.get({ ...query, focusId: ['changes', 'settlements'].includes(url.searchParams.get('tab') ?? '') ? focusId : null })
    const expectedKind = contractKind === 'material' ? '材采' : contractKind === 'construction' ? '施工' : '分包'
    if (dto.contract.kind !== expectedKind)
      return restoreProblem('mismatch')
    return { ...common, ...dto, subject: reference('contract', dto.contract.id, dto.contract.name), origin: dto.dataOrigin, filters: { contractKind: expectedKind } }
  }
  if (family === 'receipt') {
    const dto = await repos.receipts.detail(detail.id, { origin, includeDemo: query.includeDemo })
    return { ...common, capabilities: dto.capabilities, sourceVersion: dto.sourceVersion, subject: reference('receipt', dto.record.id, dto.record.draft.no || '收款登记'), origin: dto.record.dataOrigin }
  }
  if (family === 'owner-document' || family === 'subcontract-document') {
    const kind = DOCUMENT_KINDS[`${family}/${detail.kind}`]!
    const variant = url.searchParams.get('variant')
    if (variant != null && (kind !== 'acceptance' || !['acceptance', 'warranty'].includes(variant)))
      return restoreProblem('mismatch')
    const dto = await repos.ownerCommercialDocumentRead.get({ ...query, kind, variant: variant === 'warranty' ? 'warranty' : null })
    if (dto.document.kind !== kind)
      return restoreProblem('mismatch')
    return { ...common, ...dto, subject: reference(family, dto.document.id, dto.document.name || dto.document.no), origin: dto.dataOrigin, variant: variant === 'warranty' ? 'warranty' : detail.kind! }
  }
  if (family === 'auxiliary') {
    const dto = await repos.auxiliaryContracts.detail(detail.id, { origin, kind: detail.kind, includeDemo: query.includeDemo })
    if (dto.contract.kind !== detail.kind)
      return restoreProblem('mismatch')
    return { ...common, subject: reference('contract', dto.contract.id, dto.contract.draft.name || dto.contract.draft.no || '合同'), origin: dto.contract.dataOrigin, capabilities: dto.capabilities, sourceVersion: dto.contract.version, variant: detail.kind!, filters: { contractKind: detail.kind! } }
  }
  if (family === 'other-settlement') {
    const contractId = url.searchParams.get('contractId')
    if (contractId != null && !isStableRouteIdentity(contractId))
      return restoreProblem('mismatch')
    const dto = await repos.otherSettlements.detail(detail.id, { origin, includeDemo: query.includeDemo, ...(contractId ? { contractId } : {}) })
    if (contractId && dto.settlement.draft.contractId !== contractId)
      return restoreProblem('mismatch')
    return { ...common, subject: reference('settlement', dto.settlement.id, dto.settlement.draft.name || dto.settlement.draft.no || '其他支出结算'), origin: dto.settlement.dataOrigin, capabilities: dto.capabilities, sourceVersion: dto.settlement.version, variant: 'other_settlement' }
  }
  return restoreProblem('not-connected')
}

export async function readRestoredDetail(options: RestoreDetailOptions): Promise<TabRestoreResult> {
  const loaded = await load(options)
  checkRestoreAbort(options.signal)
  if ('state' in loaded)
    return loaded
  if (!loaded.capabilities.includes(loaded.capability) || !options.capabilities().includes(loaded.capability) || loaded.subject.state === 'forbidden')
    return restoreProblem('forbidden')
  if (options.path.origin === 'demo' && (!options.includeDemo() || !options.capabilities().includes('demo:read')))
    return restoreProblem('forbidden')
  if (loaded.subject.state !== 'resolved')
    return restoreProblem('not-found')
  if (loaded.subject.id !== options.detail.id || loaded.origin !== options.path.origin)
    return restoreProblem('mismatch')
  const intent: NavigationIntentDTO = { kind: 'entity-detail', subject: loaded.subject, variant: loaded.variant, view: loaded.view ?? null, filters: { ...loaded.filters, dataOrigin: loaded.origin } }
  const target = resolveNavigationTarget(intent, {
    returnTo: options.url.searchParams.get('returnTo') ?? undefined,
    returnContextId: options.url.searchParams.get('returnContext') ?? undefined,
  })
  if (target.state !== 'resolved')
    return restoreProblem(target.state === 'forbidden' ? 'forbidden' : 'not-connected')
  const canonical = new URL(target.to, 'https://ruihang.invalid')
  if (options.detail.family === 'schedule-project') {
    if (decodeURIComponent(canonical.pathname) !== `/project/${options.detail.id}`)
      return restoreProblem('mismatch')
    return { state: 'resolved', fullPath: options.path.fullPath, title: `${target.label} · 施工进度`, sourceVersion: loaded.sourceVersion }
  }
  if (decodeURIComponent(canonical.pathname) !== decodeURIComponent(options.url.pathname))
    return restoreProblem('mismatch')
  const result = new URL(options.path.fullPath, 'https://ruihang.invalid')
  result.pathname = canonical.pathname
  result.searchParams.delete('returnTo')
  result.searchParams.delete('returnContext')
  canonical.searchParams.forEach((value, key) => result.searchParams.set(key, value))
  return { state: 'resolved', fullPath: `${result.pathname}${result.search}${result.hash}`, title: target.label, sourceVersion: loaded.sourceVersion }
}
