<script setup lang="ts">
import type { TreeItemSelectEvent, TreeItemToggleEvent } from 'reka-ui'
import type { ScheduleGroupView, ScheduleProjectView, ScheduleTaskView } from '~/lib/schedule/read-model'
import { useNow } from '@vueuse/core'
import { TreeItem, TreeRoot } from 'reka-ui'
import { computed, shallowRef, watch } from 'vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { buildScheduleBindingLocation } from '~/lib/schedule/binding-navigation'
import {
  calendarDays,
  rescheduledTaskWindow,
} from '~/lib/schedule/planning'
import { toLocalDateInputValue } from '~/lib/util/local-date'
import { useScheduleStore } from '~/stores/schedule'

type TimelineMode = 'overview' | 'workspace'
type MobileView = 'wbs' | 'gantt'
type TaskState = 'done' | 'doing' | 'late-start' | 'pending'

interface ProjectRow {
  kind: 'project'
  id: string
  label: string
  start: string | null
  finish: string | null
  actual: number
  deviation: number
}

interface GroupRow {
  kind: 'group'
  id: string
  label: string
  group: ScheduleGroupView
  start: string | null
  finish: string | null
  actual: number
  deviation: number
  children: TaskRow[]
}

interface TaskRow {
  kind: 'task'
  id: string
  label: string
  task: ScheduleTaskView
  start: string
  finish: string
  actual: number
  deviation: number
}

type TimelineTreeRow = GroupRow | TaskRow
type TimelineRow = ProjectRow | TimelineTreeRow

const props = withDefaults(defineProps<{
  snapshot: ScheduleProjectView
  today: string
  mode?: TimelineMode
  highlightedGroupId?: string
  highlightedTaskId?: string
  readonly?: boolean
  origin?: 'real' | 'demo'
  returnContext?: Record<string, unknown>
  contractBindingAvailable?: boolean
}>(), {
  mode: 'workspace',
  highlightedGroupId: '',
  highlightedTaskId: '',
  contractBindingAvailable: true,
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

const ROW_HEIGHT = 34

const scheduleStore = useScheduleStore()
const desktop = isDesktopRuntime()
const memoryKey = computed(() => `${props.origin ?? 'real'}:${props.snapshot.id}`)
const mobileView = shallowRef<MobileView>('wbs')
const systemNow = useNow({ interval: 60_000 })
const systemToday = computed(() => toLocalDateInputValue(systemNow.value))
const expandedGroupIds = computed<string[]>({
  get() {
    const validIds = new Set(props.snapshot.groups.map(group => group.id))
    const stored = scheduleStore.expandedGroupIdsByProject[memoryKey.value]
    if (stored)
      return stored.filter(groupId => validIds.has(groupId))
    return props.snapshot.groups[0] ? [props.snapshot.groups[0].id] : []
  },
  set(groupIds) {
    scheduleStore.setExpandedGroupIds(memoryKey.value, groupIds)
  },
})
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
  [() => props.snapshot.id, () => props.highlightedGroupId],
  ([, groupId]) => {
    if (!groupId || expandedGroupIds.value.includes(groupId))
      return
    expandedGroupIds.value = [...expandedGroupIds.value, groupId]
  },
  { immediate: true },
)

const projectRow = computed<ProjectRow>(() => ({
  kind: 'project',
  id: props.snapshot.id,
  label: props.snapshot.name,
  start: props.snapshot.plannedStart,
  finish: props.snapshot.plannedFinish,
  actual: props.snapshot.actualProgress,
  deviation: props.snapshot.deviationDays,
}))

const treeRows = computed<GroupRow[]>(() =>
  props.snapshot.groups.map(group => ({
    kind: 'group',
    id: group.id,
    label: group.name,
    group,
    start: group.plannedStart,
    finish: group.plannedFinish,
    actual: group.actualProgress,
    deviation: group.deviationDays,
    children: group.tasks.map(task => ({
      kind: 'task',
      id: task.id,
      label: task.name,
      task,
      start: task.plannedStart,
      finish: task.plannedFinish,
      actual: task.actualProgress,
      deviation: task.deviationDays,
    })),
  })),
)

const visibleTreeRows = computed<TimelineTreeRow[]>(() => {
  const result: TimelineTreeRow[] = []
  for (const group of treeRows.value) {
    result.push(group)
    if (expandedGroupIds.value.includes(group.id))
      result.push(...group.children)
  }
  return result
})

const rows = computed<TimelineRow[]>(() =>
  props.mode === 'workspace'
    ? [projectRow.value, ...visibleTreeRows.value]
    : visibleTreeRows.value,
)

const axisStart = computed(() => monthStart(props.snapshot.plannedStart ?? systemToday.value))
const axisFinish = computed(() => monthFinish(props.snapshot.plannedFinish ?? systemToday.value))
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
  if (props.mode !== 'workspace' || props.readonly)
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
      d: `M ${fromX} ${predecessorIndex * ROW_HEIGHT + ROW_HEIGHT / 2} H ${elbowX} V ${successorIndex * ROW_HEIGHT + ROW_HEIGHT / 2} H ${toX}`,
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

function compactDate(value: string): string {
  return value.slice(5).replace('-', '.')
}

function planRange(row: TimelineRow): string {
  if (!row.start || !row.finish)
    return '—'
  return `${compactDate(row.start)}~${compactDate(row.finish)}`
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
  if (calendarDays(task.plannedStart, systemToday.value) > 0)
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

function rowStatusLabel(row: TimelineRow): string {
  if (row.kind === 'task')
    return taskStatusLabel(row.task)
  if (!row.deviation)
    return '按计划'
  return row.deviation > 0
    ? `领先${row.deviation}天`
    : `落后${Math.abs(row.deviation)}天`
}

function rowStatusTone(row: TimelineRow): 'ok' | 'brand' | 'warn' | 'danger' | 'neutral' {
  if (row.kind !== 'task')
    return row.deviation > 0 ? 'ok' : row.deviation < 0 ? 'warn' : 'brand'
  const state = taskState(row.task)
  if (state === 'late-start')
    return 'danger'
  if (state === 'pending')
    return 'neutral'
  if (state === 'doing')
    return row.deviation < 0 ? 'warn' : 'brand'
  return row.deviation < 0 ? 'danger' : 'ok'
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
  expandedGroupIds.value = expandedGroupIds.value.includes(groupId)
    ? expandedGroupIds.value.filter(id => id !== groupId)
    : [...expandedGroupIds.value, groupId]
}

function treeRowKey(row: TimelineTreeRow): string {
  return row.id
}

function treeRowChildren(row: TimelineTreeRow): TimelineTreeRow[] | undefined {
  return row.kind === 'group' ? row.children : undefined
}

function handleTreeSelect(event: TreeItemSelectEvent<TimelineTreeRow>, row: TimelineTreeRow) {
  event.preventDefault()
  if (!(event.detail.originalEvent instanceof KeyboardEvent))
    return
  if (row.kind === 'group')
    toggleGroup(row.id)
  else
    emit('selectTask', row.task)
}

function handleTreeToggle(event: TreeItemToggleEvent<TimelineTreeRow>) {
  if (!(event.detail.originalEvent instanceof KeyboardEvent))
    event.preventDefault()
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
  if (props.mode !== 'workspace' || props.readonly)
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
  if (props.mode !== 'workspace' || props.readonly)
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
      <div class="timeline-grid">
        <div class="timeline-row" role="row">
          <div class="label-cell axis-cell" role="columnheader">
            <template v-if="mode === 'workspace'">
              <span>WBS · 分组 / 工序</span><span>工期</span><span>计划起止</span><span>实际</span><span>状态</span>
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
            <span class="today-line" :style="{ left: `${position(systemToday)}%` }" />
            <span class="today-label" :style="{ left: `${position(systemToday)}%` }">今天</span>
          </div>
        </div>

        <svg
          v-if="dependencyPaths.length"
          class="dependency-overlay"
          :viewBox="`0 0 100 ${rows.length * ROW_HEIGHT}`"
          :style="{ height: `${rows.length * ROW_HEIGHT}px` }"
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

        <div v-if="mode === 'workspace'" class="timeline-row" data-kind="project">
          <div
            class="label-cell data-row"
            data-kind="project"
          >
            <div class="label-main">
              <span class="i-lucide-building-2 project-icon" aria-hidden="true" />
              <span class="truncate">{{ projectRow.label }}</span>
            </div>
            <span>{{ projectRow.start && projectRow.finish ? calendarDays(projectRow.start, projectRow.finish) + 1 : '—' }}天</span>
            <span>{{ planRange(projectRow) }}</span>
            <span class="font-700">{{ percent(projectRow.actual) }}</span>
            <span>
              <KitStatusTag class="row-status" :tone="rowStatusTone(projectRow)">
                {{ rowStatusLabel(projectRow) }}
              </KitStatusTag>
            </span>
          </div>

          <div class="chart-cell data-row" data-kind="project">
            <span v-for="tick in monthTicks" :key="tick.key" class="month-line" :style="{ left: `${tick.left}%` }" />
            <span class="today-line" :style="{ left: `${position(systemToday)}%` }" />
            <button
              v-if="projectRow.start && projectRow.finish"
              type="button"
              class="plan-bar is-rollup"
              :style="{
                'left': `${position(barStart(projectRow))}%`,
                'width': `${barWidth(displayStart(projectRow), displayFinish(projectRow))}%`,
                '--bar-color': 'var(--brand)',
              }"
              disabled
              :title="`${projectRow.label}：${displayStart(projectRow)} 至 ${displayFinish(projectRow)}`"
            >
              <span class="actual-fill" :style="{ width: percent(projectRow.actual) }" />
            </button>
          </div>
        </div>

        <TreeRoot
          v-slot="{ flattenItems }"
          v-model:expanded="expandedGroupIds"
          as="div"
          :items="treeRows"
          :get-key="treeRowKey"
          :get-children="treeRowChildren"
          class="timeline-tree"
          aria-label="施工排程 WBS"
        >
          <TreeItem
            v-for="item in flattenItems"
            v-slot="{ isExpanded, handleToggle }"
            :key="item._id"
            v-bind="item.bind"
            as="div"
            class="timeline-row"
            :data-kind="item.value.kind"
            :data-highlighted="isHighlighted(item.value) ? 'true' : undefined"
            @select="handleTreeSelect($event, item.value)"
            @toggle="handleTreeToggle"
          >
            <div
              class="label-cell data-row"
              :data-kind="item.value.kind"
            >
              <div class="label-main" :class="item.value.kind === 'task' && 'is-task'">
                <button
                  v-if="item.value.kind === 'group'"
                  type="button"
                  class="tree-trigger"
                  :aria-label="`${isExpanded ? '折叠' : '展开'}分组：${item.value.label}`"
                  @click.stop="handleToggle"
                >
                  <span :class="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" aria-hidden="true" />
                  <span class="truncate">{{ item.value.label }}</span>
                </button>
                <template v-else>
                  <span class="task-dot" :style="{ backgroundColor: item.value.task.color }" aria-hidden="true" />
                  <button
                    type="button"
                    class="task-name"
                    :aria-label="item.value.label"
                    @click.stop="emit('selectTask', item.value.task)"
                  >
                    {{ item.value.label }}
                  </button>
                  <span v-if="item.value.task.hasQty" class="i-lucide-link task-link-icon" aria-label="可下钻工程量" />
                </template>

                <template v-if="item.value.kind === 'group' && item.value.group.scopeBasis === 'provisional'">
                  <span class="pending-contract-chip">待绑定合同</span>
                  <NuxtLink
                    v-if="mode === 'workspace' && !readonly && (desktop || origin !== 'demo') && contractBindingAvailable !== false"
                    :to="desktop ? `/schedule/${item.value.group.projectId}/bind/${item.value.group.id}` : buildScheduleBindingLocation(item.value.group.projectId, item.value.group.id, origin ?? 'real', returnContext)"
                    class="binding-entry"
                    aria-label="绑定施工合同"
                    @click.stop
                  >
                    <span class="i-lucide-link-2" aria-hidden="true" />
                    <span>绑定</span>
                  </NuxtLink>
                  <button v-else-if="mode === 'workspace' && !readonly && !desktop && origin === 'real' && contractBindingAvailable === false" type="button" class="binding-entry" aria-label="绑定施工合同" disabled title="正式施工合同与BOQ来源尚未接齐，新的绑定等待范围决定">
                    绑定
                  </button>
                </template>
                <NuxtLink
                  v-if="mode === 'workspace' && !desktop && origin !== 'demo' && item.value.kind === 'group' && item.value.group.contractId"
                  :to="buildScheduleBindingLocation(item.value.group.projectId, item.value.group.id, origin ?? 'real', returnContext)"
                  class="binding-entry"
                  aria-label="查看合同依据"
                >
                  合同依据
                </NuxtLink>
                <span v-if="mode === 'overview' && item.value.kind === 'group'" class="status-label">
                  {{ groupStatusLabel(item.value.group) }}
                </span>
                <span v-if="mode === 'overview' && item.value.kind === 'task'" class="status-label">
                  {{ taskStatusLabel(item.value.task) }}
                </span>
                <button
                  v-if="mode === 'workspace' && !readonly && item.value.kind === 'group'"
                  type="button"
                  class="add-task-button"
                  :aria-label="`向${item.value.label}追加工序`"
                  @click.stop="emit('addTask', item.value.group)"
                >
                  <span class="i-lucide-plus" aria-hidden="true" />
                </button>
              </div>

              <template v-if="mode === 'workspace'">
                <span>{{ item.value.start && item.value.finish ? calendarDays(item.value.start, item.value.finish) + 1 : '—' }}天</span>
                <span>{{ planRange(item.value) }}</span>
                <span :class="item.value.kind !== 'task' && 'font-700'">{{ percent(item.value.actual) }}</span>
                <span>
                  <KitStatusTag class="row-status" :tone="rowStatusTone(item.value)">
                    {{ rowStatusLabel(item.value) }}
                  </KitStatusTag>
                </span>
              </template>
            </div>

            <div class="chart-cell data-row" :data-kind="item.value.kind">
              <span v-for="tick in monthTicks" :key="tick.key" class="month-line" :style="{ left: `${tick.left}%` }" />
              <span class="today-line" :style="{ left: `${position(systemToday)}%` }" />
              <button
                v-if="item.value.start && item.value.finish"
                type="button"
                class="plan-bar"
                :class="[
                  item.value.kind !== 'task' && 'is-rollup',
                  item.value.kind === 'task' && taskState(item.value.task) === 'late-start' && 'is-late',
                ]"
                :style="{
                  'left': `${position(barStart(item.value))}%`,
                  'width': `${barWidth(displayStart(item.value), displayFinish(item.value))}%`,
                  '--bar-color': item.value.kind === 'task' ? item.value.task.color : 'var(--brand)',
                }"
                :disabled="item.value.kind !== 'task'"
                :aria-label="item.value.kind === 'task' ? `移动工序：${item.value.label}` : undefined"
                :title="`${item.value.label}：${displayStart(item.value)} 至 ${displayFinish(item.value)}${item.value.kind === 'task' ? '；拖动整体可调日期' : ''}`"
                @click="item.value.kind === 'task' && openTaskFromBar(item.value.task)"
                @pointerdown="item.value.kind === 'task' && startDrag($event, item.value.task, 'move')"
                @pointermove="moveDrag"
                @pointerup="finishDrag"
                @pointercancel="cancelDrag"
                @keydown.left.prevent.stop="item.value.kind === 'task' && nudgeTask(item.value.task, 'move', -1)"
                @keydown.right.prevent.stop="item.value.kind === 'task' && nudgeTask(item.value.task, 'move', 1)"
              >
                <span class="actual-fill" :style="{ width: percent(item.value.actual) }" />
                <span v-if="item.value.kind === 'task' && item.value.task.baselineStart" class="baseline-mark" />
              </button>
              <button
                v-if="mode === 'workspace' && !readonly && item.value.kind === 'task'"
                type="button"
                class="duration-handle"
                :style="{ left: `calc(${position(barFinish(item.value))}% - 5px)` }"
                :aria-label="`调整工期：${item.value.label}`"
                title="拖动右缘调整计划完成日；左缘保持不动"
                @pointerdown="startDrag($event, item.value.task, 'resize-finish')"
                @pointermove="moveDrag"
                @pointerup="finishDrag"
                @pointercancel="cancelDrag"
                @keydown.left.prevent.stop="nudgeTask(item.value.task, 'resize-finish', -1)"
                @keydown.right.prevent.stop="nudgeTask(item.value.task, 'resize-finish', 1)"
              />
              <span v-if="mode === 'workspace' && item.value.kind === 'task' && dependencyLabel(item.value.id)" class="dependency-label">
                {{ dependencyLabel(item.value.id) }}
              </span>
            </div>
          </TreeItem>
        </TreeRoot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.schedule-timeline { min-width: 0; container-type: inline-size; }
.timeline-scroll { max-width: 100%; overflow-x: auto; outline: none; }
.timeline-scroll:focus-visible { box-shadow: inset 0 0 0 2px var(--brand-ring); }
.timeline-grid { position: relative; }
.timeline-row { display: grid; min-width: 0; grid-template-columns: var(--wbs-width) minmax(var(--chart-min), 1fr); }
.timeline-tree { display: block; outline: none; }
.timeline-tree > .timeline-row:focus-visible { outline: none; }
.timeline-tree > .timeline-row:focus-visible .label-cell { box-shadow: inset 3px 0 0 var(--brand); }
.label-cell { min-width: 0; border-right: 1px solid var(--line); box-sizing: border-box; }
.chart-cell { position: relative; min-width: 0; overflow: hidden; }
.axis-cell { position: sticky; top: 0; z-index: 4; height: 26px; border-bottom: 1px solid var(--line); background: var(--surface-2); color: var(--ink-faint); font-size: 10px; font-weight: 700; }
.data-row { height: 34px; border-bottom: 1px solid var(--line); font-size: 11px; }
.label-main { min-width: 0; display: flex; align-items: center; gap: 6px; }
.label-main.is-task { padding-left: 38px !important; }
.project-icon { flex: none; color: var(--brand); font-size: 13px; }
.tree-trigger, .task-name, .add-task-button {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
}
.tree-trigger { display: flex; min-width: 0; align-items: center; gap: 4px; color: var(--ink); cursor: pointer; }
.tree-trigger > [class*='i-lucide'] { width: 14px; height: 14px; flex: none; color: var(--ink-soft); }
.tree-trigger:hover { color: var(--brand-deep); }
.task-name { min-width: 0; overflow: hidden; color: var(--ink); text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; font-weight: 600; }
.task-name:hover { color: var(--brand); }
.task-dot { width: 8px; height: 8px; flex: none; border-radius: 2px; }
.task-link-icon { flex: none; color: var(--brand); font-size: 11px; }
.add-task-button { display: grid; width: 18px; height: 18px; flex: none; margin-left: 2px; place-items: center; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--panel); color: var(--brand); cursor: pointer; }
.add-task-button:hover { border-color: var(--brand); background: var(--brand-soft); }
.add-task-button:focus-visible, .tree-trigger:focus-visible, .task-name:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.pending-contract-chip { flex: none; border-radius: 999px; background: var(--warn-soft); padding: 2px 6px; color: var(--warn-ink); font-size: 9px; font-weight: 700; line-height: 1; }
.binding-entry { display: inline-flex; flex: none; align-items: center; gap: 2px; border-radius: var(--radius-sm); color: var(--brand-deep); font-size: 9px; font-weight: 700; }
.binding-entry:hover { color: var(--brand); text-decoration: underline; }
.status-label { margin-left: auto; flex: none; color: var(--ink-soft); font-family: var(--font-mono); font-size: 10px; font-variant-numeric: tabular-nums; }
.month-label { position: absolute; top: 6px; transform: translateX(4px); white-space: nowrap; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.month-line, .today-line { position: absolute; inset-block: 0; width: 1px; background: var(--line); pointer-events: none; }
.month-line { border-left: 1px dashed color-mix(in srgb, var(--line) 65%, transparent); background: transparent; }
.today-line { z-index: 3; width: 2px; background: var(--danger); opacity: .6; }
.today-label { position: absolute; z-index: 4; top: 2px; transform: translateX(-50%); border-radius: 3px; background: var(--danger-soft); padding-inline: 4px; color: var(--danger); font-size: 9px; font-weight: 800; }
.plan-bar { position: absolute; top: 10px; height: 14px; min-width: 6px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--bar-color) 76%, var(--ink)); border-radius: 4px; background: color-mix(in srgb, var(--bar-color) 20%, var(--panel)); cursor: grab; touch-action: none; }
.plan-bar:active { cursor: grabbing; }
.plan-bar:hover:not(:disabled) { box-shadow: 0 0 0 2px var(--brand-ring); }
.plan-bar.is-rollup { cursor: default; }
.plan-bar.is-late { border: 1.5px dashed var(--danger); }
.actual-fill { position: absolute; inset-block: 0; left: 0; max-width: 100%; border-radius: 2px; background: var(--bar-color); opacity: .86; }
.baseline-mark { position: absolute; inset: 2px; border: 1px dashed var(--ink); opacity: .55; }
.duration-handle { position: absolute; z-index: 4; top: 6px; width: 10px; height: 22px; border-inline: 2px solid var(--brand-deep); border-radius: 2px; cursor: ew-resize; touch-action: none; opacity: 0; }
.chart-cell:hover .duration-handle, .duration-handle:focus-visible { opacity: .9; background: color-mix(in srgb, var(--panel) 72%, transparent); }
.dependency-label { position: absolute; right: 5px; top: 10px; max-width: 44%; overflow: hidden; color: var(--ink-faint); font-family: var(--font-mono); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.dependency-overlay { position: absolute; z-index: 3; top: 26px; overflow: visible; pointer-events: none; }
.dependency-path { fill: none; stroke: var(--ink-faint); stroke-width: 1; stroke-dasharray: 3 2; vector-effect: non-scaling-stroke; }
.dependency-path.is-disabled { stroke: var(--line-strong); stroke-width: 1.5; stroke-dasharray: 2 4; opacity: .55; }
.mobile-view-switch { display: none; align-items: center; width: max-content; margin: 8px 10px; border-radius: var(--radius-btn); background: var(--surface-3); padding: 2px; }
.view-button { border: 0; border-radius: calc(var(--radius-btn) - 2px); background: transparent; padding: 4px 10px; color: var(--ink-soft); font: inherit; font-size: 11px; cursor: pointer; }
.view-button.is-active { background: var(--panel); color: var(--brand-deep); box-shadow: var(--shadow-card); font-weight: 700; }

.schedule-timeline[data-mode='overview'] .timeline-grid { --wbs-width: clamp(180px, 22%, 236px); --chart-min: 524px; min-width: 760px; }
.schedule-timeline[data-mode='overview'] .label-cell { display: flex; align-items: center; padding-inline: 10px; }
.schedule-timeline[data-mode='overview'] .data-row[data-kind='group'] { background: color-mix(in srgb, var(--surface-2) 90%, var(--panel)); font-weight: 700; }
.schedule-timeline[data-mode='overview'] .data-row[data-kind='task'] { background: var(--panel); }
.schedule-timeline[data-mode='overview'] .timeline-row[data-kind='task']:hover .data-row { background: var(--brand-soft); }

.schedule-timeline[data-mode='workspace'] .timeline-grid { --wbs-width: 480px; --chart-min: 600px; min-width: 1080px; }
.schedule-timeline[data-mode='workspace'] .label-cell { display: grid; grid-template-columns: 216px 42px 96px 46px 80px; align-items: center; padding: 0; }
.schedule-timeline[data-mode='workspace'] .label-cell > * { height: 100%; min-width: 0; border-right: 1px solid var(--line); padding-inline: 8px; box-sizing: border-box; }
.schedule-timeline[data-mode='workspace'] .label-cell > :last-child { border-right: 0; }
.schedule-timeline[data-mode='workspace'] .label-cell > span:not(:first-child) { display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.schedule-timeline[data-mode='workspace'] .data-row[data-kind='project'] { background: var(--brand-soft); font-weight: 800; }
.schedule-timeline[data-mode='workspace'] .data-row[data-kind='group'] { background: var(--surface-2); font-weight: 700; }
.schedule-timeline[data-mode='workspace'] .data-row[data-kind='task'] { background: var(--panel); }
.schedule-timeline[data-mode='workspace'] .timeline-row[data-kind='task']:hover .data-row { background: var(--brand-soft); }
.schedule-timeline[data-mode='workspace'] .timeline-row[data-kind='group'] .label-main { padding-left: 18px; }
.schedule-timeline[data-mode='workspace'] .dependency-overlay { left: 480px; width: calc(100% - 480px); }

.timeline-row[data-highlighted='true'] .data-row { background: var(--brand-soft) !important; }
.timeline-row[data-highlighted='true'] .label-cell { box-shadow: inset 3px 0 0 var(--brand); }

@container (max-width: 52rem) {
  .schedule-timeline[data-mode='workspace'] .mobile-view-switch { display: inline-flex; }
  .schedule-timeline[data-mode='workspace'][data-view='wbs'] .timeline-grid { --wbs-width: minmax(480px, 1fr); min-width: 480px; }
  .schedule-timeline[data-mode='workspace'][data-view='wbs'] .timeline-row { grid-template-columns: minmax(480px, 1fr); }
  .schedule-timeline[data-mode='workspace'][data-view='wbs'] .chart-cell,
  .schedule-timeline[data-mode='workspace'][data-view='wbs'] .dependency-overlay { display: none; }
  .schedule-timeline[data-mode='workspace'][data-view='gantt'] .timeline-grid { min-width: 660px; }
  .schedule-timeline[data-mode='workspace'][data-view='gantt'] .timeline-row { grid-template-columns: minmax(660px, 1fr); }
  .schedule-timeline[data-mode='workspace'][data-view='gantt'] .label-cell { display: none; }
  .schedule-timeline[data-mode='workspace'][data-view='gantt'] .dependency-overlay { left: 0; width: 100%; }
}
</style>
