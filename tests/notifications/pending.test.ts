// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearNotificationPending, LEGACY_NOTIFICATION_PENDING_KEY, notificationPendingKey, readNotificationPending, rememberNotificationPending } from '../../app/lib/notifications/pending'

const original = { workspaceId: 'workspace-a', actorId: 'actor-a', commandId: 'original-open-command', action: 'open' as const, eventId: `credential-warning-${'a'.repeat(64)}` }
beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

it('按工作区与操作者独立保留原命令，清 A 不影响 B，最小记录不含正文', () => {
  const other = { ...original, actorId: 'actor-b', commandId: 'other-open-command' }
  rememberNotificationPending(original)
  rememberNotificationPending(other)
  expect(readNotificationPending(original)).toEqual(original)
  expect(readNotificationPending(other)).toEqual(other)
  expect(Object.keys(JSON.parse(sessionStorage.getItem(notificationPendingKey(original))!)).sort()).toEqual(['action', 'actorId', 'commandId', 'eventId', 'workspaceId'])
  clearNotificationPending(original)
  expect(readNotificationPending(original)).toBeNull()
  expect(readNotificationPending(other)).toEqual(other)
})

it('旧单键只在所属身份可靠复制后退役，其他身份读取保留原文', () => {
  const raw = JSON.stringify(original)
  sessionStorage.setItem(LEGACY_NOTIFICATION_PENDING_KEY, raw)
  expect(readNotificationPending({ ...original, actorId: 'actor-b' })).toBeNull()
  expect(sessionStorage.getItem(LEGACY_NOTIFICATION_PENDING_KEY)).toBe(raw)
  expect(readNotificationPending(original)).toEqual(original)
  expect(sessionStorage.getItem(notificationPendingKey(original))).toBe(raw)
  expect(sessionStorage.getItem(LEGACY_NOTIFICATION_PENDING_KEY)).toBeNull()
})

it.each(['legacy', 'scoped'] as const)('损坏 %s 原记录不能默认为没有提交，也不能擦除', (kind) => {
  const key = kind === 'legacy' ? LEGACY_NOTIFICATION_PENDING_KEY : notificationPendingKey(original)
  sessionStorage.setItem(key, '{uninterpretable-original')
  expect(() => rememberNotificationPending(original)).toThrow('原消息操作编号')
  expect(sessionStorage.getItem(key)).toBe('{uninterpretable-original')
})

it('有两个不同原编号时保留两份依据，不用任意一份覆盖另一份', () => {
  const other = { ...original, commandId: 'different-original' }
  sessionStorage.setItem(notificationPendingKey(original), JSON.stringify(original))
  sessionStorage.setItem(LEGACY_NOTIFICATION_PENDING_KEY, JSON.stringify(other))
  expect(() => readNotificationPending(original)).toThrow('两个不同')
  expect(sessionStorage.getItem(notificationPendingKey(original))).toBe(JSON.stringify(original))
  expect(sessionStorage.getItem(LEGACY_NOTIFICATION_PENDING_KEY)).toBe(JSON.stringify(other))
})

it('保存后核验真实存储，未写入和配额失败均停止', () => {
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
  expect(() => rememberNotificationPending(original)).toThrow('无法可靠保留')
  set.mockImplementation(() => {
    throw new Error('quota')
  })
  expect(() => rememberNotificationPending(original)).toThrow('无法可靠保留')
})

it('合法原编号也不能替换动作、事件、归属或正文扩展', () => {
  rememberNotificationPending(original)
  expect(() => rememberNotificationPending({ ...original, action: 'mark-all-read', eventId: null })).toThrow('不能替换')
  const key = notificationPendingKey(original)
  sessionStorage.setItem(key, JSON.stringify({ ...original, secret: 'private-title' }))
  expect(() => readNotificationPending(original)).toThrow('无法可靠保留')
  expect(sessionStorage.getItem(key)).toContain('private-title')
})
