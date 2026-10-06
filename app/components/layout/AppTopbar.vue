<script setup lang="ts">
import { isTauri } from '@tauri-apps/api/core'
import { useEventListener, useIntervalFn, useNow } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { SidebarTrigger, useSidebar } from '~/components/ui/sidebar'
import {
  DATA_VISIBILITY_PENDING_KEY,
  stageDataVisibilitySwitch,
} from '~/lib/data-visibility'
import { routeTitle } from '~/lib/tabs/tab-title'
import { formatShanghaiDateTime } from '~/lib/util/datetime'

const route = useRoute()
const notificationStore = useNotificationStore()
const dataVisibilityStore = useDataVisibilityStore()
const { unreadCount } = storeToRefs(notificationStore)
const { includeDemo } = storeToRefs(dataVisibilityStore)
const notificationsRepository = useNuxtApp().$repositories.notifications
const systemToast = useToast()
const showNotifications = shallowRef(false)
onMounted(() => {
  void notificationStore.initialize(notificationsRepository, (item) => {
    const toastId = systemToast.push({
      lane: 'system',
      message: item.title,
      description: `${item.summary} · ${formatShanghaiDateTime(item.occurredAt, '时间未知')}`,
      onDismiss: () => notificationStore.dismissPresentation(item.eventId),
      action: { label: '查看', onClick: async () => {
        notificationStore.dismissPresentation(item.eventId)
        const target = await notificationStore.openItem(item.eventId)
        if (target)
          await navigateTo(target)
        else if (notificationStore.error)
          showNotifications.value = true
      } },
    })
    return () => systemToast.dismiss(toastId)
  })
})
useIntervalFn(() => {
  void notificationStore.refresh()
}, 60_000)
useEventListener('focus', () => {
  void notificationStore.refresh()
})
watch(includeDemo, () => {
  void notificationStore.refresh()
})
const { isMobile } = useSidebar()
const { confirm, warning } = useKitUI()

const showDevTools = shallowRef(false)
const switchingDataVisibility = shallowRef(false)
const isDev = import.meta.dev
const demoToggleAvailable = !isTauri()
const now = useNow({ interval: 60_000 })

const pageTitle = computed(() => routeTitle(route.path) || '瑞航 CRM')
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Shanghai',
})
const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', {
  weekday: 'long',
  timeZone: 'Asia/Shanghai',
})
const dateLabel = computed(() => {
  const weekday = weekdayFormatter.format(now.value).replace('星期', '周')
  return `${dateFormatter.format(now.value)} · ${weekday}`
})
const notificationLabel = computed(() => unreadCount.value
  ? `打开通知中心，${unreadCount.value} 条未读`
  : '打开通知中心，没有未读消息')

async function switchDataVisibility() {
  if (switchingDataVisibility.value)
    return
  const next = !includeDemo.value
  const accepted = await confirm({
    variant: 'simple',
    title: '切换数据工作区',
    message: '切换会重新加载应用。请先保存所有页签中的未提交内容，再确认继续。',
    confirmLabel: '确认切换',
  })
  if (!accepted)
    return

  if (next && !await dataVisibilityStore.authorizeDemo()) {
    warning('当前账号没有查看测试数据的权限')
    return
  }

  switchingDataVisibility.value = true
  stageDataVisibilitySwitch(sessionStorage, next)
  window.location.reload()
  window.setTimeout(() => {
    sessionStorage.removeItem(DATA_VISIBILITY_PENDING_KEY)
    switchingDataVisibility.value = false
  }, 1_000)
}
</script>

<template>
  <header
    data-shell-topbar
    class="sticky top-0 z-[var(--z-shell-header)] flex h-[var(--header-h)] shrink-0 items-center gap-2 border-b border-[var(--shell-header-border)] bg-[var(--shell-header-bg)] px-3 text-[var(--shell-header-text)]"
  >
    <SidebarTrigger class="lg:hidden" />
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-13px font-600 leading-[1.2]">
        {{ pageTitle }}
      </h1>
    </div>

    <time class="hidden flex-none text-12px text-[var(--shell-header-muted)] md:block" :datetime="now.toISOString()">
      {{ dateLabel }}
    </time>

    <div class="flex items-center gap-1" aria-label="应用工具栏">
      <button
        v-if="demoToggleAvailable"
        type="button"
        data-testid="include-demo-toggle"
        class="shell-icon-button w-auto gap-1.5 px-2"
        :class="includeDemo ? 'border-warn/45 bg-warn/10 text-warn' : ''"
        :title="includeDemo ? '关闭测试数据，恢复仅显示正式数据' : '包含测试数据（仅查看）'"
        :aria-label="includeDemo ? '关闭测试数据' : '包含测试数据'"
        :aria-pressed="includeDemo"
        :disabled="switchingDataVisibility"
        @click="switchDataVisibility"
      >
        <span class="i-lucide-flask-conical h-4 w-4" aria-hidden="true" />
        <span class="hidden text-11px font-700 sm:inline">{{ includeDemo ? '已包含测试数据' : '测试数据' }}</span>
      </button>

      <button
        type="button"
        class="shell-icon-button relative"
        title="通知中心"
        :aria-label="notificationLabel"
        :aria-pressed="showNotifications"
        @click="showNotifications = true"
      >
        <span class="i-lucide-bell h-4 w-4" aria-hidden="true" />
        <span
          v-if="unreadCount"
          class="absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-9px font-700 leading-none text-white tabular-nums"
          aria-hidden="true"
        >{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
      </button>

      <div v-if="isDev && !isMobile" class="mx-1.5 h-4 w-px bg-[var(--shell-header-border)]" aria-hidden="true" />

      <NuxtLink
        v-if="isDev && !isMobile"
        to="/dev/kit-ui"
        class="shell-icon-button"
        title="组件预览"
        aria-label="打开组件预览"
      >
        <span class="i-lucide-blocks h-4 w-4" aria-hidden="true" />
      </NuxtLink>

      <button
        v-if="isDev && !isMobile"
        type="button"
        class="shell-icon-button"
        title="Mock 数据工具"
        aria-label="打开 Mock 数据工具"
        :aria-pressed="showDevTools"
        @click="showDevTools = true"
      >
        <span class="i-lucide-database-zap h-4 w-4" aria-hidden="true" />
      </button>
    </div>

    <NotificationDrawer
      :open="showNotifications"
      @update:open="showNotifications = $event"
    />

    <DevToolsPanel
      v-if="isDev"
      :open="showDevTools"
      @close="showDevTools = false"
    />
  </header>
</template>
