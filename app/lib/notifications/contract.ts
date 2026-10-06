import type { NavigationIntentDTO, ReadMetaDTO } from '../../types/read-model'
import { isISODateTimeDTO } from '../../types/read-model'

export type NotificationTarget = { state: 'resolved', intent: NavigationIntentDTO } | { state: 'forbidden' | 'missing' }
export const NOTIFICATION_READ_SCHEMA = 'notifications.v1'
export interface CredentialNotification {
  eventId: string
  eventType: 'supplier-credential-expiry'
  kind: 'notice'
  title: string
  summary: string
  occurredAt: string
  readAt: string | null
  target: NotificationTarget
  problem: {
    id: string
    state: 'active' | 'resolved'
    severity: 'expiring' | 'expired'
    firstSeenAt: string
    lastSeenAt: string
    resolvedAt: string | null
    expiresAt: string
  }
}
export interface NotificationPage {
  meta: ReadMetaDTO
  capabilities: string[]
  dataOrigin: 'real'
  workspaceId: string
  actorId: string
  sourceVersion: string | null
  asOf: string
  businessDate: string
  evaluationState: 'ready' | 'unavailable'
  items: CredentialNotification[]
  unreadCount: number
  pagination: { requestedPage: number, page: number, pageSize: number, total: number }
}
export interface NotificationCommand {
  commandId: string
  workspaceId: string
  actorId: string
  action: 'open' | 'mark-all-read'
  eventId: string | null
}
export interface NotificationCommandResult {
  commandId: string
  eventId: string | null
  eventIds: string[]
  readAt: string
  target: NotificationTarget | null
}

/** 领域owner保存的原已读结果；eventIds只描述当次采用集合。 */
export interface NotificationStoredReceipt {
  commandId: string
  eventId: string | null
  readAt: string
  eventIds: string[]
}
export const isNotificationEventId = (value: unknown): value is string => typeof value === 'string' && /^credential-warning-[a-f0-9]{64}$/.test(value)
export function isNotificationStoredReceipt(value: unknown): value is NotificationStoredReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const row = value as Record<string, unknown>
  return Object.keys(row).sort().join(',') === 'commandId,eventId,eventIds,readAt'
    && typeof row.commandId === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(row.commandId)
    && (row.eventId === null || isNotificationEventId(row.eventId)) && isISODateTimeDTO(row.readAt)
    && Array.isArray(row.eventIds) && row.eventIds.every(isNotificationEventId) && new Set(row.eventIds).size === row.eventIds.length
    && (row.eventId === null || (row.eventIds.length === 1 && row.eventIds[0] === row.eventId))
}
