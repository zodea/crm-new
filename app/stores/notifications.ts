// @unocss-include
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

export type NotificationKind = 'todo' | 'notice'
export type NotificationType = 'payment' | 'payroll' | 'invoice' | 'delivery' | 'cert'

export interface NotificationItem {
  id: string
  kind: NotificationKind
  type: NotificationType
  title: string
  description: string
  time: string
  route: string
  read: boolean
}

export const NOTIFICATION_TYPE_META: Record<NotificationType, {
  label: string
  icon: string
  color: string
}> = {
  payment: { label: '付款审批', icon: 'i-lucide-banknote', color: 'text-brand' },
  payroll: { label: '工资发放', icon: 'i-lucide-wallet', color: 'text-warn' },
  invoice: { label: '发票校对', icon: 'i-lucide-receipt-text', color: 'text-ok' },
  delivery: { label: '送货单识别', icon: 'i-lucide-truck', color: 'text-brand' },
  cert: { label: '证照提醒', icon: 'i-lucide-shield-alert', color: 'text-danger' },
}

const SEED_ITEMS: NotificationItem[] = [
  {
    id: 'todo-invoice-review',
    kind: 'todo',
    type: 'invoice',
    title: '2 张发票待校对',
    description: '大板东建材 · 合和新城',
    time: '10 分钟前',
    route: '/finance/invoice',
    read: false,
  },
  {
    id: 'todo-delivery-recognition',
    kind: 'todo',
    type: 'delivery',
    title: '3 张送货单待识别',
    description: '合和新城 · 3 号楼',
    time: '30 分钟前',
    route: '/material/delivery',
    read: false,
  },
  {
    id: 'todo-payment-approval',
    kind: 'todo',
    type: 'payment',
    title: '付款申请待处理',
    description: '鸿运五金 · ¥8,755.00',
    time: '2 小时前',
    route: '/finance/ledger',
    read: false,
  },
  {
    id: 'notice-cert-expiring',
    kind: 'notice',
    type: 'cert',
    title: '分供方证照即将到期',
    description: '顺利圆铝业 · 30 天内到期',
    time: '1 小时前',
    route: '/base/supplier',
    read: false,
  },
  {
    id: 'notice-payment-finished',
    kind: 'notice',
    type: 'payment',
    title: '付款申请已完成',
    description: '鸿运五金 · 审批流程已完成',
    time: '昨天',
    route: '/finance/ledger',
    read: true,
  },
]

export const useNotificationStore = defineStore('notifications', () => {
  const items = shallowRef<NotificationItem[]>(SEED_ITEMS.map(item => ({ ...item })))
  const unreadCount = computed(() => items.value.filter(item => !item.read).length)

  function add(item: NotificationItem) {
    items.value = [{ ...item }, ...items.value.filter(current => current.id !== item.id)]
  }

  function markRead(id: string) {
    items.value = items.value.map(item => item.id === id ? { ...item, read: true } : item)
  }

  function markAllRead() {
    items.value = items.value.map(item => item.read ? item : { ...item, read: true })
  }

  function remove(id: string) {
    items.value = items.value.filter(item => item.id !== id)
  }

  /** 点击通知的唯一写路径：先标已读，再把真实路由交给呈现层导航。 */
  function openItem(id: string): string | undefined {
    const item = items.value.find(current => current.id === id)
    if (!item)
      return undefined
    markRead(id)
    return item.route
  }

  return {
    items,
    unreadCount,
    add,
    markRead,
    markAllRead,
    remove,
    openItem,
  }
})
