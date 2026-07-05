<script setup lang="ts">
// 应用外框（ADR 0008）：shadcn-vue Sidebar 体系 —— SidebarProvider（状态/快捷键/持久化）
// > AppSidebar（inset 毛玻璃侧栏）+ SidebarInset（圆角浮岛主内容区）。
// 主内容区结构：SiteHeader（AppTopbar）+ 页签栏（AppTabBar）+ keep-alive 页面（保留滚动/表单）。
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="h-svh overflow-hidden md:h-[calc(100svh-1rem)]">
      <AppTopbar />
      <AppTabBar />
      <div class="flex-1 overflow-y-auto p-4">
        <div class="mx-auto max-w-[var(--content-max)]">
          <NuxtPage :keepalive="{ max: 20 }" />
        </div>
      </div>
    </SidebarInset>
    <KitUIHost />
  </SidebarProvider>
</template>
