<script setup lang="ts">
// 应用外框（ADR 0008 底座 + DC 设计稿批A 外框效果）：shadcn-vue Sidebar 体系 ——
// SidebarProvider（状态/快捷键/持久化）> AppSidebar（贴边毛玻璃侧栏，批A 10 组 IA）
// + SidebarInset 平铺主区（顶栏 AppTopbar + 红圈式页签栏 AppTabBar + keep-alive 页面）。
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
    <SidebarInset class="h-svh overflow-hidden">
      <AppTopbar />
      <AppTabBar />
      <!-- 主区滚动容器（对齐设计稿 main：20px 24px 36px 全宽） -->
      <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto px-[24px] pb-[36px] pt-[20px]">
        <NuxtPage :page-key="pageKey" :keepalive="{ max: 20 }" />
      </div>
    </SidebarInset>
    <KitUIHost />
  </SidebarProvider>
</template>
