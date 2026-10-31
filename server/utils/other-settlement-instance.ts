import type { FinanceExpenseReference } from '../../app/lib/finance/expense-reference'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { OtherSettlementCommand, OtherSettlementContext, OtherSettlementDetail, OtherSettlementDraft, OtherSettlementDTO, OtherSettlementFact, OtherSettlementPage, OtherSettlementSourceDocument, OtherSettlementStored } from '../../app/lib/other-settlement/contract'
import type { OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import type { BusinessSession } from './business-session'
import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { auxiliaryTaxExclusive, subtractAuxiliaryMoney, sumAuxiliaryMoney } from '../../app/lib/auxiliary-contract/facts'
import { isConfirmedExpenditureSettlement } from '../../app/lib/contract/effective-status'
import { enumFilterValues } from '../../app/lib/kit/enum-filter'
import { matchesOtherSettlementStatus } from '../../app/lib/other-settlement/contract'
import { isEffectiveSettlementFact } from '../../app/lib/other-settlement/facts'
import { decodeOtherSettlementCommand } from '../../app/lib/other-settlement/validation'
import { parsePageQuery, resolvePagination } from '../../app/lib/read-model/pagination'
import { applyAuxiliaryAttachments } from './auxiliary-contract-attachments'
import { assertRetainedMigrationReferences } from './core-identity-migration'
import { migratedOtherSettlement } from './other-settlement-migration'
import { migratedSettlementSource, penaltySettlementSource } from './other-settlement-sources'

export type { OtherSettlementStored } from '../../app/lib/other-settlement/contract'
interface Options {
  identities: () => Pick<OtherSettlementContext, 'projects' | 'suppliers' | 'contracts' | 'workers'>
  records?: OtherSettlementStored[]
  sources?: OtherSettlementSourceDocument[]
  penalties?: () => OwnerCommercialDocumentSource[]
  now?: () => string
  createId?: () => string
  originalExpenses?: () => FinanceExpenseReference[]
  expenseAdoptionCap?: (source: FinanceExpenseReference, input: import('../../app/lib/other-settlement/contract').OtherSettlementExpenseInput) => number
  preserveHistoricalRelations?: boolean
  currentFacts?: (record: OtherSettlementStored) => OtherSettlementFact[] | null
  qualificationUnavailableReason?: (record: OtherSettlementStored) => string | undefined
  unavailableFactKinds?: (record: OtherSettlementStored) => readonly OtherSettlementFact['kind'][]
}
export function createOtherSettlementInstance(options: Options) {
  let records = new Map((options.records ?? []).map(row => [row.id, structuredClone(row)]))
  let sourceDocuments = new Map((options.sources ?? []).map(row => [row.id, structuredClone(row)]))
  const commands = new Map<string, {
    fingerprint: string
    result: {
      id: string
      version: string
      commandId: string
      updatedAt: string
      attachmentIds: string[]
    }
  }>()
  const now = options.now ?? (() => new Date().toISOString())
  const sealed = new Set<string>()
  function authorize(session: BusinessSession, action: 'read' | 'write') {
    if (!session.capabilities.includes(`other-settlement:${action}`))
      throw auxiliaryProblem('forbidden', '无权访问其他支出结算')
  }
  function find(id: string, session: BusinessSession) {
    const row = records.get(id)
    if (!row || row.workspaceId !== session.workspaceId)
      throw auxiliaryProblem('not-found', '其他支出结算不存在或已删除')
    return row
  }
  function identities() {
    const source = options.identities()
    return { ...source, contracts: source.contracts.filter(row => row.kind === 'other_expense' && !['草稿', 'draft'].includes(row.status) && row.projectId && row.supplierId && source.projects.some(p => p.id === row.projectId) && source.suppliers.some(s => s.id === row.supplierId)) }
  }
  function facts(row: OtherSettlementStored) {
    const d = row.draft
    if (!options.preserveHistoricalRelations && !(d.originalExpenses?.length && !d.contractId) && !identities().contracts.some(c => c.id === d.contractId && c.projectId === d.projectId && c.supplierId === d.supplierId))
      return null
    if (row.facts?.some(fact => fact.settlementId !== row.id || fact.projectId !== d.projectId || fact.contractId !== d.contractId || fact.supplierId !== d.supplierId))
      return null
    if (options.currentFacts)
      return options.currentFacts(row)
    if (!row.migrationBatchId && !options.sources && !options.penalties)
      return row.facts
    return row.facts?.map((fact) => {
      const document = sourceDocument(fact.sourceId, fact.kind)
      const allocation = document?.allocations.find(a => a.id === (fact.allocationId ?? fact.id) && a.targetId === (fact.kind === 'payment' ? fact.parentId : row.id))
      const parent = fact.kind === 'payment' ? sourceDocument(fact.parentId ?? '', 'application') : null
      const owner = fact.kind === 'payment' ? parent : document
      const relationValid = owner && owner.projectId === d.projectId && (!owner.contractId || owner.contractId === d.contractId) && (!owner.supplierId || owner.supplierId === d.supplierId)
      if (!document || !allocation || !relationValid)
        return { ...fact, amount: null }
      const active = allocation.effective && (fact.kind === 'penalty' ? document.status !== 'draft' : fact.kind !== 'payment' || Boolean(parent && ['submitted', 'approved', 'paying', 'paid'].includes(parent.status)))
      const attribution = fact.kind === 'payment' && new Set(parent?.allocations.filter(a => a.effective).map(a => a.targetId)).size !== 1 ? 'unknown' : fact.attribution
      return { ...fact, no: document.no, name: document.name, date: document.date, amount: allocation.amount, status: fact.kind === 'penalty' && active ? 'executed' : document.status, effective: active, attribution }
    }) ?? null
  }
  function sourceDocument(id: string, kind: OtherSettlementFact['kind']): OtherSettlementSourceDocument | null {
    if (kind === 'penalty' && options.penalties) {
      const row = options.penalties().find(p => p.dataOrigin === 'real' && p.kind === 'project_penalty' && p.id === id)
      return row ? penaltySettlementSource(row) : null
    }
    const row = sourceDocuments.get(id)
    return row?.kind === kind ? row : null
  }
  function dto(row: OtherSettlementStored): OtherSettlementDTO {
    const d = row.draft
    const identity = identities()
    const contract = identity.contracts.find(c => c.id === d.contractId && c.projectId === d.projectId && c.supplierId === d.supplierId)
    const related = facts(row)
    const sum = (kind: OtherSettlementFact['kind']) => related === null || options.unavailableFactKinds?.(row).includes(kind) || related.some(fact => fact.kind === kind && fact.unavailableReason) ? null : sumAuxiliaryMoney(related.filter(f => f.kind === kind && isEffectiveSettlementFact(f)).map(f => f.attribution === 'exact' ? f.amount : null))
    const total = d.totalAmount == null ? null : d.totalAmount.toFixed(2)
    const deductions = sum('penalty')
    const applied = sum('application')
    const paid = sum('payment')
    const qualificationUnavailableReason = options.qualificationUnavailableReason?.(row)
    const net = qualificationUnavailableReason ? null : subtractAuxiliaryMoney(total, deductions)
    const confirmed = [...records.values()].filter(item => item.workspaceId === row.workspaceId && isConfirmedExpenditureSettlement(item.draft.status ?? '') && item.draft.contractId === d.contractId && item.draft.projectId === d.projectId && item.draft.supplierId === d.supplierId)
    const others = confirmed.filter(r => r.id !== row.id)
    const prior = !contract || !d.settlementDate || others.some(r => !r.draft.settlementDate || r.draft.settlementDate === d.settlementDate)
      ? null
      : sumAuxiliaryMoney(others.filter(r => r.draft.settlementDate! < d.settlementDate!).map(r => r.draft.totalAmount?.toFixed(2) ?? null))
    const taxExclusive = auxiliaryTaxExclusive(total, d.taxRate ?? null)
    const ref = (entity: 'project' | 'supplier' | 'contract', id: string | null | undefined, label: string | undefined): OtherSettlementDTO['project'] => id && label ? { state: 'resolved', entity, id, label, no: null } : { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' }
    return { id: row.id, dataOrigin: 'real', version: String(row.version), draft: structuredClone(d), project: ref('project', d.projectId, identity.projects.find(p => p.id === d.projectId)?.label), supplier: ref('supplier', d.supplierId, identity.suppliers.find(s => s.id === d.supplierId)?.label), contract: ref('contract', d.contractId, contract?.name), navigation: { kind: 'entity-detail', subject: { state: 'resolved', entity: 'settlement', id: row.id, label: d.name || '未命名结算', no: d.no || null }, variant: 'other_settlement', view: null, filters: { dataOrigin: 'real' } }, amounts: { total, deductions, net, applied, applicable: subtractAuxiliaryMoney(net, applied), paid, unpaid: subtractAuxiliaryMoney(net, paid), contract: contract?.amount ?? null, changedContract: contract?.changedAmount ?? null, prior, cumulative: contract ? sumAuxiliaryMoney(confirmed.map(r => r.draft.totalAmount?.toFixed(2) ?? null)) : null, taxExclusive, tax: subtractAuxiliaryMoney(total, taxExclusive) }, ...(qualificationUnavailableReason ? { qualificationUnavailableReason } : {}), audit: structuredClone(row.audit), attachmentCount: row.attachments.filter(f => !f.deletedAt).length }
  }
  return {
    resolve(commandId: string, session: BusinessSession) {
      authorize(session, 'write')
      const key = JSON.stringify([session.workspaceId, session.actorId, 'other-settlement', commandId])
      const saved = commands.get(key)
      if (saved)
        return { outcome: 'applied' as const, result: structuredClone(saved.result) }
      sealed.add(key)
      return { outcome: 'not-applied' as const, commandId }
    },
    snapshot() {
      return [...records.values()].map(row => structuredClone(row))
    },
    supplierReadSource(workspaceId: string) {
      const scoped = [...records.values()].filter(row => row.workspaceId === workspaceId)
      return {
        rows: scoped.map(dto),
        sourceVersion: `other-settlement-supplier:${scoped.map(row => `${row.id}:${row.version}`).sort().join('|')}`,
      }
    },
    contractFacts(contractId: string) {
      return [...records.values()].filter(row => row.draft.contractId === contractId).map(row => ({ id: row.id, kind: 'settlement' as const, contractId, contractKind: 'other_expense' as const, dataOrigin: 'real' as const, no: row.draft.no ?? '', name: row.draft.name ?? '', amount: row.draft.totalAmount?.toFixed(2) ?? null, date: row.draft.settlementDate || null, status: row.draft.status ?? '', effective: isConfirmedExpenditureSettlement(row.draft.status ?? '') }))
    },
    assertMigrationRemoval(removed: readonly CoreMigrationServerEntityDTO[]) {
      assertRetainedMigrationReferences(removed, 'other_settlements', [...records.values()].map(row => ({ id: row.id, references: [{ type: 'projects', id: row.draft.projectId }, { type: 'suppliers', id: row.draft.supplierId }, { type: 'auxiliary_contracts', id: row.draft.contractId }] })), message => auxiliaryProblem('conflict', message))
    },
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO) {
      const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
      const entities = batchId ? snapshot.entities.filter(e => !e.deletedAt) : []
      const candidates = entities.filter(e => e.entityType === 'other_settlements').map(e => migratedOtherSettlement(e, batchId!, snapshot.entities))
      const nextSources = new Map((options.sources ?? []).map(row => [row.id, structuredClone(row)]))
      for (const entity of entities.filter(e => e.entityType === 'other_settlement_sources'))
        nextSources.set(entity.id, migratedSettlementSource(entity, entities))
      const ids = new Set(candidates.map(e => e.id))
      for (const [id, row] of records) {
        if (row.migrationBatchId && (row.migrationBatchId !== batchId || !ids.has(id)) && row.version !== 1)
          throw auxiliaryProblem('conflict', '迁入结算已有后来修改或附件变更，不能回滚移除')
      }
      const next = new Map([...records].filter(([id, row]) => !row.migrationBatchId || (row.migrationBatchId === batchId && ids.has(id))))
      for (const row of candidates) {
        if (!next.has(row.id))
          next.set(row.id, row)
      }
      return () => {
        records = next
        sourceDocuments = nextSources
      }
    },
    context(session: BusinessSession): OtherSettlementContext {
      authorize(session, 'write')
      return { ...session, ...identities() }
    },
    source(id: string, factId: string, session: BusinessSession): OtherSettlementSourceDocument {
      authorize(session, 'read')
      const row = find(id, session)
      const fact = facts(row)?.find(f => f.id === factId)
      if (!fact)
        throw auxiliaryProblem('relationship-mismatch', '当前结算不包含该源单关系')
      const document = sourceDocument(fact.sourceId, fact.kind)
      if (!document)
        throw auxiliaryProblem('not-found', '关联源单不存在或中央身份已失效')
      const owner = fact.kind === 'payment' ? sourceDocument(fact.parentId ?? '', 'application') : document
      if (!owner || owner.projectId !== row.draft.projectId || (owner.contractId && owner.contractId !== row.draft.contractId) || (owner.supplierId && owner.supplierId !== row.draft.supplierId) || !document.allocations.some(a => a.id === (fact.allocationId ?? fact.id) && a.targetId === (fact.kind === 'payment' ? fact.parentId : id)))
        throw auxiliaryProblem('relationship-mismatch', '源单与当前结算关系已不匹配')
      return structuredClone(document)
    },
    detail(id: string, query: Record<string, unknown>, session: BusinessSession): OtherSettlementDetail {
      authorize(session, 'read')
      if ((query.origin && query.origin !== 'real') || (query.contractId && query.contractId !== find(id, session).draft.contractId))
        throw auxiliaryProblem('relationship-mismatch', '结算来源或合同关系不匹配')
      const row = find(id, session)
      return { settlement: dto(row), facts: structuredClone(facts(row)), attachments: structuredClone(row.attachments.filter(f => !f.deletedAt || (query.includeDeleted === 'true' && session.capabilities.includes('other-settlement:write')))), capabilities: session.capabilities }
    },
    list(query: Record<string, unknown>, session: BusinessSession): OtherSettlementPage {
      authorize(session, 'read')
      if (query.origin && !['real', 'demo'].includes(String(query.origin)))
        throw auxiliaryProblem('invalid-query', '数据来源无效')
      const search = String(query.search ?? '').trim().toLocaleLowerCase('zh-CN')
      const all = [...records.values()].filter(row => row.workspaceId === session.workspaceId && query.origin !== 'demo').map(dto).filter(row => (!query.projectId || row.draft.projectId === query.projectId) && (!query.contractId || row.draft.contractId === query.contractId) && (!query.supplierId || row.draft.supplierId === query.supplierId) && matchesOtherSettlementStatus(row.draft.status, query.status)
        && (!search || [row.draft.name, row.draft.no, row.contract.label, row.supplier.label].some(value => value?.toLocaleLowerCase('zh-CN').includes(search)))).sort((a, b) => a.id.localeCompare(b.id))
      const { requestedPage, pageSize } = parsePageQuery(query, () => {
        throw auxiliaryProblem('invalid-query', '结算分页参数无效')
      })
      const pagination = resolvePagination(requestedPage, pageSize, all.length)
      const { page } = pagination
      const filtered = ['search', 'contractId', 'projectId', 'supplierId'].some(key => query[key]) || enumFilterValues(query.status).length > 0
      return { items: all.slice((page - 1) * pageSize, page * pageSize), pagination, summary: { count: all.length, amount: sumAuxiliaryMoney(all.map(row => row.amounts.total)) }, empty: all.length ? null : { reason: filtered ? 'no-filter-match' : 'no-records', missingRelations: [] }, capabilities: [...session.capabilities], asOf: now(), sourceVersion: `other-settlement:${[...records.values()].reduce((sum, row) => sum + row.version, 0)}`, projectOptions: identities().projects }
    },
    async execute(input: unknown, session: BusinessSession) {
      authorize(session, 'write')
      const request: OtherSettlementCommand = decodeOtherSettlementCommand(input)
      if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId || request.requiredCapability !== 'other-settlement:write')
        throw auxiliaryProblem('forbidden', '结算写入身份或权限不匹配')
      const key = JSON.stringify([session.workspaceId, session.actorId, 'other-settlement', request.commandId])
      const fingerprint = JSON.stringify(request)
      if (sealed.has(key))
        throw auxiliaryProblem('conflict', '原提交已封存为未保存，迟到请求不能写入')
      const replay = commands.get(key)
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw auxiliaryProblem('conflict', '同一命令不能变更内容')
        return structuredClone(replay.result)
      }
      const existing = request.id ? find(request.id, session) : null
      if (existing ? String(existing.version) !== request.baseVersion : request.baseVersion !== null)
        throw auxiliaryProblem('conflict', '结算已有更新，请载入最新版后重试')
      if (existing && isConfirmedExpenditureSettlement(existing.draft.status ?? ''))
        throw auxiliaryProblem('conflict', '已确认结算不能修改')
      const draft = structuredClone(request.draft)
      draft.projectId ||= null
      draft.contractId ||= null
      const source = identities()
      if (draft.projectId && !source.projects.some(p => p.id === draft.projectId))
        throw auxiliaryProblem('relationship-mismatch', '项目已不可用')
      const contract = source.contracts.find(c => c.id === draft.contractId && c.projectId === draft.projectId)
      if (draft.contractId && (!contract || (draft.supplierId && draft.supplierId !== contract.supplierId)))
        throw auxiliaryProblem('relationship-mismatch', '必须选择同项目、同类型、非草稿的真实源合同')
      draft.supplierId = contract?.supplierId ?? null
      if (!draft.contractId && draft.originalExpenses?.length) {
        draft.projectId ??= null
        draft.contractId = null
        const references = options.originalExpenses?.() ?? []
        const sources = draft.originalExpenses.map((line) => {
          const source = references.find(row => row.id === line.originalExpenseLineId)
          if (!source || (line.consumptionVersion ? source.consumptionVersion !== line.consumptionVersion : source.version !== line.sourceVersion || source.sourceRevision !== line.sourceRevision))
            throw auxiliaryProblem('conflict', '原费用或来源版本已变化，请重新核对；当前输入保留')
          if ((draft.projectId ?? null) !== source.projectId || !identities().suppliers.some(row => row.id === source.serviceSupplierId))
            throw auxiliaryProblem('relationship-mismatch', '原费用项目/公司归属或实际服务交易方不匹配')
          if (source.applicantWorkerId ? !identities().workers?.some(row => row.id === source.applicantWorkerId) : !identities().suppliers.some(row => row.id === source.applicantSupplierId))
            throw auxiliaryProblem('relationship-mismatch', '原费用垫付收款身份尚未在真实目录核验')
          if (!options.expenseAdoptionCap && source.clearedAmount > 0)
            throw auxiliaryProblem('unavailable', '原费用已有清偿记录，该批余额与旧清偿采用决定尚待明确；保留原费用和历史')
          const cap = options.expenseAdoptionCap ? options.expenseAdoptionCap(source, line) : source.amount
          const claimed = [...records.values()].filter(row => row.id !== existing?.id && row.workspaceId === session.workspaceId && isConfirmedExpenditureSettlement(row.draft.status ?? '')).flatMap(row => row.draft.originalExpenses ?? []).filter(row => row.originalExpenseLineId === source.id).reduce((sum, row) => sum + (row.amount ?? Number.NaN), 0)
          if (!Number.isFinite(cap) || cap < 0 || !Number.isFinite(claimed) || (line.amount !== null && line.amount + claimed > cap + 0.0001))
            throw auxiliaryProblem('conflict', '累计已确认结算与本次采用金额超过原费用可采用额度')
          return source
        })
        const payee = sources[0]!
        if (sources.some(row => row.applicantWorkerId !== payee.applicantWorkerId || row.applicantSupplierId !== payee.applicantSupplierId))
          throw auxiliaryProblem('relationship-mismatch', '一个结算只采用同一实际垫付收款身份的原费用')
        if ((draft.payeeWorkerId && draft.payeeWorkerId !== payee.applicantWorkerId) || (draft.payeeSupplierId && draft.payeeSupplierId !== payee.applicantSupplierId))
          throw auxiliaryProblem('relationship-mismatch', '实际收款身份必须继承原费用，不能换成服务交易方')
        draft.payeeWorkerId = payee.applicantWorkerId
        draft.payeeSupplierId = payee.applicantSupplierId
        draft.payeeNameSnapshot = payee.applicantNameSnapshot
        const serviceIds = new Set(sources.map(row => row.serviceSupplierId))
        draft.supplierId = serviceIds.size === 1 ? payee.serviceSupplierId : null
        const total = draft.originalExpenses.some(row => row.amount === null) ? null : draft.originalExpenses.reduce((sum, row) => sum + Math.round(row.amount! * 100), 0) / 100
        if (draft.totalAmount !== null && draft.totalAmount !== undefined && total !== null && Math.round(draft.totalAmount * 100) !== Math.round(total * 100))
          throw auxiliaryProblem('validation-failed', '无合同结算金额须由明确采用的原费用分摊合计，不能另造费用金额')
        draft.totalAmount = total
      }
      if (existing && (existing.facts === null || existing.facts.length) && ['projectId', 'contractId', 'supplierId'].some(key => draft[key as keyof OtherSettlementDraft] !== existing.draft[key as keyof OtherSettlementDraft]))
        throw auxiliaryProblem('relationship-mismatch', '已关联事实或事实未知的结算不能改挂其他合同')
      if (request.action !== 'draft') {
        const errors: Record<string, string[]> = {}
        for (const field of (draft.contractId ? ['name', 'projectId', 'contractId', 'settlementDate'] : ['name', 'settlementDate']) as ('name' | 'projectId' | 'contractId' | 'settlementDate')[]) {
          if (!draft[field])
            errors[field] = ['必填项']
        }
        if (!draft.contractId && !draft.originalExpenses?.length)
          errors.originalExpenses = ['请选择真实原费用，不能凭无合同自由文本建立付款来源']
        if (draft.totalAmount == null)
          errors.totalAmount = ['请填写结算金额，零金额可保存']
        if (Object.keys(errors).length)
          throw auxiliaryProblem('validation-failed', '请补全结算资料', errors)
      }
      if (request.action === 'confirm' && existing?.draft.status !== 'pending')
        throw auxiliaryProblem('conflict', '仅待确认结算可确认')
      const id = existing?.id ?? options.createId?.() ?? crypto.randomUUID()
      const timestamp = now()
      draft.id = id
      draft.status = request.action === 'confirm' ? 'confirmed' : request.action === 'submit' ? 'pending' : existing?.draft.status ?? 'draft'
      const attachments = applyAuxiliaryAttachments(existing?.attachments ?? [], request.attachments, { id, kind: 'other_expense', actorId: session.actorId, timestamp }).map(file => ({ ...file, ownerType: 'expenditure_settlement' as const }))
      const row: OtherSettlementStored = { id, version: (existing?.version ?? 0) + 1, workspaceId: session.workspaceId, migrationBatchId: existing?.migrationBatchId ?? null, draft, attachments, facts: existing ? existing.facts : [], audit: { createdAt: existing ? existing.audit.createdAt : timestamp, createdBy: existing ? existing.audit.createdBy : session.actorId, updatedAt: timestamp, updatedBy: session.actorId, responsible: existing?.audit.responsible ?? null, department: existing?.audit.department ?? null } }
      records.set(id, row)
      const result = { id, version: String(row.version), commandId: request.commandId, updatedAt: timestamp, attachmentIds: attachments.filter(file => !existing?.attachments.some(before => before.id === file.id)).map(file => file.id) }
      commands.set(key, { fingerprint, result })
      return structuredClone(result)
    },
  }
}
