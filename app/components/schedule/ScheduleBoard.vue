<script setup lang="ts">
import type { ScheduleGroupView, ScheduleProjectView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { addCalendarDays, calendarDays } from '~/lib/schedule/planning'

type BoardRow
  = | { kind: 'project', id: string, label: string, start: string | null, finish: string | null, actual: number, planned: number, deviation: number }
    | { kind: 'group', id: string, label: string, group: ScheduleGroupView, start: string | null, finish: string | null, actual: number, planned: number, deviation: number }
    | { kind: 'task', id: string, label: string, task: ScheduleTaskView, start: string, finish: string, actual: number, planned: number, deviation: number }

const props = defineProps<{
  snapshot: ScheduleProjectView
  today: string
  highlightedGroupId?: string
}>()

const emit = defineEmits<{
  selectTask: [task: ScheduleTaskView]
  addTask: [group: ScheduleGroupView]
}>()

const view = shallowRef<'wbs' | 'gantt'>('wbs')
const collapsedIds = shallowRef<Set<string>>(new Set())

const rows = computed<BoardRow[]>(() => {
  const source: BoardRow[] = [{
    kind: 'project',
    id: props.snapshot.id,
    label: props.snapshot.name,
    start: props.snapshot.plannedStart,
    finish: props.snapshot.plannedFinish,
    actual: props.snapshot.actualProgress,
    planned: props.snapshot.plannedProgress,
    deviation: props.snapshot.deviationDays,
  }]
  for (const group of props.snapshot.groups) {
    source.push({
      kind: 'group',
      id: group.id,
      label: group.name,
      group,
      start: group.plannedStart,
      finish: group.plannedFinish,
      actual: group.actualProgress,
      planned: group.plannedProgress,
      deviation: group.deviationDays,
    })
    if (!collapsedIds.value.has(group.id)) {
      for (const task of group.tasks) {
        source.push({
          kind: 'task',
          id: task.id,
          label: task.name,
          task,
          start: task.plannedStart,
          finish: task.plannedFinish,
          actual: task.actualProgress,
          planned: task.plannedProgress,
          deviation: task.deviationDays,
        })
      }
    }
  }
  return source
})

const axisStart = computed(() => addCalendarDays(props.snapshot.plannedStart ?? props.today, -3))
const axisFinish = computed(() => addCalendarDays(props.snapshot.plannedFinish ?? props.today, 3))
const axisDays = computed(() => Math.max(calendarDays(axisStart.value, axisFinish.value) + 1, 1))

const monthTicks = computed(() => {
  const ticks: { key: string, label: string, left: number }[] = []
  const start = new Date(`${axisStart.value}T00:00:00Z`)
  const finish = new Date(`${axisFinish.value}T00:00:00Z`)
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
  while (cursor <= finish) {
    const value = cursor.toISOString().slice(0, 10)
    ticks.push({
      key: value,
      label: `${cursor.getUTCMonth() + 1}月`,
      left: position(value),
    })
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  }
  return ticks
})

const dependencyPaths = computed(() => {
  const taskById = new Map(props.snapshot.groups.flatMap(group => group.tasks).map(task => [task.id, task]))
  const rowIndexById = new Map(rows.value.map((row, index) => [row.id, index]))
  return props.snapshot.dependencies.flatMap((dependency) => {
    const predecessor = taskById.get(dependency.predId)
    const successor = taskById.get(dependency.succId)
    const predecessorIndex = rowIndexById.get(dependency.predId)
    const successorIndex = rowIndexById.get(dependency.succId)
    if (!predecessor || !successor || predecessorIndex == null || successorIndex == null)
      return []
    const fromX = position(predecessor.plannedFinish)
    const toX = position(successor.plannedStart)
    const elbowX = Math.max(fromX + 1.2, (fromX + toX) / 2)
    const fromY = predecessorIndex * 36 + 18
    const toY = successorIndex * 36 + 18
    return [{
      id: dependency.id,
      d: `M ${fromX} ${fromY} H ${elbowX} V ${toY} H ${toX}`,
    }]
  })
})

function position(value: string): number {
  return Math.max(0, Math.min(100, calendarDays(axisStart.value, value) / axisDays.value * 100))
}

function width(start: string | null, finish: string | null): number {
  if (!start || !finish)
    return 0
  return Math.max(0.8, (calendarDays(start, finish) + 1) / axisDays.value * 100)
}

function toggle(groupId: string) {
  const next = new Set(collapsedIds.value)
  if (next.has(groupId))
    next.delete(groupId)
  else
    next.add(groupId)
  collapsedIds.value = next
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function deviationLabel(days: number): string {
  if (!days)
    return '正常'
  return days > 0 ? `提前 ${days}天` : `滞后 ${Math.abs(days)}天`
}

function dependencyLabel(taskId: string): string {
  const dependency = props.snapshot.dependencies.find(candidate => candidate.succId === taskId)
  if (!dependency)
    return ''
  const predecessor = props.snapshot.groups.flatMap(group => group.tasks).find(task => task.id === dependency.predId)
  const lag = dependency.lagDays ? `${dependency.lagDays > 0 ? '+' : ''}${dependency.lagDays}天` : ''
  return `${predecessor?.name ?? '前置'} · ${dependency.dependencyType}${lag}`
}
</script>

<template>
  <section class="schedule-board panel min-w-0 overflow-hidden" :data-view="view">
    <header class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
      <div>
        <div class="text-13px font-800 text-ink">
          WBS 与计划时间轴
        </div>
        <div class="text-11px text-ink-faint">
          行高同源 · 工序计划与工程量实际进度联动
        </div>
      </div>
      <div class="inline-flex rounded-[var(--radius-btn)] bg-surface-3 p-0.5" aria-label="移动端视图切换">
        <button type="button" class="view-button" :class="view === 'wbs' && 'is-active'" @click="view = 'wbs'">
          WBS
        </button>
        <button type="button" class="view-button" :class="view === 'gantt' && 'is-active'" @click="view = 'gantt'">
          甘特
        </button>
      </div>
    </header>

    <div data-testid="schedule-scroll" class="schedule-scroll" tabindex="0" aria-label="施工进度排程表，可横向滚动">
      <div class="schedule-grid">
        <div class="wbs-cell wbs-head">
          <span>WBS / 工序</span><span>工期</span><span>计划开始</span><span>计划完成</span><span>实际</span><span>偏差</span>
        </div>
        <div class="timeline-cell timeline-head">
          <span
            v-for="tick in monthTicks"
            :key="tick.key"
            class="month-tick"
            :style="{ left: `${tick.left}%` }"
          >{{ tick.label }}</span>
          <span class="today-line" :style="{ left: `${position(today)}%` }" />
        </div>

        <svg
          v-if="dependencyPaths.length"
          class="dependency-overlay"
          :viewBox="`0 0 100 ${rows.length * 36}`"
          :style="{ height: `${rows.length * 36}px` }"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <marker id="schedule-dependency-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
              <path d="M0,0 L5,2.5 L0,5 Z" fill="var(--ink-faint)" />
            </marker>
          </defs>
          <path
            v-for="dependency in dependencyPaths"
            :key="dependency.id"
            :d="dependency.d"
            class="dependency-path"
            marker-end="url(#schedule-dependency-arrow)"
          />
        </svg>

        <template v-for="row in rows" :key="row.id">
          <div
            class="wbs-cell schedule-row"
            :data-kind="row.kind"
            :data-highlighted="row.kind === 'group' && row.id === highlightedGroupId ? 'true' : undefined"
          >
            <div class="min-w-0 flex items-center gap-1.5" :class="row.kind === 'task' && 'pl-8'">
              <button
                v-if="row.kind === 'group'"
                type="button"
                class="grid h-5 w-5 flex-none place-items-center text-ink-soft"
                :aria-label="collapsedIds.has(row.id) ? '展开分组' : '折叠分组'"
                @click="toggle(row.id)"
              >
                <span :class="collapsedIds.has(row.id) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" />
              </button>
              <span v-else-if="row.kind === 'project'" class="i-lucide-folder-kanban flex-none text-brand" />
              <span v-else class="h-2 w-2 flex-none rounded-full" :style="{ background: row.task.color }" />
              <button
                v-if="row.kind === 'task'"
                type="button"
                class="truncate text-left hover:text-brand"
                @click="emit('selectTask', row.task)"
              >
                {{ row.label }}
              </button>
              <span v-else class="truncate">{{ row.label }}</span>
              <button
                v-if="row.kind === 'group'"
                type="button"
                class="ml-auto grid h-5 w-5 flex-none place-items-center rounded text-brand hover:bg-brand-soft"
                aria-label="追加工序"
                @click="emit('addTask', row.group)"
              >
                <span class="i-lucide-plus" />
              </button>
            </div>
            <span>{{ row.start && row.finish ? calendarDays(row.start, row.finish) + 1 : '—' }}天</span>
            <span>{{ row.start ?? '—' }}</span>
            <span>{{ row.finish ?? '—' }}</span>
            <span>{{ percent(row.actual) }}</span>
            <span :class="row.deviation < 0 ? 'text-danger' : row.deviation > 0 ? 'text-ok' : 'text-ink-soft'">
              {{ deviationLabel(row.deviation) }}
            </span>
          </div>

          <div class="timeline-cell schedule-row" :data-kind="row.kind">
            <span v-for="tick in monthTicks" :key="tick.key" class="grid-line" :style="{ left: `${tick.left}%` }" />
            <span class="today-line" :style="{ left: `${position(today)}%` }" />
            <button
              v-if="row.start && row.finish"
              type="button"
              class="plan-bar"
              :class="row.kind !== 'task' && 'is-rollup'"
              :style="{
                'left': `${position(row.start)}%`,
                'width': `${width(row.start, row.finish)}%`,
                '--bar-color': row.kind === 'task' ? row.task.color : 'var(--brand)',
              }"
              :disabled="row.kind !== 'task'"
              :title="`${row.label}：${row.start} 至 ${row.finish}`"
              @click="row.kind === 'task' && emit('selectTask', row.task)"
            >
              <span class="actual-fill" :style="{ width: percent(row.actual) }" />
              <span v-if="row.kind === 'task' && row.task.baselineStart" class="baseline-mark" />
            </button>
            <span v-if="row.kind === 'task' && dependencyLabel(row.id)" class="dependency-label">
              {{ dependencyLabel(row.id) }}
            </span>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.schedule-board { container-type: inline-size; }
.schedule-scroll { max-width: 100%; overflow-x: auto; outline: none; }
.schedule-scroll:focus-visible { box-shadow: inset 0 0 0 2px var(--brand-ring); }
.schedule-grid { position: relative; display: grid; grid-template-columns: 590px minmax(600px, 1fr); min-width: 1190px; }
.wbs-cell { display: grid; grid-template-columns: minmax(190px, 2fr) 46px 78px 78px 48px 72px; align-items: center; gap: 6px; border-right: 1px solid var(--line); padding-inline: 10px; }
.wbs-cell > span:not(:first-child), .month-tick, .dependency-label { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.timeline-cell { position: relative; min-width: 0; overflow: hidden; }
.wbs-head, .timeline-head { position: sticky; top: 0; z-index: 4; height: 34px; border-bottom: 1px solid var(--line); background: var(--surface-2); color: var(--ink-faint); font-size: 10px; font-weight: 700; }
.schedule-row { height: 36px; border-bottom: 1px solid var(--line); font-size: 11px; }
.schedule-row[data-kind='project'] { background: color-mix(in srgb, var(--brand-soft) 45%, var(--panel)); font-weight: 800; }
.schedule-row[data-kind='group'] { background: var(--surface-2); font-weight: 700; }
.schedule-row[data-highlighted='true'] { background: var(--brand-soft); box-shadow: inset 3px 0 0 var(--brand); }
.month-tick { position: absolute; top: 9px; transform: translateX(4px); white-space: nowrap; }
.grid-line, .today-line { position: absolute; inset-block: 0; width: 1px; background: var(--line); pointer-events: none; }
.today-line { z-index: 3; width: 2px; background: var(--danger); opacity: .65; }
.plan-bar { position: absolute; top: 9px; height: 18px; min-width: 6px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--bar-color) 76%, var(--ink)); border-radius: 4px; background: color-mix(in srgb, var(--bar-color) 18%, var(--panel)); cursor: pointer; }
.plan-bar.is-rollup { top: 11px; height: 14px; border-radius: 2px; cursor: default; }
.actual-fill { position: absolute; inset-block: 0; left: 0; max-width: 100%; background: var(--bar-color); opacity: .82; }
.baseline-mark { position: absolute; inset: 2px; border: 1px dashed var(--ink); opacity: .55; }
.dependency-label { position: absolute; right: 5px; top: 10px; max-width: 44%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-faint); font-size: 9px; }
.dependency-overlay { position: absolute; z-index: 3; top: 34px; left: 590px; width: calc(100% - 590px); overflow: visible; pointer-events: none; }
.dependency-path { fill: none; stroke: var(--ink-faint); stroke-width: 1; stroke-dasharray: 3 2; vector-effect: non-scaling-stroke; }
.view-button { border-radius: calc(var(--radius-btn) - 2px); padding: 4px 10px; color: var(--ink-soft); font-size: 11px; }
.view-button.is-active { background: var(--panel); color: var(--brand-deep); box-shadow: var(--shadow-card); font-weight: 700; }

@container (min-width: 52.01rem) {
  .view-button { display: none; }
}

@container (max-width: 52rem) {
  .schedule-board[data-view='wbs'] .schedule-grid { grid-template-columns: minmax(560px, 1fr); min-width: 560px; }
  .schedule-board[data-view='wbs'] .timeline-cell { display: none; }
  .schedule-board[data-view='wbs'] .dependency-overlay { display: none; }
  .schedule-board[data-view='gantt'] .schedule-grid { grid-template-columns: minmax(660px, 1fr); min-width: 660px; }
  .schedule-board[data-view='gantt'] .wbs-cell { display: none; }
  .schedule-board[data-view='gantt'] .dependency-overlay { left: 0; width: 100%; }
}
</style>
