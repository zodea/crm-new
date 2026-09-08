import type { AuxiliaryContractAudit } from '../../app/lib/auxiliary-contract/contract'
import type { ContractFormAttachment } from '../../app/lib/contract/forms'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { OtherSettlementCommand, OtherSettlementContext, OtherSettlementDetail, OtherSettlementDraft, OtherSettlementDTO, OtherSettlementFact, OtherSettlementPage } from '../../app/lib/other-settlement/contract'
import type { BusinessSession } from './business-session'
import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { auxiliaryTaxExclusive, subtractAuxiliaryMoney, sumAuxiliaryMoney } from '../../app/lib/auxiliary-contract/facts'
import { isEffectiveSettlementFact } from '../../app/lib/other-settlement/facts'
import { decodeOtherSettlementCommand } from '../../app/lib/other-settlement/validation'
import { applyAuxiliaryAttachments } from './auxiliary-contract-attachments'
import { migratedOtherSettlement } from './other-settlement-migration'

export interface OtherSettlementStored {
  id: string
  version: number
  workspaceId: string
  migrationBatchId: string | null
  draft: OtherSettlementDraft
  attachments: ContractFormAttachment[]
  audit: AuxiliaryContractAudit
  facts: OtherSettlementFact[] | null
}
interface Options {
  identities: () => Pick<OtherSettlementContext, 'projects' | 'suppliers' | 'contracts'>
  records?: OtherSettlementStored[]
  now?: () => string
  createId?: () => string
}
export function createOtherSettlementInstance(options: Options) {
  let records = new Map((options.records ?? []).map(row => [row.id, structuredClone(row)]))
  const commands = new Map<string, {
    fingerprint: string
    result: {
      id: string
      version: string
      commandId: string
    }
  }>()
  const now = options.now ?? (() => new Date().toISOString())
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
    if (!identities().contracts.some(c => c.id === d.contractId && c.projectId === d.projectId && c.supplierId === d.supplierId))
      return null
    if (row.facts?.some(fact => fact.settlementId !== row.id || fact.projectId !== d.projectId || fact.contractId !== d.contractId || fact.supplierId !== d.supplierId))
      return null
    return row.facts
  }
  function dto(row: OtherSettlementStored): OtherSettlementDTO {
    const d = row.draft
    const identity = identities()
    const contract = identity.contracts.find(c => c.id === d.contractId && c.projectId === d.projectId && c.supplierId === d.supplierId)
    const related = facts(row)
    const sum = (kind: OtherSettlementFact['kind']) => related === null ? null : sumAuxiliaryMoney(related.filter(f => f.kind === kind && isEffectiveSettlementFact(f)).map(f => f.attribution === 'exact' ? f.amount : null))
    const total = d.totalAmount == null ? null : d.totalAmount.toFixed(2)
    const deductions = sum('penalty')
    const applied = sum('application')
    const paid = sum('payment')
    const net = subtractAuxiliaryMoney(total, deductions)
    const confirmed = [...records.values()].filter(item => item.workspaceId === row.workspaceId && item.draft.status === 'confirmed' && item.draft.contractId === d.contractId && item.draft.projectId === d.projectId && item.draft.supplierId === d.supplierId)
    const others = confirmed.filter(r => r.id !== row.id)
    const prior = !contract || !d.settlementDate || others.some(r => !r.draft.settlementDate || r.draft.settlementDate === d.settlementDate)
      ? null
      : sumAuxiliaryMoney(others.filter(r => r.draft.settlementDate! < d.settlementDate!).map(r => r.draft.totalAmount?.toFixed(2) ?? null))
    const taxExclusive = auxiliaryTaxExclusive(total, d.taxRate ?? null)
    const ref = (entity: 'project' | 'supplier' | 'contract', id: string | null | undefined, label: string | undefined): OtherSettlementDTO['project'] => id && label ? { state: 'resolved', entity, id, label, no: null } : { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' }
    return { id: row.id, dataOrigin: 'real', version: String(row.version), draft: structuredClone(d), project: ref('project', d.projectId, identity.projects.find(p => p.id === d.projectId)?.label), supplier: ref('supplier', d.supplierId, identity.suppliers.find(s => s.id === d.supplierId)?.label), contract: ref('contract', d.contractId, contract?.name), navigation: { kind: 'entity-detail', subject: { state: 'resolved', entity: 'settlement', id: row.id, label: d.name || '未命名结算', no: d.no || null }, variant: 'other_settlement', view: null, filters: { dataOrigin: 'real' } }, amounts: { total, deductions, net, applied, applicable: subtractAuxiliaryMoney(net, applied), paid, unpaid: subtractAuxiliaryMoney(net, paid), contract: contract?.amount ?? null, changedContract: contract?.changedAmount ?? null, prior, cumulative: contract ? sumAuxiliaryMoney(confirmed.map(r => r.draft.totalAmount?.toFixed(2) ?? null)) : null, taxExclusive, tax: subtractAuxiliaryMoney(total, taxExclusive) }, audit: structuredClone(row.audit), attachmentCount: row.attachments.filter(f => !f.deletedAt).length }
  }
  return {
    contractFacts(contractId: string) {
      return [...records.values()].filter(row => row.draft.contractId === contractId).map(row => ({ id: row.id, kind: 'settlement' as const, contractId, contractKind: 'other_expense' as const, dataOrigin: 'real' as const, no: row.draft.no ?? '', name: row.draft.name ?? '', amount: row.draft.totalAmount?.toFixed(2) ?? null, date: row.draft.settlementDate || null, status: row.draft.status ?? '', effective: row.draft.status === 'confirmed' }))
    },
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO) {
      const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
      const entities = batchId ? snapshot.entities.filter(e => !e.deletedAt) : []
      const candidates = entities.filter(e => e.entityType === 'other_settlements').map(e => migratedOtherSettlement(e, batchId!, entities))
      const ids = new Set(candidates.map(e => e.id))
      const next = new Map([...records].filter(([id, row]) => !row.migrationBatchId || (row.migrationBatchId === batchId && ids.has(id))))
      for (const row of candidates) {
        if (!next.has(row.id))
          next.set(row.id, row)
      }
      return () => {
        records = next
        for (const [key, command] of commands) {
          if (!records.has(command.result.id))
            commands.delete(key)
        }
      }
    },
    context(session: BusinessSession): OtherSettlementContext {
      authorize(session, 'write')
      return { ...session, ...identities() }
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
      const all = [...records.values()].filter(row => row.workspaceId === session.workspaceId && query.origin !== 'demo').map(dto).filter(row => (!query.projectId || row.draft.projectId === query.projectId) && (!query.contractId || row.draft.contractId === query.contractId) && (!query.supplierId || row.draft.supplierId === query.supplierId) && (!query.status || row.draft.status === query.status)
        && (!search || [row.draft.name, row.draft.no, row.contract.label, row.supplier.label].some(value => value?.toLocaleLowerCase('zh-CN').includes(search)))).sort((a, b) => a.id.localeCompare(b.id))
      const pageSize = [10, 20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : 20
      const page = Math.min(Number.isSafeInteger(Number(query.page)) && Number(query.page) > 0 ? Number(query.page) : 1, Math.max(1, Math.ceil(all.length / pageSize)))
      return { items: all.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: all.length }, summary: { count: all.length, amount: sumAuxiliaryMoney(all.map(row => row.amounts.total)) }, empty: all.length ? null : { reason: Object.keys(query).some(k => ['search', 'status', 'contractId', 'projectId', 'supplierId'].includes(k) && query[k]) ? 'no-filter-match' : 'no-records', missingRelations: [] }, capabilities: [...session.capabilities], asOf: now(), sourceVersion: `other-settlement:${[...records.values()].reduce((sum, row) => sum + row.version, 0)}`, projectOptions: identities().projects }
    },
    async execute(input: unknown, session: BusinessSession) {
      authorize(session, 'write')
      const request: OtherSettlementCommand = decodeOtherSettlementCommand(input)
      if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId || request.requiredCapability !== 'other-settlement:write')
        throw auxiliaryProblem('forbidden', '结算写入身份或权限不匹配')
      const key = `${session.workspaceId}:${request.commandId}`
      const fingerprint = JSON.stringify(request)
      const replay = commands.get(key)
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          throw auxiliaryProblem('conflict', '同一命令不能变更内容')
        return structuredClone(replay.result)
      }
      const existing = request.id ? find(request.id, session) : null
      if (existing ? String(existing.version) !== request.baseVersion : request.baseVersion !== null)
        throw auxiliaryProblem('conflict', '结算已有更新，请载入最新版后重试')
      if (existing?.draft.status === 'confirmed')
        throw auxiliaryProblem('conflict', '已确认结算不能修改')
      const draft = structuredClone(request.draft)
      const source = identities()
      if (draft.projectId && !source.projects.some(p => p.id === draft.projectId))
        throw auxiliaryProblem('relationship-mismatch', '项目已不可用')
      const contract = source.contracts.find(c => c.id === draft.contractId && c.projectId === draft.projectId)
      if (draft.contractId && (!contract || (draft.supplierId && draft.supplierId !== contract.supplierId)))
        throw auxiliaryProblem('relationship-mismatch', '必须选择同项目、同类型、非草稿的真实源合同')
      draft.supplierId = contract?.supplierId ?? null
      if (existing && (existing.facts === null || existing.facts.length) && ['projectId', 'contractId', 'supplierId'].some(key => draft[key as keyof OtherSettlementDraft] !== existing.draft[key as keyof OtherSettlementDraft]))
        throw auxiliaryProblem('relationship-mismatch', '已关联事实或事实未知的结算不能改挂其他合同')
      if (request.action !== 'draft') {
        const errors: Record<string, string[]> = {}
        for (const field of ['name', 'projectId', 'contractId', 'settlementDate'] as const) {
          if (!draft[field])
            errors[field] = ['必填项']
        }
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
      const result = { id, version: String(row.version), commandId: request.commandId }
      commands.set(key, { fingerprint, result })
      return structuredClone(result)
    },
  }
}
