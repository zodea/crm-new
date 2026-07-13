<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { SidebarTrigger, useSidebar } from '~/components/ui/sidebar'

const notificationStore = useNotificationStore()
const { unreadCount } = storeToRefs(notificationStore)
const { theme, toggleTheme } = useShellTheme()
const { isMobile } = useSidebar()

const showNotifications = shallowRef(false)
const showDevTools = shallowRef(false)
const isDev = import.meta.dev
</script>

<template>
  <header
    class="flex h-[var(--header-h)] shrink-0 items-center border-b border-[var(--shell-header-border)] bg-[var(--shell-header-bg)] px-4 text-[var(--shell-header-text)] backdrop-blur-[8px]"
  >
    <SidebarTrigger class="lg:hidden" />
    <div class="flex-1" />

    <div class="flex items-center gap-1" aria-label="应用工具栏">
      <button
        type="button"
        class="shell-icon-button"
        :title="theme === 'dark' ? '切换为浅色侧栏' : '切换为深色侧栏'"
        :aria-label="theme === 'dark' ? '切换为浅色侧栏' : '切换为深色侧栏'"
        @click="toggleTheme"
      >
        <span :class="theme === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'" class="h-4 w-4" aria-hidden="true" />
      </button>

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
