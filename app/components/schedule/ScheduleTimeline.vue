<script setup lang="ts">
import type { ScheduleGroupView, ScheduleProjectView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { computed, shallowRef, watch } from 'vue'
import {
  calendarDays,
  rescheduledTaskWindow,
} from '~/lib/schedule/planning'

type TimelineMode = 'overview' | 'workspace'
type MobileView = 'wbs' | 'gantt'
type TaskState = 'done' | 'doing' | 'late-start' | 'pending'

type TimelineRow
  = | { kind: 'project', id: string, label: string, start: string | null, finish: string | null, actual: number, deviation: number }
    | { kind: 'group', id: string, label: string, group: ScheduleGroupView, start: string | null, finish: string | null, actual: number, deviation: number }
    | { kind: 'task', id: string, label: string, task: ScheduleTaskView, start: string, finish: string, actual: number, deviation: number }

const props = withDefaults(defineProps<{
  snapshot: ScheduleProjectView
  today: string
  mode?: TimelineMode
  highlightedGroupId?: string
  highlightedTaskId?: string
}>(), {
  mode: 'workspace',
  highlightedGroupId: '',
  highlightedTaskId: '',
})

const emit = defineEmits<{
  selectTask: [task: ScheduleTaskView]
  addTask: [group: ScheduleGroupView]
  rescheduleTask: [payload: {
    task: ScheduleTaskView
    plannedStart: string
    plannedFinish: string
  }]
}>()

const mobileView = shallowRef<MobileView>('wbs')
const expandedGroupIds = shallowRef<Set<string>>(new Set())
const drag = shallowRef<{
  task: ScheduleTaskView
  mode: 'move' | 'resize-finish'
  pointerId: number
  startX: number
  chartWidth: number
  deltaDays: number
} | null>(null)
const dragPreview = shallowRef<{
  taskId: string
  plannedStart: string
  plannedFinish: string
} | null>(null)
const draggedRecently = shallowRef(false)

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

const rows = computed<TimelineRow[]>(() => {
  const result: TimelineRow[] = []
  if (props.mode === 'workspace') {
    result.push({
      kind: 'project',
      id: props.snapshot.id,
      label: props.snapshot.name,
      start: props.snapshot.plannedStart,
      finish: props.snapshot.plannedFinish,
      actual: props.snapshot.actualProgress,
      deviation: props.snapshot.deviationDays,
    })
  }

  for (const group of props.snapshot.groups) {
    result.push({
      kind: 'group',
      id: group.id,
      label: group.name,
      group,
      start: group.plannedStart,
      finish: group.plannedFinish,
      actual: group.actualProgress,
      deviation: group.deviationDays,
    })
    if (!expandedGroupIds.value.has(group.id))
      continue
    for (const task of group.tasks) {
      result.push({
        kind: 'task',
        id: task.id,
        label: task.name,
        task,
        start: task.plannedStart,
        finish: task.plannedFinish,
        actual: task.actualProgress,
        deviation: task.deviationDays,
      })
    }
  }
  return result
})

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

const dependencyPaths = computed(() => {
  if (props.mode !== 'workspace')
    return []
  const taskById = new Map(props.snapshot.groups.flatMap(group => group.tasks).map(task => [task.id, task]))
  const rowIndexById = new Map(rows.value.map((row, index) => [row.id, index]))
  return [
    ...props.snapshot.dependencies.map(dependency => ({ dependency, disabled: false })),
    ...props.snapshot.disabledDependencies.map(dependency => ({ dependency, disabled: true })),
  ].flatMap(({ dependency, disabled }) => {
    const predecessor = taskById.get(dependency.predId)
    const successor = taskById.get(dependency.succId)
    const predecessorIndex = rowIndexById.get(dependency.predId)
    const successorIndex = rowIndexById.get(dependency.succId)
    if (!predecessor || !successor || predecessorIndex == null || successorIndex == null)
      return []
    const fromX = position(predecessor.plannedFinish)
    const toX = position(successor.plannedStart)
    const elbowX = Math.max(fromX + 1.2, (fromX + toX) / 2)
    return [{
      id: dependency.id,
      disabled,
      d: `M ${fromX} ${predecessorIndex * 36 + 18} H ${elbowX} V ${successorIndex * 36 + 18} H ${toX}`,
    }]
  })
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
  return Math.max(0.8, (calendarDays(start, finish) + 1) / axisDays.value * 100)
}

function displayStart(row: TimelineRow): string | null {
  return row.kind === 'task' && dragPreview.value?.taskId === row.id
    ? dragPreview.value.plannedStart
    : row.start
}

function displayFinish(row: TimelineRow): string | null {
  return row.kind === 'task' && dragPreview.value?.taskId === row.id
    ? dragPreview.value.plannedFinish
    : row.finish
}

function barStart(row: TimelineRow): string {
  return displayStart(row) ?? axisStart.value
}

function barFinish(row: TimelineRow): string {
  return displayFinish(row) ?? axisStart.value
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function deviationLabel(days: number): string {
  if (!days)
    return '正常'
  return days > 0 ? `提前 ${days}天` : `滞后 ${Math.abs(days)}天`
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
  if (state === 'done')
    return task.deviationDays ? deviationLabel(task.deviationDays).replace(' ', '') : '按期'
  if (state === 'doing') {
    const pace = task.deviationDays > 0
      ? ` 快${task.deviationDays}天`
      : task.deviationDays < 0 ? ` 慢${Math.abs(task.deviationDays)}天` : ''
    return `${percent(task.actualProgress)}${pace}`
  }
  return state === 'late-start' ? '应开未开' : '待开始'
}

function groupStatusLabel(group: ScheduleGroupView): string {
  const pace = group.deviationDays > 0 ? ' 领先' : group.deviationDays < 0 ? ' 落后' : ''
  return `${percent(group.actualProgress)}${pace}`
}

function dependencyLabel(taskId: string): string {
  const dependency = props.snapshot.dependencies.find(candidate => candidate.succId === taskId)
  if (!dependency)
    return ''
  const predecessor = props.snapshot.groups.flatMap(group => group.tasks).find(task => task.id === dependency.predId)
  const lag = dependency.lagDays ? `${dependency.lagDays > 0 ? '+' : ''}${dependency.lagDays}天` : ''
  return `${predecessor?.name ?? '前置'} · ${dependency.dependencyType}${lag}`
}

function toggleGroup(groupId: string) {
  const next = new Set(expandedGroupIds.value)
  if (next.has(groupId))
    next.delete(groupId)
  else
    next.add(groupId)
  expandedGroupIds.value = next
}

function isHighlighted(row: TimelineRow): boolean {
  return row.kind === 'group'
    ? row.id === props.highlightedGroupId
    : row.kind === 'task' && row.id === props.highlightedTaskId
}

function applyDragPreview() {
  if (!drag.value)
    return
  const next = rescheduledTaskWindow({
    plannedStart: drag.value.task.plannedStart,
    plannedFinish: drag.value.task.plannedFinish,
    deltaDays: drag.value.deltaDays,
    mode: drag.value.mode,
  })
  dragPreview.value = {
    taskId: drag.value.task.id,
    ...next,
  }
}

function startDrag(event: PointerEvent, task: ScheduleTaskView, mode: 'move' | 'resize-finish') {
  if (props.mode !== 'workspace')
    return
  const target = event.currentTarget as HTMLElement
  const chart = target.closest('.chart-cell')
  if (!chart)
    return
  event.preventDefault()
  event.stopPropagation()
  target.setPointerCapture(event.pointerId)
  drag.value = {
    task,
    mode,
    pointerId: event.pointerId,
    startX: event.clientX,
    chartWidth: Math.max(chart.getBoundingClientRect().width, 1),
    deltaDays: 0,
  }
  dragPreview.value = {
    taskId: task.id,
    plannedStart: task.plannedStart,
    plannedFinish: task.plannedFinish,
  }
}

function updateDragPreview(clientX: number) {
  if (!drag.value)
    return
  drag.value = {
    ...drag.value,
    deltaDays: Math.round((clientX - drag.value.startX) / drag.value.chartWidth * axisDays.value),
  }
  applyDragPreview()
}

function moveDrag(event: PointerEvent) {
  if (!drag.value || drag.value.pointerId !== event.pointerId)
    return
  updateDragPreview(event.clientX)
}

function finishDrag(event: PointerEvent) {
  if (!drag.value || drag.value.pointerId !== event.pointerId)
    return
  updateDragPreview(event.clientX)
  const preview = dragPreview.value
  const current = drag.value
  drag.value = null
  dragPreview.value = null
  if (!preview || !current.deltaDays)
    return
  draggedRecently.value = true
  setTimeout(() => {
    draggedRecently.value = false
  }, 0)
  emit('rescheduleTask', {
    task: current.task,
    plannedStart: preview.plannedStart,
    plannedFinish: preview.plannedFinish,
  })
}

function cancelDrag(event: PointerEvent) {
  if (!drag.value || drag.value.pointerId !== event.pointerId)
    return
  drag.value = null
  dragPreview.value = null
}

function openTaskFromBar(task: ScheduleTaskView) {
  if (!draggedRecently.value)
    emit('selectTask', task)
}

function nudgeTask(task: ScheduleTaskView, mode: 'move' | 'resize-finish', deltaDays: number) {
  if (props.mode !== 'workspace')
    return
  emit('rescheduleTask', {
    task,
    ...rescheduledTaskWindow({
      plannedStart: task.plannedStart,
      plannedFinish: task.plannedFinish,
      deltaDays,
      mode,
    }),
  })
}
</script>

<template>
  <div
    class="schedule-timeline"
    :data-mode="mode"
    :data-view="mobileView"
  >
    <div v-if="mode === 'workspace'" class="mobile-view-switch" aria-label="移动端视图切换">
      <button type="button" class="view-button" :class="mobileView === 'wbs' && 'is-active'" @click="mobileView = 'wbs'">
        WBS
      </button>
      <button type="button" class="view-button" :class="mobileView === 'gantt' && 'is-active'" @click="mobileView = 'gantt'">
        甘特
      </button>
    </div>

    <div
      :data-testid="mode === 'overview' ? 'home-schedule-scroll' : 'schedule-scroll'"
      class="timeline-scroll"
      tabindex="0"
      :aria-label="mode === 'overview' ? '首页施工进度甘特，可横向滚动' : '施工进度排程表，可横向滚动'"
    >
      <div class="timeline-grid" role="grid" aria-label="施工排程时间轴">
        <div class="timeline-row" role="row">
          <div class="label-cell axis-cell" role="columnheader">
            <template v-if="mode === 'workspace'">
              <span>WBS / 工序</span><span>工期</span><span>计划开始</span><span>计划完成</span><span>实际</span><span>偏差</span>
            </template>
            <span v-else>楼栋分组 / 工序</span>
          </div>
          <div class="chart-cell axis-cell" role="columnheader">
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
            :class="dependency.disabled && 'is-disabled'"
            marker-end="url(#schedule-dependency-arrow)"
          />
        </svg>

        <div v-for="row in rows" :key="row.id" class="timeline-row" role="row">
          <div
            class="label-cell data-row"
            :data-kind="row.kind"
            :data-highlighted="isHighlighted(row) ? 'true' : undefined"
            role="gridcell"
          >
            <div class="label-main" :class="row.kind === 'task' && 'is-task'">
              <button
                v-if="row.kind === 'group'"
                type="button"
                class="toggle-button"
                :aria-label="`${expandedGroupIds.has(row.id) ? '折叠' : '展开'}分组：${row.label}`"
                @click="toggleGroup(row.id)"
              >
                <span :class="expandedGroupIds.has(row.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" />
              </button>
              <span v-else-if="row.kind === 'project'" class="i-lucide-folder-kanban flex-none text-brand" />
              <span v-else class="task-dot" :style="{ backgroundColor: row.task.color }" />

              <button
                v-if="row.kind === 'task'"
                type="button"
                class="task-name"
                :aria-label="row.label"
                @click="emit('selectTask', row.task)"
              >
                {{ row.label }}
              </button>
              <span v-else class="truncate">{{ row.label }}</span>

              <span v-if="row.kind === 'task' && row.task.hasQty" class="i-lucide-link flex-none text-brand" aria-label="可下钻工程量" />
              <template v-if="row.kind === 'group' && row.group.scopeBasis === 'provisional'">
                <span class="pending-contract-chip">待绑定合同</span>
                <NuxtLink
                  v-if="mode === 'workspace'"
                  :to="`/schedule/${row.group.projectId}/bind/${row.group.id}`"
                  class="binding-entry"
                  aria-label="绑定施工合同"
                >
                  <span class="i-lucide-link-2" aria-hidden="true" />
                  <span>绑定</span>
                </NuxtLink>
              </template>
              <span v-if="mode === 'overview' && row.kind === 'group'" class="status-label">
                {{ groupStatusLabel(row.group) }}
              </span>
              <span v-if="mode === 'overview' && row.kind === 'task'" class="status-label">
                {{ taskStatusLabel(row.task) }}
              </span>
              <button
                v-if="mode === 'workspace' && row.kind === 'group'"
                type="button"
                class="add-task-button"
                :aria-label="`向${row.label}追加工序`"
                @click="emit('addTask', row.group)"
              >
                <span class="i-lucide-plus" />
              </button>
            </div>

            <template v-if="mode === 'workspace'">
              <span>{{ row.start && row.finish ? calendarDays(row.start, row.finish) + 1 : '—' }}天</span>
              <span>{{ row.start ?? '—' }}</span>
              <span>{{ row.finish ?? '—' }}</span>
              <span>{{ percent(row.actual) }}</span>
              <span :class="row.deviation < 0 ? 'text-danger' : row.deviation > 0 ? 'text-ok' : 'text-ink-soft'">
                {{ deviationLabel(row.deviation) }}
              </span>
            </template>
          </div>

          <div class="chart-cell data-row" :data-kind="row.kind" role="gridcell">
            <span v-for="tick in monthTicks" :key="tick.key" class="month-line" :style="{ left: `${tick.left}%` }" />
            <span class="today-line" :style="{ left: `${position(today)}%` }" />
            <button
              v-if="row.start && row.finish"
              type="button"
              class="plan-bar"
              :class="[
                row.kind !== 'task' && 'is-rollup',
                row.kind === 'task' && taskState(row.task) === 'late-start' && 'is-late',
              ]"
              :style="{
                'left': `${position(barStart(row))}%`,
                'width': `${barWidth(displayStart(row), displayFinish(row))}%`,
                '--bar-color': row.kind === 'task' ? row.task.color : 'var(--brand)',
              }"
              :disabled="row.kind !== 'task'"
              :aria-label="row.kind === 'task' ? `移动工序：${row.label}` : undefined"
              :title="`${row.label}：${displayStart(row)} 至 ${displayFinish(row)}；拖动整体可调日期`"
              @click="row.kind === 'task' && openTaskFromBar(row.task)"
              @pointerdown="row.kind === 'task' && startDrag($event, row.task, 'move')"
              @pointermove="moveDrag"
              @pointerup="finishDrag"
              @pointercancel="cancelDrag"
              @keydown.left.prevent="row.kind === 'task' && nudgeTask(row.task, 'move', -1)"
              @keydown.right.prevent="row.kind === 'task' && nudgeTask(row.task, 'move', 1)"
            >
              <span class="actual-fill" :style="{ width: percent(row.actual) }" />
              <span v-if="row.kind === 'task' && row.task.baselineStart" class="baseline-mark" />
            </button>
            <button
              v-if="mode === 'workspace' && row.kind === 'task'"
              type="button"
              class="duration-handle"
              :style="{ left: `calc(${position(barFinish(row))}% - 5px)` }"
              :aria-label="`调整工期：${row.label}`"
              title="拖动右缘调整计划完成日；左缘保持不动"
              @pointerdown="startDrag($event, row.task, 'resize-finish')"
              @pointermove="moveDrag"
              @pointerup="finishDrag"
              @pointercancel="cancelDrag"
              @keydown.left.prevent="nudgeTask(row.task, 'resize-finish', -1)"
              @keydown.right.prevent="nudgeTask(row.task, 'resize-finish', 1)"
            />
            <span v-if="mode === 'workspace' && row.kind === 'task' && dependencyLabel(row.id)" class="dependency-label">
              {{ dependencyLabel(row.id) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.schedule-timeline { min-width: 0; container-type: inline-size; }
.timeline-scroll { max-width: 100%; overflow-x: auto; outline: none; }
.timeline-scroll:focus-visible { box-shadow: inset 0 0 0 2px var(--brand-ring); }
.timeline-grid { position: relative; display: grid; }
.timeline-row { display: contents; }
.label-cell { min-width: 0; border-right: 1px solid var(--line); }
.chart-cell { position: relative; min-width: 0; overflow: hidden; }
.axis-cell { position: sticky; top: 0; z-index: 4; height: 34px; border-bottom: 1px solid var(--line); background: var(--surface-2); color: var(--ink-faint); font-size: 10px; font-weight: 700; }
.data-row { height: 36px; border-bottom: 1px solid var(--line); font-size: 11px; }
.label-main { min-width: 0; display: flex; align-items: center; gap: 6px; }
.label-main.is-task { padding-left: 32px; }
.task-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); text-align: left; }
.task-name:hover { color: var(--brand); }
.task-dot { width: 8px; height: 8px; flex: none; border-radius: 2px; }
.toggle-button { display: grid; width: 20px; height: 20px; flex: none; place-items: center; color: var(--ink-soft); }
.add-task-button { display: grid; width: 20px; height: 20px; flex: none; place-items: center; border-radius: var(--radius-sm); color: var(--brand); }
.add-task-button:hover { background: var(--brand-soft); }
.pending-contract-chip { flex: none; border-radius: 999px; background: var(--warn-soft); padding: 2px 6px; color: var(--warn-ink); font-size: 9px; font-weight: 700; line-height: 1; }
.binding-entry { display: inline-flex; flex: none; align-items: center; gap: 2px; border-radius: var(--radius-sm); color: var(--brand-deep); font-size: 9px; font-weight: 700; }
.binding-entry:hover { color: var(--brand); text-decoration: underline; }
.status-label { margin-left: auto; flex: none; color: var(--ink-soft); font-family: var(--font-mono); font-size: 10px; font-variant-numeric: tabular-nums; }
.month-label { position: absolute; top: 9px; transform: translateX(4px); white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.month-line, .today-line { position: absolute; inset-block: 0; width: 1px; background: var(--line); pointer-events: none; }
.month-line { border-left: 1px dashed color-mix(in srgb, var(--line) 65%, transparent); background: transparent; }
.today-line { z-index: 3; width: 2px; background: var(--danger); opacity: .6; }
.today-label { position: absolute; z-index: 4; top: -1px; transform: translateX(-50%); border-radius: var(--radius-sm); background: var(--danger-soft); padding-inline: 4px; color: var(--danger); font-size: 9px; font-weight: 800; }
.plan-bar { position: absolute; top: 9px; height: 18px; min-width: 6px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--bar-color) 76%, var(--ink)); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--bar-color) 18%, var(--panel)); cursor: grab; touch-action: none; }
.plan-bar:active { cursor: grabbing; }
.plan-bar:hover:not(:disabled) { box-shadow: 0 0 0 2px var(--brand-ring); }
.plan-bar.is-rollup { top: 11px; height: 14px; border-radius: 2px; cursor: default; }
.plan-bar.is-late { border: 1.5px dashed var(--danger); }
.actual-fill { position: absolute; inset-block: 0; left: 0; max-width: 100%; border-radius: 2px; background: var(--bar-color); opacity: .86; }
.baseline-mark { position: absolute; inset: 2px; border: 1px dashed var(--ink); opacity: .55; }
.duration-handle { position: absolute; z-index: 4; top: 7px; width: 10px; height: 22px; border-inline: 2px solid var(--brand-deep); border-radius: 2px; cursor: ew-resize; touch-action: none; opacity: 0; }
.chart-cell:hover .duration-handle, .duration-handle:focus-visible { opacity: .9; background: color-mix(in srgb, var(--panel) 72%, transparent); }
.dependency-label { position: absolute; right: 5px; top: 10px; max-width: 44%; overflow: hidden; color: var(--ink-faint); font-family: var(--font-mono); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.dependency-overlay { position: absolute; z-index: 3; top: 34px; overflow: visible; pointer-events: none; }
.dependency-path { fill: none; stroke: var(--ink-faint); stroke-width: 1; stroke-dasharray: 3 2; vector-effect: non-scaling-stroke; }
.dependency-path.is-disabled { stroke: var(--line-strong); stroke-width: 1.5; stroke-dasharray: 2 4; opacity: .55; }
.mobile-view-switch { display: none; align-items: center; width: max-content; margin: 8px 10px; border-radius: var(--radius-btn); background: var(--surface-3); padding: 2px; }
.view-button { border-radius: calc(var(--radius-btn) - 2px); padding: 4px 10px; color: var(--ink-soft); font-size: 11px; }
.view-button.is-active { background: var(--panel); color: var(--brand-deep); box-shadow: var(--shadow-card); font-weight: 700; }

.schedule-timeline[data-mode='overview'] .timeline-grid { grid-template-columns: clamp(180px, 22%, 236px) minmax(524px, 1fr); min-width: 760px; }
.schedule-timeline[data-mode='overview'] .label-cell { display: flex; align-items: center; padding-inline: 10px; }
.schedule-timeline[data-mode='overview'] .data-row[data-kind='group'] { background: color-mix(in srgb, var(--surface-2) 90%, var(--panel)); font-weight: 700; }
.schedule-timeline[data-mode='overview'] .data-row[data-kind='task'] { background: var(--panel); }

.schedule-timeline[data-mode='workspace'] .timeline-grid { grid-template-columns: 590px minmax(600px, 1fr); min-width: 1190px; }
.schedule-timeline[data-mode='workspace'] .label-cell { display: grid; grid-template-columns: minmax(190px, 2fr) 46px 78px 78px 48px 72px; align-items: center; gap: 6px; padding-inline: 10px; }
.schedule-timeline[data-mode='workspace'] .label-cell > span:not(:first-child) { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.schedule-timeline[data-mode='workspace'] .data-row[data-kind='project'] { background: color-mix(in srgb, var(--brand-soft) 45%, var(--panel)); font-weight: 800; }
.schedule-timeline[data-mode='workspace'] .data-row[data-kind='group'] { background: var(--surface-2); font-weight: 700; }
.schedule-timeline[data-mode='workspace'] .dependency-overlay { left: 590px; width: calc(100% - 590px); }

.data-row[data-highlighted='true'] { background: var(--brand-soft) !important; box-shadow: inset 3px 0 0 var(--brand); }

@container (max-width: 52rem) {
  .schedule-timeline[data-mode='workspace'] .mobile-view-switch { display: inline-flex; }
  .schedule-timeline[data-mode='workspace'][data-view='wbs'] .timeline-grid { grid-template-columns: minmax(560px, 1fr); min-width: 560px; }
  .schedule-timeline[data-mode='workspace'][data-view='wbs'] .chart-cell,
  .schedule-timeline[data-mode='workspace'][data-view='wbs'] .dependency-overlay { display: none; }
  .schedule-timeline[data-mode='workspace'][data-view='gantt'] .timeline-grid { grid-template-columns: minmax(660px, 1fr); min-width: 660px; }
  .schedule-timeline[data-mode='workspace'][data-view='gantt'] .label-cell { display: none; }
  .schedule-timeline[data-mode='workspace'][data-view='gantt'] .dependency-overlay { left: 0; width: 100%; }
}
</style>
