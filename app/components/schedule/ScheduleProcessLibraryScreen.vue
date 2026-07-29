<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'
import { Button } from '~/components/ui/button'
import StatePanel from '~/components/ui/StatePanel.vue'

const store = useScheduleProcessLibraryStore()
const { error, libraries, loading } = storeToRefs(store)

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

onMounted(() => {
  void store.loadLibraries()
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <section class="panel flex flex-wrap items-start gap-3 p-4 sm:p-5">
      <Button as-child variant="ghost" size="icon">
        <NuxtLink to="/schedule" aria-label="返回施工进度">
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
          已被排程引用的版本保持只读；调整时基于旧版新建版本，不追溯修改既有项目。
        </p>
      </div>
      <Button as-child variant="accent">
        <NuxtLink to="/schedule/process-library/form">
          <span class="i-lucide-plus" aria-hidden="true" />
          新建空白工序库
        </NuxtLink>
      </Button>
    </section>

    <StatePanel
      v-if="loading && !libraries.length"
      kind="loading"
      title="正在读取标准工序库"
    />
    <StatePanel
      v-else-if="error && !libraries.length"
      kind="error"
      title="标准工序库读取失败"
      :description="error"
      action-label="重试"
      @action="store.loadLibraries"
    />
    <StatePanel
      v-else-if="!versionGroups.length"
      kind="empty"
      title="还没有标准工序库"
      description="从空白版本开始维护工序、工种、工期、阶段映射和前置关系。"
    >
      <template #action>
        <Button as-child variant="accent">
          <NuxtLink to="/schedule/process-library/form">
            新建标准工序库
          </NuxtLink>
        </Button>
      </template>
    </StatePanel>

    <template v-else>
      <section
        v-for="group in versionGroups"
        :key="group.code"
        class="panel min-w-0 overflow-hidden"
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
        <div class="min-w-0 overflow-x-auto overscroll-contain">
          <table class="w-full min-w-760px">
            <thead>
              <tr>
                <th>版本</th>
                <th>说明</th>
                <th>工序数</th>
                <th>引用状态</th>
                <th class="w-42">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="version in group.versions" :key="version.id">
                <td class="font-mono font-700 text-ink">
                  v{{ version.version }}
                </td>
                <td>{{ version.description || '—' }}</td>
                <td>{{ version.taskCount }} 道</td>
                <td>
                  <span
                    v-if="version.usageCount"
                    class="inline-flex rounded-full bg-surface-3 px-2 py-1 text-10px text-ink-soft"
                  >
                    已被 {{ version.usageCount }} 个排程引用 · 只读
                  </span>
                  <span v-else class="text-11px text-ink-faint">尚未引用 · 仍以新版本方式调整</span>
                </td>
                <td>
                  <Button as-child size="sm">
                    <NuxtLink
                      :to="{ path: '/schedule/process-library/form', query: { source: version.id } }"
                    >
                      基于此版本新建
                    </NuxtLink>
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
