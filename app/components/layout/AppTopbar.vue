<script setup lang="ts">
// 顶栏 —— SiteHeader 风格（对照官方 dashboard 示例）：SidebarTrigger + 分隔线 + 页面标题 + 工具按钮。
import { SidebarTrigger } from '~/components/ui/sidebar'

const route = useRoute()

const showNotifications = ref(false)
const showDevTools = ref(false)
const isDev = import.meta.dev

const pageTitle = computed(() => {
  const path = route.path
  if (path === '/') return '首页'
  if (path.startsWith('/project')) return '项目信息'
  if (path.startsWith('/base/supplier')) return '分供方'
  if (path.startsWith('/base/crew')) return '班组管理'
  if (path.startsWith('/base/worker')) return '工人信息'
  if (path.startsWith('/finance/invoice')) return '发票识别'
  if (path.startsWith('/finance')) return '资金管理'
  if (path.startsWith('/contract')) return '主合同管理'
  if (path.startsWith('/subcontract/quantity')) return '工程量管理'
  if (path.startsWith('/subcontract/payroll')) return '工资核算'
  if (path.startsWith('/subcontract')) return '分包及人工'
  if (path.startsWith('/material/delivery')) return '送货单识别'
  if (path.startsWith('/material/price')) return '单价对比'
  if (path.startsWith('/material')) return '乙供材管理'
  return ''
})
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
