import type { CredentialNotification, NotificationCommand, NotificationPage, NotificationStoredReceipt } from '~/lib/notifications/contract'
import type { createNotificationRepository } from '~/lib/notifications/repository'
import type { ProblemDTO, ReadState } from '~/types/read-model'
import { useSessionStorage } from '@vueuse/core'
// @unocss-include
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { isNotificationEventId, isNotificationStoredReceipt } from '~/lib/notifications/contract'
import { clearNotificationPending, notificationPendingKey, readNotificationPending, rememberNotificationPending, verifyNotificationPending } from '~/lib/notifications/pending'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { collectReadPages } from '~/lib/read-model/collection'
import { problemFromHttpFailure } from '~/lib/read-model/problem'
import { readFailureState } from '~/lib/read-model/state'
import { formatShanghaiDateTime } from '~/lib/util/datetime'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { isISODateTimeDTO } from '~/types/read-model'

export type NotificationKind = 'todo' | 'notice'
export type NotificationType = 'payment' | 'payroll' | 'invoice' | 'delivery' | 'cert'
interface NotificationPresentation { presentedAt: string, presentationDismissedAt: string | null }

export interface NotificationItem {
  id: string
  kind: NotificationKind
  type: NotificationType
  title: string
  description: string
  time: string
  route: string
  read: boolean
  problem?: CredentialNotification['problem']
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
    description: '顺利圆铝业 · 7 天内到期（演示）',
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
  const dataVisibilityStore = useDataVisibilityStore()
  const demoItems = shallowRef<NotificationItem[]>(SEED_ITEMS.map(item => ({ ...item })))
  const realItems = shallowRef<NotificationItem[]>([])
  const page = shallowRef<NotificationPage | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const pending = shallowRef<NotificationCommand | null>(null)
  const readState = shallowRef<ReadState<NotificationPage>>({ kind: 'idle' })
  let currentScope: Pick<NotificationCommand, 'workspaceId' | 'actorId'> | null = null
  let currentEvents: CredentialNotification[] = []
  // The warm receipt keeps only its adopted stable event IDs and time, never a private target or title.
  const savedReads = new Map<string, NotificationStoredReceipt>()
  // 只保存事件身份及本地呈现时间；不保存名称、摘要、原件或业务正文。
  const presentations = useSessionStorage<Record<string, NotificationPresentation>>('ruihang-notification-presentations', {}, { serializer: {
    read(value) {
      try {
        const parsed = JSON.parse(value)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          return {}
        return Object.fromEntries(Object.entries(parsed).filter(([key, row]) => {
          const entry = row as { presentedAt?: unknown, presentationDismissedAt?: unknown }
          return key.split(':').length === 3 && isNotificationEventId(key.split(':')[2]) && !!entry && typeof entry === 'object'
            && isISODateTimeDTO(entry.presentedAt)
            && (entry.presentationDismissedAt === null || isISODateTimeDTO(entry.presentationDismissedAt))
            && Object.keys(entry).sort().join(',') === 'presentationDismissedAt,presentedAt'
        })) as Record<string, NotificationPresentation>
      }
      catch { return {} }
    },
    write: value => JSON.stringify(value),
  } })
  const items = computed(() => dataVisibilityStore.includeDemo ? demoItems.value : realItems.value)
  const unreadCount = computed(() => dataVisibilityStore.includeDemo ? items.value.filter(item => !item.read).length : page.value?.unreadCount ?? 0)
  const evaluationUnavailable = computed(() => !dataVisibilityStore.includeDemo && page.value?.evaluationState === 'unavailable')
  let repository: ReturnType<typeof createNotificationRepository> | null = null
  let generation = 0
  let controller: AbortController | null = null
  let saving = false
  let present: ((item: CredentialNotification) => void | (() => void)) | null = null
  const displayed = new Map<string, () => void>()

  function invalidateFacts(problem: ProblemDTO) {
    ++generation
    controller?.abort()
    realItems.value = []
    currentEvents = []
    currentScope = null
    page.value = null
    pending.value = null
    loading.value = false
    error.value = problem.message
    readState.value = readFailureState<NotificationPage>(problem, null)
    withdrawPresentations()
  }
  bindReadAuthority(invalidateFacts)

  function withdrawPresentations(keep: ReadonlySet<string> = new Set()) {
    for (const [key, cleanup] of displayed) {
      if (!keep.has(key)) {
        displayed.delete(key)
        cleanup()
      }
    }
  }

  async function refresh(): Promise<boolean> {
    const request = ++generation
    controller?.abort()
    controller = new AbortController()
    if (dataVisibilityStore.includeDemo || !repository) {
      withdrawPresentations()
      realItems.value = []
      currentEvents = []
      currentScope = null
      pending.value = null
      page.value = null
      loading.value = false
      readState.value = { kind: 'idle' }
      return false
    }
    loading.value = true
    error.value = null
    readState.value = { kind: 'loading', previous: null }
    try {
      const first = await repository.list(1, controller.signal)
      if (request !== generation || dataVisibilityStore.includeDemo)
        return false
      if (!first.meta.sources.some(source => source.state === 'readable') && first.meta.sources.some(source => source.state === 'forbidden')) {
        invalidateFacts({ code: 'forbidden', message: '当前没有资料提醒查看权限', retryable: false, fieldErrors: {}, traceId: null })
        return false
      }
      const all = first.evaluationState === 'ready'
        ? (await collectReadPages<NotificationPage>({
            load: current => current === 1 ? Promise.resolve(first) : repository!.list(current, controller!.signal),
            identity: (item: CredentialNotification) => item.eventId,
            isCurrent: () => request === generation && !dataVisibilityStore.includeDemo,
          })).items
        : [...first.items]
      if (request !== generation || dataVisibilityStore.includeDemo)
        return false
      if (new Set(all.map(item => item.eventId)).size !== all.length || all.length !== first.pagination.total)
        throw new Error('消息分页未完整对账，请重新读取')
      currentScope = { workspaceId: first.workspaceId, actorId: first.actorId }
      pending.value = readNotificationPending(currentScope)
      page.value = first
      currentEvents = all
      readState.value = first.items.length ? { kind: 'ready', data: first } : { kind: 'empty', data: first, empty: { reason: 'no-records', missingRelations: [] } }
      withdrawPresentations(new Set(all.filter(item => item.readAt === null && item.problem.state === 'active').map(item => `${first.workspaceId}:${first.actorId}:${item.eventId}`)))
      realItems.value = all.map(item => ({ id: item.eventId, kind: item.kind, type: 'cert', title: item.title, description: item.summary, time: formatShanghaiDateTime(item.occurredAt, '时间未知'), route: '', read: item.readAt !== null, problem: item.problem }))
      for (const item of all) {
        const key = `${first.workspaceId}:${first.actorId}:${item.eventId}`
        if (present && item.readAt === null && item.problem.state === 'active' && !presentations.value[key]) {
          presentations.value = { ...presentations.value, [key]: { presentedAt: new Date().toISOString(), presentationDismissedAt: null } }
          const cleanup = present(structuredClone(item))
          if (cleanup)
            displayed.set(key, cleanup)
        }
      }
      return true
    }
    catch (cause) {
      if (request !== generation || controller.signal.aborted)
        return false
      // 权限失去或源故障不保留可泄露名称的旧消息，也不换成演示事实。
      realItems.value = []
      page.value = null
      currentEvents = []
      withdrawPresentations()
      const problem = problemFromHttpFailure(cause) ?? { code: 'unavailable' as const, message: cause instanceof Error ? cause.message : '消息暂时无法读取，请重试', retryable: true, fieldErrors: {}, traceId: null }
      if (['forbidden', 'unauthenticated'].includes(problem.code)) {
        currentScope = null
        pending.value = null
      }
      error.value = problem.message
      readState.value = readFailureState<NotificationPage>(problem, null)
      return false
    }
    finally {
      if (request === generation)
        loading.value = false
    }
  }

  async function initialize(adapter: ReturnType<typeof createNotificationRepository>, presenter?: (item: CredentialNotification) => void | (() => void)) {
    withdrawPresentations()
    repository = adapter
    present = presenter ?? null
    await refresh()
  }

  function dismissPresentation(eventId: string) {
    if (!page.value)
      return
    const key = `${page.value.workspaceId}:${page.value.actorId}:${eventId}`
    const previous = presentations.value[key]
    if (previous)
      presentations.value = { ...presentations.value, [key]: { ...previous, presentationDismissedAt: new Date().toISOString() } }
  }

  async function executeReal(action: 'open' | 'mark-all-read', eventId: string | null): Promise<string | undefined> {
    if (!repository || !page.value || saving)
      return undefined
    if (pending.value && (pending.value.action !== action || pending.value.eventId !== eventId)) {
      error.value = '上次已读提交结果尚待核对，请先恢复原操作'
      return undefined
    }
    const identity = `${page.value.workspaceId}:${page.value.actorId}`
    const command = pending.value ?? { commandId: crypto.randomUUID(), workspaceId: page.value.workspaceId, actorId: page.value.actorId, action, eventId }
    const key = `${notificationPendingKey(command)}:${command.commandId}`
    saving = true
    error.value = null
    try {
      rememberNotificationPending(command)
      pending.value = command
      verifyNotificationPending(command)
      let receipt = savedReads.get(key)
      if (!receipt) {
        const result = await repository.execute(command)
        const proof = { commandId: result.commandId, eventId: result.eventId, eventIds: result.eventIds, readAt: result.readAt }
        if (!isNotificationStoredReceipt(proof) || proof.commandId !== command.commandId || proof.eventId !== command.eventId)
          throw new Error('原消息回执与采用集合不一致，请保留原编号。')
        receipt = structuredClone(proof)
        savedReads.set(key, receipt)
      }
      if (dataVisibilityStore.includeDemo || `${page.value?.workspaceId}:${page.value?.actorId}` !== identity)
        return undefined
      if (!await refresh())
        throw new Error('消息已读已保存待刷新，请只恢复原操作读取。')
      if (dataVisibilityStore.includeDemo || `${page.value?.workspaceId}:${page.value?.actorId}` !== identity)
        return undefined
      if (receipt.eventIds.some(id => !currentEvents.some(item => item.eventId === id && item.readAt !== null && Date.parse(item.readAt) <= Date.parse(receipt.readAt))))
        throw new Error('原已读集合尚未在同一身份下可靠读取，请保留原编号。')
      clearNotificationPending(command)
      savedReads.delete(key)
      pending.value = null
      const target = command.eventId ? currentEvents.find(item => item.eventId === command.eventId)?.target : null
      if (target?.state === 'resolved') {
        const resolution = resolveNavigationTarget(target.intent)
        if (resolution.state === 'resolved')
          return resolution.to
        error.value = resolution.message
      }
      else if (target) {
        error.value = target.state === 'forbidden' ? '已标记已读，当前无资料入口权限' : '已标记已读，原资料入口已失效'
      }
      return undefined
    }
    catch (cause) {
      if (dataVisibilityStore.includeDemo || !currentScope || `${currentScope.workspaceId}:${currentScope.actorId}` !== identity)
        return undefined
      error.value = cause instanceof Error ? `${cause.message}；请恢复原已读操作` : '提交结果未知，请恢复原已读操作'
      return undefined
    }
    finally { saving = false }
  }

  async function recoverPending() {
    if (!page.value)
      await refresh()
    return pending.value ? executeReal(pending.value.action, pending.value.eventId) : undefined
  }

  function add(item: NotificationItem) {
    demoItems.value = [{ ...item }, ...demoItems.value.filter(current => current.id !== item.id)]
  }

  function markRead(id: string) {
    if (!dataVisibilityStore.includeDemo)
      return executeReal('open', id)
    demoItems.value = demoItems.value.map(item => item.id === id ? { ...item, read: true } : item)
  }

  function markAllRead() {
    if (!dataVisibilityStore.includeDemo)
      return executeReal('mark-all-read', null)
    demoItems.value = demoItems.value.map(item => item.read ? item : { ...item, read: true })
  }

  function remove(id: string) {
    if (!dataVisibilityStore.includeDemo)
      return
    demoItems.value = demoItems.value.filter(item => item.id !== id)
  }

  /** 点击通知的唯一写路径：先标已读，再把真实路由交给呈现层导航。 */
  function openItem(id: string): string | undefined | Promise<string | undefined> {
    const item = items.value.find(current => current.id === id)
    if (!item)
      return undefined
    if (!dataVisibilityStore.includeDemo)
      return executeReal('open', id)
    markRead(id)
    return item.route
  }

  return {
    items,
    unreadCount,
    loading,
    error,
    pending,
    readState,
    evaluationUnavailable,
    refresh,
    initialize,
    dismissPresentation,
    recoverPending,
    add,
    markRead,
    markAllRead,
    remove,
    openItem,
  }
})
