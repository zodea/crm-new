<script setup lang="ts">
// 应用外框（ADR 0008 交互底座 + ADR 0011 外壳规格）：shadcn-vue Sidebar 体系 ——
// SidebarProvider（响应式状态）> AppSidebar（可固定/悬浮的完整导航树）
// + SidebarInset 主区（动作顶栏 AppTopbar + 路由页签 AppTabBar + keep-alive 页面）。
// 页签隔离：page-key=fullPath 让每个页签是独立组件实例（表单/内部 state 互不串），
// 配合 keepalive 缓存；滚动位置按页签 key 手动存取（滚动容器是共享的，keep-alive 不覆盖）。
import { deriveKey } from '~/lib/tabs/tab-machine'

const route = useRoute()
const tabsStore = useTabsStore()
const { theme } = provideShellTheme()
const scrollEl = useTemplateRef<HTMLElement>('scrollEl')
const scrollPos = new Map<string, number>()

watch(
  () => route.fullPath,
  (to, from) => {
    const fromKey = deriveKey(from)
    if (from && scrollEl.value && tabsStore.tabs.some(tab => tab.key === fromKey))
      scrollPos.set(fromKey, scrollEl.value.scrollTop)
    nextTick(() => {
      if (scrollEl.value)
        scrollEl.value.scrollTop = scrollPos.get(deriveKey(to)) ?? 0
    })
  },
  { flush: 'pre' },
)

watch(
  () => tabsStore.invalidatedKeys,
  (keys) => {
    for (const key of keys)
      scrollPos.delete(key)
    if (keys.includes(tabsStore.activeKey) && scrollEl.value)
      scrollEl.value.scrollTop = 0
  },
)

function pageKey(r: { fullPath: string }) {
  return tabsStore.pageCacheKey(r.fullPath)
}
</script>

<template>
  <SidebarProvider :data-shell-theme="theme">
    <AppSidebar />
    <SidebarInset class="h-svh overflow-hidden">
      <AppTopbar />
      <AppTabBar />
      <!-- 主区滚动容器（对齐设计稿 main：20px 24px 36px 全宽） -->
      <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto bg-[var(--shell-workspace-bg)] px-4 pb-9 pt-3">
        <div class="mx-auto w-full max-w-[var(--content-max)]">
          <NuxtPage :page-key="pageKey" :keepalive="{ max: 16 }" />
        </div>
      </div>
    </SidebarInset>
    <KitUIHost />
  </SidebarProvider>
</template>
