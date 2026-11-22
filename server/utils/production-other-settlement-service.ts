import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { FinanceExpenseReference } from '../../app/lib/finance/expense-reference'
import type { OtherSettlementContext, OtherSettlementFact, OtherSettlementResult, OtherSettlementSourceDocument, OtherSettlementStored } from '../../app/lib/other-settlement/contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { CONFIRMED_SETTLEMENT_SQL_VALUES, isConfirmedExpenditureSettlement, isEffectiveExpenditureContract } from '../../app/lib/contract/effective-status'
import { FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { expenseConsumptionFingerprint } from '../../app/lib/finance/clearance-verification'
import { contractOriginalPayloadDigest } from '../../app/lib/forms/original-content'
import { decodeOtherSettlementResult, otherSettlementFingerprint, otherSettlementKey, readOtherSettlementStored, validateOtherSettlementJournal } from '../../app/lib/other-settlement/storage'
import { decodeOtherSettlementCommand } from '../../app/lib/other-settlement/validation'
import { createOtherSettlementInstance } from './other-settlement-instance'
import { readAuxiliaryContractScopeFacts, validateProductionAuxiliaryState } from './production-auxiliary-contract-record'
import { listWorkerReferences } from './production-crew-worker-references'
import { appendClearanceLink, readClearanceLinks, validateExpenseClearanceJournal } from './production-finance-clearance'
import { listOriginalExpenseReferences, readOriginalExpenseReference } from './production-finance-expense-references'
import { listMigrationReferences } from './production-migration-references'
import { assertOtherSettlementSourceCommandUnused, validateOtherSettlementImportEvidence } from './production-other-settlement-migration'
import { createReadMeta, withReadMeta } from './read-meta'

type Session = () => BusinessSession
function fail(code: Parameters<typeof auxiliaryProblem>[0], message: string): never {
  throw auxiliaryProblem(code, message)
}
async function identities(tx: TransactionDb, actor: BusinessSession): Promise<Pick<OtherSettlementContext, 'projects' | 'suppliers' | 'workers' | 'contracts'>> {
  const projects = actor.capabilities.includes('project:list:read')
    ? await tx.select<{
        id: string
        label: string
      }>('SELECT id,name AS label FROM projects WHERE deleted_at IS NULL ORDER BY name,id')
    : []
  const suppliers = actor.capabilities.includes('supplier:list:read')
    ? await tx.select<{
        id: string
        label: string
      }>('SELECT id,json_extract(draft_json,\'$.name\') AS label FROM suppliers WHERE COALESCE(json_extract(draft_json,\'$.deletedAt\'),\'\')=\'\' ORDER BY label,id')
    : []
  const workers = actor.capabilities.includes('worker:list:read') ? (await listWorkerReferences(tx, actor)).map(row => ({ id: row.id, label: row.name })) : []
  let contracts: OtherSettlementContext['contracts'] = []
  if (actor.capabilities.includes('auxiliary-contract:read')) {
    const participant = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'auxiliary-contract\''))[0]
    if (participant?.schema_version === 1) {
      const facts = await readAuxiliaryContractScopeFacts(tx, actor)
      contracts = facts.filter(row => row.eligible && isEffectiveExpenditureContract(row.status) && projects.some(project => project.id === row.projectId) && suppliers.some(supplier => supplier.id === row.supplierId)).map(row => ({ id: row.id, kind: 'other_expense', name: row.name, projectId: row.projectId, supplierId: row.supplierId, status: row.status, amount: row.amount === null ? null : row.amount.toFixed(2), changedAmount: row.amount === null || row.supplementAmount === null ? null : (row.amount + row.supplementAmount).toFixed(2) }))
    }
  }
  return { projects, suppliers, workers, contracts }
}
async function actualFacts(tx: TransactionDb, record: OtherSettlementStored, actor: BusinessSession): Promise<{
  facts: OtherSettlementFact[] | null
  sources: OtherSettlementSourceDocument[]
  qualificationUnavailableReason?: string
  unavailableFactKinds?: OtherSettlementFact['kind'][]
}> {
  if (!record.draft.originalExpenses?.length && !record.draft.contractId)
    return { facts: record.facts, sources: [] }
  const participant = await tx.select('SELECT domain FROM production_participants WHERE domain=\'finance\' AND schema_version IN (1,2)')
  if (!participant.length)
    return { facts: null, sources: [] }
  if (!['finance-reimbursement:read', 'finance-payment-application:read', 'finance-payment-record:read'].every(capability => actor.capabilities.includes(capability)))
    return { facts: null, sources: [] }
  const imports = record.version === 0 ? (await tx.select<{ graph_json: string }>('SELECT graph_json FROM other_settlement_imports WHERE sealed_at IS NULL')).map(row => JSON.parse(row.graph_json)) : []
  const serviceIds = new Set<string>()
  let qualificationUnavailableReason: string | undefined
  const unavailableFactKinds = new Set<OtherSettlementFact['kind']>()
  for (const adopted of record.draft.contractId ? [] : record.draft.originalExpenses ?? []) {
    const allocation = (await tx.select<{ id: string, frozen_json: string }>('SELECT id,frozen_json FROM expenditure_settlement_expense_allocations WHERE settlement_id=? AND original_expense_line_id=? AND deleted_at IS NULL', [record.id, adopted.originalExpenseLineId]))[0]
    if (!allocation)
      return { facts: null, sources: [] }
    const frozen = JSON.parse(allocation.frozen_json) as FinanceExpenseReference
    const evidence = imports.find(item => item.graph.tables.expenditure_settlement_expense_allocations?.some((line: { id: string }) => line.id === allocation.id))
    const bound = (entityType: string, id: string | null) => !id ? null : evidence ? evidence.mappings.find((mapping: { entityType: string, legacyId: string, targetId: string }) => mapping.entityType === entityType && mapping.legacyId === id)?.targetId ?? null : id
    let original
    try {
      original = await readOriginalExpenseReference(tx, actor, adopted.originalExpenseLineId)
    }
    catch (cause) {
      if (cause instanceof FinanceRepositoryProblem && ['unavailable', 'forbidden'].includes(cause.problem.code))
        return { facts: null, sources: [] }
      throw cause
    }
    if (!original || adopted.amount === null || original.projectId !== (record.draft.projectId ?? null) || original.projectId !== bound('projects', frozen.projectId) || original.serviceSupplierId !== bound('suppliers', frozen.serviceSupplierId) || original.applicantWorkerId !== bound('workers', frozen.applicantWorkerId) || original.applicantSupplierId !== bound('suppliers', frozen.applicantSupplierId) || original.applicantWorkerId !== (record.draft.payeeWorkerId ?? null) || original.applicantSupplierId !== (record.draft.payeeSupplierId ?? null) || adopted.amount > original.amount || adopted.amount > frozen.amount)
      return { facts: null, sources: [] }
    serviceIds.add(original.serviceSupplierId)
    if (!['verified', 'not-required'].includes(original.qualification.state))
      qualificationUnavailableReason = original.qualification.message
    const claims = await tx.select<{ allocated_amount: number | null }>(`SELECT a.allocated_amount
      FROM expenditure_settlement_expense_allocations a
      JOIN expenditure_settlements h ON h.id=a.settlement_id
      WHERE a.original_expense_line_id=? AND a.deleted_at IS NULL
        AND h.status IN (${CONFIRMED_SETTLEMENT_SQL_VALUES})`, [original.id])
    const claimed = claims.reduce<number | null>((sum, claim) => {
      if (sum === null || claim.allocated_amount === null || !Number.isFinite(claim.allocated_amount) || claim.allocated_amount < 0)
        return null
      const amount = Math.round(claim.allocated_amount * 100)
      return Number.isSafeInteger(amount) && Number.isSafeInteger(sum + amount) ? sum + amount : null
    }, 0)
    if (claimed === null || claimed > Math.round(original.amount * 100)) {
      qualificationUnavailableReason = claimed === null
        ? '同一原费用的已确认采用合计无法可靠核验，当前新申请资格不可用；原结算、历史回执及实际现金继续保留'
        : '同一原费用的已确认采用合计超过真实原费用上限，当前新申请资格不可用；原结算、历史回执及实际现金继续保留'
    }
  }
  if (!record.draft.contractId && (serviceIds.size === 1 ? [...serviceIds][0] : null) !== (record.draft.supplierId ?? null))
    return { facts: null, sources: [] }
  const rows = await tx.select<Record<string, unknown>>('SELECT a.*,l.id AS allocation_id,l.allocated_amount,l.deleted_at AS allocation_deleted_at FROM payment_application_settlement_allocations l JOIN payment_applications a ON a.id=l.payment_application_id WHERE l.settlement_id=? ORDER BY a.id,l.id', [record.id])
  const evidence = imports.find(item => item.graph.tables.expenditure_settlements.some((head: { id: string }) => head.id === record.id))
  if (evidence?.graph.retained.penalty_settlement_deductions?.some((line: Record<string, unknown>) => line.settlement_id === record.id && line.deleted_at == null)) {
    unavailableFactKinds.add('penalty')
    qualificationUnavailableReason = '原结算关联的真实奖罚来源尚未接通，净额与当前新申请资格不可核验；原历史及实际现金继续保留'
  }
  if (evidence?.graph.retained.payment_application_settlement_allocations?.some((line: Record<string, unknown>) => line.settlement_id === record.id && line.deleted_at == null && !rows.some(row => row.allocation_id === line.id && row.id === line.payment_application_id && row.allocated_amount === line.allocated_amount))) {
    unavailableFactKinds.add('application')
    unavailableFactKinds.add('payment')
    qualificationUnavailableReason = '原申请采用关系尚未在真实财务来源中完整核验，申请及支付完整额未知，当前新申请资格不可用；原历史及已核验现金明细继续保留'
  }
  const facts: OtherSettlementFact[] = []
  const sources: OtherSettlementSourceDocument[] = []
  const currentRows = rows.filter(row => row.allocation_deleted_at === null || !rows.some(other => other.id === row.id && other.allocation_deleted_at === null))
  for (const row of currentRows) {
    const payeeSupplierId = record.draft.payeeSupplierId ?? (record.draft.contractId && !record.draft.payeeWorkerId ? record.draft.supplierId ?? null : null)
    const valid = row.project_id === (record.draft.projectId ?? null) && row.contract_id === (record.draft.contractId ?? null) && row.supplier_id === payeeSupplierId && row.worker_id === (record.draft.payeeWorkerId ?? null)
    const active = valid && row.deleted_at === null && row.allocation_deleted_at === null && ['submitted', 'approved', 'paying', 'paid'].includes(String(row.status))
    const amount = typeof row.allocated_amount === 'number' && Number.isFinite(row.allocated_amount) ? row.allocated_amount.toFixed(2) : null
    const all = await tx.select<{
      id: string
      settlement_id: string
      allocated_amount: number
    }>('SELECT * FROM payment_application_settlement_allocations WHERE payment_application_id=?', [row.id])
    const application: OtherSettlementSourceDocument = { id: String(row.id), kind: 'application', no: String(row.no), name: String(row.name), status: String(row.status), amount: typeof row.apply_amount === 'number' ? row.apply_amount.toFixed(2) : null, date: String(row.apply_date) || null, projectId: row.project_id as string | null, contractId: row.contract_id as string | null, supplierId: row.supplier_id as string | null, fields: [{ label: '实际收款人', value: row.payee_name_snapshot as string | null }], files: [], allocations: all.map(line => ({ id: line.id, targetId: line.settlement_id, kind: 'settlement', amount: Number.isFinite(line.allocated_amount) ? line.allocated_amount.toFixed(2) : null, effective: active, unavailableReason: valid ? null : '收款身份或归属不匹配' })) }
    sources.push(application)
    facts.push({ id: String(row.allocation_id), allocationId: String(row.allocation_id), kind: 'application', settlementId: record.id, projectId: record.draft.projectId ?? null, contractId: record.draft.contractId ?? null, supplierId: record.draft.supplierId ?? null, sourceId: String(row.id), parentId: null, no: String(row.no), name: String(row.name), amount: valid ? amount : null, date: application.date, status: String(row.status), effective: active, attribution: 'exact' })
    const payments = await tx.select<Record<string, unknown>>('SELECT p.*,l.id AS allocation_id,l.allocated_amount FROM payment_record_application_allocations l JOIN payment_records p ON p.id=l.payment_record_id WHERE l.payment_application_id=? AND l.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY p.id,l.id', [row.id])
    for (const payment of payments) {
      const exact = new Set(all.map(line => line.settlement_id)).size === 1
      const paymentValid = valid && payment.project_id === row.project_id && payment.supplier_id === row.supplier_id && payment.worker_id === row.worker_id
      const effective = payment.confirmation_status === 'confirmed'
      const paymentAmount = exact && paymentValid && typeof payment.allocated_amount === 'number' && Number.isFinite(payment.allocated_amount) ? payment.allocated_amount.toFixed(2) : null
      if (!facts.some(fact => fact.kind === 'payment' && fact.id === payment.allocation_id))
        facts.push({ id: String(payment.allocation_id), allocationId: String(payment.allocation_id), kind: 'payment', settlementId: record.id, projectId: record.draft.projectId ?? null, contractId: record.draft.contractId ?? null, supplierId: record.draft.supplierId ?? null, sourceId: String(payment.id), parentId: String(row.id), no: String(payment.no), name: String(payment.purpose), amount: paymentAmount, date: String(payment.payment_date) || null, status: String(payment.confirmation_status), effective, attribution: exact ? 'exact' : 'unknown' })
      sources.push({ id: String(payment.id), kind: 'payment', no: String(payment.no), name: String(payment.purpose), status: String(payment.confirmation_status), amount: typeof payment.amount === 'number' ? payment.amount.toFixed(2) : null, date: String(payment.payment_date) || null, projectId: payment.project_id as string | null, contractId: null, supplierId: payment.supplier_id as string | null, fields: [{ label: '银行流水号', value: String(payment.bank_serial_no) || null }, { label: '实际收款人', value: payment.payee_name_snapshot as string | null }], files: [], allocations: [{ id: String(payment.allocation_id), targetId: String(row.id), kind: 'application', amount: paymentAmount, effective, unavailableReason: exact ? null : '一申请关联多个结算，实际支付无法逐结算归属' }] })
    }
    if (!active && payments.some(payment => payment.confirmation_status === 'confirmed')) {
      const reason = '原申请或结算采用关系已删除、撤回或失配，但仍有已确认现金；当前申请余款资格不可证明'
      const fact = facts.find(fact => fact.kind === 'application' && fact.id === row.allocation_id)!
      fact.amount = null
      fact.unavailableReason = reason
      application.fields.push({ label: '历史付款保护', value: reason })
    }
  }
  return { facts, sources, qualificationUnavailableReason, unavailableFactKinds: [...unavailableFactKinds] }
}
async function loaded(tx: TransactionDb, actor: BusinessSession) {
  await assertProductionOtherSettlementParticipant(tx)
  const data = await readOtherSettlementStored(tx, actor)
  const source = await identities(tx, actor)
  const sources: OtherSettlementSourceDocument[] = []
  const records: OtherSettlementStored[] = []
  const qualificationReasons = new Map<string, string>()
  const unavailableFactKindsById = new Map<string, OtherSettlementFact['kind'][]>()
  const deletedAtById = new Map((await tx.select<{ id: string, deleted_at: string | null }>('SELECT id,deleted_at FROM expenditure_settlements')).map(row => [row.id, row.deleted_at]))
  for (const raw of data.records) {
    const related = await actualFacts(tx, raw, actor)
    sources.push(...related.sources)
    records.push({ ...raw, workspaceId: actor.workspaceId, facts: related.facts })
    if (related.qualificationUnavailableReason)
      qualificationReasons.set(raw.id, related.qualificationUnavailableReason)
    if (related.unavailableFactKinds?.length)
      unavailableFactKindsById.set(raw.id, related.unavailableFactKinds)
    if (deletedAtById.get(raw.id))
      qualificationReasons.set(raw.id, '原结算已删除，当前新申请资格不可用；原结算、历史回执及实际现金继续保留')
  }
  return { ...data, originalRecords: data.records, source, records, sources, qualificationReasons, deletedAtById, unavailableFactKindsById }
}

async function assertProductionOtherSettlementParticipant(tx: Pick<TransactionDb, 'select'>) {
  const participant = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'other-settlements\''))[0]
  const columns = await tx.select<{ name: string }>('PRAGMA table_info(expenditure_settlements)')
  const routed = columns.some(column => column.name === 'document_owner')
  if (!participant || ![1, 2].includes(participant.schema_version) || routed !== (participant.schema_version === 2))
    return fail('unavailable', '正式其他支出结算的参与版本与单一 owner 边界不一致，停止读取或写入')
}

function instance(data: Awaited<ReturnType<typeof loaded>>, expenses: Awaited<ReturnType<typeof listOriginalExpenseReferences>> = []) {
  return createOtherSettlementInstance({ identities: () => data.source, records: data.records, originalExpenses: () => expenses, expenseAdoptionCap: (base, input) => {
    const source = expenses.find(row => row.id === base.id)!
    const qualified = source.qualification
    if (qualified.state === 'unavailable' && qualified.verifiedHandledAmount !== null && qualified.confirmedOtherAdoptedAmount !== null && qualified.verifiedOverlapAmount !== null
      && qualified.verifiedHandledAmount + qualified.confirmedOtherAdoptedAmount - qualified.verifiedOverlapAmount > source.amount + 0.0001) {
      return fail('conflict', '累计已确认结算与已核旧份额的去重采用超过原费用可采用额度')
    }
    if (!['verified', 'not-required'].includes(source.qualification.state) || source.qualification.newAdoptableAmount === null || source.qualification.confirmedOtherAdoptedAmount === null)
      return fail('unavailable', source.qualification.message || '原费用去重额度不可核验')
    let legacy = 0
    for (const adopted of input.clearanceAllocations ?? []) {
      const proof = source.clearanceProofs.at(-1)
      const item = proof?.items.find(item => item.id === adopted.itemId)
      if (!proof || proof.id !== adopted.verificationId || !item || adopted.amount > item.amount)
        return fail('unavailable', '必须明确采用当前真实核定份额，不能按银行金额猜原费用关系')
      legacy += adopted.amount
    }
    if (input.amount !== null && legacy > input.amount)
      return fail('validation-failed', '旧份额采用金额超过本结算原费用采用金额')
    return source.qualification.newAdoptableAmount + source.qualification.confirmedOtherAdoptedAmount + legacy
  }, preserveHistoricalRelations: true, currentFacts: record => record.facts, qualificationUnavailableReason: record => data.qualificationReasons.get(record.id), unavailableFactKinds: record => data.unavailableFactKindsById.get(record.id) ?? [] })
}
async function envelope<T extends object>(tx: TransactionDb, actor: BusinessSession, operation: string, value: T, scope: Record<string, unknown> = {}) {
  const revision = (await tx.select<{
    revision: number
  }>('SELECT revision FROM other_settlement_revision WHERE singleton=1'))[0]!.revision
  const participant = (await tx.select('SELECT domain FROM production_participants WHERE domain=\'finance\' AND schema_version IN (1,2)')).length > 0
  const finance = participant && (await tx.select<{
    revision: number
  }>('SELECT revision FROM finance_revision WHERE singleton=1'))[0]
  const asOf = new Date().toISOString()
  const readable = ['finance-reimbursement:read', 'finance-payment-application:read', 'finance-payment-record:read'].every(capability => actor.capabilities.includes(capability))
  const auxiliary = actor.capabilities.includes('auxiliary-contract:read') && (await tx.select('SELECT domain FROM production_participants WHERE domain=\'auxiliary-contract\' AND schema_version=1')).length ? (await tx.select<{ revision: number }>('SELECT revision FROM auxiliary_contract_revision WHERE singleton=1'))[0] : null
  return withReadMeta(value, createReadMeta({ session: actor, schemaVersion: 'other-settlement-read-v1', operation: `other-settlement:${operation}`, dataOrigin: 'real', asOf, coverage: 'complete', scope, sources: [{ key: 'other-settlements', state: 'readable', sourceVersion: `other-settlement-${revision}`, asOf }, { key: 'finance', state: readable ? finance ? 'readable' : 'unavailable' : 'forbidden', sourceVersion: readable && finance ? `finance-${finance.revision}` : null, asOf: readable && finance ? asOf : null }, { key: 'auxiliary-contracts', state: !actor.capabilities.includes('auxiliary-contract:read') ? 'forbidden' : auxiliary ? 'readable' : 'unavailable', sourceVersion: auxiliary ? `auxiliary-contract-${auxiliary.revision}` : null, asOf: auxiliary ? asOf : null }] }))
}
export function createProductionOtherSettlementService(storage: ProductionStorage) {
  function authorize(session: Session, write: boolean) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('other-settlement:read') || (write && !actor.capabilities.includes('other-settlement:write')))
      return fail('forbidden', '当前身份没有本工作区结算权限')
    return structuredClone(actor)
  }
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      await assertProductionOtherSettlementParticipant(tx)
      if (otherSettlementFingerprint(authorize(session, write)) !== otherSettlementFingerprint(actor))
        return fail('forbidden', '身份或权限已变化')
      await validateOtherSettlementJournal(tx, storage.identity)
      await validateOtherSettlementImportEvidence(tx, storage.identity)
      await validateExpenseClearanceJournal(tx, storage.identity)
      const result = await work(tx, actor)
      if (otherSettlementFingerprint(authorize(session, write)) !== otherSettlementFingerprint(actor))
        return fail('forbidden', '结算操作期间身份或权限改变，事务已撤回')
      return result
    })
  }
  return {
    context: (session: Session) => run(session, false, async (tx, actor) => envelope(tx, actor, 'context', { ...actor, ...await identities(tx, actor) })),
    expenses: (session: Session) => run(session, false, async (tx, actor) => envelope(tx, actor, 'expenses', { workspaceId: actor.workspaceId, actorId: actor.actorId, items: await listOriginalExpenseReferences(tx, actor), capabilities: actor.capabilities })),
    list: (query: Record<string, unknown>, session: Session) => run(session, false, async (tx, actor) => envelope(tx, actor, 'list', instance(await loaded(tx, actor)).list(query, actor), query)),
    detail: (id: string, query: Record<string, unknown>, session: Session) => run(session, false, async (tx, actor) => {
      const data = await loaded(tx, actor)
      const detail = instance(data).detail(id, query, actor)
      detail.settlement.expenseAllocations = (await tx.select<{ id: string, original_expense_line_id: string, allocated_amount: number | null, source_version: string, source_revision: string }>('SELECT * FROM expenditure_settlement_expense_allocations WHERE settlement_id=? AND deleted_at IS NULL ORDER BY id', [id])).map(row => ({ id: row.id, originalExpenseLineId: row.original_expense_line_id, amount: row.allocated_amount, sourceVersion: row.source_version, sourceRevision: row.source_revision }))
      detail.settlement.clearanceLinks = (await readClearanceLinks(tx)).filter(link => link.settlementId === id)
      const history = await tx.select<Record<string, unknown>>('SELECT * FROM other_settlement_history WHERE settlement_id=? ORDER BY version', [id])
      const imports = await tx.select<{ graph_json: string }>('SELECT graph_json FROM other_settlement_imports WHERE sealed_at IS NULL')
      const sourceHistory = imports.map(row => JSON.parse(row.graph_json)).filter(evidence => evidence.graph.tables.expenditure_settlements.some((head: Record<string, unknown>) => head.id === id)).map((evidence) => {
        const penaltyLines = evidence.graph.retained.penalty_settlement_deductions?.filter((row: Record<string, unknown>) => row.settlement_id === id) ?? []
        return { sourceBytesSha256: evidence.sourceBytesSha256, rawHead: evidence.graph.tables.expenditure_settlements.find((head: Record<string, unknown>) => head.id === id), history: evidence.graph.tables.other_settlement_history?.filter((row: Record<string, unknown>) => row.settlement_id === id) ?? [], commands: evidence.graph.tables.other_settlement_commands?.filter((row: Record<string, unknown>) => row.settlement_id === id) ?? [], audit: evidence.graph.retained.operation_logs?.filter((row: Record<string, unknown>) => row.record_id === id) ?? [], retained: { penalty_settlement_deductions: penaltyLines, penalty_records: evidence.graph.retained.penalty_records?.filter((row: Record<string, unknown>) => penaltyLines.some((line: Record<string, unknown>) => line.penalty_id === row.id)) ?? [], payment_application_settlement_allocations: evidence.graph.retained.payment_application_settlement_allocations?.filter((row: Record<string, unknown>) => row.settlement_id === id) ?? [] } }
      })
      return envelope(tx, actor, 'detail', { ...detail, history: history.map(row => ({ version: String(row.version), record: JSON.parse(String(row.snapshot_json)), actorId: row.actor_id, commandId: row.command_id, occurredAt: row.occurred_at })), sourceHistory }, { id, ...query })
    }),
    source: (id: string, factId: string, session: Session) => run(session, false, async (tx, actor) => {
      const data = await loaded(tx, actor)
      const row = data.records.find(row => row.id === id)
      const fact = row?.facts?.find(fact => fact.id === factId)
      const source = fact && data.sources.find(source => source.id === fact.sourceId && source.kind === fact.kind)
      if (!source)
        return fail('not-found', '实际关联源单不可读取')
      return envelope(tx, actor, 'source', source, { id, factId })
    }),
    async execute(body: unknown, session: Session) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['id', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'action', 'draft', 'attachments'].includes(key)))
        return fail('validation-failed', '正式结算命令含不支持的字段')
      const request = decodeOtherSettlementCommand(body)
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId || request.requiredCapability !== 'other-settlement:write')
          return fail('forbidden', '结算命令不能覆盖已认证身份')
        const key = otherSettlementKey(request.commandId, actor)
        await assertOtherSettlementSourceCommandUnused(tx, request.commandId, actor)
        const fingerprint = otherSettlementFingerprint(request)
        if ((await tx.select('SELECT scoped_id FROM other_settlement_resolutions WHERE scoped_id=?', [key])).length)
          return fail('conflict', '原提交已封存为未保存，迟到请求不能重新写入')
        const prior = (await tx.select<{
          fingerprint: string
          result_json: string
        }>('SELECT * FROM other_settlement_commands WHERE scoped_id=?', [key]))[0]
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            return fail('conflict', '同一原结算命令不能变更内容')
          return decodeOtherSettlementResult(JSON.parse(prior.result_json))
        }
        const data = await loaded(tx, actor)
        if (request.draft.clearanceLinkEdit) {
          const target = data.records.find(record => record.id === request.id)
          if (!target || request.baseVersion !== String(target.version))
            return fail('conflict', '结算实际版本已变化，请保留原关系输入')
          const edit = request.draft.clearanceLinkEdit
          const updatedAt = new Date().toISOString()
          const clearanceLinkIds = []
          for (const binding of edit.bindings) {
            const allocation = (await tx.select<{ settlement_id: string }>('SELECT settlement_id FROM expenditure_settlement_expense_allocations WHERE id=?', [binding.expenseAllocationId]))[0]
            if (allocation?.settlement_id !== target.id)
              return fail('relationship-mismatch', '补充采用行不属于此真实结算')
            clearanceLinkIds.push(await appendClearanceLink(tx, actor, { verificationId: edit.verificationId, itemId: binding.itemId, amount: binding.amount }, binding.expenseAllocationId, 'other-settlement', request.commandId, updatedAt))
          }
          const result: OtherSettlementResult = { id: target.id, version: String(target.version), commandId: request.commandId, updatedAt, attachmentIds: [], clearanceLinkIds }
          await tx.execute('INSERT INTO other_settlement_commands VALUES(?,?,?,?,?,?,?,?)', [key, request.commandId, actor.workspaceId, actor.actorId, fingerprint, JSON.stringify(request), JSON.stringify(result), target.id])
          await validateOtherSettlementJournal(tx, storage.identity)
          await validateExpenseClearanceJournal(tx, storage.identity)
          return result
        }
        if (request.id && data.records.find(row => row.id === request.id)?.version === 0)
          return fail('unavailable', '旧结算需先完成完整来源核验；保留旧原文、原件和当前输入')
        const expenses = request.draft.originalExpenses?.length ? await listOriginalExpenseReferences(tx, actor) : []
        // 提交时已原子写入本结算的明确旧份额关联。确认时只剔除这些自身关联，
        // 重算提交前摘要；其他来源或关联变化仍必须触发冲突。
        const target = request.id ? data.records.find(row => row.id === request.id) : undefined
        const normalized = structuredClone(request)
        if (request.action === 'confirm' && target && !isConfirmedExpenditureSettlement(target.draft.status ?? '')
          && otherSettlementFingerprint(target.draft.originalExpenses ?? []) === otherSettlementFingerprint(request.draft.originalExpenses ?? [])) {
          for (const line of normalized.draft.originalExpenses ?? []) {
            const source = expenses.find(row => row.id === line.originalExpenseLineId)
            const ownLinks = source?.clearanceLinks.filter(link => link.settlementId === request.id) ?? []
            if (!source || !line.consumptionVersion || !ownLinks.length || !source.consumptionVersion)
              continue
            const bindings = line.clearanceAllocations ?? []
            if (ownLinks.length !== bindings.length || ownLinks.some(link => !bindings.some(binding => binding.verificationId === link.verificationId && binding.itemId === link.itemId && binding.amount === link.amount)))
              continue
            const before = {
              ...source,
              clearanceLinks: source.clearanceLinks.filter(link => link.settlementId !== request.id),
              clearanceItemAvailability: source.clearanceItemAvailability.map(item => ({
                ...item,
                amountRemaining: item.amountRemaining === null ? null : (Math.round(item.amountRemaining * 100) + ownLinks.filter(link => link.verificationId === item.verificationId && link.itemId === item.itemId).reduce((sum, link) => sum + Math.round(link.amount * 100), 0)) / 100,
              })),
            }
            const priorConsumption = `expense-consumption-v1:${createHash('sha256').update(expenseConsumptionFingerprint(before)).digest('hex')}`
            if (priorConsumption === line.consumptionVersion)
              line.consumptionVersion = source.consumptionVersion
          }
        }
        const domain = instance(data, expenses)
        const result: OtherSettlementResult = await domain.execute(normalized, actor)
        const record = domain.snapshot().find(row => row.id === result.id)!
        // Dynamic downstream facts are read from finance, never persisted as another cash/cost authority.
        record.facts = request.id ? data.originalRecords.find(row => row.id === request.id)!.facts : []
        const previous = data.records.find(row => row.id === result.id)
        if (!previous)
          await tx.execute('INSERT INTO expenditure_settlements(id) VALUES(?)', [record.id])
        const activeIds = new Set(record.draft.originalExpenses?.map(line => line.originalExpenseLineId) ?? [])
        for (const old of await tx.select<{
          id: string
          original_expense_line_id: string
          deleted_at: string | null
        }>('SELECT * FROM expenditure_settlement_expense_allocations WHERE settlement_id=?', [record.id])) {
          if (old.deleted_at === null && !activeIds.has(old.original_expense_line_id))
            await tx.execute('UPDATE expenditure_settlement_expense_allocations SET deleted_at=? WHERE id=?', [result.updatedAt, old.id])
        }
        for (const line of record.draft.originalExpenses ?? []) {
          const source = expenses.find(source => source.id === line.originalExpenseLineId)!
          const existing = (await tx.select<{
            id: string
          }>('SELECT id FROM expenditure_settlement_expense_allocations WHERE settlement_id=? AND original_expense_line_id=?', [record.id, line.originalExpenseLineId]))[0]
          if (existing)
            await tx.execute('UPDATE expenditure_settlement_expense_allocations SET source_version=?,source_revision=?,allocated_amount=?,frozen_json=?,adopted_at=?,adopted_by=?,deleted_at=NULL WHERE id=?', [line.sourceVersion, line.sourceRevision, line.amount, JSON.stringify(source), result.updatedAt, actor.actorId, existing.id])
          else
            await tx.execute('INSERT INTO expenditure_settlement_expense_allocations VALUES(?,?,?,?,?,?,?,?,?,NULL)', [crypto.randomUUID(), record.id, line.originalExpenseLineId, line.sourceVersion, line.sourceRevision, line.amount, JSON.stringify(source), result.updatedAt, actor.actorId])
        }
        const added = record.attachments.filter(file => !previous?.attachments.some(old => old.id === file.id))
        for (const [index, file] of added.entries()) {
          const input = request.attachments.add?.[index]
          if (typeof input?.payloadBase64 !== 'string')
            return fail('validation-failed', '结算原件正文不可缺失')
          file.sha256 = await contractOriginalPayloadDigest(input.payloadBase64, file.fileSize, () => fail('validation-failed', '结算原件正文、大小或摘要不一致'))
          await tx.execute('INSERT INTO file_refs VALUES(?,?,?,?,?,?,?,?,?,?,?)', [file.id, 'expenditure_settlement', record.id, file.fileName, '', file.fileSize, file.mimeType, file.category, actor.actorId, file.uploadedAt, file.deletedAt])
          await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [file.id, Buffer.from(input.payloadBase64, 'base64'), file.sha256])
          await tx.execute('INSERT INTO other_settlement_files VALUES(?,?,?)', [file.id, record.id, file.sha256])
        }
        for (const file of record.attachments.filter(file => !added.some(added => added.id === file.id)))
          await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=? AND owner_type=\'expenditure_settlement\' AND owner_id=?', [file.deletedAt, file.id, record.id])
        const d = record.draft
        const a = record.audit
        await tx.execute('UPDATE expenditure_settlements SET no=?,name=?,project_id=?,supplier_id=?,contract_id=?,settlement_type=?,total_amount=?,tax_rate=?,settlement_date=?,settlement_period=?,deduction_note=?,status=?,note=?,created_by=?,updated_by=?,created_at=?,updated_at=?,responsible=?,department=?,payee_supplier_id=?,payee_worker_id=?,payee_name_snapshot=?,version=?,record_json=? WHERE id=?', [d.no ?? '', d.name ?? '', d.projectId ?? null, d.supplierId ?? null, d.contractId ?? null, d.settlementType ?? '', d.totalAmount ?? null, d.taxRate ?? null, d.settlementDate ?? '', d.period ?? '', d.deductionNote ?? '', d.status ?? '', d.note ?? '', a.createdBy, a.updatedBy, a.createdAt, a.updatedAt, a.responsible, a.department, d.payeeSupplierId ?? null, d.payeeWorkerId ?? null, d.payeeNameSnapshot ?? null, record.version, JSON.stringify(record), record.id])
        await tx.execute('INSERT INTO other_settlement_history VALUES(?,?,?,?,?,?)', [record.id, record.version, JSON.stringify(record), actor.actorId, request.commandId, result.updatedAt])
        const clearanceLinkIds = []
        for (const line of record.draft.originalExpenses ?? []) {
          const allocation = (await tx.select<{ id: string }>('SELECT id FROM expenditure_settlement_expense_allocations WHERE settlement_id=? AND original_expense_line_id=? AND deleted_at IS NULL', [record.id, line.originalExpenseLineId]))[0]!
          for (const binding of line.clearanceAllocations ?? []) clearanceLinkIds.push(await appendClearanceLink(tx, actor, binding, allocation.id, 'other-settlement', request.commandId, result.updatedAt))
        }
        if (clearanceLinkIds.length) {
          result.clearanceLinkIds = clearanceLinkIds
        }
        await tx.execute('INSERT INTO other_settlement_commands VALUES(?,?,?,?,?,?,?,?)', [key, request.commandId, actor.workspaceId, actor.actorId, fingerprint, JSON.stringify(request), JSON.stringify(result), record.id])
        await tx.execute('UPDATE other_settlement_revision SET revision=revision+1 WHERE singleton=1')
        await validateOtherSettlementJournal(tx, storage.identity)
        await validateExpenseClearanceJournal(tx, storage.identity)
        return result
      })
    },
    resolve: (commandId: string, session: Session) => run(session, true, async (tx, actor): Promise<{
      outcome: 'applied'
      result: OtherSettlementResult
    } | {
      outcome: 'not-applied'
      commandId: string
    }> => {
      if (!commandId || commandId.length > 240)
        return fail('validation-failed', '原命令编号无效')
      const key = otherSettlementKey(commandId, actor)
      await assertOtherSettlementSourceCommandUnused(tx, commandId, actor)
      const row = (await tx.select<{
        result_json: string
      }>('SELECT result_json FROM other_settlement_commands WHERE scoped_id=?', [key]))[0]
      if (row)
        return { outcome: 'applied', result: decodeOtherSettlementResult(JSON.parse(row.result_json)) }
      if (!(await tx.select('SELECT scoped_id FROM other_settlement_resolutions WHERE scoped_id=?', [key])).length)
        await tx.execute('INSERT INTO other_settlement_resolutions VALUES(?,?,?,?,?)', [key, commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
      return { outcome: 'not-applied', commandId }
    }),
    original: (id: string, fileId: string, version: string | null, session: Session) => run(session, false, async (tx, actor) => {
      const record = (await readOtherSettlementStored(tx, actor)).records.find(row => row.id === id)
      if (!record)
        return fail('not-found', '结算不存在')
      const history = version
        ? (await tx.select<{
            snapshot_json: string
          }>('SELECT snapshot_json FROM other_settlement_history WHERE settlement_id=? AND version=?', [id, Number(version)]))[0]
        : null
      const selected = version ? history && JSON.parse(history.snapshot_json) as OtherSettlementStored : record
      const file = selected && selected.attachments.find(file => file.id === fileId && file.deletedAt === null)
      if (!file)
        return fail('not-found', '原件不属于该结算版本')
      const payload = (await tx.select<{
        content: Uint8Array
      }>('SELECT content FROM file_payloads WHERE file_ref_id=?', [fileId]))[0]!
      if (!payload || !file.sha256)
        return fail('unavailable', '该历史原件只保留元数据，真实正文尚未核验；不会以空文件替代')
      return { dataOrigin: 'real' as const, ownerType: 'expenditure_settlement', ownerId: id, fileId, fileName: file.fileName, fileSize: file.fileSize, mimeType: file.mimeType, sha256: file.sha256, payloadBase64: Buffer.from(payload.content).toString('base64') }
    }),
  }
}

export type SettlementContractEvidence
  = | { state: 'none', settlementId: string, settlementVersion: string }
    | { state: 'unavailable' | 'forbidden', settlementId: string, settlementVersion: string, reason: string }
    | { state: 'resolved', settlementId: string, settlementVersion: string, domain: 'auxiliary', kind: 'other_expense', id: string, version: string, sourceVersion: string, projectId: string, projectVersion: string, projectSourceVersion: string, supplierId: string, supplierVersion: string, supplierSourceVersion: string }

/** Current, same-transaction evidence only; migrated legacy contract IDs are not mappings. */
async function settlementContractEvidence(tx: TransactionDb, actor: BusinessSession, record: OtherSettlementStored, available: Awaited<ReturnType<typeof identities>>, loadSources: () => Promise<{ facts: Awaited<ReturnType<typeof readAuxiliaryContractScopeFacts>>, source: Awaited<ReturnType<typeof validateProductionAuxiliaryState>>, projects: Awaited<ReturnType<typeof listMigrationReferences>>, suppliers: Awaited<ReturnType<typeof listMigrationReferences>> }>): Promise<SettlementContractEvidence> {
  const base = { settlementId: record.id, settlementVersion: String(record.version) }
  const contractId = record.draft.contractId
  if (!contractId)
    return { ...base, state: 'none' }
  if (record.version === 0 || record.migrationBatchId)
    return { ...base, state: 'unavailable', reason: '历史结算合同尚无明确身份映射' }
  if (!['auxiliary-contract:read', 'project:list:read', 'supplier:list:read'].every(capability => actor.capabilities.includes(capability)))
    return { ...base, state: 'forbidden', reason: '缺少合同、项目或分供方来源读取权限' }
  const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'auxiliary-contract\'')
  if (participant?.schema_version !== 1)
    return { ...base, state: 'unavailable', reason: '真实辅助合同来源不可用' }
  const [history] = await tx.select<{ command_id: string }>('SELECT command_id FROM other_settlement_history WHERE settlement_id=? AND version=?', [record.id, record.version])
  const [receipt] = history ? await tx.select<{ request_json: string }>('SELECT request_json FROM other_settlement_commands WHERE settlement_id=? AND command_id=?', [record.id, history.command_id]) : []
  let requested: OtherSettlementStored['draft'] | undefined
  try {
    requested = receipt ? JSON.parse(receipt.request_json).draft : undefined
  }
  catch {
    return { ...base, state: 'unavailable', reason: '结算原命令无法核实' }
  }
  if (!requested || requested.contractId !== contractId || (requested.projectId ?? null) !== (record.draft.projectId ?? null) || (requested.supplierId && requested.supplierId !== record.draft.supplierId))
    return { ...base, state: 'unavailable', reason: '结算冻结关系与原命令不一致' }
  let resolvedSources: Awaited<ReturnType<typeof loadSources>>
  try {
    resolvedSources = await loadSources()
  }
  catch (cause) {
    const problem = cause && typeof cause === 'object' && 'problem' in cause ? cause.problem : null
    if (problem && typeof problem === 'object' && 'code' in problem && (problem.code === 'forbidden' || problem.code === 'unavailable'))
      return { ...base, state: problem.code, reason: '合同、项目或分供方来源不可核实' }
    throw cause
  }
  const { facts, source, projects, suppliers } = resolvedSources
  const contract = facts.find(row => row.id === contractId && row.eligible && isEffectiveExpenditureContract(row.status))
  if (!contract || !contract.projectId || !contract.supplierId || contract.projectId !== record.draft.projectId || contract.supplierId !== record.draft.supplierId)
    return { ...base, state: 'unavailable', reason: '当前合同类型、项目或服务分供方无法核实' }
  if (!available.projects.some(row => row.id === contract.projectId) || !available.suppliers.some(row => row.id === contract.supplierId))
    return { ...base, state: 'unavailable', reason: '结算项目或服务分供方已不可用' }
  const project = projects.find(row => row.serverId === contract.projectId)
  const supplier = suppliers.find(row => row.serverId === contract.supplierId)
  if (!project || !supplier)
    return { ...base, state: 'unavailable', reason: '结算项目或分供方来源版本无法核实' }
  const owner = source.state.contracts.find(row => row.draft.id === contractId && row.draft.kind === 'other_expense')
  if (!owner || !Number.isSafeInteger(owner.version) || owner.version < 1 || !Number.isSafeInteger(source.state.sourceVersion) || source.state.sourceVersion < 0)
    return { ...base, state: 'unavailable', reason: '合同稳定身份或来源版本无法核实' }
  return { ...base, state: 'resolved', domain: 'auxiliary', kind: 'other_expense', id: contractId, version: String(owner.version), sourceVersion: `auxiliary-contract-${source.state.sourceVersion}`, projectId: contract.projectId, projectVersion: project.version, projectSourceVersion: project.sourceVersion, supplierId: contract.supplierId, supplierVersion: supplier.version, supplierSourceVersion: supplier.sourceVersion }
}

export async function listProductionOtherSettlementReferences(tx: TransactionDb, actor: BusinessSession) {
  const metadata = (await tx.select<{
    workspace_id: string
    owner_id: string
  }>('SELECT * FROM production_metadata WHERE singleton=1'))[0]
  if (!metadata || metadata.workspace_id !== actor.workspaceId || metadata.owner_id !== actor.actorId || !actor.capabilities.includes('other-settlement:read'))
    return fail('forbidden', '当前身份无权读取实际支出结算')
  await validateOtherSettlementJournal(tx, actor)
  await validateOtherSettlementImportEvidence(tx, actor)
  const data = await loaded(tx, actor)
  const service = instance(data)
  let cachedSources: Promise<{ facts: Awaited<ReturnType<typeof readAuxiliaryContractScopeFacts>>, source: Awaited<ReturnType<typeof validateProductionAuxiliaryState>>, projects: Awaited<ReturnType<typeof listMigrationReferences>>, suppliers: Awaited<ReturnType<typeof listMigrationReferences>> }> | undefined
  const loadSources = () => cachedSources ??= Promise.all([readAuxiliaryContractScopeFacts(tx, actor), validateProductionAuxiliaryState(tx, actor), listMigrationReferences(tx, actor, 'projects'), listMigrationReferences(tx, actor, 'suppliers')]).then(([facts, source, projects, suppliers]) => ({ facts, source, projects, suppliers }))
  return Promise.all(data.records.map(async (record) => {
    const dto = service.detail(record.id, { origin: 'real' }, actor).settlement
    return { id: record.id, document_owner: 'other' as const, name: record.draft.name ?? '', no: record.draft.no ?? '', project_id: record.draft.projectId ?? null, contract_id: record.draft.contractId ?? null, supplier_id: record.draft.payeeSupplierId ?? (record.draft.originalExpenses?.length ? null : record.draft.supplierId ?? null), worker_id: record.draft.payeeWorkerId ?? null, payee_name_snapshot: record.draft.payeeNameSnapshot ?? null, total_amount: dto.amounts.net === null ? null : Number(dto.amounts.net), status: record.draft.status ?? '', original_expense_line_ids: record.draft.originalExpenses?.map(line => line.originalExpenseLineId) ?? [], service_supplier_id: record.draft.supplierId ?? null, deleted_at: data.deletedAtById.get(record.id) ?? null, version: String(record.version), source_revision: `other-settlement-${data.revision}`, unavailable_reason: dto.qualificationUnavailableReason ?? null, contractEvidence: await settlementContractEvidence(tx, actor, record, data.source, loadSources) }
  }))
}
export async function readProductionOtherSettlementReference(tx: TransactionDb, actor: BusinessSession, id: string) {
  const row = (await listProductionOtherSettlementReferences(tx, actor)).find(row => row.id === id) ?? null
  if (row?.unavailable_reason)
    throw new FinanceRepositoryProblem({ code: 'unavailable', message: row.unavailable_reason })
  return row
}
