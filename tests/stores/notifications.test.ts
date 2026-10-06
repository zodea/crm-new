// @vitest-environment jsdom

import type { NotificationPage } from '~/lib/notifications/contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { notificationPendingKey } from '~/lib/notifications/pending'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useNotificationStore } from '~/stores/notifications'
import { withNotificationFixtureMeta } from '../helpers/notification-read-meta'

describe('通知中心', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  async function enableDemo() {
    const visibility = useDataVisibilityStore()
    await visibility.initialize()
    await visibility.authorizeDemo(async () => true)
    visibility.commitPreference(true)
  }

  it('正式模式不暴露演示通知和角标', () => {
    const store = useNotificationStore()
    expect(store.items).toEqual([])
    expect(store.unreadCount).toBe(0)
  })

  it('显式包含测试数据后才显示示例通知并计算未读数', async () => {
    await enableDemo()
    const store = useNotificationStore()
    expect(store.items.length).toBeGreaterThan(0)
    expect(store.unreadCount).toBe(store.items.filter(item => !item.read).length)
  })

  it('支持单条已读和全部已读', async () => {
    await enableDemo()
    const store = useNotificationStore()
    const firstUnread = store.items.find(item => !item.read)!

    store.markRead(firstUnread.id)
    expect(store.items.find(item => item.id === firstUnread.id)?.read).toBe(true)

    store.markAllRead()
    expect(store.unreadCount).toBe(0)
  })

  it('点击条目会标记已读并返回真实路由', async () => {
    await enableDemo()
    const store = useNotificationStore()
    const target = store.items.find(item => !item.read)!

    expect(store.openItem(target.id)).toBe(target.route)
    expect(store.items.find(item => item.id === target.id)?.read).toBe(true)
  })

  it('删除只影响指定条目', async () => {
    await enableDemo()
    const store = useNotificationStore()
    const [target] = store.items
    const before = store.items.length

    store.remove(target!.id)

    expect(store.items).toHaveLength(before - 1)
    expect(store.items.some(item => item.id === target!.id)).toBe(false)
  })

  const eventId = `credential-warning-${'a'.repeat(64)}`
  function formalPage(overrides: Partial<NotificationPage> = {}): NotificationPage {
    const timestamp = '2026-10-04T00:00:00.000Z'
    return withNotificationFixtureMeta({ dataOrigin: 'real' as const, workspaceId: 'workspace-a', actorId: 'actor-a', sourceVersion: 'n1', asOf: timestamp, businessDate: '2026-10-04', evaluationState: 'ready' as const, unreadCount: 1, pagination: { requestedPage: 1, page: 1, pageSize: 100, total: 1 }, items: [{ eventId, eventType: 'supplier-credential-expiry' as const, kind: 'notice' as const, title: '合成证照即将到期', summary: '合成分供方 · 7天内', occurredAt: timestamp, readAt: null, target: { state: 'resolved' as const, intent: { kind: 'entity-subview' as const, subject: { state: 'resolved' as const, entity: 'supplier' as const, id: 'supplier-a', label: '合成分供方', no: null }, variant: 'credentials', view: null, filters: { dataOrigin: 'real' } } }, problem: { id: 'problem-a', state: 'active' as const, severity: 'expiring' as const, firstSeenAt: timestamp, lastSeenAt: timestamp, expiresAt: '2026-10-11', resolvedAt: null } }], ...overrides })
  }

  it('正式已读先持久提交并回读；已读和删除都不能解除持续问题', async () => {
    const current = formalPage()
    const list = vi.fn(async () => structuredClone(current))
    const execute = vi.fn(async (command) => {
      current.items[0]!.readAt = current.asOf
      current.unreadCount = 0
      return { commandId: command.commandId, eventId: command.eventId, eventIds: [eventId], readAt: current.asOf, target: current.items[0]!.target }
    })
    const store = useNotificationStore()
    await store.initialize({ list, execute })
    expect(await store.openItem(eventId)).toBe('/base/supplier/credential/supplier-a?origin=real')
    expect(store.items[0]).toMatchObject({ read: true, problem: { state: 'active' } })
    expect(store.unreadCount).toBe(0)
    store.remove(eventId)
    expect(store.items).toHaveLength(1)
  })

  it('持久事件只扇出一次系统提示；关闭仅记录本地呈现，冷刷新不重弹且不已读或解除问题', async () => {
    const current = formalPage()
    const presenter = vi.fn()
    const execute = vi.fn()
    const adapter = { list: vi.fn(async () => structuredClone(current)), execute }
    const store = useNotificationStore()
    await store.initialize(adapter, presenter)
    await store.refresh()
    expect(presenter).toHaveBeenCalledTimes(1)
    expect(presenter).toHaveBeenCalledWith(current.items[0])
    store.dismissPresentation(eventId)
    expect(store.unreadCount).toBe(1)
    expect(store.items[0]).toMatchObject({ read: false, problem: { state: 'active' } })
    expect(execute).not.toHaveBeenCalled()
    await nextTick()
    const local = JSON.parse(sessionStorage.getItem('ruihang-notification-presentations')!)
    expect(local[`workspace-a:actor-a:${eventId}`]).toMatchObject({ presentedAt: expect.any(String), presentationDismissedAt: expect.any(String) })
    expect(JSON.stringify(local)).not.toContain('合成分供方')
    setActivePinia(createPinia())
    const restarted = useNotificationStore()
    await restarted.initialize(adapter, presenter)
    expect(presenter).toHaveBeenCalledTimes(1)
    expect(restarted.unreadCount).toBe(1)
  })

  it.each(['permission', 'demo', 'actor', 'read', 'resolved'] as const)('撤回 %s 时清除已呈现的敏感系统提示，清理不写已读', async (reason) => {
    const current = formalPage()
    const cleanup = vi.fn()
    const presenter = vi.fn(() => cleanup)
    const list = vi.fn(async () => structuredClone(current))
    const execute = vi.fn()
    const store = useNotificationStore()
    await store.initialize({ list, execute }, presenter)
    if (reason === 'permission') {
      list.mockRejectedValueOnce(new Error('权限撤销'))
    }
    else if (reason === 'demo') {
      await enableDemo()
    }
    else if (reason === 'actor') {
      current.actorId = 'actor-b'
      Object.assign(current, withNotificationFixtureMeta({ ...current, sourceVersion: 'n1' }))
    }
    else if (reason === 'read') {
      current.items[0]!.readAt = current.asOf
      current.unreadCount = 0
    }
    else {
      current.items[0]!.problem.state = 'resolved'
      current.items[0]!.problem.resolvedAt = current.asOf
    }
    await store.refresh()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
    if (reason === 'permission')
      expect(store.items).toEqual([])
    if (reason === 'actor')
      expect(presenter).toHaveBeenCalledTimes(2)
  })

  it('结果未知保留原操作编号，重复点击不发新命令，刷新后恢复同一编号', async () => {
    const current = formalPage()
    const list = vi.fn(async () => structuredClone(current))
    const execute = vi.fn().mockRejectedValueOnce(new Error('合成响应丢失')).mockImplementation(async (command) => {
      current.items[0]!.readAt = current.asOf
      current.unreadCount = 0
      return { commandId: command.commandId, eventId: command.eventId, eventIds: [eventId], readAt: current.asOf, target: current.items[0]!.target }
    })
    let store = useNotificationStore()
    await store.initialize({ list, execute })
    expect(await store.openItem(eventId)).toBeUndefined()
    const original = execute.mock.calls[0]![0]
    expect(store.items[0]?.read).toBe(false)
    await nextTick()
    setActivePinia(createPinia())
    store = useNotificationStore()
    await store.initialize({ list, execute })
    await store.recoverPending()
    expect(execute.mock.calls[1]![0]).toEqual(original)
    expect(store.pending).toBeNull()
  })

  it('来源切换后的迟到正式消息被丢弃，正式故障不冒充空集或演示消息', async () => {
    let finish!: (value: NotificationPage) => void
    const list = vi.fn(() => new Promise<NotificationPage>((resolve) => {
      finish = resolve
    }))
    const execute = vi.fn()
    const store = useNotificationStore()
    const waiting = store.initialize({ list, execute })
    await enableDemo()
    await store.refresh()
    finish(formalPage())
    await waiting
    expect(store.items.some(item => item.id === eventId)).toBe(false)
    useDataVisibilityStore().reset()
    list.mockRejectedValueOnce(new Error('无资料查看权限'))
    await store.refresh()
    expect(store.items).toEqual([])
    expect(store.error).toBe('无资料查看权限')
    expect(store.unreadCount).toBe(0)
  })

  it('成功回执后读取失败保原编号和原集合，恢复只读不再发送且不用旧目标导航', async () => {
    const current = formalPage()
    const list = vi.fn(async () => structuredClone(current))
    const execute = vi.fn(async (command) => {
      current.items[0]!.readAt = current.asOf
      current.unreadCount = 0
      return { commandId: command.commandId, eventId: command.eventId, eventIds: [eventId], readAt: current.asOf, target: current.items[0]!.target }
    })
    const store = useNotificationStore()
    await store.initialize({ list, execute })
    list.mockRejectedValueOnce(new Error('合成保存后读取失败'))
    expect(await store.openItem(eventId)).toBeUndefined()
    const original = execute.mock.calls[0]![0]
    expect(JSON.parse(sessionStorage.getItem(notificationPendingKey(current))!)).toEqual(original)
    expect(store.pending).toEqual(original)
    expect(store.readState.kind).toBe('unavailable')
    current.items[0]!.target = { state: 'forbidden' }
    expect(await store.recoverPending()).toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(store.pending).toBeNull()
    expect(store.error).toContain('无资料入口权限')
    expect(sessionStorage.getItem(notificationPendingKey(current))).toBeNull()
  })

  it('操作者切换只改变本代恢复显示，回到 A 仍恢复同一原键，B 无权采用 A 操作', async () => {
    const current = formalPage()
    const execute = vi.fn().mockRejectedValueOnce(new Error('合成响应丢失')).mockImplementation(async (command) => {
      current.items[0]!.readAt = current.asOf
      current.unreadCount = 0
      return { commandId: command.commandId, eventId: command.eventId, eventIds: [eventId], readAt: current.asOf, target: current.items[0]!.target }
    })
    const store = useNotificationStore()
    await store.initialize({ list: async () => structuredClone(current), execute })
    await store.openItem(eventId)
    const original = execute.mock.calls[0]![0]
    current.actorId = 'actor-b'
    Object.assign(current, withNotificationFixtureMeta({ ...current, sourceVersion: 'n1' }))
    await store.refresh()
    expect(store.pending).toBeNull()
    expect(await store.recoverPending()).toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(JSON.parse(sessionStorage.getItem(notificationPendingKey(original))!)).toEqual(original)
    current.actorId = 'actor-a'
    Object.assign(current, withNotificationFixtureMeta({ ...current, sourceVersion: 'n1' }))
    await store.refresh()
    expect(store.pending).toEqual(original)
    await store.recoverPending()
    expect(execute.mock.calls[1]![0]).toEqual(original)
    expect(store.pending).toBeNull()
  })

  it.each(['version', 'scope', 'duplicate', 'missing-page'] as const)('完整通知跨页遇到 %s 不采用任何私密页，也不推进已读', async (boundary) => {
    const template = formalPage().items[0]!
    const events = Array.from({ length: 101 }, (_, index) => ({ ...structuredClone(template), eventId: `credential-warning-${(index + 1).toString(16).padStart(64, '0')}` }))
    const first = formalPage({ items: events.slice(0, 100), unreadCount: events.length, pagination: { requestedPage: 1, page: 1, pageSize: 100, total: events.length } })
    const next = formalPage({ items: events.slice(100), unreadCount: events.length, pagination: { requestedPage: 2, page: 2, pageSize: 100, total: events.length } })
    if (boundary === 'version')
      Object.assign(next, withNotificationFixtureMeta({ ...next, sourceVersion: 'n2' }))
    else if (boundary === 'scope')
      next.meta.authorizedScope.fingerprint = 'another-authorized-scope'
    else if (boundary === 'duplicate')
      next.items[0] = events[0]!
    else
      next.pagination = { ...next.pagination, page: 1 }
    const execute = vi.fn()
    const store = useNotificationStore()
    await store.initialize({ list: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next), execute })
    expect(store.items).toEqual([])
    expect(store.readState.kind).toBe('unavailable')
    expect(execute).not.toHaveBeenCalled()
    expect(JSON.stringify(store.$state)).not.toContain('合成分供方')
  })

  it('来源权限已拒绝时清除私密事件和提示，不用可见空集冒充已完整读取', async () => {
    const current = formalPage()
    const cleanup = vi.fn()
    const list = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce({ ...current, items: [], unreadCount: 0, pagination: { ...current.pagination, total: 0 }, sourceVersion: null, meta: { ...current.meta, sourceVersion: null, authorizedScope: { coverage: 'permission-filtered', fingerprint: 'restricted-source' }, sources: [{ key: 'notification-ledger', state: 'forbidden', sourceVersion: null, asOf: null }] } })
    const store = useNotificationStore()
    await store.initialize({ list, execute: vi.fn() }, () => cleanup)
    await store.refresh()
    expect(store.items).toEqual([])
    expect(store.readState).toMatchObject({ kind: 'forbidden', problem: { code: 'forbidden' } })
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('冷恢复全部已读只核原回执集合，后来新增消息仍未读而不阻塞原操作恢复', async () => {
    const current = formalPage()
    let originalResult: Record<string, unknown> | null = null
    const execute = vi.fn(async (command) => {
      if (originalResult)
        return structuredClone(originalResult) as never
      current.items[0]!.readAt = current.asOf
      current.unreadCount = 0
      originalResult = { commandId: command.commandId, eventId: null, eventIds: [eventId], readAt: current.asOf, target: null }
      throw new Error('合成响应丢失')
    })
    const adapter = { list: async () => structuredClone(current), execute }
    let store = useNotificationStore()
    await store.initialize(adapter)
    await store.markAllRead()
    const original = execute.mock.calls[0]![0]
    const newerId = `credential-warning-${'b'.repeat(64)}`
    current.items.push({ ...structuredClone(current.items[0]!), eventId: newerId, readAt: null, problem: { ...current.items[0]!.problem, id: 'newer-problem' } })
    current.pagination.total = 2
    current.unreadCount = 1
    setActivePinia(createPinia())
    store = useNotificationStore()
    await store.initialize(adapter)
    await store.recoverPending()
    expect(execute.mock.calls[1]![0]).toEqual(original)
    expect(store.pending).toBeNull()
    expect(store.items.find(row => row.id === newerId)?.read).toBe(false)
    expect(store.unreadCount).toBe(1)
  })

  it('存储不可核验时不发送，原命令先持久保存后才能执行', async () => {
    const store = useNotificationStore()
    const current = formalPage()
    const execute = vi.fn()
    await store.initialize({ list: async () => structuredClone(current), execute })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await store.openItem(eventId)
    expect(execute).not.toHaveBeenCalled()
    expect(store.error).toContain('无法可靠保留')
    set.mockRestore()
  })

  it('保存后真实401清私密事实，保原编号且不以旧导航完成，再登录后只恢复读取', async () => {
    const current = formalPage()
    const list = vi.fn(async () => structuredClone(current))
    const execute = vi.fn(async (command) => {
      current.items[0]!.readAt = current.asOf
      current.unreadCount = 0
      return { commandId: command.commandId, eventId: command.eventId, eventIds: [eventId], readAt: current.asOf, target: current.items[0]!.target }
    })
    const store = useNotificationStore()
    await store.initialize({ list, execute })
    list.mockRejectedValueOnce({ statusCode: 401, data: { broken: true } })
    expect(await store.openItem(eventId)).toBeUndefined()
    const original = execute.mock.calls[0]![0]
    expect(store.readState).toMatchObject({ kind: 'forbidden', problem: { code: 'unauthenticated' } })
    expect(store.items).toEqual([])
    expect(JSON.stringify(store.$state)).not.toContain('合成分供方')
    expect(JSON.parse(sessionStorage.getItem(notificationPendingKey(original))!)).toEqual(original)
    expect(await store.recoverPending()).toBe('/base/supplier/credential/supplier-a?origin=real')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(store.pending).toBeNull()
  })
})
