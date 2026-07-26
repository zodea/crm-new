<script setup lang="ts">
import type { ScheduleProjectView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { calendarDays } from '~/lib/schedule/planning'

type TaskState = 'done' | 'doing' | 'late-start' | 'pending'

const props = defineProps<{
  snapshot: ScheduleProjectView
  today: string
  highlightedGroupId?: string
  highlightedTaskId?: string
}>()

const emit = defineEmits<{
  selectTask: [task: ScheduleTaskView]
}>()

const expandedGroupIds = shallowRef<Set<string>>(new Set())

watch(
  () => props.snapshot.id,
  () => {
    expandedGroupIds.value = new Set(props.snapshot.groups.map(group => group.id))
  },
  { immediate: true },
)

watch(
  () => props.highlightedGroupId,
  (groupId) => {
    if (!groupId || expandedGroupIds.value.has(groupId))
      return
    expandedGroupIds.value = new Set([...expandedGroupIds.value, groupId])
  },
  { immediate: true },
)

const axisStart = computed(() => monthStart(props.snapshot.plannedStart ?? props.today))
const axisFinish = computed(() => monthFinish(props.snapshot.plannedFinish ?? props.today))
const axisDays = computed(() => Math.max(calendarDays(axisStart.value, axisFinish.value) + 1, 1))

const monthTicks = computed(() => {
  const ticks: { key: string, label: string, left: number }[] = []
  const finish = parseDate(axisFinish.value)
  let cursor = parseDate(axisStart.value)
  while (cursor <= finish) {
    const value = formatDate(cursor)
    ticks.push({
      key: value,
      label: `${cursor.getUTCMonth() === 0 ? `${String(cursor.getUTCFullYear()).slice(2)}年` : ''}${cursor.getUTCMonth() + 1}月`,
      left: position(value),
    })
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  }
  return ticks
})

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

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`)
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`
}

function monthFinish(value: string): string {
  const date = parseDate(value)
  return formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)))
}

function position(value: string): number {
  return Math.max(0, Math.min(100, calendarDays(axisStart.value, value) / axisDays.value * 100))
}

function barWidth(start: string | null, finish: string | null): number {
  if (!start || !finish)
    return 0
  return Math.max(1.2, (calendarDays(start, finish) + 1) / axisDays.value * 100)
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function dottedDate(value: string | null): string {
  return value ? value.replaceAll('-', '.') : '—'
}

function toggleGroup(groupId: string) {
  const next = new Set(expandedGroupIds.value)
  if (next.has(groupId))
    next.delete(groupId)
  else
    next.add(groupId)
  expandedGroupIds.value = next
}

function taskState(task: ScheduleTaskView): TaskState {
  if (task.actualProgress >= 1)
    return 'done'
  if (task.actualProgress > 0)
    return 'doing'
  if (calendarDays(task.plannedStart, props.today) > 0)
    return 'late-start'
  return 'pending'
}

function taskStatusLabel(task: ScheduleTaskView): string {
  const state = taskState(task)
  const days = task.deviationDays
  if (state === 'done') {
    if (days > 0)
      return `提前${days}天`
    if (days < 0)
      return `延后${Math.abs(days)}天`
    return '按期'
  }
  if (state === 'doing') {
    const suffix = days > 0 ? ` 快${days}天` : days < 0 ? ` 慢${Math.abs(days)}天` : ''
    return `${percent(task.actualProgress)}${suffix}`
  }
  return state === 'late-start' ? '应开未开' : '待开始'
}

function taskStatusTone(task: ScheduleTaskView) {
  const state = taskState(task)
  if (state === 'done')
    return task.deviationDays < 0 ? 'danger' as const : 'ok' as const
  if (state === 'doing')
    return task.deviationDays < 0 ? 'warn' as const : 'brand' as const
  return state === 'late-start' ? 'danger' as const : 'neutral' as const
}

function groupStatus(group: ScheduleProjectView['groups'][number]): string {
  const suffix = group.deviationDays > 0 ? ' 领先' : group.deviationDays < 0 ? ' 落后' : ''
  return `${percent(group.actualProgress)}${suffix}`
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

    <div
      data-testid="home-schedule-scroll"
      class="home-schedule-scroll"
      tabindex="0"
      aria-label="首页施工进度甘特，可横向滚动"
    >
      <div class="home-schedule-grid">
        <div class="home-row home-axis">
          <div class="home-label-cell font-700 text-ink-faint">
            楼栋分组 / 工序
          </div>
          <div class="home-timeline-cell">
            <span
              v-for="tick in monthTicks"
              :key="tick.key"
              class="month-label"
              :style="{ left: `${tick.left}%` }"
            >{{ tick.label }}</span>
            <span class="today-line" :style="{ left: `${position(today)}%` }" />
            <span class="today-label" :style="{ left: `${position(today)}%` }">今天</span>
          </div>
        </div>

        <template v-for="group in snapshot.groups" :key="group.id">
          <div
            class="home-row group-row"
            :data-highlighted="group.id === highlightedGroupId ? 'true' : undefined"
          >
            <button type="button" class="home-label-cell group-button" @click="toggleGroup(group.id)">
              <span :class="expandedGroupIds.has(group.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
              <span class="truncate font-800">{{ group.name }}</span>
              <StatusChip :tone="group.deviationDays < 0 ? 'warn' : 'ok'" class="ml-auto flex-none">
                {{ groupStatus(group) }}
              </StatusChip>
            </button>
            <div class="home-timeline-cell">
              <span v-for="tick in monthTicks" :key="tick.key" class="month-line" :style="{ left: `${tick.left}%` }" />
              <span class="today-line" :style="{ left: `${position(today)}%` }" />
              <span
                v-if="group.plannedStart && group.plannedFinish"
                class="schedule-bar group-bar"
                :style="{
                  left: `${position(group.plannedStart)}%`,
                  width: `${barWidth(group.plannedStart, group.plannedFinish)}%`,
                }"
              >
                <span class="actual-fill bg-brand" :style="{ width: percent(group.actualProgress) }" />
              </span>
            </div>
          </div>

          <div
            v-for="task in expandedGroupIds.has(group.id) ? group.tasks : []"
            :key="task.id"
            class="home-row task-row"
            :data-highlighted="task.id === highlightedTaskId ? 'true' : undefined"
          >
            <button type="button" class="home-label-cell task-button" @click="emit('selectTask', task)">
              <span class="task-dot" :style="{ backgroundColor: task.color }" />
              <span class="truncate font-600">{{ task.name }}</span>
              <span v-if="task.hasQty" class="i-lucide-link flex-none text-brand" aria-label="可下钻工程量" />
              <StatusChip :tone="taskStatusTone(task)" class="ml-auto flex-none">
                {{ taskStatusLabel(task) }}
              </StatusChip>
            </button>
            <div class="home-timeline-cell">
              <span v-for="tick in monthTicks" :key="tick.key" class="month-line" :style="{ left: `${tick.left}%` }" />
              <span class="today-line" :style="{ left: `${position(today)}%` }" />
              <button
                type="button"
                class="schedule-bar task-bar"
                :class="taskState(task) === 'late-start' && 'is-late'"
                :style="{
                  'left': `${position(task.plannedStart)}%`,
                  'width': `${barWidth(task.plannedStart, task.plannedFinish)}%`,
                  '--task-color': task.color,
                }"
                :aria-label="`下钻${task.name}`"
                @click="emit('selectTask', task)"
              >
                <span class="actual-fill" :style="{ width: percent(task.actualProgress) }" />
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

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
.home-schedule-scroll { max-width: 100%; overflow-x: auto; border-block: 1px solid var(--line); outline: none; }
.home-schedule-scroll:focus-visible { box-shadow: inset 0 0 0 2px var(--brand-ring); }
.home-schedule-grid { min-width: 760px; }
.home-row { display: grid; grid-template-columns: clamp(180px, 22%, 236px) minmax(524px, 1fr); min-height: 34px; border-bottom: 1px solid var(--line); }
.home-row:last-child { border-bottom: 0; }
.home-label-cell { min-width: 0; border-right: 1px solid var(--line); padding: 6px 10px; }
.home-timeline-cell { position: relative; min-width: 0; overflow: hidden; }
.home-axis { min-height: 24px; background: var(--surface-2); color: var(--ink-soft); font-size: 10px; }
.home-axis .home-label-cell { padding-block: 4px; }
.group-row { background: color-mix(in srgb, var(--surface-2) 90%, var(--panel)); }
.group-row[data-highlighted='true'], .task-row[data-highlighted='true'] { background: var(--brand-soft); box-shadow: inset 3px 0 0 var(--brand); }
.group-button, .task-button { display: flex; width: 100%; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--ink); text-align: left; }
.group-button:hover, .task-button:hover { color: var(--brand-deep); }
.task-button { padding-left: 26px; font-size: 12px; }
.task-dot { width: 8px; height: 8px; flex: none; border-radius: 2px; }
.month-label { position: absolute; top: 4px; transform: translateX(4px); white-space: nowrap; font-family: var(--font-mono); font-weight: 700; }
.month-line, .today-line { position: absolute; inset-block: 0; width: 1px; background: var(--line); pointer-events: none; }
.month-line { border-left: 1px dashed color-mix(in srgb, var(--line) 65%, transparent); background: transparent; }
.today-line { z-index: 3; width: 2px; background: var(--danger); opacity: .55; }
.today-label { position: absolute; z-index: 4; top: -1px; transform: translateX(-50%); border-radius: 3px; background: var(--danger-soft); padding-inline: 4px; color: var(--danger); font-size: 9px; font-weight: 800; }
.schedule-bar { position: absolute; top: 8px; bottom: 8px; min-width: 6px; overflow: hidden; border-radius: 4px; }
.group-bar { border: 1px solid var(--line-strong); background: var(--surface-3); }
.task-bar { border: 0; background: color-mix(in srgb, var(--task-color) 22%, transparent); cursor: pointer; }
.task-bar:hover { box-shadow: 0 0 0 2px var(--brand-ring); }
.task-bar.is-late { border: 1.5px dashed var(--danger); }
.actual-fill { position: absolute; inset-block: 0; left: 0; max-width: 100%; border-radius: 3px; background: var(--task-color); opacity: .95; }
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
