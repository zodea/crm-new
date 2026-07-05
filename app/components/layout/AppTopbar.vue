<script setup lang="ts">
// 顶栏 —— SiteHeader 风格（对照官方 dashboard 示例）：SidebarTrigger + 分隔线 + 页面标题 + 工具按钮。
import { SidebarTrigger } from '~/components/ui/sidebar'
import { routeTitle } from '~/lib/tabs/tab-title'

const route = useRoute()

const showNotifications = ref(false)
const showDevTools = ref(false)
const isDev = import.meta.dev

// 与页签栏共用同一套路由→标题映射，保持一致。
const pageTitle = computed(() => routeTitle(route.path))
</script>

<template>
  <header
    class="flex h-[var(--header-h)] shrink-0 items-center gap-2 border-b border-line px-4"
  >
    <SidebarTrigger class="-ml-1" />
    <div class="mx-1 h-4 w-px bg-line" aria-hidden="true" />
    <h1 class="text-17px font-500 text-ink">
      {{ pageTitle }}
    </h1>

    <div class="flex-1" />

    <!-- 开发工具 (dev only) -->
    <button v-if="isDev" class="icon-btn mr-2" title="开发工具" @click="showDevTools = true">
      <span class="i-lucide-wrench text-15px text-warn" aria-hidden="true" />
    </button>

    <!-- 通知 -->
    <button class="icon-btn mr-2 relative" title="通知" @click="showNotifications = true">
      <span class="i-lucide-bell-ring text-15px" aria-hidden="true" />
      <span class="absolute -top-0.5 -right-0.5 w-2 h-2 bg-danger rounded-full" />
    </button>

    <!-- 设置 -->
    <button class="icon-btn" title="设置">
      <span class="i-lucide-settings text-15px" aria-hidden="true" />
    </button>

    <NotificationDrawer
      :open="showNotifications"
      @close="showNotifications = false"
    />

    <DevToolsPanel
      v-if="isDev"
      :open="showDevTools"
      @close="showDevTools = false"
    />
  </header>
</template>
