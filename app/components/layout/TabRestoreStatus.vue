<script setup lang="ts">
const session = useTabSessionStore()
const tabs = useTabsStore()
const router = useRouter()

async function close(key: string) {
  if (await tabs.requestClose(key))
    await router.push(tabs.activeFullPath)
}
</script>

<template>
  <div
    v-if="session.problems.length || session.diagnostics.length || session.storageProblem || session.loadingKey"
    data-tab-restore-status
    class="max-h-36 shrink-0 overflow-y-auto border-b border-line bg-surface-2 px-3 py-2 text-12px text-ink-soft"
  >
    <p v-if="session.loadingKey" class="m-0" role="status">
      正在恢复页面…
    </p>
    <div v-if="session.diagnostics.length" class="flex items-center justify-between gap-2" role="status">
      <span>已整理不再适用或超出上限的旧页签。</span>
      <KitButton variant="ghost" size="sm" aria-label="关闭页签整理提示" @click="session.dismissDiagnostics()">
        关闭提示
      </KitButton>
    </div>
    <div v-if="session.storageProblem" class="flex items-center justify-between gap-2" role="status">
      <span>{{ session.storageProblem }}</span>
      <KitButton variant="ghost" size="sm" aria-label="关闭页签保存提示" @click="session.dismissStorageProblem()">
        关闭提示
      </KitButton>
    </div>
    <div v-for="problem in session.problems" :key="problem.key" class="flex flex-wrap items-center gap-2 py-1" role="alert">
      <span class="min-w-0 flex-1">{{ problem.title }}：{{ problem.message }}</span>
      <KitButton variant="secondary" size="sm" :disabled="!!session.loadingKey" @click="router.push(problem.fullPath)">
        重试恢复
      </KitButton>
      <KitButton variant="ghost" size="sm" @click="close(problem.key)">
        关闭页签
      </KitButton>
    </div>
  </div>
</template>
