<script setup lang="ts">
const sidebarCollapsed = ref(false)
provide('sidebarCollapsed', sidebarCollapsed)
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-bg">
    <AppSidebar
      :collapsed="sidebarCollapsed"
      @toggle="sidebarCollapsed = !sidebarCollapsed"
    />
    <div class="flex flex-col flex-1 min-w-0">
      <AppTopbar />
      <main class="flex-1 overflow-y-auto p-4">
        <div class="max-w-[var(--content-max)] mx-auto">
          <NuxtPage />
        </div>
      </main>
    </div>
    <KitUIHost />
  </div>
</template>
