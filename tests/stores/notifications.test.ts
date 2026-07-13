import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useNotificationStore } from '~/stores/notifications'

describe('通知中心', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('以未读示例数据初始化并计算未读数', () => {
    const store = useNotificationStore()
    expect(store.items.length).toBeGreaterThan(0)
    expect(store.unreadCount).toBe(store.items.filter(item => !item.read).length)
  })

  it('支持单条已读和全部已读', () => {
    const store = useNotificationStore()
    const firstUnread = store.items.find(item => !item.read)!

    store.markRead(firstUnread.id)
    expect(store.items.find(item => item.id === firstUnread.id)?.read).toBe(true)

    store.markAllRead()
    expect(store.unreadCount).toBe(0)
  })

  it('点击条目会标记已读并返回真实路由', () => {
    const store = useNotificationStore()
    const target = store.items.find(item => !item.read)!

    expect(store.openItem(target.id)).toBe(target.route)
    expect(store.items.find(item => item.id === target.id)?.read).toBe(true)
  })

  it('删除只影响指定条目', () => {
    const store = useNotificationStore()
    const [target] = store.items
    const before = store.items.length

    store.remove(target!.id)

    expect(store.items).toHaveLength(before - 1)
    expect(store.items.some(item => item.id === target!.id)).toBe(false)
  })
})
