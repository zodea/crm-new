import type { OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import { SUBCONTRACT_CHANGE_READ_CAPABILITY } from '../../app/lib/owner-document/central-command-contract'
import {
  buildOwnerCommercialDocumentDetail,
  buildOwnerCommercialDocumentListPage,
  ownerCommercialDocumentProblem,
  OwnerCommercialDocumentRepositoryProblem,
  parseOwnerCommercialDocumentDetailQuery,
  parseOwnerCommercialDocumentListQuery,
} from '../../app/lib/owner-document/central-repository'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from './owner-commercial-document-fixtures'

export type OwnerCommercialDocumentReadTestScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-25T00:00:00.000Z'
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
    const requiredCapability = (kind === 'sub_change' || kind === 'sub_settlement' || kind === 'project_penalty') ? SUBCONTRACT_CHANGE_READ_CAPABILITY : 'owner-document:read'
    if (!capabilities.includes(requiredCapability))
      throw problem('forbidden', kind === 'sub_settlement' ? '无分包结算查看权限' : kind === 'sub_change' ? '无分包变洽签查看权限' : '无甲方商务单据查看权限')
    const formal = commandInstance.rows(sessionId)
    return {
      documents: scenario === 'empty' ? formal : [...formal, ...demoDocuments],
      capabilities,
      sourceVersion: commandInstance.sourceVersion(sessionId),
    }
  }

  return {
    reset(scenario: OwnerCommercialDocumentReadTestScenario, sessionId?: string | null) {
      if (scenario === 'ready')
        scenarios.delete(keyFor(sessionId))
      else
        scenarios.set(keyFor(sessionId), scenario)
    },
    list(kind: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const parsed = parseOwnerCommercialDocumentListQuery(kind, input)
      const data = context(parsed.kind, sessionId)
      return buildOwnerCommercialDocumentListPage({
        ...data,
        query: { ...parsed, includeDemo: parsed.includeDemo && data.capabilities.includes('demo:read') },
        asOf: FIXED_AS_OF,
      })
    },
    detail(kind: string, id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const parsed = parseOwnerCommercialDocumentDetailQuery(kind, id, input)
      const data = context(parsed.kind, sessionId)
      return buildOwnerCommercialDocumentDetail({
        ...data,
        query: { ...parsed, includeDemo: parsed.includeDemo && data.capabilities.includes('demo:read') },
        asOf: FIXED_AS_OF,
      })
    },
  }
}

export const ownerCommercialDocumentReadTestInstance
  = createOwnerCommercialDocumentReadTestInstance()
