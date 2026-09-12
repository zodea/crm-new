<script setup lang="ts">
import type { ScheduleGroupView, ScheduleProjectView, ScheduleTaskView } from '~/lib/schedule/read-model'
import ScheduleTimeline from '~/components/schedule/ScheduleTimeline.vue'

defineProps<{
  snapshot: ScheduleProjectView
  today: string
  highlightedGroupId?: string
  readonly?: boolean
  origin?: 'real' | 'demo'
  returnContext?: Record<string, unknown>
}>()

const emit = defineEmits<{
  selectTask: [task: ScheduleTaskView]
  addTask: [group: ScheduleGroupView]
  rescheduleTask: [payload: {
    task: ScheduleTaskView
    plannedStart: string
    plannedFinish: string
  }]
}>()
</script>

<template>
  <section class="schedule-board panel min-w-0 overflow-hidden">
    <header class="border-b border-line px-3 py-2">
      <div class="text-13px font-800 text-ink">
        WBS 与计划时间轴
      </div>
      <div class="text-11px text-ink-faint">
        行高同源 · 工序计划与工程量实际进度联动
      </div>
    </header>

    <ScheduleTimeline
      mode="workspace"
      :snapshot="snapshot"
      :today="today"
      :highlighted-group-id="highlightedGroupId"
      :readonly="readonly"
      :origin="origin"
      :return-context="returnContext"
      @select-task="emit('selectTask', $event)"
      @add-task="emit('addTask', $event)"
      @reschedule-task="emit('rescheduleTask', $event)"
    />
  </section>
</template>

<style scoped>
.schedule-board { container-type: inline-size; }
</style>
