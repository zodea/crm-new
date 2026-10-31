import type { BusinessSession } from '../../server/utils/business-session'
import { createReadMeta, readQueryScope, withOriginReadMeta } from '../../server/utils/read-meta'

/** 仅为浏览器交互提供合成读取证据，不代表正式来源已接入。 */
export function withSyntheticOwnerRead<T extends object>(result: T, session: BusinessSession, query: object, asOf: string) {
  const meta = (origin: 'real' | 'demo') => createReadMeta({
    session,
    schemaVersion: 'owner-document-read-v2',
    operation: 'owner-document:synthetic-list',
    dataOrigin: origin,
    asOf,
    coverage: origin === 'real' ? 'complete' : 'unknown',
    scope: readQueryScope(query),
    sources: [{ key: 'owner-documents', state: origin === 'real' ? 'readable' : 'not-requested', sourceVersion: origin === 'real' ? 'synthetic-owner-documents' : null, asOf: origin === 'real' ? asOf : null }],
  })
  return withOriginReadMeta(result, { real: meta('real'), demo: meta('demo') })
}
