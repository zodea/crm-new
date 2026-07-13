<script setup lang="ts">
// 顶栏 —— 对齐 DC 设计稿 app.dc.html header：两行标题（18px/800 title + 12px 副标）+
// 右侧日期；保留 Nuxt 侧特性：SidebarTrigger、通知、设置、DevTools（dev only）。
import { SidebarTrigger } from '~/components/ui/sidebar'
import { routeSubtitle, routeTitle } from '~/lib/tabs/tab-title'

const route = useRoute()

const showNotifications = shallowRef(false)
const showDevTools = shallowRef(false)
const isDev = import.meta.dev

// 与页签栏共用同一套路由→标题映射，保持一致。
const pageTitle = computed(() => routeTitle(route.path))
const pageSubtitle = computed(() => routeSubtitle(route.path))

// 顶栏日期（对齐设计稿「2026年6月29日 · 周一」；进入应用时定格，无需实时刷新）
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
const now = new Date()
const today = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · ${WEEKDAYS[now.getDay()]}`
</script>

<template>
  <header
    class="flex h-[var(--header-h)] shrink-0 items-center gap-3 border-b border-line bg-[rgba(255,255,255,0.96)] px-6 backdrop-blur-[8px]"
  >
    <SidebarTrigger class="-ml-1" />
    <div class="mx-1 h-4 w-px bg-line" aria-hidden="true" />
    <div class="min-w-0">
      <h1 class="truncate text-18px font-800 leading-tight text-ink">
        {{ pageTitle }}
      </h1>
      <div class="mt-0.5 min-h-4 truncate text-12px text-ink-soft">
        {{ pageSubtitle }}
      </div>
    </div>

    <div class="flex-1" />

    <span class="hidden text-12px text-ink-soft md:block">{{ today }}</span>

    <NuxtLink
      v-if="isDev"
      to="/dev/kit-ui"
      class="icon-btn ml-2"
      title="组件预览"
      aria-label="打开组件预览"
    >
      <span class="i-lucide-blocks text-15px text-brand" aria-hidden="true" />
    </NuxtLink>

    <!-- 开发工具 (dev only) -->
    <button v-if="isDev" class="icon-btn" title="开发工具" @click="showDevTools = true">
      <span class="i-lucide-wrench text-15px text-warn" aria-hidden="true" />
    </button>

    <!-- 通知 -->
    <button class="icon-btn relative" title="通知" @click="showNotifications = true">
      <span class="i-lucide-bell-ring text-15px" aria-hidden="true" />
      <span class="absolute h-2 w-2 rounded-full bg-danger -right-0.5 -top-0.5" />
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
