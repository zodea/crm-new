<script setup lang="ts">
import { useNow } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { SidebarTrigger, useSidebar } from '~/components/ui/sidebar'
import { routeSubtitle, routeTitle } from '~/lib/tabs/tab-title'

const route = useRoute()
const notificationStore = useNotificationStore()
const { unreadCount } = storeToRefs(notificationStore)
const { isMobile } = useSidebar()

const showNotifications = shallowRef(false)
const showDevTools = shallowRef(false)
const isDev = import.meta.dev
const now = useNow({ interval: 60_000 })

const pageTitle = computed(() => routeTitle(route.path) || '瑞航 CRM')
const pageSubtitle = computed(() => routeSubtitle(route.path))
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
</script>

<template>
  <header
    data-shell-topbar
    class="sticky top-0 z-[var(--z-shell-header)] flex h-[var(--header-h)] shrink-0 items-center gap-[12px] border-b border-[var(--shell-header-border)] bg-[var(--shell-header-bg)] px-[24px] text-[var(--shell-header-text)] backdrop-blur-[8px]"
  >
    <SidebarTrigger class="lg:hidden" />
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-18px font-800 leading-[1.2]">
        {{ pageTitle }}
      </h1>
      <p class="mt-[2px] min-h-[16px] truncate text-12px leading-[1.35] text-[var(--shell-header-muted)]">
        {{ pageSubtitle }}
      </p>
    </div>

    <time class="hidden flex-none text-12px text-[var(--shell-header-muted)] md:block" :datetime="now.toISOString()">
      {{ dateLabel }}
    </time>

    <div class="flex items-center gap-1" aria-label="应用工具栏">
      <button
        type="button"
        class="shell-icon-button relative"
        title="通知中心"
        aria-label="打开通知中心"
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
