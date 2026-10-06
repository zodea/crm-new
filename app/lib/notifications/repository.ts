import type { NotificationCommand, NotificationCommandResult, NotificationPage, NotificationTarget } from './contract'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { hasConsistentReadMeta } from '../read-model/meta'
import { isNotificationEventId, NOTIFICATION_READ_SCHEMA } from './contract'

type Fetcher = (url: string, options?: { method?: 'POST', body?: NotificationCommand, query?: Record<string, unknown>, signal?: AbortSignal }) => Promise<unknown>
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function timestamp(value: unknown): value is string {
  return isISODateTimeDTO(value)
}
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).sort().join(',') === [...expected].sort().join(',')
const identity = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
function invalid(): never {
  throw new Error('消息服务响应不完整或来源身份不一致，请重新读取')
}
function target(value: unknown): value is NotificationTarget {
  if (!object(value))
    return false
  if (value.state === 'forbidden' || value.state === 'missing')
    return Object.keys(value).length === 1
  if (value.state !== 'resolved' || !keys(value, ['state', 'intent']) || !object(value.intent))
    return false
  const intent = value.intent
  return keys(intent, ['kind', 'subject', 'view', 'variant', 'filters']) && intent.kind === 'entity-subview'
    && object(intent.subject) && keys(intent.subject, ['state', 'entity', 'id', 'label', 'no']) && intent.subject.state === 'resolved' && intent.subject.entity === 'supplier'
    && identity(intent.subject.id) && identity(intent.subject.label) && intent.subject.no === null
    && intent.view === null && intent.variant === 'credentials' && object(intent.filters) && keys(intent.filters, ['dataOrigin']) && intent.filters.dataOrigin === 'real'
}
export function createNotificationRepository(fetcher: Fetcher) {
  return {
    async list(page = 1, signal?: AbortSignal): Promise<NotificationPage> {
      signal?.throwIfAborted()
      const value = await fetcher('/api/read/notifications', { query: { page, pageSize: 100 }, signal })
      signal?.throwIfAborted()
      if (!object(value) || !hasConsistentReadMeta(value, NOTIFICATION_READ_SCHEMA, 'real') || !keys(value, ['meta', 'capabilities', 'dataOrigin', 'workspaceId', 'actorId', 'sourceVersion', 'businessDate', 'asOf', 'evaluationState', 'items', 'unreadCount', 'pagination']) || value.dataOrigin !== 'real' || !['workspaceId', 'actorId'].every(key => identity(value[key])) || !object(value.meta) || value.meta.workspaceId !== value.workspaceId || value.meta.actorId !== value.actorId || !isISODateDTO(value.businessDate)
        || !timestamp(value.asOf) || !['ready', 'unavailable'].includes(String(value.evaluationState)) || !Array.isArray(value.items)
        || !Number.isSafeInteger(value.unreadCount) || (value.unreadCount as number) < 0 || !object(value.pagination)
        || !keys(value.pagination, ['requestedPage', 'page', 'pageSize', 'total']) || !['requestedPage', 'page', 'pageSize', 'total'].every(key => Number.isSafeInteger((value.pagination as Record<string, unknown>)[key]) && Number((value.pagination as Record<string, unknown>)[key]) >= (key === 'total' ? 0 : 1))
        || value.pagination.requestedPage !== page || value.pagination.pageSize !== 100
        || value.pagination.page !== Math.min(page, Math.max(1, Math.ceil(Number(value.pagination.total) / 100)))
        || value.items.length !== Math.min(100, Math.max(0, Number(value.pagination.total) - (Number(value.pagination.page) - 1) * 100))
        || Number(value.unreadCount) > Number(value.pagination.total)) {
        invalid()
      }
      const ids = new Set<string>()
      const meta = (value as unknown as NotificationPage).meta
      if ((!meta.sources.some(source => source.state === 'readable') && (value.items.length > 0 || value.unreadCount !== 0 || value.pagination.total !== 0))
        || (value.evaluationState === 'ready' && meta.sources.some(source => source.state === 'readable') && meta.authorizedScope.coverage === 'unknown')) {
        invalid()
      }
      for (const item of value.items as unknown[]) {
        if (!object(item) || !keys(item, ['eventId', 'eventType', 'kind', 'title', 'summary', 'occurredAt', 'readAt', 'target', 'problem']) || !isNotificationEventId(item.eventId) || ids.has(item.eventId) || item.eventType !== 'supplier-credential-expiry' || item.kind !== 'notice'
          || typeof item.title !== 'string' || typeof item.summary !== 'string' || !timestamp(item.occurredAt)
          || !(item.readAt === null || timestamp(item.readAt)) || !target(item.target) || !object(item.problem)
          || !keys(item.problem, ['id', 'state', 'severity', 'firstSeenAt', 'lastSeenAt', 'resolvedAt', 'expiresAt']) || !identity(item.problem.id) || !['active', 'resolved'].includes(String(item.problem.state))
          || !['expiring', 'expired'].includes(String(item.problem.severity)) || !timestamp(item.problem.firstSeenAt) || !timestamp(item.problem.lastSeenAt)
          || !(item.problem.resolvedAt === null || timestamp(item.problem.resolvedAt)) || !isISODateDTO(item.problem.expiresAt)
          || item.occurredAt !== item.problem.firstSeenAt || Date.parse(item.problem.lastSeenAt as string) < Date.parse(item.problem.firstSeenAt as string)
          || (item.readAt !== null && Date.parse(item.readAt as string) < Date.parse(item.occurredAt as string))
          || (item.problem.resolvedAt !== null && Date.parse(item.problem.resolvedAt as string) < Date.parse(item.problem.firstSeenAt as string))
          || (item.problem.state === 'active' && item.problem.resolvedAt !== null)) {
          invalid()
        }
        ids.add(item.eventId)
      }
      const unread = value.items.filter(item => (item as Record<string, unknown>).readAt === null).length
      if (Number(value.unreadCount) < unread || Number(value.unreadCount) > Number(value.pagination.total) - (value.items.length - unread))
        invalid()
      return structuredClone(value) as unknown as NotificationPage
    },
    async execute(command: NotificationCommand): Promise<NotificationCommandResult> {
      const value = await fetcher('/api/commands/notifications', { method: 'POST', body: command })
      if (!object(value) || !keys(value, ['commandId', 'eventId', 'eventIds', 'readAt', 'target']) || value.commandId !== command.commandId || value.eventId !== command.eventId || !timestamp(value.readAt)
        || !Array.isArray(value.eventIds) || !value.eventIds.every(isNotificationEventId) || new Set(value.eventIds).size !== value.eventIds.length
        || (command.action === 'open' && (value.eventIds.length !== 1 || value.eventIds[0] !== command.eventId))
        || (command.action === 'open' ? !target(value.target) : value.target !== null)) {
        invalid()
      }
      return structuredClone(value) as unknown as NotificationCommandResult
    },
  }
}
