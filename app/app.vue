<script setup lang="ts">
// 应用外框（ADR 0008）：shadcn-vue Sidebar 体系 —— SidebarProvider（状态/快捷键/持久化）
// > AppSidebar（inset 毛玻璃侧栏）+ SidebarInset（圆角浮岛主内容区，内部滚动）。
</script>

<template>
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset class="h-svh overflow-hidden md:h-[calc(100svh-1rem)]">
      <AppTopbar />
      <div class="flex-1 overflow-y-auto p-4">
        <div class="mx-auto max-w-[var(--content-max)]">
          <NuxtPage />
        </div>
      </div>
    </SidebarInset>
    <KitUIHost />
  </SidebarProvider>
</template>
