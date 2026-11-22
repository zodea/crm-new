import type { BoqCommand } from '../../app/lib/boq/production-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CommandRecoveryDescriptor } from '../../app/lib/forms/command-recovery'
import type { OwnerCommercialDocumentCommandRequestDTO, OwnerCommercialDocumentCommandResultDTO } from '../../app/lib/owner-document/central-command-contract'
import type { OwnerCommercialDocumentKind, OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import type { SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import type { BoqLineRecord } from './production-boq-record'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { boqRecoveryDescriptor } from '../../app/lib/boq/command-recovery'
import { buildOwnerCommercialDocumentDetail, buildOwnerCommercialDocumentListPage, OWNER_COMMERCIAL_DOCUMENT_KINDS, parseOwnerCommercialDocumentDetailQuery, parseOwnerCommercialDocumentListQuery } from '../../app/lib/owner-document/central-repository'
import { isQuantityBasis } from '../../app/lib/quantity/basis'
import { isStableRouteIdentity } from '../../app/lib/util/stable-route-identity'
import { commandJournalKey, parseResolveCommandBody } from './command-journal'
import { parseOwnerCommercialDocumentCommandRequest } from './owner-commercial-document-command-request'
import { createOwnerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { readAuxiliaryContractScopeFacts } from './production-auxiliary-contract-record'
import { productionBoqHeadVersion, readProductionBoqChanges, readProductionBoqQuantityFacts, readProductionBoqRows } from './production-boq-record'
import { createProductionBoqService } from './production-boq-service'
import { validateProductionBoqState } from './production-boq-validation'
import { readProductionConstructionContractFacts, readProductionConstructionContractReference } from './production-construction-contract-sources'
import { businessApplications } from './production-finance-payment-detail'
import { assertProductionOwnerDocument, assertProductionOwnerDocumentCommandNamespace, ownerDocumentDigest as digest, ownerDocumentFailure as fail, ownerDocumentKey, parseOwnerDocumentStoredJson, productionOwnerDocumentBoqResult, productionOwnerDocumentFileId, productionOwnerDocumentId, productionOwnerDocumentIntent, readProductionOwnerDocumentState, restoreProductionOwnerDocumentIntent } from './production-owner-document-record'
import { PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES } from './production-owner-document-schema'
import { productionQuantityVersion } from './production-quantity-record'
import { productionQuantityInTransaction } from './production-quantity-service'
import { readProductionSubcontractState } from './production-subcontract-contract-record'
import { readSubcontractContractScopeFacts } from './production-subcontract-contract-sources'
import { loadProductionSuppliers } from './production-supplier-record'
import { createReadMeta, withOriginReadMeta, withReadMeta } from './read-meta'

type Session = () => BusinessSession
type StoredState = Awaited<ReturnType<typeof readProductionOwnerDocumentState>>
const subcontract = (kind: OwnerCommercialDocumentKind) => ['sub_change', 'sub_settlement', 'project_penalty'].includes(kind)
const readCapability = (kind: OwnerCommercialDocumentKind) => subcontract(kind) ? 'subcontract-document:read' : 'owner-document:read'
const writeCapability = (kind: OwnerCommercialDocumentKind) => subcontract(kind) ? 'subcontract-document:write' : 'owner-document:write'
const locator = (command: OwnerCommercialDocumentCommandRequestDTO) => ({ kind: command.kind, commandId: command.commandId, workspaceId: command.workspaceId, actorId: command.actorId, targetId: command.id, action: command.action })

type RelationshipVersions = Record<string, { id: string, version: string }>
function selectedRelationships(draft: Record<string, unknown>, versions: Record<string, Map<string, string>>): RelationshipVersions {
  const selected: RelationshipVersions = {}
  for (const [field, values] of Object.entries(versions)) {
    const id = draft[field]
    if (typeof id === 'string' && id && values.has(id))
      selected[field] = { id, version: values.get(id)! }
  }
  return selected
}
async function quantityConsumed(tx: TransactionDb, actor: BusinessSession, scope: { projectId: string, contractId: string, periodNo: string, basis: import('../../app/lib/quantity/basis').QuantityBasis }, facts: readonly import('../../app/lib/quantity/central-monthly').QuantityMonthlyBoqFact[]) {
  const ids = facts.filter(fact => fact.contractId === scope.contractId).map(fact => fact.boqLineId)
  const quantity = await productionQuantityVersion(tx, scope.projectId, { ...scope, origin: 'real', includeDemo: false }, 'monthly')
  const boq = await readProductionBoqQuantityFacts(tx, scope.projectId, actor, { contractIds: [scope.contractId], lineIds: ids })
  return `owner-monthly:${digest({ scope, quantity, boq: boq.lines.map(line => ({ id: line.id, contractId: line.contractId, unit: line.unit, qty: line.qty, approvedDeltaQty: line.approvedDeltaQty, eligible: line.eligible, qualificationVersion: line.qualificationVersion, bindingVersion: line.bindingVersion })) })}`
}

async function domain(tx: TransactionDb, actor: BusinessSession, state: StoredState, command?: OwnerCommercialDocumentCommandRequestDTO) {
  const projects = actor.capabilities.includes('project:list:read') ? await tx.select<{ id: string, name: string, customerId: string | null }>('SELECT id,name,customer_id AS customerId FROM projects WHERE deleted_at IS NULL ORDER BY id') : []
  const customers = actor.capabilities.includes('customer:list:read') ? await tx.select<{ id: string, name: string }>('SELECT id,name FROM customers WHERE deleted_at IS NULL ORDER BY id') : []
  const supplierState = actor.capabilities.includes('supplier:list:read') ? await loadProductionSuppliers(tx, actor) : null
  const suppliers = [...(supplierState?.suppliers.values() ?? [])].map(row => ({ id: row.id, name: row.draft.name ?? '' }))
  const crews = actor.capabilities.includes('crew:list:read') ? await tx.select<{ id: string, name: string }>('SELECT id,name FROM crews WHERE deleted_at IS NULL ORDER BY id') : []
  const construction = actor.capabilities.includes('construction-contract:read') ? await readProductionConstructionContractFacts(tx, actor) : null
  const subcontracts = actor.capabilities.includes('subcontract-contract:read') ? (await readSubcontractContractScopeFacts(tx, actor)).filter(row => row.eligible) : []
  const subcontractSupplements = actor.capabilities.includes('subcontract-contract:read') ? (await readProductionSubcontractState(tx, actor)).supplements.filter(row => !('deletedAt' in row) || row.deletedAt === null) : null
  const auxiliary = actor.capabilities.includes('auxiliary-contract:read') ? (await readAuxiliaryContractScopeFacts(tx, actor)).filter(row => row.eligible) : []
  const versions: Record<string, Map<string, string>> = {
    projectId: new Map(projects.map(row => [row.id, digest({ id: row.id, customerId: row.customerId, deletedAt: null })])),
    customerId: new Map(customers.map(row => [row.id, digest({ id: row.id, deletedAt: null })])),
    supplierId: new Map([...(supplierState?.suppliers.values() ?? [])].map(row => [row.id, digest({ id: row.id, credentialStatus: row.credentialStatus })])),
    crewId: new Map(crews.map(row => [row.id, digest({ id: row.id, deletedAt: null })])),
    contractId: new Map([...(construction?.contracts.map(row => [row.id, digest({ id: row.id, kind: 'construction', projectId: row.projectId, customerId: row.customerId, status: row.status, amount: row.amount })] as const) ?? []), ...subcontracts.map(row => [row.id, digest({ id: row.id, kind: 'subcontract', projectId: row.projectId, supplierId: row.supplierId, status: row.status, amount: row.amount })] as const)]),
  }
  for (const row of auxiliary)
    versions.contractId!.set(row.id, digest({ id: row.id, kind: 'other_expense', projectId: row.projectId, supplierId: row.supplierId, status: row.status, amount: row.amount }))
  if (command && (command.action === 'save' || command.action === 'submit')) {
    let supplied: RelationshipVersions = {}
    try {
      if (typeof command.draft.relationshipVersionsJson === 'string')
        supplied = JSON.parse(command.draft.relationshipVersionsJson)
    }
    catch { fail('validation-failed', '所选真实关系的原采用版本格式无效') }
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))
      fail('validation-failed', '真实关系采用版本必须是逐稳定ID的对象')
    for (const [field, candidates] of Object.entries(versions)) {
      const id = command.draft[field]
      if (typeof id !== 'string' || !id)
        continue
      const actual = candidates.get(id)
      if (!actual || supplied[field]?.id !== id || supplied[field]?.version !== actual)
        fail('stale-source', '所选项目、合同或责任主档采用版本已变化，请保留输入重新核对实际来源')
    }
  }
  const boqKnown = actor.capabilities.includes('boq:read') && actor.capabilities.includes('construction-contract:read') && actor.capabilities.includes('owner-document:read')
  // The stored change is the document itself. Related BOQ/contract permissions only
  // govern its source projection; they cannot turn an existing document into an empty list.
  const changesReadable = actor.capabilities.includes('owner-document:read')
  if (changesReadable)
    await validateProductionBoqState(tx)
  const changes = changesReadable ? await readProductionBoqChanges(tx) : []
  const lines = boqKnown ? await readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines') : []
  let monthlyFacts: import('../../app/lib/quantity/central-monthly').QuantityMonthlyBoqFact[] = []
  if (command?.kind === 'owner_report' && (command.action === 'save' || command.action === 'submit') && command.draft.projectId && command.draft.contractId && command.draft.periodNo) {
    const basis = command.draft.quantityBasis ?? 'field'
    if (!isQuantityBasis(basis))
      fail('validation-failed', '报量取数基准无效')
    const scope = { projectId: String(command.draft.projectId), contractId: String(command.draft.contractId), periodNo: String(command.draft.periodNo), basis }
    monthlyFacts = await productionQuantityInTransaction(tx, () => actor).withMonthly({ ...scope, origin: 'real', includeDemo: false }, actor, facts => [...facts].filter(row => row.contractId === scope.contractId))
    const actual = await quantityConsumed(tx, actor, scope, monthlyFacts)
    if ((command.action === 'submit' || command.draft.lines?.length) && command.draft.quantityConsumedVersion !== actual)
      fail('stale-source', '实际完成量、唯一报量映射或BOQ资格量已变化，请刷新来源并保留手工量后核对')
  }
  const fileMetadata = new Map(state.files.map(binding => [binding.file_ref_id, parseOwnerDocumentStoredJson<OwnerCommercialDocumentSource['files'][number]>(binding.original_metadata_json)]))
  let attachmentIndex = 0
  const owner = createOwnerCommercialDocumentCommandTestInstance({
    strictSources: true,
    snapshot: state.snapshot,
    documents: changes,
    projects,
    customers,
    suppliers,
    crews,
    contracts: construction?.contracts.map(row => ({ id: row.id, no: row.no, name: row.name, projectId: row.projectId!, customerId: row.customerId, amount: row.amount })) ?? [],
    subcontractContracts: subcontracts.map(row => ({ id: row.id, no: row.no, name: row.name, projectId: row.projectId!, supplierId: row.supplierId!, amount: row.amount })),
    finalSettlementSupplements: construction?.supplements.filter(row => row.contractId !== null).map(row => ({ contractId: row.contractId!, id: row.id, no: row.no, name: row.name, status: row.status, amount: row.amount, date: row.date ?? null })),
    knownSupplementContractIds: construction?.contracts.map(row => row.id) ?? [],
    finalSettlementChanges: contractId => boqKnown ? changes.filter(row => row.contractId === contractId) : null,
    penaltySettlementReferences: state.externalSettlements,
    boqLines: lines.map(({ value }) => ({ id: value.id, projectId: value.projectId, contractId: value.contractId, itemName: value.itemName, unit: value.unit, qty: value.qty, unitPrice: value.unitPrice, building: value.building, unitType: value.unitType, floorZone: value.floorZone, autoQty: 0, missingQtyCount: 0, updatedAt: value.updatedAt, source: { boqFileId: value.fileId, changeOrderId: value.changeId, traceKey: value.traceKey, sourceSheet: value.sourceSheet, sourceRow: value.sourceRow, confirmed: value.confirmedOriginal } })),
    monthlyQuantityFacts: monthlyFacts,
    ...(command ? { createId: () => productionOwnerDocumentId(command), createAttachmentId: () => productionOwnerDocumentFileId(command, attachmentIndex++), attachmentActor: actor.actorId, attachmentMetadata: id => fileMetadata.get(id) } : {}),
  })
  return { owner, projects, customers, suppliers, construction, subcontracts, subcontractSupplements, auxiliary, changes, boqKnown, versions }
}

async function readRows(tx: TransactionDb, actor: BusinessSession, state: StoredState, scope: { projectId?: string, contractId?: string } = {}) {
  const data = await domain(tx, actor, state)
  const sources = data.owner.rows()
  const rows = sources.filter(row => actor.capabilities.includes(readCapability(row.kind))
    && (!scope.projectId || row.projectId === scope.projectId) && (!scope.contractId || row.contractId === scope.contractId))
  for (const row of rows) {
    row.projectPermission = actor.capabilities.includes('project:list:read') ? 'allowed' : 'forbidden'
    row.customerPermission = actor.capabilities.includes('customer:list:read') ? 'allowed' : 'forbidden'
    row.contractPermission = actor.capabilities.includes(subcontract(row.kind) ? 'subcontract-contract:read' : 'construction-contract:read') ? 'allowed' : 'forbidden'
    row.supplierPermission = actor.capabilities.includes('supplier:list:read') ? 'allowed' : 'forbidden'
    row.crewPermission = actor.capabilities.includes('crew:list:read') ? 'allowed' : 'forbidden'
    const otherContract = row.kind === 'project_penalty' && (row.contractKind === 'other_expense' || data.auxiliary.some(contract => contract.id === row.contractId))
    row.contractKind = otherContract ? 'other_expense' : subcontract(row.kind) ? 'subcontract' : 'construction'
    if (otherContract)
      row.contractPermission = actor.capabilities.includes('auxiliary-contract:read') ? 'allowed' : 'forbidden'
    Object.assign(row, { projectAvailability: row.projectId && data.projects.some(source => source.id === row.projectId) ? 'available' : 'unavailable', customerAvailability: row.customerId && data.customers.some(source => source.id === row.customerId) ? 'available' : 'unavailable', supplierAvailability: row.supplierId && data.suppliers.some(source => source.id === row.supplierId) ? 'available' : 'unavailable', contractAvailability: row.contractId && (otherContract ? data.auxiliary : subcontract(row.kind) ? data.subcontracts : data.construction?.contracts ?? []).some(source => source.id === row.contractId) ? 'available' : 'unavailable', crewAvailability: row.crewId && data.versions.crewId!.has(row.crewId) ? 'available' : 'unavailable' })
    if (row.kind === 'sub_settlement' && row.subcontractSettlementEvidence) {
      Object.assign(row.subcontractSettlementEvidence, await businessApplications(tx, actor, row))
      row.subcontractSettlementEvidence.supplements = data.subcontractSupplements?.filter(fact => fact.contractId === row.contractId).map(fact => ({ id: fact.id, no: fact.no, name: fact.name, amount: fact.amount, date: fact.date, status: fact.status })) ?? null
      row.subcontractSettlementEvidence.changes = rows.filter(fact => fact.kind === 'sub_change' && fact.projectId === row.projectId && fact.supplierId === row.supplierId && fact.contractId === row.contractId).map(fact => ({ id: fact.id, no: fact.no, name: fact.name, amount: fact.amount, date: fact.applicationDate ?? null, status: fact.status }))
      row.subcontractSettlementEvidence.settlements = row.subcontractSettlementEvidence.settlements.map((fact) => {
        const source = rows.find(source => source.kind === 'sub_settlement' && source.id === fact.id)
        return { ...fact, no: source?.no, name: source?.name, date: source?.applicationDate ?? null }
      })
      row.subcontractSettlementEvidence.penalties = state.snapshot.penaltyDeductions.filter(fact => fact.settlementId === row.id).map((fact) => {
        const penalty = sources.find(source => source.kind === 'project_penalty' && source.id === fact.penaltyId)!
        return { id: fact.penaltyId, no: penalty.no, name: penalty.name, amount: penalty.amount, date: penalty.applicationDate ?? null, status: penalty.status, deductionAmount: fact.amount, deductionId: fact.id }
      })
    }
    if (row.kind === 'project_penalty') {
      const ids = (row.penaltyDeductions ?? []).filter(deduction => state.externalSettlements.some(settlement => settlement.id === deduction.settlementId)).map(deduction => deduction.settlementId)
      const other = actor.capabilities.includes('other-settlement:read') && ids.length
        ? await tx.select<{ id: string, name: string, no: string }>(`SELECT id,name,no FROM expenditure_settlements WHERE document_owner='other' AND id IN(${ids.map(() => '?').join(',')})`, ids)
        : []
      row.penaltySettlementSources = other.map(settlement => ({ ...settlement, owner: 'other' }))
    }
  }
  return { ...data, rows }
}

function sourceEvidence(actor: BusinessSession, state: StoredState, rows: readonly OwnerCommercialDocumentSource[], asOf: string, consumed?: Awaited<ReturnType<typeof domain>>): SourceEvidenceDTO[] {
  const evidence = (key: string, capability: string, wanted: boolean, value: unknown, unavailable = false): SourceEvidenceDTO => {
    const status = !wanted ? 'not-requested' : !actor.capabilities.includes(capability) ? 'forbidden' : unavailable ? 'unavailable' : 'readable'
    return { key, state: status, sourceVersion: status === 'readable' ? digest(value) : null, asOf: status === 'readable' ? asOf : null }
  }
  const sub = rows.filter(row => row.kind === 'sub_settlement')
  const income = rows.filter(row => row.kind === 'final_settlement')
  const constructionIds = new Set(rows.filter(row => !subcontract(row.kind)).flatMap(row => row.contractId ? [row.contractId] : []))
  const subcontractIds = new Set(rows.filter(row => subcontract(row.kind) && row.contractKind !== 'other_expense').flatMap(row => row.contractId ? [row.contractId] : []))
  const boqIds = new Set(rows.filter(row => ['owner_change', 'owner_report', 'final_settlement'].includes(row.kind)).flatMap(row => row.contractId ? [row.contractId] : []))
  return [
    { key: 'owner-documents', state: 'readable', sourceVersion: `owner-documents:${digest(state.snapshot)}`, asOf },
    evidence('construction-contracts', 'construction-contract:read', constructionIds.size > 0, {
      contracts: consumed?.construction?.contracts.filter(row => constructionIds.has(row.id)),
      supplements: consumed?.construction?.supplements.filter(row => row.contractId !== null && constructionIds.has(row.contractId)),
    }, [...constructionIds].some(id => !consumed?.construction?.contracts.some(row => row.id === id))),
    evidence('subcontract-contracts', 'subcontract-contract:read', subcontractIds.size > 0, { contracts: consumed?.subcontracts.filter(row => subcontractIds.has(row.id)), supplements: consumed?.subcontractSupplements?.filter(row => row.contractId !== null && subcontractIds.has(row.contractId)) }, [...subcontractIds].some(id => !consumed?.subcontracts.some(row => row.id === id))),
    evidence('auxiliary-contracts', 'auxiliary-contract:read', rows.some(row => row.contractKind === 'other_expense' && row.contractId !== null), consumed?.auxiliary.filter(row => rows.some(source => source.contractKind === 'other_expense' && source.contractId === row.id))),
    evidence('boq-owner-changes', 'boq:read', boqIds.size > 0, consumed?.changes.filter(row => row.contractId !== null && boqIds.has(row.contractId)), !consumed?.boqKnown),
    evidence('settlement-applications', 'finance-payment-application:read', sub.length > 0, sub.map(row => row.subcontractSettlementEvidence?.applications), sub.some(row => row.subcontractSettlementEvidence?.applications === null)),
    evidence('settlement-payment-records', 'finance-payment-record:read', sub.length > 0, sub.map(row => row.subcontractSettlementEvidence?.cashApplications), sub.some(row => row.subcontractSettlementEvidence?.cashApplications == null || row.subcontractSettlementEvidence.cashApplications.some(application => application.payments === null))),
    { key: 'owner-receipts', state: income.length ? 'unavailable' : 'not-requested', sourceVersion: null, asOf: null },
  ]
}

/** Related host pages read this owner in their existing transaction, without another directory. */
export async function readProductionOwnerDocumentFacts(tx: TransactionDb, actor: BusinessSession, scope: { projectId?: string, contractId?: string } = {}) {
  if (!actor.capabilities.includes('owner-document:read') && !actor.capabilities.includes('subcontract-document:read'))
    fail('forbidden', '无正式商务单据来源读取权限')
  const state = await readProductionOwnerDocumentState(tx, actor)
  const read = await readRows(tx, actor, state, scope)
  const documents = read.rows
  const asOf = new Date().toISOString()
  const evidence = sourceEvidence(actor, state, documents, asOf, read)
  return { documents, sourceEvidence: evidence, sourceVersion: `owner-facts:${digest({ documents, sources: evidence.map(({ asOf: _asOf, ...source }) => source) })}`, asOf }
}

async function persist(tx: TransactionDb, before: StoredState, owner: ReturnType<typeof createOwnerCommercialDocumentCommandTestInstance>, command: OwnerCommercialDocumentCommandRequestDTO, result: OwnerCommercialDocumentCommandResultDTO, actor: BusinessSession) {
  const after = owner.snapshot()
  const own = after.documents.filter(row => row.kind !== 'owner_change')
  const removed = before.snapshot.documents.filter(previous => !own.some(row => row.kind === previous.kind && row.id === previous.id))
  for (const previous of removed) {
    if (!result.deleted || command.id !== previous.id || command.kind !== previous.kind)
      fail('unavailable', '商务删除缺原命令与稳定目标，不能移除其他事实')
    own.push({ ...previous, version: Number(result.version), updatedAt: result.updatedAt, deletedAt: result.updatedAt } as OwnerCommercialDocumentSource)
  }
  for (const source of own) {
    const previous = before.snapshot.documents.find(row => row.kind === source.kind && row.id === source.id)
    if (previous && isDeepStrictEqual(previous, source))
      continue
    if (source.version !== (previous?.version ?? 0) + 1)
      fail('unavailable', '商务版本不连续，停止事务并保留原图')
    const deletedAt = result.deleted && command.kind === source.kind && command.id === source.id ? result.updatedAt : null
    if (source.kind === 'sub_settlement') {
      const [existing] = await tx.select<{ document_owner: string }>('SELECT document_owner FROM expenditure_settlements WHERE id=?', [source.id])
      if (existing && existing.document_owner !== 'business')
        fail('conflict', '共享结算稳定ID已属于原Other owner，不能覆盖其原文或归属')
      await tx.execute(`INSERT INTO expenditure_settlements(id,no,name,biz_type,project_id,supplier_id,contract_id,settlement_type,total_amount,settlement_date,settlement_period,deduction_note,status,note,created_by,updated_by,created_at,updated_at,responsible,department,payee_supplier_id,payee_name_snapshot,version,record_json,deleted_at,document_owner)
        VALUES(?,?,?,'分包',?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,'business')
        ON CONFLICT(id) DO UPDATE SET no=excluded.no,name=excluded.name,project_id=excluded.project_id,supplier_id=excluded.supplier_id,contract_id=excluded.contract_id,settlement_type=excluded.settlement_type,total_amount=excluded.total_amount,settlement_date=excluded.settlement_date,settlement_period=excluded.settlement_period,deduction_note=excluded.deduction_note,status=excluded.status,note=excluded.note,updated_at=excluded.updated_at,version=excluded.version,record_json=excluded.record_json,deleted_at=excluded.deleted_at`, [source.id, source.no, source.name, source.projectId, source.supplierId ?? null, source.contractId, source.documentType, source.amount, source.applicationDate ?? '', source.periodNo, source.deductionNote ?? '', source.status, source.note, actor.actorId, actor.actorId, source.createdAt, source.updatedAt, source.supplierId ?? null, source.supplierName ?? null, source.version, JSON.stringify(source), deletedAt])
    }
    else {
      const table = PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES[source.kind as keyof typeof PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES]
      if (!table)
        fail('unavailable', '商务kind不属于本持久参与者')
      await tx.execute(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,contract_id=excluded.contract_id,supplier_id=excluded.supplier_id,crew_id=excluded.crew_id,period_no=excluded.period_no,record_json=excluded.record_json,version=excluded.version,deleted_at=excluded.deleted_at`, [source.id, source.projectId, source.contractId, source.supplierId ?? null, source.crewId ?? null, source.periodNo || null, JSON.stringify(source), source.version, deletedAt])
    }
    await tx.execute('INSERT INTO owner_document_history VALUES(?,?,?,?,?,?,?,?)', [`business-history-${randomUUID()}`, source.kind, source.id, actor.actorId, command.commandId, previous ? JSON.stringify(previous) : null, JSON.stringify(source), result.updatedAt])
    for (const file of source.files) {
      if (previous?.files.find(row => row.id === file.id)?.deletedAt !== file.deletedAt)
        await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=?', [file.deletedAt, file.id])
    }
  }
  for (const row of after.penaltyDeductions) {
    if (!before.snapshot.penaltyDeductions.some(prior => prior.id === row.id))
      await tx.execute('INSERT INTO penalty_settlement_deductions VALUES(?,?,?,?)', [row.id, row.penaltyId, row.settlementId, JSON.stringify(row)])
  }
  for (const row of after.penaltyRectifications) {
    if (!before.snapshot.penaltyRectifications.some(prior => prior.id === row.id))
      await tx.execute('INSERT INTO penalty_rectification_events VALUES(?,?,?)', [row.id, row.penaltyId, JSON.stringify(row)])
  }
  await tx.execute('UPDATE owner_document_revision SET revision=?,metadata_json=? WHERE singleton=1', [after.sourceVersion, JSON.stringify({ migrationKeys: after.migrationKeys, migrationSnapshotFingerprint: after.migrationSnapshotFingerprint })])
  await tx.execute('INSERT INTO owner_document_command_receipts VALUES(?,?,?,?,?,?,?)', [...ownerDocumentKey(command), command.kind, digest(command), JSON.stringify(result), result.updatedAt])
}

export function createProductionOwnerDocumentService(storage: ProductionStorage) {
  const active = new Map<string, { fingerprint: string, promise: Promise<OwnerCommercialDocumentCommandResultDTO> }>()
  const boq = createProductionBoqService(storage)
  function authorize(kind: OwnerCommercialDocumentKind, session: Session, write = false) {
    const actor = structuredClone(session())
    if (!OWNER_COMMERCIAL_DOCUMENT_KINDS.includes(kind) || actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId
      || !actor.capabilities.includes(readCapability(kind)) || (write && !actor.capabilities.includes(writeCapability(kind)))) {
      fail('forbidden', '当前可信身份不能读取或修改此正式商务来源')
    }
    return actor
  }
  async function run<T>(kind: OwnerCommercialDocumentKind, session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession, state: StoredState) => Promise<T>) {
    const queued = authorize(kind, session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const actor = authorize(kind, session, write)
      if (!isDeepStrictEqual(queued, actor))
        fail('forbidden', '排队期间商务身份、权限或来源已切换')
      const participant = await assertProductionOwnerDocument(tx, actor)
      if (participant.schemaVersion !== 3)
        fail('unavailable', '商务参与者还未达到含共享结算的连续升级版本')
      const state = await readProductionOwnerDocumentState(tx, actor)
      const result = await work(tx, actor, state)
      if (!isDeepStrictEqual(actor, session()))
        fail('forbidden', '操作期间商务身份或权限变化，保留原提交编号')
      return result
    }).catch((cause) => {
      if (cause && typeof cause === 'object' && 'problem' in cause && !(cause instanceof Error && cause.name === 'OwnerCommercialDocumentRepositoryProblem')) {
        const problem = cause.problem as { code: Parameters<typeof fail>[0], message: string }
        return fail(problem.code, problem.message)
      }
      throw cause
    })
  }
  function meta(actor: BusinessSession, state: StoredState, operation: string, scope: unknown, dataOrigin: 'real' | 'demo' = 'real', asOf = new Date().toISOString(), rows?: OwnerCommercialDocumentSource[], consumed?: Awaited<ReturnType<typeof domain>>) {
    return createReadMeta({ session: actor, schemaVersion: 'owner-document-read-v3', operation, dataOrigin, asOf, coverage: 'complete', scope, sources: dataOrigin === 'real' ? sourceEvidence(actor, state, rows ?? [], asOf, consumed) : [] })
  }
  async function ownerChange(command: OwnerCommercialDocumentCommandRequestDTO, session: Session) {
    const wrapper = await run(command.kind, session, false, async (tx, actor) => {
      const [original] = await tx.select<{ request_json: string }>(`SELECT request_json FROM boq_command_intents WHERE workspace_id=? AND actor_id=?
        AND json_extract(request_json,'$.action.kind')='owner-change' AND json_extract(request_json,'$.action.command.commandId')=?`, ownerDocumentKey(command))
      if (original) {
        const saved = parseOwnerDocumentStoredJson<BoqCommand>(original.request_json)
        if (saved.action.kind !== 'owner-change')
          fail('conflict', '原编号已经用于其他清单动作')
        // Existing BOQ summary strips payloads; its actual execute compares original byte digests.
        return { ...saved, action: { kind: 'owner-change' as const, command } }
      }
      if (command.action === 'save' || command.action === 'submit')
        await domain(tx, actor, await readProductionOwnerDocumentState(tx, actor), command)
      const source = command.id ? (await readProductionBoqChanges(tx)).find(row => row.id === command.id) : null
      const projectId = command.action === 'save' || command.action === 'submit' ? String(command.draft.projectId ?? '') : source?.projectId ?? ''
      const contractId = command.action === 'save' || command.action === 'submit' ? String(command.draft.contractId ?? '') : source?.contractId ?? ''
      if (!isStableRouteIdentity(projectId) || !isStableRouteIdentity(contractId))
        fail('relationship-mismatch', '甲方变洽签须明确真实项目与施工主合同')
      const parent = await readProductionConstructionContractReference(tx, actor, contractId)
      return { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: command.commandId, projectId, contractId, origin: 'real' as const, requiredCapability: 'boq:write' as const, contractVersion: productionBoqHeadVersion(parent), action: { kind: 'owner-change' as const, command } }
    })
    const result = await boq.execute(wrapper, session)
    return run(command.kind, session, false, (tx, actor) => productionOwnerDocumentBoqResult(tx, result, actor))
  }
  return {
    context(kind: OwnerCommercialDocumentKind | undefined, session: Session) {
      const effectiveKind = kind ?? (session().capabilities.includes('owner-document:read') ? 'owner_penalty' : 'sub_change')
      return run(effectiveKind, session, false, async (tx, actor, state) => {
        const data = await domain(tx, actor, state)
        const context = data.owner.context(actor, undefined, kind)
        return { ...context, projects: context.projects.map(row => ({ ...row, version: data.versions.projectId!.get(row.id) })), customers: context.customers.map(row => ({ ...row, version: data.versions.customerId!.get(row.id) })), suppliers: context.suppliers.map(row => ({ ...row, version: data.versions.supplierId!.get(row.id) })), crews: context.crews?.map(row => ({ ...row, version: data.versions.crewId!.get(row.id) })), contracts: context.contracts.map(row => ({ ...row, version: data.versions.contractId!.get(row.id) })) }
      })
    },
    list(kind: string, input: Record<string, unknown>, session: Session) {
      const query = parseOwnerCommercialDocumentListQuery(kind, input)
      return run(query.kind, session, false, async (tx, actor, state) => {
        if (query.origin === 'demo' || query.includeDemo)
          fail('forbidden', '正式商务列表只读取实际来源')
        const read = await readRows(tx, actor, state)
        const { rows } = read
        const proof = meta(actor, state, 'owner-document:list', query, 'real', undefined, rows, read)
        return withOriginReadMeta(buildOwnerCommercialDocumentListPage({ documents: rows, query, asOf: proof.asOf, sourceVersion: proof.sourceVersion, capabilities: [...actor.capabilities] }), { real: proof, demo: meta(actor, state, 'owner-document:list', query, 'demo', proof.asOf) })
      })
    },
    detail(kind: string, id: string, input: Record<string, unknown>, session: Session) {
      const query = parseOwnerCommercialDocumentDetailQuery(kind, id, input)
      return run(query.kind, session, false, async (tx, actor, state) => {
        if (query.origin !== 'real' || query.includeDemo)
          fail('forbidden', '商务详情不能跨正式与演示来源')
        const read = await readRows(tx, actor, state)
        const { rows } = read
        const proof = meta(actor, state, 'owner-document:detail', query, 'real', undefined, rows, read)
        return withReadMeta(buildOwnerCommercialDocumentDetail({ documents: rows, query, asOf: proof.asOf, sourceVersion: proof.sourceVersion, capabilities: [...actor.capabilities] }), proof)
      })
    },
    form(kind: OwnerCommercialDocumentKind, id: string, session: Session, includeDeleted = false) {
      return run(kind, session, false, async (tx, actor, state) => {
        if (includeDeleted) {
          let source: OwnerCommercialDocumentSource | undefined
          let deletedAt: string | null = null
          let original: OwnerCommercialDocumentCommandResultDTO | undefined
          if (kind === 'owner_change') {
            await validateProductionBoqState(tx)
            const [head] = await tx.select<{ deleted_at: string | null }>('SELECT deleted_at FROM boq_change_records WHERE id=?', [id])
            deletedAt = head?.deleted_at ?? null
            source = (await readProductionBoqChanges(tx, undefined, undefined, true)).find(row => row.id === id)
            const receipts = await tx.select<{ result_json: string }>(`SELECT r.result_json FROM boq_commands r JOIN boq_command_intents i
              ON i.workspace_id=r.workspace_id AND i.actor_id=r.actor_id AND i.command_id=r.command_id
              WHERE r.workspace_id=? AND r.actor_id=? AND json_extract(i.request_json,'$.action.kind')='owner-change'
              AND json_extract(i.request_json,'$.action.command.kind')='owner_change'
              AND json_extract(i.request_json,'$.action.command.action')='delete'
              AND json_extract(i.request_json,'$.action.command.id')=?`, [actor.workspaceId, actor.actorId, id])
            if (receipts.length === 1)
              original = await productionOwnerDocumentBoqResult(tx, parseOwnerDocumentStoredJson(receipts[0]!.result_json), actor)
          }
          else {
            source = state.allDocuments.find(row => row.kind === kind && row.id === id)
            const table = kind === 'sub_settlement' ? 'expenditure_settlements' : PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES[kind]
            const [head] = await tx.select<{ deleted_at: string | null }>(`SELECT deleted_at FROM ${table} WHERE id=?`, [id])
            deletedAt = head?.deleted_at ?? null
            for (const [key, result] of state.snapshot.commands) {
              const scope = JSON.parse(key) as string[]
              if (scope[0] !== actor.workspaceId || scope[1] !== actor.actorId || result.id !== id || !result.deleted)
                continue
              const intent = state.intents.find(row => row.command_id === result.commandId && row.kind === kind)
              if (intent && (await restoreProductionOwnerDocumentIntent(tx, intent.request_json)).action === 'delete')
                original = result
            }
          }
          if (!source || !deletedAt || !original || !original.deleted || source.version < Number(original.version))
            fail('forbidden', '仅可核对当前身份已可靠删除的同一商务记录；普通编辑不读取归档记录')
          const form = createOwnerCommercialDocumentCommandTestInstance({ strictSources: true, documents: [source] }).form(kind, id, actor)
          return { ...form, workspaceId: actor.workspaceId, actorId: actor.actorId, dataOrigin: 'real' as const, readOnly: true, deletionVerification: { commandId: original.commandId, deletedAt } }
        }
        const data = await domain(tx, actor, state)
        const source = data.owner.rawRows().find(row => row.kind === kind && row.id === id)
        if (source?.projectId && !data.projects.some(project => project.id === source.projectId))
          fail(actor.capabilities.includes('project:list:read') ? 'not-found' : 'forbidden', '当前工程项目已删除、不可用或无权读取，不能打开编辑表单')
        const form = data.owner.form(kind, id, actor)
        return { ...form, draft: { ...form.draft, relationshipVersionsJson: JSON.stringify(selectedRelationships(form.draft, data.versions)) }, workspaceId: actor.workspaceId, actorId: actor.actorId, dataOrigin: 'real' as const }
      })
    },
    boqLines(scope: { projectId: string, contractId: string, periodNo?: string, quantityBasis?: unknown, origin?: string }, session: Session) {
      return run('owner_report', session, false, async (tx, actor, state) => {
        if (scope.origin !== undefined && scope.origin !== 'real')
          fail('forbidden', '报量清单不可跨来源')
        const { owner } = await domain(tx, actor, state)
        const basis = scope.quantityBasis ?? 'field'
        if (!isQuantityBasis(basis))
          fail('validation-failed', '报量取数基准无效')
        if (!scope.periodNo)
          return owner.boqLinesFor(scope.projectId, scope.contractId)
        const actualScope = { projectId: scope.projectId, contractId: scope.contractId, periodNo: scope.periodNo, basis }
        return productionQuantityInTransaction(tx, () => actor).withMonthly({ ...actualScope, origin: 'real', includeDemo: false }, actor, async (facts) => {
          const token = await quantityConsumed(tx, actor, actualScope, facts)
          const source = facts.find(row => row.contractId === scope.contractId)
          return owner.boqLinesFor(scope.projectId, scope.contractId, scope.periodNo, undefined, facts).map(row => ({ ...row, quantityConsumedVersion: token, quantitySourceVersion: source?.sourceVersion ?? null, quantitySourceUpdatedAt: source?.sourceUpdatedAt ?? null }))
        })
      })
    },
    async execute(input: OwnerCommercialDocumentCommandRequestDTO, session: Session) {
      const command = parseOwnerCommercialDocumentCommandRequest(input)
      const actor = authorize(command.kind, session, true)
      parseResolveCommandBody({ commandId: command.commandId })
      if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
        fail('forbidden', '商务原意图与当前可信身份不同')
      const key = JSON.stringify(ownerDocumentKey(command))
      const fingerprint = digest(command)
      const pending = active.get(key)
      if (pending) {
        if (pending.fingerprint !== fingerprint)
          fail('conflict', '原商务提交仍在执行，不能改变内容')
        return pending.promise
      }
      let confirmedAbsent = false
      const promise = (async () => {
        await run(command.kind, session, true, async (tx, current, before) => {
          const [sealed] = await tx.select('SELECT command_id FROM owner_document_command_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', ownerDocumentKey(command))
          if (sealed)
            fail('conflict', '原商务编号已封存未应用，迟到请求不能保存')
          await assertProductionOwnerDocumentCommandNamespace(tx, current, command.commandId, command.kind, { legacyCommandIds: before.legacyCommandIds })
          if (command.kind === 'owner_change')
            return
          const [old] = await tx.select<{ fingerprint: string }>('SELECT fingerprint FROM owner_document_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', ownerDocumentKey(command))
          if (old) {
            if (old.fingerprint !== fingerprint)
              fail('conflict', '同一商务原编号不能改变动作、目标或正文')
            return
          }
          if (before.legacyCommandIds.has(command.commandId))
            fail('conflict', '原Native商务编号属于保全的历史证据，不能冒用为新的正式提交')
          const summary = await productionOwnerDocumentIntent(tx, command, current)
          await tx.execute('INSERT INTO owner_document_command_intents VALUES(?,?,?,?,?,?,?,?)', [...ownerDocumentKey(command), command.kind, command.id, fingerprint, JSON.stringify(summary), new Date().toISOString()])
        })
        if (command.kind === 'owner_change')
          return ownerChange(command, session)
        return run(command.kind, session, true, async (tx, current, before) => {
          const commandKey = commandJournalKey(command.commandId, current, 'owner-commercial-document')
          const old = before.snapshot.commands.find(([key]) => key === commandKey)
          if (old)
            return old[1]
          confirmedAbsent = true
          const original = before.intents.find(row => row.workspace_id === current.workspaceId && row.actor_id === current.actorId && row.command_id === command.commandId)!
          const fixed = await restoreProductionOwnerDocumentIntent(tx, original.request_json)
          const data = await domain(tx, current, before, fixed)
          const { owner } = data
          if (fixed.action !== 'save' && fixed.action !== 'submit' && fixed.action !== 'delete') {
            const source = data.owner.rawRows().find(row => row.kind === fixed.kind && row.id === fixed.id)
            if (source) {
              for (const [field, values] of Object.entries(data.versions)) {
                const id = source[field as keyof typeof source]
                if (typeof id === 'string' && id && !values.has(id))
                  fail('stale-source', '原单据当前依赖主档已不可用，保留冻结历史并关闭日常写入')
              }
            }
          }
          const result = await owner.execute(fixed, current)
          await persist(tx, before, owner, fixed, result, current)
          await readProductionOwnerDocumentState(tx, current)
          return result
        })
      })()
      active.set(key, { fingerprint, promise })
      try {
        return await promise
      }
      catch (cause) {
        if (confirmedAbsent && cause && typeof cause === 'object' && 'problem' in cause) {
          const problem = cause.problem as { code: string }
          if (['validation-failed', 'conflict', 'relationship-mismatch', 'not-found', 'forbidden'].includes(problem.code)) {
            let sealed = false
            try {
              sealed = await run(command.kind, session, true, async (tx, current, state) => {
                const key = commandJournalKey(command.commandId, current, 'owner-commercial-document')
                if (state.snapshot.commands.some(([identity]) => identity === key))
                  return false
                const original = state.intents.find(row => row.command_id === command.commandId && row.kind === command.kind)
                if (!original || original.fingerprint !== fingerprint)
                  return false
                const [prior] = await tx.select<{ kind: string }>('SELECT kind FROM owner_document_command_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', ownerDocumentKey(command))
                if (prior?.kind && prior.kind !== command.kind)
                  return false
                if (!prior)
                  await tx.execute('INSERT INTO owner_document_command_resolutions VALUES(?,?,?,?,?,?)', [...ownerDocumentKey(command), command.kind, JSON.stringify(locator(command)), new Date().toISOString()])
                return true
              })
            }
            catch {
              // Lost authority or unavailable storage leaves the original outcome unknown; no marker is released.
            }
            if (sealed)
              Object.assign(problem, { commandId: command.commandId, commandOutcome: 'not-applied' })
          }
        }
        throw cause
      }
      finally {
        if (active.get(key)?.promise === promise)
          active.delete(key)
      }
    },
    async resolve(kind: OwnerCommercialDocumentKind, descriptor: string | CommandRecoveryDescriptor, session: Session) {
      const actor = authorize(kind, session, true)
      const commandId = typeof descriptor === 'string' ? descriptor : descriptor.commandId
      parseResolveCommandBody({ commandId })
      if (typeof descriptor !== 'string' && (descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId || descriptor.family !== 'owner-commercial-document' || descriptor.scopeId !== kind))
        fail('forbidden', '商务恢复定位与当前真实身份或类型不同')
      await active.get(JSON.stringify([actor.workspaceId, actor.actorId, commandId]))?.promise.catch(() => {})
      if (kind === 'owner_change') {
        const original = await run(kind, session, false, async tx => (await tx.select<{ request_json: string }>(`SELECT request_json FROM boq_command_intents WHERE workspace_id=? AND actor_id=?
          AND json_extract(request_json,'$.action.kind')='owner-change' AND json_extract(request_json,'$.action.command.commandId')=?`, [actor.workspaceId, actor.actorId, commandId]))[0])
        if (original) {
          const wrapper = parseOwnerDocumentStoredJson<BoqCommand>(original.request_json)
          if (wrapper.action.kind !== 'owner-change')
            fail('conflict', '原编号并非甲方变洽签命令')
          if (typeof descriptor !== 'string' && (descriptor.targetId !== wrapper.action.command.id || descriptor.action !== wrapper.action.command.action))
            fail('conflict', '签证恢复目标或动作不是原提交范围')
          const result = await boq.resolve(boqRecoveryDescriptor(wrapper), session)
          if (result.outcome === 'applied')
            return { outcome: 'applied' as const, result: await run(kind, session, false, (tx, current) => productionOwnerDocumentBoqResult(tx, result.result, current)) }
        }
      }
      return run(kind, session, true, async (tx, current, state) => {
        await assertProductionOwnerDocumentCommandNamespace(tx, current, commandId, kind, { legacyCommandIds: new Set() })
        const intent = state.intents.find(row => row.command_id === commandId && row.workspace_id === current.workspaceId && row.actor_id === current.actorId)
        if (intent && intent.kind !== kind)
          fail('conflict', '商务原编号属于另一种单据')
        if (intent && typeof descriptor !== 'string') {
          const original = await restoreProductionOwnerDocumentIntent(tx, intent.request_json)
          if (descriptor.targetId !== original.id || descriptor.action !== original.action)
            fail('conflict', '商务恢复目标或动作不是原提交范围')
        }
        const key = commandJournalKey(commandId, current, 'owner-commercial-document')
        const receipt = state.snapshot.commands.find(([entry]) => entry === key)
        if (receipt)
          return { outcome: 'applied' as const, result: receipt[1] }
        if (state.legacyCommandIds.has(commandId))
          fail('unavailable', '原Native商务命令保留完整来源证据，缺可信正式身份映射，不能封存为未应用')
        const original = intent ? locator(await restoreProductionOwnerDocumentIntent(tx, intent.request_json)) : { kind, commandId, workspaceId: current.workspaceId, actorId: current.actorId, targetId: typeof descriptor === 'string' ? null : descriptor.targetId, action: typeof descriptor === 'string' ? 'unknown' : descriptor.action }
        const [sealed] = await tx.select<{ kind: string }>('SELECT kind FROM owner_document_command_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', [current.workspaceId, current.actorId, commandId])
        if (sealed?.kind && sealed.kind !== kind)
          fail('conflict', '原商务编号已按另一种单据封存')
        if (!sealed)
          await tx.execute('INSERT INTO owner_document_command_resolutions VALUES(?,?,?,?,?,?)', [current.workspaceId, current.actorId, commandId, kind, JSON.stringify(original), new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId }
      })
    },
    file(scope: { kind: OwnerCommercialDocumentKind, id: string, fileId: string, origin: 'real' }, session: Session) {
      return run(scope.kind, session, false, async (tx, actor, state) => {
        if (scope.origin !== 'real')
          fail('forbidden', '商务原件不得跨来源读取')
        if (scope.kind === 'owner_change') {
          if (!['boq:read', 'construction-contract:read', 'project:list:read'].every(capability => actor.capabilities.includes(capability)))
            fail('forbidden', '无权读取当前实际清单与签证原件')
          const change = (await readProductionBoqChanges(tx)).find(row => row.id === scope.id)
          if (!change?.projectId || !change.contractId)
            fail('not-found', '原签证没有实际项目或主合同')
          await readProductionConstructionContractReference(tx, actor, change.contractId, { includeDeleted: true })
          // The BOQ adapter owns file proof; avoid coordinator re-entry by validating its same raw source below.
          const file = change.files.find(row => row.id === scope.fileId && row.deletedAt === null)
          if (!file)
            fail('not-found', '原签证附件不存在或已隐藏')
          await validateProductionBoqState(tx)
          const [body] = await tx.select<{ content: Uint8Array, sha256: string }>('SELECT content,sha256 FROM file_payloads WHERE file_ref_id=?', [file.fileRefId ?? file.id])
          if (!body?.content)
            fail('unavailable', '原签证附件仅有描述，正文不可用')
          return { ...scope, workspaceId: actor.workspaceId, actorId: actor.actorId, fileName: file.fileName, mimeType: file.mimeType, sha256: body.sha256, bytes: Buffer.from(body.content) }
        }
        const row = state.snapshot.documents.find(row => row.kind === scope.kind && row.id === scope.id)
        const file = row?.files.find(file => file.id === scope.fileId && file.deletedAt === null)
        const binding = state.files.find(binding => binding.file_ref_id === scope.fileId && binding.kind === scope.kind && binding.owner_id === scope.id)
        if (!file || !binding)
          fail('not-found', '原附件不属于当前商务单据或已经隐藏')
        const [body] = await tx.select<{ content: Uint8Array, sha256: string }>('SELECT content,sha256 FROM file_payloads WHERE file_ref_id=?', [scope.fileId])
        if (!body?.content || binding.body_state !== 'embedded')
          fail('unavailable', '商务历史原件只有描述，缺少实际正文')
        return { ...scope, workspaceId: actor.workspaceId, actorId: actor.actorId, fileName: file.fileName, mimeType: file.mimeType || 'application/octet-stream', sha256: body.sha256, bytes: Buffer.from(body.content) }
      })
    },
  }
}
