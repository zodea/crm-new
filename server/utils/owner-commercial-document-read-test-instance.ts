import type { OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import type { ProjectBusinessDocumentJourneys } from '../../app/lib/project/read-contract'
import type { DataOriginDTO, SourceEvidenceDTO } from '../../app/types/read-model'
import { SUBCONTRACT_CHANGE_READ_CAPABILITY } from '../../app/lib/owner-document/central-command-contract'
import {
  buildOwnerCommercialDocumentDetail,
  buildOwnerCommercialDocumentListPage,
  ownerCommercialDocumentProblem,
  OwnerCommercialDocumentRepositoryProblem,
  parseOwnerCommercialDocumentDetailQuery,
  parseOwnerCommercialDocumentListQuery,
} from '../../app/lib/owner-document/central-repository'
import { PROJECT_BUSINESS_DOCUMENT_VIEWS } from '../../app/lib/project/read-contract'
import { resolveBusinessSession } from './business-session'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from './owner-commercial-document-fixtures'
import { createReadMeta, readQueryScope, readSourceVersion, withOriginReadMeta, withReadMeta } from './read-meta'

export type OwnerCommercialDocumentReadTestScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const demoDocuments: OwnerCommercialDocumentSource[] = OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS.map((row, index) => {
  const suffix = `-demo-${index + 1}`
  return {
    ...structuredClone(row),
    dataOrigin: 'demo' as const,
    id: `${row.id}${suffix}`,
    sourceId: `${row.id}${suffix}`,
    no: `DEMO-${row.no}`,
    finalSettlementEvidence: row.finalSettlementEvidence
      ? {
          ...structuredClone(row.finalSettlementEvidence),
          supplements: row.finalSettlementEvidence.supplements == null
            ? null
            : row.finalSettlementEvidence.supplements.map(source => ({ ...source, id: `${source.id}${suffix}` })),
          receipts: row.finalSettlementEvidence.receipts == null
            ? null
            : row.finalSettlementEvidence.receipts.map(source => ({ ...source, id: `${source.id}${suffix}` })),
        }
      : undefined,
  }
})

function problem(code: 'forbidden' | 'unavailable', message: string, retryable = false) {
  return new OwnerCommercialDocumentRepositoryProblem({
    ...ownerCommercialDocumentProblem(code, message, retryable),
    traceId: `owner-document-test-${code}`,
  })
}

function readCapability(kind: string) {
  return kind === 'sub_change' || kind === 'sub_settlement' || kind === 'project_penalty'
    ? SUBCONTRACT_CHANGE_READ_CAPABILITY
    : 'owner-document:read'
}

export function createOwnerCommercialDocumentReadTestInstance(
  resolveCapabilities: (sessionId?: string | null) => readonly string[] = id => demoWorkspaceTestInstance.capabilities(id),
  commandInstance = ownerCommercialDocumentCommandTestInstance,
) {
  const scenarios = new Map<string, OwnerCommercialDocumentReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function context(kind: string, sessionId?: string | null) {
    const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
    if (scenario === 'forbidden')
      throw problem('forbidden', '无甲方商务单据查看权限')
    if (scenario === 'unavailable')
      throw problem('unavailable', '甲方商务单据中央读取服务暂时不可用', true)
    const capabilities = [...resolveCapabilities(sessionId)]
    if (!capabilities.includes(readCapability(kind)))
      throw problem('forbidden', kind === 'sub_settlement' ? '无分包结算查看权限' : kind === 'sub_change' ? '无分包变洽签查看权限' : '无甲方商务单据查看权限')
    const formal = commandInstance.rows(sessionId)
    return {
      documents: scenario === 'empty' ? formal : [...formal, ...demoDocuments],
      capabilities,
      sourceVersion: commandInstance.sourceVersion(sessionId),
    }
  }

  function metadata(data: ReturnType<typeof context>, query: Record<string, unknown>, operation: string, dataOrigin: DataOriginDTO, asOf: string, sessionId?: string | null) {
    const requested = (query.origin === undefined || query.origin === null || query.origin === dataOrigin) && (dataOrigin === 'real' || query.includeDemo === true)
    return createReadMeta({ session: { ...resolveBusinessSession(), capabilities: data.capabilities }, schemaVersion: 'owner-document-read-v2', operation, dataOrigin, asOf, coverage: requested ? 'complete' : 'unknown', scope: { query: readQueryScope(query), testSession: sessionId ?? null }, sources: [{ key: 'owner-documents', state: requested ? 'readable' : 'not-requested', sourceVersion: requested ? readSourceVersion('owner-documents', { documents: data.documents.filter(row => row.dataOrigin === dataOrigin), revision: data.sourceVersion }) : null, asOf: requested ? asOf : null }] })
  }

  function listPage(data: ReturnType<typeof context>, parsed: ReturnType<typeof parseOwnerCommercialDocumentListQuery>, asOf: string, sessionId?: string | null) {
    const query = { ...parsed, includeDemo: parsed.includeDemo && data.capabilities.includes('demo:read') }
    return withOriginReadMeta(buildOwnerCommercialDocumentListPage({ ...data, query, asOf }), {
      real: metadata(data, query, 'owner-document:list', 'real', asOf, sessionId),
      demo: metadata(data, query, 'owner-document:list', 'demo', asOf, sessionId),
    }, query.origin ?? 'real')
  }

  return {
    facts(kind: string, sessionId?: string | null) {
      return { ...context(kind, sessionId), asOf: new Date().toISOString() }
    },
    reset(scenario: OwnerCommercialDocumentReadTestScenario, sessionId?: string | null) {
      if (scenario === 'ready')
        scenarios.delete(keyFor(sessionId))
      else
        scenarios.set(keyFor(sessionId), scenario)
    },
    list(kind: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const parsed = parseOwnerCommercialDocumentListQuery(kind, input)
      return listPage(context(parsed.kind, sessionId), parsed, new Date().toISOString(), sessionId)
    },
    projectJourneys(projectId: string, asOf: string, sessionId?: string | null): { journeys: ProjectBusinessDocumentJourneys, source: SourceEvidenceDTO } {
      const journeys: ProjectBusinessDocumentJourneys = { pages: {}, issues: [] }
      const unavailable = (state: 'forbidden' | 'unavailable', message: string) => {
        journeys.issues.push(message)
        return { journeys, source: { key: 'owner-documents', state, sourceVersion: null, asOf: null } }
      }
      const capabilities = resolveCapabilities(sessionId)
      const firstKind = capabilities.includes('owner-document:read')
        ? 'owner_change'
        : capabilities.includes(SUBCONTRACT_CHANGE_READ_CAPABILITY) ? 'sub_change' : null
      if (!firstKind)
        return unavailable('forbidden', '当前身份无项目商务单据读取权限')
      let data: ReturnType<typeof context>
      try {
        data = context(firstKind, sessionId)
      }
      catch (cause) {
        if (cause instanceof OwnerCommercialDocumentRepositoryProblem)
          return unavailable(cause.problem.code === 'forbidden' ? 'forbidden' : 'unavailable', cause.problem.message)
        throw cause
      }
      for (const key of Object.keys(PROJECT_BUSINESS_DOCUMENT_VIEWS) as Array<keyof typeof PROJECT_BUSINESS_DOCUMENT_VIEWS>) {
        const [kind, variant] = PROJECT_BUSINESS_DOCUMENT_VIEWS[key]
        if (!data.capabilities.includes(readCapability(kind))) {
          journeys.issues.push(`${key}：无读取权限`)
          continue
        }
        const query = parseOwnerCommercialDocumentListQuery(kind, { projectId, origin: 'real', page: 1, pageSize: 10, ...(variant ? { variant } : {}) })
        journeys.pages[key] = listPage(data, query, asOf, sessionId)
      }
      return { journeys, source: { key: 'owner-documents', state: 'readable', sourceVersion: readSourceVersion('owner-documents', { projectId, revision: data.sourceVersion, documents: data.documents.filter(row => row.dataOrigin === 'real' && row.projectId === projectId) }), asOf } }
    },
    detail(kind: string, id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const parsed = parseOwnerCommercialDocumentDetailQuery(kind, id, input)
      const data = context(parsed.kind, sessionId)
      const query = { ...parsed, includeDemo: parsed.includeDemo && data.capabilities.includes('demo:read') }
      const asOf = new Date().toISOString()
      return withReadMeta(buildOwnerCommercialDocumentDetail({
        ...data,
        query,
        asOf,
      }), metadata(data, query, 'owner-document:detail', query.origin, asOf, sessionId))
    },
  }
}

export const ownerCommercialDocumentReadTestInstance
  = createOwnerCommercialDocumentReadTestInstance()
