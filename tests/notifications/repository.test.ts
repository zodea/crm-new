import { expect, it, vi } from 'vitest'
import { createNotificationRepository } from '../../app/lib/notifications/repository'
import { withNotificationFixtureMeta } from '../helpers/notification-read-meta'

const eventId = `credential-warning-${'a'.repeat(64)}`
const timestamp = '2026-10-04T00:00:00.000Z'
const target = { state: 'resolved', intent: { kind: 'entity-subview', subject: { state: 'resolved', entity: 'supplier', id: 'supplier-original', label: '合成分供方', no: null }, variant: 'credentials', view: null, filters: { dataOrigin: 'real' } } }
const item = { eventId, eventType: 'supplier-credential-expiry', kind: 'notice', title: '到期资料', summary: '合成分供方', occurredAt: timestamp, readAt: null, target, problem: { id: 'problem-original', state: 'active', severity: 'expiring', firstSeenAt: timestamp, lastSeenAt: timestamp, resolvedAt: null, expiresAt: '2026-10-11' } }
const page = withNotificationFixtureMeta({ dataOrigin: 'real', workspaceId: 'workspace-original', actorId: 'actor-original', sourceVersion: 'notifications-original', asOf: timestamp, businessDate: '2026-10-04', evaluationState: 'ready', unreadCount: 1, pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 }, items: [item] })

it('严格解码真实通知，合法越界请求带请求页和实际页，已读不解除问题', async () => {
  const fetcher = vi.fn().mockResolvedValue(page)
  const repository = createNotificationRepository(fetcher)
  await expect(repository.list()).resolves.toEqual(page)
  expect(fetcher).toHaveBeenCalledWith('/api/read/notifications', { query: { page: 1, pageSize: 100 }, signal: undefined })
  const clamped = { ...page, pagination: { ...page.pagination, requestedPage: 99 } }
  fetcher.mockResolvedValue(clamped)
  await expect(repository.list(99)).resolves.toEqual(clamped)
  const read = { ...page, unreadCount: 0, items: [{ ...item, readAt: timestamp }] }
  fetcher.mockResolvedValue(read)
  await expect(repository.list()).resolves.toMatchObject({ unreadCount: 0, items: [{ problem: { state: 'active' } }] })
})

it.each([
  { ...page, workspaceId: '' },
  { ...page, meta: { ...page.meta, actorId: 'another-actor' } },
  { ...page, meta: { ...page.meta, schemaVersion: 'retired-notification-schema' } },
  { ...page, capabilities: [...page.capabilities, 'supplier:write'] },
  { ...page, meta: { ...page.meta, authorizedScope: { ...page.meta.authorizedScope, coverage: 'unknown' } } },
  { ...page, sourceVersion: null, meta: { ...page.meta, sourceVersion: null, sources: page.meta.sources.map(source => ({ ...source, state: 'forbidden', sourceVersion: null, asOf: null })) } },
  { ...page, businessDate: '2026-02-30' },
  { ...page, asOf: 'October 4, 2026' },
  { ...page, unreadCount: 0 },
  { ...page, unreadCount: 2 },
  { ...page, pagination: { ...page.pagination, total: 0 } },
  { ...page, pagination: { ...page.pagination, requestedPage: 2 } },
  { ...page, items: [{ ...item, problem: { ...item.problem, firstSeenAt: '2026-10-05T00:00:00.000Z' } }] },
  { ...page, items: [{ ...item, target: { state: 'forbidden', id: 'restricted-supplier' } }] },
  { ...page, items: [{ ...item, target: { ...target, intent: { ...target.intent, filters: { dataOrigin: 'demo' } } } }] },
  { ...page, items: [{ ...item, payloadBase64: 'private-original' }] },
].map(value => ({ value })))('错误来源、分页、计数、历史及敏感扩展不得进入可信通知：%#', async ({ value }) => {
  await expect(createNotificationRepository(async () => value).list()).rejects.toThrow(/不完整|不一致/)
})

it('原已读回执必须匹配commandId/eventId，不能泄露受限目标或以不合法时间冒充结果', async () => {
  const command = { commandId: 'open-original', workspaceId: page.workspaceId, actorId: page.actorId, action: 'open' as const, eventId }
  const receipt = { commandId: command.commandId, eventId, eventIds: [eventId], readAt: timestamp, target }
  const fetcher = vi.fn().mockResolvedValue(receipt)
  const repository = createNotificationRepository(fetcher)
  await expect(repository.execute(command)).resolves.toEqual(receipt)
  for (const invalid of [{ ...receipt, commandId: 'another-command' }, { ...receipt, eventId: `credential-warning-${'b'.repeat(64)}` }, { ...receipt, readAt: 'October 4, 2026' }, { ...receipt, target: { state: 'forbidden', id: 'restricted' } }, { ...receipt, eventIds: [] }, { ...receipt, eventIds: [eventId, eventId] }, { ...receipt, eventIds: [`credential-warning-${'b'.repeat(64)}`] }, { ...receipt, eventIds: ['supplier-private'] }]) {
    fetcher.mockResolvedValue(invalid)
    await expect(repository.execute(command)).rejects.toThrow(/不完整|不一致/)
  }
})
