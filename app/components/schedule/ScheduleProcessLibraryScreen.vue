<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import { storeToRefs } from 'pinia'
import { computed, onActivated, onDeactivated, shallowRef, watch } from 'vue'
import { Button } from '~/components/ui/button'
import KitTable from '~/components/ui/KitTable.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { processLibraryNavigationQuery, processLibraryReturnTo } from '~/lib/schedule/process-library-navigation'

const store = useScheduleProcessLibraryStore()
const route = useRoute()
const { error, libraries, loading } = storeToRefs(store)
const active = shallowRef(true)
const origin = computed(() => route.query.origin === 'demo' ? 'demo' : route.query.origin === 'real' ? 'real' : store.origin)
const mismatch = computed(() => origin.value !== store.origin)
const returnTo = computed(() => processLibraryReturnTo(route.query))
const navigationQuery = computed(() => processLibraryNavigationQuery(origin.value, returnTo.value))
const columns: KitTableColumn[] = [
  { field: 'version', title: '版本', width: 76, slot: 'version' },
  { field: 'description', title: '说明', minWidth: 220 },
  { field: 'taskCount', title: '工序数', width: 84, slot: 'count' },
  { field: 'usageCount', title: '引用状态', minWidth: 248, slot: 'usage' },
  { title: '操作', width: 246, slot: 'actions', resizable: false },
]
async function load() {
  if (!active.value || mismatch.value)
    return
  try {
    await store.loadLibraries()
  }
  catch { /* 错误状态由页面直接呈现，重试不降级旧库。 */ }
}

const versionGroups = computed(() => {
  const groups = new Map<string, typeof libraries.value>()
  for (const library of libraries.value) {
    groups.set(library.code, [...(groups.get(library.code) ?? []), library])
  }
  return [...groups.entries()].map(([code, versions]) => ({
    code,
    name: versions[0]?.name ?? code,
    versions: [...versions].sort((left, right) => right.version - left.version),
  }))
})

watch(() => [origin.value, store.origin], () => void load(), { immediate: true })
onActivated(() => {
  if (!active.value) {
    active.value = true
    void load()
  }
})
onDeactivated(() => {
  active.value = false
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <section class="panel flex flex-wrap items-start gap-3 p-4 sm:p-5">
      <Button as-child variant="ghost" size="icon">
        <NuxtLink :to="returnTo ?? '/schedule'" :aria-label="returnTo ? '返回新建楼栋分组' : '返回施工进度'">
          <span class="i-lucide-arrow-left" aria-hidden="true" />
        </NuxtLink>
      </Button>
      <div class="min-w-56 flex-1">
        <div class="text-11px font-700 tracking-wide text-brand">
          施工进度 · 全局模板
        </div>
        <h1 class="mt-0.5 text-20px font-850 text-ink">
          标准工序库
        </h1>
        <p class="mt-1 max-w-3xl text-12px text-ink-soft">
          每个已保存版本保持只读；可从任意旧版创建下一版，不追溯修改既有项目。
        </p>
      </div>
      <Button v-if="store.canWrite && !mismatch" as-child variant="accent">
        <NuxtLink :to="{ path: '/schedule/process-library/form', query: navigationQuery }">
          <span class="i-lucide-plus" aria-hidden="true" />
          新建空白工序库
        </NuxtLink>
      </Button>
    </section>

    <StatePanel
      v-if="mismatch"
      kind="error"
      title="工序库来源不一致"
      description="请切回对应来源后重新打开工序库。"
    />
    <StatePanel
      v-else-if="loading && !libraries.length"
      kind="loading"
      title="正在读取标准工序库"
    />
    <StatePanel
      v-else-if="error && !libraries.length"
      kind="error"
      title="标准工序库读取失败"
      :description="error"
      action-label="重试"
      @action="load"
    />
    <StatePanel
      v-else-if="!versionGroups.length"
      kind="empty"
      title="还没有标准工序库"
      description="从空白版本开始维护工序、工种、工期、阶段映射和前置关系。"
    >
      <template #action>
        <Button v-if="store.canWrite" as-child variant="accent">
          <NuxtLink :to="{ path: '/schedule/process-library/form', query: navigationQuery }">
            新建标准工序库
          </NuxtLink>
        </Button>
      </template>
    </StatePanel>

    <template v-else>
      <div v-if="loading || error" class="panel flex flex-wrap items-center gap-2 p-3" aria-live="polite">
        <p v-if="loading" role="status" class="text-12px text-ink-soft">
          正在刷新工序库，暂时不能新建版本。
        </p>
        <template v-else>
          <p role="alert" class="min-w-0 flex-1 text-12px text-danger">
            刷新失败：{{ error }}。当前保留上次成功读取的记录，重新读取成功前不能新建版本。
          </p>
          <Button size="sm" @click="load">
            重试刷新
          </Button>
        </template>
      </div>
      <p v-if="origin === 'demo'" class="text-12px text-ink-soft">
        演示来源只读，可查看各版本及工序。
      </p>
      <section
        v-for="group in versionGroups"
        :key="group.code"
        class="panel min-w-0 overflow-hidden"
        :aria-busy="loading"
      >
        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 class="text-14px font-800 text-ink">
              {{ group.name }}
            </h2>
            <p class="mt-0.5 font-mono text-10px text-ink-faint">
              {{ group.code }} · 共 {{ group.versions.length }} 个版本
            </p>
          </div>
        </header>
        <KitTable :columns="columns" :data="[...group.versions]" :min-rows="1" :row-height="44">
          <template #version="{ row }">
            <span class="font-mono font-700">v{{ row.version }}</span>
          </template>
          <template #count="{ row }">
            {{ row.taskCount }} 道
          </template>
          <template #usage="{ row }">
            <span v-if="row.usageCount === null" class="text-11px text-ink-soft">当前身份无法读取引用情况</span>
            <span v-else-if="row.usageCount" class="text-11px text-ink-soft">已被 {{ row.usageCount }} 个排程引用 · 只读</span>
            <span v-else class="text-11px text-ink-faint">尚未引用 · 仍以新版本方式调整</span>
          </template>
          <template #actions="{ row }">
            <div class="flex items-center gap-2">
              <Button as-child size="sm" variant="ghost">
                <NuxtLink :to="{ path: `/schedule/process-library/${encodeURIComponent(row.id)}`, query: navigationQuery }">
                  查看版本
                </NuxtLink>
              </Button>
              <Button v-if="store.canWrite" as-child size="sm">
                <NuxtLink :to="{ path: '/schedule/process-library/form', query: processLibraryNavigationQuery(origin, returnTo, row.id) }">
                  基于此版本新建
                </NuxtLink>
              </Button>
            </div>
          </template>
        </KitTable>
      </section>
    </template>
  </div>
</template>
