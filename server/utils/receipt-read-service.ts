import type { ReceiptContext, ReceiptDetail, ReceiptPage, ReceiptRecord, ReceiptReferenceFacts } from '../../app/lib/receipt/contract'
import type { DataOriginDTO, EntityKindDTO, EntityRefDTO, SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import type { createReceiptCommandTestInstance } from './receipt-command-test-instance'
import { financeStatusLabel } from '../../app/lib/finance/status'
import { parsePageQuery, resolvePagination } from '../../app/lib/read-model/pagination'
import { RECEIPT_READ_CAPABILITY, receiptProblem } from '../../app/lib/receipt/contract'
import { effectiveReceiptAmount } from '../../app/lib/receipt/effective'
import { createReadMeta, readQueryScope, readSourceVersion, withOriginReadMeta, withReadMeta } from './read-meta'

interface Options {
  commands: ReturnType<typeof createReceiptCommandTestInstance>
  references: (sessionId?: string | null) => ReceiptReferenceFacts
  demoRecords?: () => ReceiptRecord[]
  demoReferences?: () => ReceiptReferenceFacts
  now?: () => string
}

function reference(entity: EntityKindDTO, id: string | null, rows: Array<{ id: string, name: string, no?: string }>, allowed: boolean): EntityRefDTO {
  if (!id)
    return { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' }
  if (!allowed)
    return { state: 'forbidden', entity, id: null, label: null, reason: 'permission-denied' }
  const row = rows.find(row => row.id === id)
  return row ? { state: 'resolved', entity, id, label: row.name, no: row.no ?? null } : { state: 'missing', entity, id: null, label: null, reason: 'not-recorded' }
}

export function createReceiptReadService(options: Options) {
  function allowed(session: BusinessSession, capability: string) {
    return session.capabilities.includes(capability)
  }
  function authorize(session: BusinessSession) {
    if (!allowed(session, RECEIPT_READ_CAPABILITY))
      throw receiptProblem('forbidden', '无收款读取权限')
  }
  function references(session: BusinessSession, sessionId?: string | null, origin: DataOriginDTO = 'real') {
    const facts = origin === 'real' ? options.references(sessionId) : options.demoReferences?.() ?? { projects: [], customers: [], contracts: [] }
    return {
      projects: allowed(session, 'project:list:read') ? facts.projects.map(row => ({ ...row, customerId: allowed(session, 'customer:list:read') ? row.customerId : null })) : [],
      customers: allowed(session, 'customer:list:read') ? facts.customers : [],
      contracts: allowed(session, 'construction-contract:read') ? facts.contracts.map(row => ({ ...row, projectId: allowed(session, 'project:list:read') ? row.projectId : null, customerId: allowed(session, 'customer:list:read') ? row.customerId : null })) : [],
    }
  }
  function rows(query: Record<string, unknown>, session: BusinessSession, sessionId?: string | null) {
    authorize(session)
    if (query.origin !== undefined && query.origin !== null && query.origin !== '' && !['real', 'demo'].includes(String(query.origin)))
      throw receiptProblem('invalid-query', '收款来源无效')
    const includeDemo = query.includeDemo === true || query.includeDemo === 'true'
    if (query.origin === 'demo' && (!includeDemo || !allowed(session, 'demo:read')))
      throw receiptProblem('forbidden', '测试收款未授权显示')
    const formal = options.commands.facts(sessionId)
    const demo = includeDemo && allowed(session, 'demo:read') ? options.demoRecords?.() ?? [] : []
    return { records: [...formal.rows, ...demo].filter(row => !query.origin || row.dataOrigin === query.origin), sourceVersion: formal.sourceVersion }
  }
  function evidence(session: BusinessSession, origin: DataOriginDTO, query: object, operation: string, asOf: string, sessionId?: string | null, requested = true) {
    const facts = requested ? (origin === 'real' ? options.references(sessionId) : options.demoReferences?.() ?? { projects: [], customers: [], contracts: [] }) : null
    const sources: SourceEvidenceDTO[] = [{ key: 'receipts', state: requested ? 'readable' as const : 'not-requested' as const, sourceVersion: requested ? (origin === 'real' ? options.commands.facts(sessionId).sourceVersion : readSourceVersion('demo-receipts', options.demoRecords?.() ?? [])) : null, asOf: requested ? asOf : null }]
    for (const [key, capability] of [['projects', 'project:list:read'], ['customers', 'customer:list:read'], ['contracts', 'construction-contract:read']] as const) {
      const readable = requested && allowed(session, capability)
      sources.push({ key: `receipt-${key}-references`, state: readable ? 'readable' : requested ? 'forbidden' : 'not-requested', sourceVersion: readable ? readSourceVersion(`receipt-${key}-references`, facts![key]) : null, asOf: readable ? asOf : null } as typeof sources[number])
    }
    return createReadMeta({ session, schemaVersion: 'receipt-read-v2', operation, dataOrigin: origin, asOf, sources, coverage: requested ? 'complete' : 'unknown', scope: { query: readQueryScope(query), testSession: sessionId ?? null } })
  }
  function detail(record: ReceiptRecord, all: ReceiptRecord[], session: BusinessSession, sessionId?: string | null, asOf = options.now?.() ?? new Date().toISOString()): ReceiptDetail {
    const facts = references(session, sessionId, record.dataOrigin)
    const project = reference('project', record.draft.projectId, facts.projects, allowed(session, 'project:list:read'))
    const customer = reference('customer', record.draft.customerId, facts.customers, allowed(session, 'customer:list:read'))
    const contract = reference('contract', record.draft.contractId, facts.contracts, allowed(session, 'construction-contract:read'))
    const contractAmount = contract.state === 'resolved' ? facts.contracts.find(row => row.id === contract.id)?.amount ?? null : null
    const cumulativeReceipt = contract.state === 'resolved' ? effectiveReceiptAmount(all.filter(row => row.dataOrigin === record.dataOrigin && row.draft.contractId === record.draft.contractId)) : null
    const receiptRatio = contractAmount !== null && Number(contractAmount) > 0 && cumulativeReceipt !== null ? (Number(cumulativeReceipt) / Number(contractAmount)).toFixed(6) : null
    const { id, dataOrigin, draft, version, attachments, createdAt, updatedAt, createdBy, updatedBy } = record
    const hasRestrictedRelation = [project, customer, contract].some(reference => reference.state === 'forbidden')
    const visibleDraft = { ...draft, projectId: project.state === 'forbidden' ? null : draft.projectId, customerId: customer.state === 'forbidden' ? null : draft.customerId, contractId: contract.state === 'forbidden' ? null : draft.contractId }
    const capabilities = record.dataOrigin === 'demo' || hasRestrictedRelation ? session.capabilities.filter(cap => cap !== 'receipt:write') : [...session.capabilities]
    return withReadMeta({
      record: structuredClone({ id, dataOrigin, draft: visibleDraft, version, attachments: attachments.map(file => ({ ...file, filePath: '' })), createdAt, updatedAt, createdBy, updatedBy }),
      category: null,
      receiptType: null,
      project,
      customer,
      contract,
      amounts: { contractOriginal: contractAmount, contractChange: null, contract: contractAmount, cumulativeReceipt, cumulativeReceiptExcludingCurrent: contract.state === 'resolved' ? effectiveReceiptAmount(all.filter(row => row.dataOrigin === record.dataOrigin && row.draft.contractId === record.draft.contractId && row.id !== record.id)) : null, receiptRatio, invoicedUnreceived: null },
    }, evidence({ ...session, capabilities }, record.dataOrigin, { id: record.id, origin: record.dataOrigin }, 'receipt:detail', asOf, sessionId))
  }
  return {
    facts(session: BusinessSession, sessionId?: string | null) {
      const source = rows({ origin: 'real' }, session, sessionId)
      return { rows: source.records, sourceVersion: source.sourceVersion, capabilities: [...session.capabilities], asOf: options.now?.() ?? new Date().toISOString() }
    },
    context(session: BusinessSession, sessionId?: string | null): ReceiptContext {
      authorize(session)
      return { ...structuredClone(references(session, sessionId)), workspaceId: session.workspaceId, actorId: session.actorId, capabilities: [...session.capabilities] }
    },
    detail(id: string, query: Record<string, unknown>, session: BusinessSession, sessionId?: string | null): ReceiptDetail {
      const source = rows(query, session, sessionId)
      const record = source.records.find(row => row.id === id && row.dataOrigin === (query.origin ?? 'real'))
      if (!record)
        throw receiptProblem('not-found', '收款记录不存在、已删除或来源不匹配')
      return detail(record, source.records, session, sessionId)
    },
    list(query: Record<string, unknown>, session: BusinessSession, sessionId?: string | null): ReceiptPage {
      for (const [filter, capability] of [['projectId', 'project:list:read'], ['customerId', 'customer:list:read'], ['contractId', 'construction-contract:read']] as const) {
        if (query[filter] && !allowed(session, capability))
          throw receiptProblem('forbidden', '无权按该关联筛选收款')
      }
      const source = rows(query, session, sessionId)
      const facts = { real: references(session, sessionId), demo: references(session, sessionId, 'demo') }
      const search = String(query.search ?? '').trim().toLocaleLowerCase('zh-CN')
      const filtered = source.records.filter(row => (!query.projectId || row.draft.projectId === query.projectId)
        && (!query.customerId || row.draft.customerId === query.customerId) && (!query.contractId || row.draft.contractId === query.contractId)
        && (!query.status || financeStatusLabel(row.draft.status) === financeStatusLabel(String(query.status)))
        && (!search || [row.draft.no, row.draft.note, facts[row.dataOrigin].projects.find(item => item.id === row.draft.projectId)?.name, facts[row.dataOrigin].customers.find(item => item.id === row.draft.customerId)?.name].some(text => text?.toLocaleLowerCase('zh-CN').includes(search))))
        .sort((a, b) => b.draft.receiptDate.localeCompare(a.draft.receiptDate) || b.id.localeCompare(a.id))
      const { requestedPage, pageSize } = parsePageQuery(query, () => {
        throw receiptProblem('invalid-query', '收款分页参数无效')
      })
      const pagination = resolvePagination(requestedPage, pageSize, filtered.length)
      const { page } = pagination
      const originSummary = (origin: 'real' | 'demo') => {
        const records = filtered.filter(record => record.dataOrigin === origin)
        return { count: records.length, effectiveAmount: effectiveReceiptAmount(records) }
      }
      const asOf = options.now?.() ?? new Date().toISOString()
      const requested = (origin: DataOriginDTO) => (!query.origin || query.origin === origin) && (origin === 'real' || ((query.includeDemo === true || query.includeDemo === 'true') && allowed(session, 'demo:read')))
      return withOriginReadMeta({
        items: filtered.slice((page - 1) * pageSize, page * pageSize).map(row => detail(row, source.records, session, sessionId, asOf)),
        pagination,
        summary: { origins: { real: originSummary('real'), demo: originSummary('demo') } },
        projectOptions: (['real', 'demo'] as const).filter(origin => (!query.origin || query.origin === origin) && (origin === 'real' || ((query.includeDemo === true || query.includeDemo === 'true') && allowed(session, 'demo:read')))).flatMap(origin => facts[origin].projects.map(({ id, name }) => ({ id, name, dataOrigin: origin }))),
      }, { real: evidence(session, 'real', query, 'receipt:list', asOf, sessionId, requested('real')), demo: evidence(session, 'demo', query, 'receipt:list', asOf, sessionId, requested('demo')) }, query.origin === 'demo' ? 'demo' : 'real')
    },
  }
}
