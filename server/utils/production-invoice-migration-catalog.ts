import type { InvoiceContractReference } from '../../app/lib/invoice/central-contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { createHash } from 'node:crypto'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { validateProductionAuxiliaryState } from './production-auxiliary-contract-record'
import { readProductionConstructionContractFacts, readProductionConstructionContractReference } from './production-construction-contract-sources'
import { invoiceContractCapability, verifyInvoiceContractReference } from './production-invoice-contracts'
import { loadProductionMaterialContractState } from './production-material-contract-record'
import { listMigrationReferences } from './production-migration-references'
import { validateProductionSubcontractState } from './production-subcontract-contract-record'

type Domain = InvoiceContractReference['domain']
type Key = 'projects' | 'suppliers' | Domain
interface MasterCandidate { id: string, label: string, version: string, sourceVersion: string }
interface ContractCandidate { id: string, label: string, domain: Domain, version: string, projectId: string | null, supplierId: string | null }
interface Source { key: Key, state: 'readable' | 'forbidden' | 'unavailable', sourceVersion: string | null }
const keys: Key[] = ['projects', 'suppliers', 'construction', 'subcontract', 'material', 'auxiliary', 'company']
const participants: Record<Domain, string> = { construction: 'construction-contracts', subcontract: 'subcontract-contracts', material: 'material-contracts', auxiliary: 'auxiliary-contract', company: 'auxiliary-contract' }
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
const version = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const sessionKey = (actor: BusinessSession) => JSON.stringify({ workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities].sort() })

/** 只在同一正式事务中读取已授权的完整目录；缺权限和缺来源均显式报告。 */
async function readInvoiceCatalog(storage: ProductionStorage, session: () => BusinessSession, requested: Key[], migration: boolean) {
  if (!Array.isArray(requested) || requested.some(key => !keys.includes(key)) || new Set(requested).size !== requested.length)
    throw new CentralInvoiceProblem('validation-failed', '发票迁入目标目录请求无效。')
  const authorize = () => {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId
      || !actor.capabilities.includes('finance-invoice:read') || (migration && !actor.capabilities.includes('finance-invoice:import'))) {
      throw new CentralInvoiceProblem('forbidden', '当前身份无发票迁入目录读取权限。')
    }
    return actor
  }
  const initial = sessionKey(authorize())
  return storage.withTransaction(async (tx) => {
    const actor = authorize()
    if (sessionKey(actor) !== initial)
      throw new CentralInvoiceProblem('forbidden', '读取目录期间身份或权限已变化。')
    const projects: MasterCandidate[] = []
    const suppliers: MasterCandidate[] = []
    const contracts: ContractCandidate[] = []
    const sources: Source[] = []
    for (const key of requested) {
      const capability = key === 'projects' ? 'project:list:read' : key === 'suppliers' ? 'supplier:list:read' : invoiceContractCapability(key)
      if (!actor.capabilities.includes(capability)) {
        sources.push({ key, state: 'forbidden', sourceVersion: null })
        continue
      }
      try {
        if (key === 'projects' || key === 'suppliers') {
          const rows = await listMigrationReferences(tx, actor, key)
          const domain = key === 'projects' ? 'project' : 'supplier'
          const revisions = await tx.select<{ revision: number }>(`SELECT revision FROM ${domain}_revision WHERE singleton=1`)
          if (revisions.length !== 1 || !Number.isSafeInteger(revisions[0]!.revision) || revisions[0]!.revision < 0)
            throw new CentralInvoiceProblem('unavailable', '目录版本无法核实。')
          const sourceVersion = `${key}:${revisions[0]!.revision}`
          if (rows.some(row => row.sourceVersion !== sourceVersion || !id(row.serverId) || !/^[1-9]\d*$/.test(row.version)))
            throw new CentralInvoiceProblem('unavailable', '目录身份或版本无法核实。')
          const target = key === 'projects' ? projects : suppliers
          target.push(...rows.map(row => ({ id: row.serverId, label: row.label, version: row.version, sourceVersion })))
          sources.push({ key, state: 'readable', sourceVersion })
          continue
        }
        const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=?', [participants[key]])
        if (participant?.schema_version !== 1)
          throw new CentralInvoiceProblem('unavailable', '合同正式来源尚未登记。')
        const candidates: ContractCandidate[] = []
        const add = (value: { id: unknown, name?: string, no?: string, version: unknown, projectId?: string | null, supplierId?: string | null }) => {
          if (!id(value.id) || !version(value.version) || (value.projectId != null && !id(value.projectId)) || (value.supplierId != null && !id(value.supplierId)))
            throw new CentralInvoiceProblem('unavailable', '合同身份、版本或关联无法核实。')
          candidates.push({ id: value.id, label: [value.name, value.no].filter(Boolean).join(' / '), domain: key, version: String(value.version), projectId: value.projectId ?? null, supplierId: value.supplierId ?? null })
        }
        if (key === 'construction') {
          const state = await readProductionConstructionContractFacts(tx, actor)
          for (const row of state.contracts) {
            const actual = await readProductionConstructionContractReference(tx, actor, row.id)
            add({ ...actual, version: Number(actual.version), name: row.name, no: row.no })
          }
        }
        else if (key === 'material') {
          const state = await loadProductionMaterialContractState(tx, actor)
          for (const row of state.contracts.filter(item => !item.draft.isSupplement && !item.migrationRetired && !item.migrationEvidence?.deletedAt))
            add({ id: row.id, version: row.version, name: row.draft.name, no: row.draft.no, projectId: row.draft.projectId, supplierId: row.draft.supplierId })
        }
        else if (key === 'subcontract') {
          const state = await validateProductionSubcontractState(tx, actor)
          const heads = await tx.select<{ id: string, deleted_at: string | null }>('SELECT id,deleted_at FROM subcontract_contract_records')
          const restores = await tx.select<{ import_id: string }>('SELECT import_id FROM subcontract_contract_import_restores')
          for (const row of state.state.contracts.filter(item => heads.some(head => head.id === item.draft.id && head.deleted_at === null) && !restores.some(restore => restore.import_id === item.migrationBatchId)))
            add({ id: row.draft.id, version: row.version, name: row.draft.name, no: row.draft.no, projectId: row.draft.projectId, supplierId: row.draft.supplierId })
        }
        else {
          const state = await validateProductionAuxiliaryState(tx, actor)
          const heads = await tx.select<{ id: string, deleted_at: string | null }>('SELECT id,deleted_at FROM auxiliary_contract_records')
          for (const row of state.state.contracts.filter(item => item.draft.kind === (key === 'company' ? 'company_expense' : 'other_expense') && (key !== 'company' || !!item.draft.supplierId) && heads.some(head => head.id === item.draft.id && head.deleted_at === null) && !state.restores.some(restore => restore.import_id === item.migrationBatchId)))
            add({ id: row.draft.id, version: row.version, name: row.draft.name, no: row.draft.no, projectId: row.draft.projectId, supplierId: row.draft.supplierId })
        }
        for (const row of candidates)
          await verifyInvoiceContractReference(tx, actor, { domain: row.domain, id: row.id, version: row.version }, row.projectId, row.supplierId)
        const sourceVersion = `invoice-catalog:${key}:${createHash('sha256').update(JSON.stringify(candidates)).digest('hex')}`
        contracts.push(...candidates)
        sources.push({ key, state: 'readable', sourceVersion })
      }
      catch (error) {
        const code = error && typeof error === 'object' && 'problem' in error ? (error.problem as { code?: string }).code : undefined
        if (code !== 'forbidden' && code !== 'unavailable')
          throw error
        sources.push({ key, state: code, sourceVersion: null })
      }
    }
    if (sessionKey(authorize()) !== initial)
      throw new CentralInvoiceProblem('forbidden', '读取目录期间身份或权限已变化。')
    return { context: { workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities] }, asOf: new Date().toISOString(), sources, projects, suppliers, contracts }
  })
}

export function readInvoiceMigrationCatalog(storage: ProductionStorage, session: () => BusinessSession, requested: Key[]) {
  return readInvoiceCatalog(storage, session, requested, true)
}

export function readInvoiceWorkspaceCatalog(storage: ProductionStorage, session: () => BusinessSession, requested: Key[]) {
  return readInvoiceCatalog(storage, session, requested, false)
}
