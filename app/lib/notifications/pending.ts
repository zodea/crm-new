import type { NotificationCommand } from './contract'
import { isNotificationEventId } from './contract'

type Scope = Pick<NotificationCommand, 'workspaceId' | 'actorId'>
export const LEGACY_NOTIFICATION_PENDING_KEY = 'ruihang-notification-pending'
export const notificationPendingKey = (scope: Scope) => `crm:notification-command:v1:${encodeURIComponent(scope.workspaceId)}:${encodeURIComponent(scope.actorId)}`
const sameScope = (left: Scope, right: Scope) => left.workspaceId === right.workspaceId && left.actorId === right.actorId
const sameCommand = (left: NotificationCommand, right: NotificationCommand) => left.commandId === right.commandId && sameScope(left, right) && left.action === right.action && left.eventId === right.eventId
function unavailable(): never {
  throw new Error('无法可靠保留原消息操作编号，请恢复浏览器存储后核对原操作。')
}
function decode(raw: string): NotificationCommand {
  let value: unknown
  try {
    value = JSON.parse(raw)
  }
  catch { return unavailable() }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return unavailable()
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'action,actorId,commandId,eventId,workspaceId'
    || typeof row.commandId !== 'string' || !/^[a-z0-9][\w-]{2,79}$/i.test(row.commandId)
    || typeof row.workspaceId !== 'string' || !row.workspaceId.trim() || typeof row.actorId !== 'string' || !row.actorId.trim()
    || !((row.action === 'open' && isNotificationEventId(row.eventId)) || (row.action === 'mark-all-read' && row.eventId === null))) {
    return unavailable()
  }
  return row as unknown as NotificationCommand
}
function read(key: string) {
  try {
    return window.sessionStorage.getItem(key)
  }
  catch { return unavailable() }
}
function write(key: string, value: NotificationCommand) {
  try {
    const raw = JSON.stringify(value)
    window.sessionStorage.setItem(key, raw)
    if (read(key) !== raw)
      unavailable()
  }
  catch { unavailable() }
}
function remove(key: string) {
  try {
    window.sessionStorage.removeItem(key)
    if (read(key) !== null)
      unavailable()
  }
  catch { unavailable() }
}

/** Only the original five-field command is retained. Another actor's descriptor remains in its own scope. */
export function readNotificationPending(scope: Scope): NotificationCommand | null {
  const key = notificationPendingKey(scope)
  const raw = read(key)
  let command = raw === null ? null : decode(raw)
  if (command && !sameScope(command, scope))
    unavailable()
  const legacyRaw = read(LEGACY_NOTIFICATION_PENDING_KEY)
  if (legacyRaw !== null && legacyRaw !== 'null') {
    const legacy = decode(legacyRaw)
    if (sameScope(legacy, scope)) {
      if (command && !sameCommand(command, legacy))
        throw new Error('发现两个不同的原消息编号，请保留原记录并核对。')
      if (!command) {
        write(key, legacy)
        command = legacy
      }
      // Verify the legacy descriptor again before retiring the reliably copied original.
      if (read(LEGACY_NOTIFICATION_PENDING_KEY) !== legacyRaw)
        unavailable()
      remove(LEGACY_NOTIFICATION_PENDING_KEY)
    }
  }
  return command ? structuredClone(command) : null
}
export function rememberNotificationPending(command: NotificationCommand) {
  decode(JSON.stringify(command))
  const existing = readNotificationPending(command)
  if (existing && !sameCommand(existing, command))
    throw new Error('请先恢复原消息操作，不能替换尚未确认的编号。')
  if (!existing)
    write(notificationPendingKey(command), command)
  verifyNotificationPending(command)
}
export function verifyNotificationPending(command: NotificationCommand) {
  const existing = readNotificationPending(command)
  if (!existing || !sameCommand(existing, command))
    throw new Error('原消息操作编号已变化，请保留原记录并重新核对。')
}
export function clearNotificationPending(command: NotificationCommand) {
  verifyNotificationPending(command)
  remove(notificationPendingKey(command))
}
