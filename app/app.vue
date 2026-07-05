<script setup lang="ts">
// 应用外框（ADR 0008）：shadcn-vue Sidebar 体系 —— SidebarProvider（状态/快捷键/持久化）
// > AppSidebar（inset 毛玻璃侧栏）+ SidebarInset（圆角浮岛主内容区）。
// 主内容区结构：SiteHeader（AppTopbar）+ 页签栏（AppTabBar）+ keep-alive 页面。
// 页签隔离：page-key=fullPath 让每个页签是独立组件实例（表单/内部 state 互不串），
// 配合 keepalive 缓存；滚动位置按页签 key 手动存取（滚动容器是共享的，keep-alive 不覆盖）。
import { deriveKey } from '~/lib/tabs/tab-machine'

const route = useRoute()
const scrollEl = useTemplateRef<HTMLElement>('scrollEl')
const scrollPos = new Map<string, number>()

watch(
  () => route.fullPath,
  (to, from) => {
    if (from && scrollEl.value)
      scrollPos.set(deriveKey(from), scrollEl.value.scrollTop)
    nextTick(() => {
      if (scrollEl.value)
        scrollEl.value.scrollTop = scrollPos.get(deriveKey(to)) ?? 0
    })
  },
  { flush: 'pre' },
)

function pageKey(r: { fullPath: string }) {
  return r.fullPath
}
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="h-svh overflow-hidden md:h-[calc(100svh-1rem)]">
      <AppTopbar />
      <AppTabBar />
      <div ref="scrollEl" class="flex-1 overflow-y-auto p-4">
        <div class="mx-auto max-w-[var(--content-max)]">
          <NuxtPage :page-key="pageKey" :keepalive="{ max: 20 }" />
        </div>
      </div>
    </SidebarInset>
    <KitUIHost />
  </SidebarProvider>
</template>
