<script setup lang="ts">
import type { AttendanceRecord } from '~/lib/payroll/attendance'
import { computed } from 'vue'

const props = defineProps<{
  workerCount: number
  records: readonly AttendanceRecord[]
  blockedWorkerCount: number
}>()

const recordedWorkerCount = computed(() =>
  new Set(props.records.map(record => record.workerId)).size,
)
const normalHours = computed(() =>
  props.records.reduce((total, record) => total + record.hours, 0),
)
const overtimeHours = computed(() =>
  props.records.reduce((total, record) => total + record.overtimeHours, 0),
)

const metrics = computed(() => [
  {
    label: '当前名册',
    value: props.workerCount.toLocaleString('zh-CN'),
    suffix: '人',
    note: '当前项目或责任范围',
  },
  {
    label: '已有考勤',
    value: props.records.length.toLocaleString('zh-CN'),
    suffix: '人日',
    note: `${recordedWorkerCount.value} 人已有记录`,
  },
  {
    label: '正常工时',
    value: normalHours.value.toLocaleString('zh-CN'),
    suffix: '小时',
    note: '当前筛选月累计',
  },
  {
    label: '加班工时',
    value: overtimeHours.value.toLocaleString('zh-CN'),
    suffix: '小时',
    note: '当前筛选月累计',
  },
  {
    label: '不可编辑',
    value: props.blockedWorkerCount.toLocaleString('zh-CN'),
    suffix: '人',
    note: 'C2 签工或 C1 已发放',
  },
])
</script>

<template>
  <section
    data-ui="attendance-summary"
    aria-label="考勤事实汇总"
    class="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-3 xl:grid-cols-5"
  >
    <article
      v-for="metric in metrics"
      :key="metric.label"
      class="min-w-0 bg-panel px-3 py-2.5"
    >
      <p class="m-0 text-11px font-700 text-ink-faint">
        {{ metric.label }}
      </p>
      <p class="m-0 mt-1 flex min-w-0 items-baseline gap-1">
        <strong class="truncate font-mono text-18px font-800 text-ink">
          {{ metric.value }}
        </strong>
        <span class="text-11px text-ink-soft">{{ metric.suffix }}</span>
      </p>
      <p class="m-0 mt-0.5 truncate text-10px text-ink-faint" :title="metric.note">
        {{ metric.note }}
      </p>
    </article>
  </section>
</template>
