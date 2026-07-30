<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { addCalendarDays, calendarDays, rescheduledTaskWindow } from '~/lib/schedule/planning'

export interface ScheduleTemplateGanttRow {
  key: string
  name: string
  trade: string
  color: string
  plannedStart: string
  plannedFinish: string
  disabled?: boolean
}

const props = defineProps<{
  rows: readonly ScheduleTemplateGanttRow[]
}>()

const emit = defineEmits<{
  updateWindow: [payload: {
    key: string
    plannedStart: string
    plannedFinish: string
  }]
}>()

interface DragState {
  pointerId: number
  startX: number
  chartWidth: number
  row: ScheduleTemplateGanttRow
  mode: 'move' | 'resize-finish'
}

const drag = shallowRef<DragState | null>(null)
const preview = shallowRef<{
  key: string
  plannedStart: string
  plannedFinish: string
} | null>(null)

const axisStart = computed(() => {
  const first = props.rows.map(row => row.plannedStart).sort()[0]
  return first ? addCalendarDays(first, -2) : '2026-01-01'
})
const naturalAxisFinish = computed(() => {
  const last = props.rows.map(row => row.plannedFinish).sort().at(-1)
  return last ? addCalendarDays(last, 2) : addCalendarDays(axisStart.value, 29)
})
const axisFinish = computed(() => (
  calendarDays(axisStart.value, naturalAxisFinish.value) < 29
    ? addCalendarDays(axisStart.value, 29)
    : naturalAxisFinish.value
))
const axisDays = computed(() => calendarDays(axisStart.value, axisFinish.value) + 1)
const tickLabels = computed(() => {
  const count = 5
  return Array.from({ length: count }, (_, index) => {
    const day = Math.round(index * (axisDays.value - 1) / (count - 1))
    return {
      key: day,
      label: addCalendarDays(axisStart.value, day).slice(5),
      left: day / axisDays.value * 100,
    }
  })
})

function visibleWindow(row: ScheduleTemplateGanttRow) {
  return preview.value?.key === row.key ? preview.value : row
}

function barStyle(row: ScheduleTemplateGanttRow) {
  const window = visibleWindow(row)
  const offset = calendarDays(axisStart.value, window.plannedStart)
  const duration = calendarDays(window.plannedStart, window.plannedFinish) + 1
  return {
    left: `${Math.max(0, offset) / axisDays.value * 100}%`,
    width: `${Math.max(1, duration) / axisDays.value * 100}%`,
    backgroundColor: row.color,
  }
}

function resizeStyle(row: ScheduleTemplateGanttRow) {
  const window = visibleWindow(row)
  const finishOffset = calendarDays(axisStart.value, window.plannedFinish) + 1
  return {
    left: `calc(${Math.max(1, finishOffset) / axisDays.value * 100}% - 10px)`,
  }
}

function shiftedWindow(state: DragState, clientX: number) {
  const deltaDays = Math.round(
    (clientX - state.startX) / Math.max(1, state.chartWidth) * axisDays.value,
  )
  return rescheduledTaskWindow({
    plannedStart: state.row.plannedStart,
    plannedFinish: state.row.plannedFinish,
    deltaDays,
    mode: state.mode,
  })
}

function startDrag(
  event: PointerEvent,
  row: ScheduleTemplateGanttRow,
  mode: DragState['mode'],
) {
  if (row.disabled)
    return
  const trigger = event.currentTarget as HTMLElement
  const chart = trigger.closest<HTMLElement>('.template-gantt__chart')
  if (!chart)
    return
  trigger.setPointerCapture?.(event.pointerId)
  drag.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    chartWidth: chart.getBoundingClientRect().width,
    row,
    mode,
  }
  preview.value = { key: row.key, plannedStart: row.plannedStart, plannedFinish: row.plannedFinish }
}

function moveDrag(event: PointerEvent) {
  const current = drag.value
  if (!current || current.pointerId !== event.pointerId)
    return
  preview.value = { key: current.row.key, ...shiftedWindow(current, event.clientX) }
}

function finishDrag(event: PointerEvent) {
  const current = drag.value
  if (!current || current.pointerId !== event.pointerId)
    return
  const window = shiftedWindow(current, event.clientX)
  drag.value = null
  preview.value = null
  emit('updateWindow', { key: current.row.key, ...window })
}

function cancelDrag(event: PointerEvent) {
  if (drag.value?.pointerId !== event.pointerId)
    return
  drag.value = null
  preview.value = null
}

function nudge(
  row: ScheduleTemplateGanttRow,
  mode: DragState['mode'],
  deltaDays: number,
) {
  if (row.disabled)
    return
  emit('updateWindow', {
    key: row.key,
    ...rescheduledTaskWindow({
      plannedStart: row.plannedStart,
      plannedFinish: row.plannedFinish,
      deltaDays,
      mode,
    }),
  })
}
</script>

<template>
  <div
    data-testid="template-gantt-scroll"
    class="min-w-0 overflow-x-auto overscroll-contain"
  >
    <div
      role="grid"
      aria-label="标准工序模板甘特"
      class="template-gantt min-w-820px"
    >
      <div role="row" class="template-gantt__row template-gantt__header">
        <div role="columnheader" class="template-gantt__name">
          工序 / 工种
        </div>
        <div role="columnheader" class="template-gantt__chart">
          <span
            v-for="tick in tickLabels"
            :key="tick.key"
            class="template-gantt__tick-label"
            :style="{ left: `${tick.left}%` }"
          >
            {{ tick.label }}
          </span>
        </div>
      </div>

      <div
        v-for="row in rows"
        :key="row.key"
        role="row"
        class="template-gantt__row"
        :class="row.disabled && 'opacity-45'"
      >
        <div role="gridcell" class="template-gantt__name">
          <span class="truncate text-12px font-800 text-ink">{{ row.name }}</span>
          <span class="truncate text-10px text-ink-faint">{{ row.trade || '未设工种' }}</span>
        </div>
        <div role="gridcell" class="template-gantt__chart">
          <i
            v-for="tick in tickLabels"
            :key="tick.key"
            class="template-gantt__gridline"
            :style="{ left: `${tick.left}%` }"
            aria-hidden="true"
          />
          <button
            type="button"
            class="template-gantt__bar"
            :style="barStyle(row)"
            :disabled="row.disabled"
            :aria-label="`移动模板工序：${row.name}`"
            :title="`${visibleWindow(row).plannedStart} 至 ${visibleWindow(row).plannedFinish}；拖动整体，方向键微调`"
            @pointerdown="startDrag($event, row, 'move')"
            @pointermove="moveDrag"
            @pointerup="finishDrag"
            @pointercancel="cancelDrag"
            @keydown.left.prevent="nudge(row, 'move', -1)"
            @keydown.right.prevent="nudge(row, 'move', 1)"
          >
            <span class="truncate">{{ visibleWindow(row).plannedStart.slice(5) }} → {{ visibleWindow(row).plannedFinish.slice(5) }}</span>
          </button>
          <button
            type="button"
            class="template-gantt__resize"
            :style="resizeStyle(row)"
            :disabled="row.disabled"
            :aria-label="`调整模板工期：${row.name}`"
            title="拖动右边缘调整工期；左边缘保持不动"
            @pointerdown="startDrag($event, row, 'resize-finish')"
            @pointermove="moveDrag"
            @pointerup="finishDrag"
            @pointercancel="cancelDrag"
            @keydown.left.prevent="nudge(row, 'resize-finish', -1)"
            @keydown.right.prevent="nudge(row, 'resize-finish', 1)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.template-gantt {
  border-top: 1px solid var(--line);
}

.template-gantt__row {
  display: grid;
  grid-template-columns: 210px minmax(610px, 1fr);
  min-height: 44px;
  border-bottom: 1px solid var(--line);
}

.template-gantt__header {
  min-height: 34px;
  background: var(--surface-2);
}

.template-gantt__name {
  display: grid;
  min-width: 0;
  align-content: center;
  gap: 2px;
  border-right: 1px solid var(--line);
  padding: 6px 12px;
}

.template-gantt__chart {
  position: relative;
  min-width: 0;
  overflow: hidden;
}

.template-gantt__tick-label {
  position: absolute;
  top: 8px;
  color: var(--ink-faint);
  font-family: var(--font-mono);
  font-size: 9px;
  transform: translateX(-50%);
}

.template-gantt__gridline {
  position: absolute;
  inset-block: 0;
  width: 1px;
  background: var(--line);
}

.template-gantt__bar {
  position: absolute;
  top: 9px;
  height: 26px;
  min-width: 14px;
  touch-action: none;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-sm);
  padding-inline: 7px 13px;
  color: white;
  cursor: grab;
  font-family: var(--font-mono);
  font-size: 9px;
  text-align: left;
}

.template-gantt__bar:active {
  cursor: grabbing;
}

.template-gantt__bar:focus-visible,
.template-gantt__resize:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.template-gantt__resize {
  position: absolute;
  z-index: 2;
  top: 11px;
  height: 22px;
  width: 10px;
  touch-action: none;
  border: 0;
  border-left: 2px solid white;
  border-radius: 0;
  background: transparent !important;
  cursor: ew-resize;
}
</style>
