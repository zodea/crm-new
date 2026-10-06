import type { DataOriginDTO, SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { readSourceVersion } from './read-meta'

export async function receiptConstructionEvidence(session: BusinessSession, sessionId?: string | null) {
  const unavailable = (state: 'forbidden' | 'unavailable'): SourceEvidenceDTO => ({ key: 'construction-aggregate', state, sourceVersion: null, asOf: null })
  if (!session.capabilities.includes('construction-contract:read'))
    return { real: unavailable('forbidden'), demo: unavailable('forbidden') }
  try {
    const { constructionContractReadTestInstance } = await import('./construction-contract-read-test-instance')
    const { asOf, capabilities: _capabilities, ...snapshot } = constructionContractReadTestInstance.facts(sessionId)
    const source = (origin: DataOriginDTO): SourceEvidenceDTO => ({
      key: 'construction-aggregate',
      state: 'readable',
      asOf,
      sourceVersion: readSourceVersion('construction-aggregate', Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, Array.isArray(value) ? value.filter(row => typeof row === 'object' && row !== null && 'dataOrigin' in row && row.dataOrigin === origin) : value]))),
    })
    return { real: source('real'), demo: source('demo') }
  }
  catch (cause) {
    const code = (cause as { problem?: { code?: string } })?.problem?.code
    const state = code === 'forbidden' || code === 'unauthenticated' ? 'forbidden' : 'unavailable'
    return { real: unavailable(state), demo: unavailable(state) }
  }
}

export function sameConstructionEvidence(left: SourceEvidenceDTO, right: SourceEvidenceDTO) {
  return left.state === right.state && left.sourceVersion === right.sourceVersion
}
