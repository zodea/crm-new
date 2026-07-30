<script setup lang="ts">
import type { ScheduleProjectView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { computed } from 'vue'
import ScheduleTimeline from '~/components/schedule/ScheduleTimeline.vue'

const props = defineProps<{
  snapshot: ScheduleProjectView
  today: string
  highlightedGroupId?: string
  highlightedTaskId?: string
}>()

const emit = defineEmits<{
  selectTask: [task: ScheduleTaskView]
}>()

const overallLabel = computed(() => {
  const days = props.snapshot.deviationDays
  if (days > 0)
    return `整体领先约 ${days} 天`
  if (days < 0)
    return `整体落后约 ${Math.abs(days)} 天`
  return '按计划推进'
})

const overallTone = computed(() => {
  if (props.snapshot.deviationDays > 0)
    return 'ok' as const
  if (props.snapshot.deviationDays < 0)
    return 'warn' as const
  return 'brand' as const
})

function dottedDate(value: string | null): string {
  return value ? value.replaceAll('-', '.') : '—'
}
</script>

<template>
  <section class="home-schedule panel min-w-0 overflow-hidden" aria-labelledby="home-schedule-title">
    <header class="flex flex-wrap items-center gap-2.5 px-4 py-3">
      <span class="h-4 w-1 flex-none rounded-full bg-brand" />
      <h1 id="home-schedule-title" class="text-15px font-800 text-ink">
        施工进度
      </h1>
      <StatusChip :tone="overallTone">
        {{ overallLabel }}
      </StatusChip>
      <span class="text-12px text-ink-soft">
        开工 <strong>{{ dottedDate(snapshot.plannedStart) }}</strong>
        <span class="mx-1.5 text-ink-faint">→</span>
        计划完工 <strong>{{ dottedDate(snapshot.plannedFinish) }}</strong>
      </span>
      <span class="ml-auto text-11px text-ink-faint">
        点工序下钻工程量 · 计划编辑在施工进度页
      </span>
      <NuxtLink :to="{ path: '/schedule', query: { project: snapshot.id } }" class="btn-secondary">
        <span class="i-lucide-calendar-range mr-1" /> 打开施工进度
      </NuxtLink>
    </header>

    <ScheduleTimeline
      mode="overview"
      :snapshot="snapshot"
      :today="today"
      :highlighted-group-id="highlightedGroupId"
      :highlighted-task-id="highlightedTaskId"
      @select-task="emit('selectTask', $event)"
    />

    <footer class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-11px text-ink-soft">
      <span class="legend-item"><i class="legend-plan" />计划区间</span>
      <span class="legend-item"><i class="legend-actual" />实际完成</span>
      <span class="legend-item"><i class="legend-today" />今天</span>
      <span class="legend-item"><span class="i-lucide-link text-brand" />可下钻工程量</span>
      <span class="legend-item"><i class="legend-late" />应开未开</span>
    </footer>
  </section>
</template>

<style scoped>
.home-schedule { container-type: inline-size; }
.home-schedule strong { color: var(--ink); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.legend-item { display: inline-flex; align-items: center; gap: 5px; }
.legend-item i { display: inline-block; flex: none; }
.legend-plan { width: 18px; height: 8px; border-radius: 2px; background: color-mix(in srgb, var(--brand) 22%, transparent); }
.legend-actual { width: 12px; height: 8px; border-radius: 2px; background: var(--brand); }
.legend-today { width: 2px; height: 12px; background: var(--danger); }
.legend-late { width: 14px; height: 8px; border: 1.5px dashed var(--danger); border-radius: 2px; }

@container (max-width: 48rem) {
  .home-schedule > header { align-items: flex-start; }
  .home-schedule > header > .ml-auto { width: 100%; margin-left: 0; }
}
</style>
