<script setup lang="ts">
const props = defineProps<{ projectId: string }>()
const store = useScheduleStore()

const snapshot = computed(() => store.snapshot?.id === props.projectId ? store.snapshot : null)

async function load() {
  await store.loadProject(props.projectId)
}

watch(() => props.projectId, load)
onMounted(load)
</script>

<template>
  <section class="panel mb-3 overflow-hidden">
    <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
      <span class="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft text-brand">
        <span class="i-lucide-calendar-clock" />
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="text-13px font-800 text-ink">
          施工进度排程
        </h3>
        <p class="text-11px text-ink-faint">
          与工程量阶段完成事实共享实际进度
        </p>
      </div>
      <NuxtLink :to="{ path: '/schedule', query: { project: projectId } }" class="btn-primary">
        打开完整排程 <span class="i-lucide-arrow-right ml-1" />
      </NuxtLink>
    </div>

    <div v-if="store.loading && !snapshot" class="px-4 py-5 text-center text-11px text-ink-faint">
      正在读取排程…
    </div>
    <div v-else-if="snapshot?.groups.length" class="grid gap-3 p-4">
      <div class="grid grid-cols-3 gap-2 text-11px">
        <div class="rounded-lg bg-surface-2 p-2.5">
          <span class="text-ink-faint">计划周期</span><strong class="mt-1 block text-ink">{{ snapshot.plannedStart }} — {{ snapshot.plannedFinish }}</strong>
        </div>
        <div class="rounded-lg bg-surface-2 p-2.5">
          <span class="text-ink-faint">计划进度</span><strong class="mt-1 block text-ink">{{ Math.round(snapshot.plannedProgress * 100) }}%</strong>
        </div>
        <div class="rounded-lg bg-surface-2 p-2.5">
          <span class="text-ink-faint">实际进度</span><strong class="mt-1 block text-brand">{{ Math.round(snapshot.actualProgress * 100) }}%</strong>
        </div>
      </div>
      <div class="grid gap-2">
        <div v-for="group in snapshot.groups" :key="group.id" class="grid grid-cols-[minmax(100px,1fr)_minmax(120px,2fr)_42px] items-center gap-2 text-11px">
          <span class="truncate font-700 text-ink">{{ group.name }}</span>
          <span class="relative h-2 overflow-hidden rounded-full bg-surface-3">
            <span class="absolute inset-y-0 left-0 rounded-full bg-brand" :style="{ width: `${Math.round(group.actualProgress * 100)}%` }" />
          </span>
          <span class="text-right text-ink-soft">{{ Math.round(group.actualProgress * 100) }}%</span>
        </div>
      </div>
    </div>
    <div v-else class="flex flex-wrap items-center justify-between gap-2 px-4 py-4 text-12px text-ink-soft">
      <span>当前项目还没有施工排程。</span>
      <NuxtLink :to="{ path: '/schedule/new', query: { project: projectId } }" class="btn-secondary">
        新建楼栋分组
      </NuxtLink>
    </div>
  </section>
</template>
