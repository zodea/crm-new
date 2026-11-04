import type { AuxiliaryContractAudit, AuxiliaryContractCommand, AuxiliaryContractDetail, AuxiliaryContractDraft, AuxiliaryContractDTO, AuxiliaryContractFact, AuxiliaryContractPage } from '../../app/lib/auxiliary-contract/contract'
import type { ContractFormAttachment } from '../../app/lib/contract/forms'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { BusinessSession } from './business-session'
import { auxiliaryKind, auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { auxiliaryTaxExclusive, subtractAuxiliaryMoney, sumAuxiliaryFacts, sumAuxiliaryMoney } from '../../app/lib/auxiliary-contract/facts'
import { decodeAuxiliaryCommand } from '../../app/lib/auxiliary-contract/validation'
import { enumFilterValues, matchesEnumFilter } from '../../app/lib/kit/enum-filter'
import { parsePageQuery, resolvePagination } from '../../app/lib/read-model/pagination'
import { applyAuxiliaryAttachments } from './auxiliary-contract-attachments'
import { migratedAuxiliaryContract } from './auxiliary-contract-migration'
import { assertRetainedMigrationReferences } from './core-identity-migration'
import { createReadMeta, readSourceVersion, withOriginReadMeta, withReadMeta } from './read-meta'

export interface AuxiliaryStoredContract {
  draft: AuxiliaryContractDraft & { id: string }
  version: number
  attachments: ContractFormAttachment[]
  audit: AuxiliaryContractAudit
  workspaceId: string
  migrationBatchId: string | null
  facts: AuxiliaryContractFact[]
  settlementStatus: string | null
  clearanceStatus: string | null
}
export interface AuxiliaryOwnerSnapshot { schemaVersion: 1, sourceVersion: number, contracts: AuxiliaryStoredContract[] }
interface Option { id: string, name: string }
interface Options { createId?: () => string, now?: () => string, projects?: Option[], suppliers?: Option[], facts?: AuxiliaryContractFact[], identities?: () => { projects: Option[], suppliers: Option[] }, settlements?: (contractId: string) => AuxiliaryContractFact[] }

export function createAuxiliaryContractTestInstance(options: Options = {}) {
  let records = new Map<string, AuxiliaryStoredContract>()
  let revision = 0
  const replay = new Map<string, { id: string, version: string, commandId: string, updatedAt: string, attachmentIds: string[] }>()
  const fingerprints = new Map<string, string>()
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  let projects = new Map((options.projects ?? []).map(row => [row.id, row.name]))
  let suppliers = new Map((options.suppliers ?? []).map(row => [row.id, row.name]))
  const facts: AuxiliaryContractFact[] = structuredClone(options.facts ?? [])
  function authorize(session: BusinessSession, action: 'read' | 'write') {
    if (!session.capabilities.includes(`auxiliary-contract:${action}`))
      throw auxiliaryProblem('forbidden', '无辅助合同访问权限')
    const identities = options.identities?.()
    if (identities) {
      projects = new Map(identities.projects.map(row => [row.id, row.name]))
      suppliers = new Map(identities.suppliers.map(row => [row.id, row.name]))
    }
  }
  function find(id: string, session: BusinessSession) {
    const stored = records.get(id)
    if (!stored || stored.workspaceId !== session.workspaceId)
      throw auxiliaryProblem('not-found', '合同不存在或已删除')
    return stored
  }
  function relatedFacts(stored: AuxiliaryStoredContract) {
    const related = [...facts, ...stored.facts].filter(row => row.contractId === stored.draft.id && row.contractKind === stored.draft.kind && row.dataOrigin === 'real')
    return options.settlements && stored.draft.kind === 'other_expense' ? [...related.filter(row => row.kind !== 'settlement'), ...options.settlements(stored.draft.id)] : related
  }
  function dto(stored: AuxiliaryStoredContract): AuxiliaryContractDTO {
    const d = stored.draft
    const amount = d.amount == null ? null : d.amount.toFixed(2)
    const exclusive = auxiliaryTaxExclusive(amount, d.taxRate ?? null)
    const related = relatedFacts(stored)
    const invoiced = sumAuxiliaryFacts(related, 'invoice')
    const paid = sumAuxiliaryFacts(related, 'payment')
    const settled = d.kind === 'company_expense' ? null : sumAuxiliaryFacts(related, 'settlement')
    const ref = (entity: 'project' | 'supplier', id: string | null | undefined, names: Map<string, string>): AuxiliaryContractDTO['project'] => id && names.has(id)
      ? { state: 'resolved', entity, id, label: names.get(id)!, no: null }
      : { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' }
    return {
      id: d.id,
      kind: d.kind,
      dataOrigin: 'real',
      draft: structuredClone(d),
      version: String(stored.version),
      project: d.kind === 'company_expense' ? null : ref('project', d.projectId, projects),
      supplier: d.kind === 'company_expense' && !d.supplierId ? null : ref('supplier', d.supplierId, suppliers),
      navigation: { kind: 'entity-detail', subject: { state: 'resolved', entity: 'contract', id: d.id, label: d.name || '未命名合同', no: d.no || null }, variant: d.kind, view: null, filters: { dataOrigin: 'real', contractKind: d.kind } },
      amounts: { contract: amount, changed: sumAuxiliaryMoney([amount, sumAuxiliaryFacts(related, 'supplement')]), taxExclusive: exclusive, tax: subtractAuxiliaryMoney(amount, exclusive), invoiced, paid, settled, byInvoicePayable: subtractAuxiliaryMoney(invoiced, paid), bySettlementPayable: subtractAuxiliaryMoney(settled, paid) },
      settlementStatus: stored.settlementStatus,
      clearanceStatus: stored.clearanceStatus,
      audit: structuredClone(stored.audit),
      attachmentCount: stored.attachments.filter(file => !file.deletedAt).length,
      attachmentCategories: stored.attachments.filter(file => !file.deletedAt).reduce<Record<string, number>>((counts, file) => {
        counts[file.category || '合同附件'] = (counts[file.category || '合同附件'] ?? 0) + 1
        return counts
      }, {}),
    }
  }
  function readEvidence(session: BusinessSession, query: Record<string, unknown>, operation: string, asOf: string, origin: 'real' | 'demo' = 'real') {
    const owned = [...records.values()].filter(row => row.workspaceId === session.workspaceId)
    const sourceVersion = readSourceVersion('auxiliary-contracts', { records: owned, facts: owned.map(row => ({ id: row.draft.id, rows: relatedFacts(row) })), projects: [...projects], suppliers: [...suppliers] })
    const scope = operation === 'auxiliary-contract:list'
      ? { kind: query.kind, origin: 'real', search: String(query.search ?? '').trim(), category: enumFilterValues(query.category), status: enumFilterValues(query.status), projectId: query.projectId ?? query.project ?? null, supplierId: query.supplierId ?? query.supplier ?? null }
      : { id: query.id, kind: query.kind, origin: 'real', includeDeleted: query.includeDeleted === 'true' }
    return createReadMeta({ session, schemaVersion: 'auxiliary-contract-read-v2', operation, dataOrigin: origin, asOf, sources: [{ key: 'auxiliary-contracts', state: origin === 'real' ? 'readable' : 'not-requested', sourceVersion: origin === 'real' ? sourceVersion : null, asOf: origin === 'real' ? asOf : null }], coverage: origin === 'real' ? 'complete' : 'unknown', scope })
  }
  return {
    exportState(): AuxiliaryOwnerSnapshot { return structuredClone({ schemaVersion: 1, sourceVersion: revision, contracts: [...records.values()] }) },
    importState(state: AuxiliaryOwnerSnapshot) {
      if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.sourceVersion) || state.sourceVersion < 0 || new Set(state.contracts.map(row => row.draft.id)).size !== state.contracts.length)
        throw auxiliaryProblem('unavailable', '辅助合同持久快照身份或版本损坏')
      records = new Map(structuredClone(state.contracts).map(row => [row.draft.id, row]))
      revision = state.sourceVersion
    },
    supplierReadSource(workspaceId: string) {
      const scoped = [...records.values()].filter(row => row.workspaceId === workspaceId && row.draft.kind === 'other_expense')
      return {
        rows: scoped.map(dto),
        sourceVersion: `auxiliary-supplier:${scoped.map(row => `${row.draft.id}:${row.version}`).sort().join('|')}`,
      }
    },
    otherSettlementContext(session: BusinessSession) {
      authorize(session, 'read')
      return { projects: [...projects].map(([id, label]) => ({ id, label })), suppliers: [...suppliers].map(([id, label]) => ({ id, label })), contracts: [...records.values()].filter(row => row.workspaceId === session.workspaceId).map(row => ({ id: row.draft.id, kind: row.draft.kind, name: row.draft.name || '未命名合同', projectId: row.draft.projectId ?? null, supplierId: row.draft.supplierId ?? null, status: row.draft.status || '草稿', amount: row.draft.amount?.toFixed(2) ?? null, changedAmount: sumAuxiliaryMoney([row.draft.amount?.toFixed(2) ?? null, sumAuxiliaryFacts(relatedFacts(row), 'supplement')]) })) }
    },
    assertMigrationRemoval(removed: readonly CoreMigrationServerEntityDTO[]) {
      assertRetainedMigrationReferences(removed, 'auxiliary_contracts', [...records.values()].map(row => ({ id: row.draft.id, references: [{ type: 'projects', id: row.draft.projectId }, { type: 'suppliers', id: row.draft.supplierId }] })), message => auxiliaryProblem('conflict', message))
    },
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO) {
      const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
      const entities = batchId ? snapshot.entities.filter(row => !row.deletedAt) : []
      const candidates = entities.filter(row => row.entityType === 'auxiliary_contracts').map(row => migratedAuxiliaryContract(row, batchId!))
      const ids = new Set(candidates.map(row => row.draft.id))
      for (const [id, row] of records) {
        if (row.migrationBatchId && (row.migrationBatchId !== batchId || !ids.has(id)) && row.version !== 1)
          throw auxiliaryProblem('conflict', '迁入辅助合同已有后来修改或附件变更，不能回滚移除')
      }
      const nextRecords = new Map([...records].filter(([id, row]) => !row.migrationBatchId || (row.migrationBatchId === batchId && ids.has(id))))
      for (const row of candidates) {
        if (!nextRecords.has(row.draft.id))
          nextRecords.set(row.draft.id, row)
      }
      const nextProjects = new Map((options.projects ?? []).map(row => [row.id, row.name]))
      const nextSuppliers = new Map((options.suppliers ?? []).map(row => [row.id, row.name]))
      for (const row of entities) {
        if (row.entityType === 'projects')
          nextProjects.set(row.id, row.name)
        if (row.entityType === 'suppliers')
          nextSuppliers.set(row.id, row.name)
      }
      return () => {
        records = nextRecords
        projects = nextProjects
        suppliers = nextSuppliers
      }
    },
    context(session: BusinessSession) {
      authorize(session, 'write')
      return { ...session, projects: [...projects].map(([id, label]) => ({ id, label })), suppliers: [...suppliers].map(([id, label]) => ({ id, label })) }
    },
    detail(id: string, query: Record<string, unknown>, session: BusinessSession): AuxiliaryContractDetail {
      authorize(session, 'read')
      const stored = find(id, session)
      if (auxiliaryKind(query.kind) !== stored.draft.kind || (query.origin && query.origin !== 'real'))
        throw auxiliaryProblem('relationship-mismatch', '合同类型或数据来源不匹配')
      const includeDeleted = query.includeDeleted === 'true' && session.capabilities.includes('auxiliary-contract:write')
      const asOf = now()
      return withReadMeta({ contract: dto(stored), facts: structuredClone(relatedFacts(stored)), attachments: structuredClone(stored.attachments.filter(file => includeDeleted || !file.deletedAt)) }, readEvidence(session, { ...query, id }, 'auxiliary-contract:detail', asOf))
    },
    list(query: Record<string, unknown>, session: BusinessSession): AuxiliaryContractPage {
      authorize(session, 'read')
      const kind = auxiliaryKind(query.kind)
      if (kind === 'company_expense' && (query.projectId || query.supplierId || query.project || query.supplier))
        throw auxiliaryProblem('invalid-query', '公司合同不接受项目或分供方筛选')
      if (query.origin && query.origin !== 'real' && query.origin !== 'demo')
        throw auxiliaryProblem('invalid-query', '数据来源无效')
      if (query.origin === 'demo')
        throw auxiliaryProblem('unavailable', '辅助合同测试来源尚未连接，无法确认记录或汇总。')
      const search = String(query.search ?? '').trim().toLocaleLowerCase('zh-CN')
      const items = [...records.values()].filter(row => row.workspaceId === session.workspaceId && row.draft.kind === kind && query.origin !== 'demo').filter(({ draft }) => (!search || [draft.name, draft.no, draft.counterparty, suppliers.get(draft.supplierId ?? '')].some(value => value?.toLocaleLowerCase('zh-CN').includes(search)))
        && matchesEnumFilter(draft.category, query.category)
        && matchesEnumFilter(draft.status, query.status)
        && (!(query.projectId || query.project) || draft.projectId === (query.projectId || query.project))
        && (!(query.supplierId || query.supplier) || draft.supplierId === (query.supplierId || query.supplier))).sort((a, b) => a.draft.id.localeCompare(b.draft.id)).map(dto)
      const { requestedPage, pageSize } = parsePageQuery(query, () => {
        throw auxiliaryProblem('invalid-query', '合同分页参数无效')
      })
      const pagination = resolvePagination(requestedPage, pageSize, items.length)
      const { page } = pagination
      const filtered = ['search', 'projectId', 'supplierId', 'project', 'supplier'].some(key => query[key]) || enumFilterValues(query.category).length > 0 || enumFilterValues(query.status).length > 0
      const asOf = now()
      return withOriginReadMeta({ items: items.slice((page - 1) * pageSize, page * pageSize), pagination, projectOptions: kind === 'other_expense' ? [...projects].map(([id, label]) => ({ id, label })) : [], empty: items.length ? null : { reason: filtered ? 'no-filter-match' : 'no-records', missingRelations: [] }, asOf, sourceVersion: null, summary: { real: { count: items.length, amount: sumAuxiliaryMoney(items.map(row => row.amounts.contract)) }, demo: { count: 0, amount: '0.00' } }, capabilities: [...session.capabilities] }, { real: readEvidence(session, query, 'auxiliary-contract:list', asOf), demo: readEvidence(session, query, 'auxiliary-contract:list', asOf, 'demo') })
    },
    async execute(request: AuxiliaryContractCommand, session: BusinessSession) {
      authorize(session, 'write')
      request = decodeAuxiliaryCommand(request)
      if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId || request.requiredCapability !== 'auxiliary-contract:write')
        throw auxiliaryProblem('forbidden', '写入会话不一致')
      const replayKey = `${session.workspaceId}:${session.actorId}:${request.commandId}`
      const fingerprint = JSON.stringify(request)
      if (replay.has(replayKey)) {
        if (fingerprints.get(replayKey) !== fingerprint)
          throw auxiliaryProblem('conflict', '同一命令不能用于不同内容')
        return structuredClone(replay.get(replayKey)!)
      }
      const existing = request.id ? find(request.id, session) : null
      if (existing && existing.draft.kind !== request.draft.kind)
        throw auxiliaryProblem('relationship-mismatch', '合同类型不匹配')
      if ((existing ? String(existing.version) : null) !== request.baseVersion)
        throw auxiliaryProblem('conflict', '合同已有更新，请重新载入后编辑')
      const input = request.draft
      if (input.projectId && !projects.has(input.projectId))
        throw auxiliaryProblem('validation-failed', '项目不存在', { projectId: ['请选择真实项目'] })
      if (input.supplierId && !suppliers.has(input.supplierId))
        throw auxiliaryProblem('validation-failed', '分供方不存在', { supplierId: ['请选择真实分供方'] })
      if (input.status && input.status !== (existing?.draft.status ?? '草稿'))
        throw auxiliaryProblem('validation-failed', '不能直接修改审批或结清状态')
      if (existing && existing.draft.status !== '草稿' && request.action !== 'save')
        throw auxiliaryProblem('forbidden', '当前合同不能退回草稿或重复提交')
      if (request.action !== 'draft') {
        const required: Array<keyof AuxiliaryContractDraft> = ['name', 'signDate', 'category', ...(input.kind === 'other_expense' ? ['projectId', 'supplierId'] as const : ['counterparty'] as const)]
        const errors = Object.fromEntries(required.filter(key => !input[key]).map(key => [key, ['此项为必填项']]))
        if (input.amount == null)
          errors.amount = ['请输入合同金额']
        if (Object.keys(errors).length)
          throw auxiliaryProblem('validation-failed', '请补全合同必填资料', errors)
      }
      const id = existing?.draft.id ?? createId()
      const timestamp = now()
      const draft = structuredClone({ ...input, id, status: request.action === 'submit' ? '审批中' : existing?.draft.status ?? '草稿' })
      const audit = { createdBy: session.actorId, createdAt: timestamp, responsible: null, department: null, ...existing?.audit, updatedBy: session.actorId, updatedAt: timestamp }
      const attachments = applyAuxiliaryAttachments(existing?.attachments ?? [], request.attachments, { id, kind: draft.kind, actorId: session.actorId, timestamp })
      const stored: AuxiliaryStoredContract = { draft, audit, version: (existing?.version ?? 0) + 1, attachments, workspaceId: session.workspaceId, migrationBatchId: existing?.migrationBatchId ?? null, facts: existing?.facts ?? [], settlementStatus: existing?.settlementStatus ?? null, clearanceStatus: existing?.clearanceStatus ?? null }
      records.set(id, stored)
      revision++
      const result = { id, version: String(stored.version), commandId: request.commandId, updatedAt: timestamp, attachmentIds: attachments.filter(file => !file.deletedAt).map(file => file.id) }
      replay.set(replayKey, result)
      fingerprints.set(replayKey, fingerprint)
      return result
    },
  }
}
