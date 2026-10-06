import { NOTIFICATION_READ_SCHEMA } from '../../app/lib/notifications/contract'
import { createReadMeta, withReadMeta } from '../../server/utils/read-meta'

export function withNotificationFixtureMeta<T extends { workspaceId: string, actorId: string, asOf: string, sourceVersion: string | null }>(page: T) {
  return withReadMeta(page, createReadMeta({ session: { workspaceId: page.workspaceId, actorId: page.actorId, capabilities: ['supplier-credential:read'] }, schemaVersion: NOTIFICATION_READ_SCHEMA, operation: 'notification-fixture-read', dataOrigin: 'real', asOf: page.asOf, sources: [{ key: 'notification-ledger', state: 'readable', sourceVersion: page.sourceVersion, asOf: page.asOf }], coverage: 'complete', scope: { actorId: page.actorId } }))
}
