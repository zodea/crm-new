<script setup lang="ts">
import type { AttendanceRecord } from '~/lib/payroll/attendance'
import type { PayrollOption } from '~/lib/payroll/statements'
import { computed, nextTick, reactive, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  projectId: string
  crewId?: string
  month: string
  workers: readonly PayrollOption[]
  records: readonly AttendanceRecord[]
  blockedWorkerIds?: readonly string[]
  loading?: boolean
  saving?: boolean
  saveError?: string
}>()

const emit = defineEmits<{
  save: [input: {
    projectId: string
    crewId: string | null
    workerId: string
    workDate: string
    hours: number
    overtimeHours: number
    workContent: string
  }]
  clearError: []
}>()

const normalHoursInput = useTemplateRef<HTMLInputElement>('normalHoursInput')
const selected = reactive({
  workerId: '',
  day: 0,
  hours: 8,
  overtimeHours: 0,
  workContent: '',
})

const dayCount = computed(() => {
  if (!props.month)
    return 31
  const [year, month] = props.month.split('-').map(Number)
  return new Date(year!, month!, 0).getDate()
})
const days = computed(() => Array.from({ length: dayCount.value }, (_, index) => index + 1))
const visibleWorkers = computed(() =>
  props.workers.filter(worker => !props.crewId || worker.crewId === props.crewId),
)
const byCell = computed(() => new Map(props.records.map(record => [
  `${record.workerId}:${Number(record.workDate.slice(8, 10))}`,
  record,
])))
const selectedWorker = computed(() =>
  visibleWorkers.value.find(worker => worker.id === selected.workerId),
)
const blockedWorkers = computed(() => new Set(props.blockedWorkerIds ?? []))
const interactionDisabled = computed(() => Boolean(props.loading || props.saving))
const tableMinWidth = computed(() => `${128 + dayCount.value * 40 + 152}px`)
const selectedDate = computed(() =>
  selected.day
    ? `${props.month}-${String(selected.day).padStart(2, '0')}`
    : '',
)
const workerTotals = computed(() => {
  const totals = new Map<string, { hours: number, overtime: number }>()
  for (const worker of visibleWorkers.value)
    totals.set(worker.id, { hours: 0, overtime: 0 })
  for (const record of props.records) {
    const total = totals.get(record.workerId)
    if (!total)
      continue
    total.hours += record.hours
    total.overtime += record.overtimeHours
  }
  return totals
})
const dayTotals = computed(() => {
  const totals = new Map<number, { hours: number, overtime: number }>()
  for (const day of days.value)
    totals.set(day, { hours: 0, overtime: 0 })
  for (const record of props.records) {
    const total = totals.get(Number(record.workDate.slice(8, 10)))
    if (!total || !visibleWorkers.value.some(worker => worker.id === record.workerId))
      continue
    total.hours += record.hours
    total.overtime += record.overtimeHours
  }
  return totals
})
const grandTotal = computed(() =>
  [...workerTotals.value.values()].reduce(
    (total, worker) => ({
      hours: total.hours + worker.hours,
      overtime: total.overtime + worker.overtime,
    }),
    { hours: 0, overtime: 0 },
  ),
)

function recordFor(workerId: string, day: number): AttendanceRecord | undefined {
  return byCell.value.get(`${workerId}:${day}`)
}

function isWeekend(day: number): boolean {
  const date = new Date(`${props.month}-${String(day).padStart(2, '0')}T00:00:00`)
  return date.getDay() === 0 || date.getDay() === 6
}

function formatHours(value: number): string {
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}

async function selectCell(workerId: string, day: number) {
  if (interactionDisabled.value || blockedWorkers.value.has(workerId))
    return
  selected.workerId = workerId
  selected.day = day
  const record = recordFor(workerId, day)
  selected.hours = record?.hours ?? 8
  selected.overtimeHours = record?.overtimeHours ?? 0
  selected.workContent = record?.workContent ?? ''
  emit('clearError')
  await nextTick()
  normalHoursInput.value?.focus()
}

function clearError() {
  emit('clearError')
}

function submit() {
  if (!props.projectId || !selected.workerId || !selected.day || interactionDisabled.value)
    return
  emit('save', {
    projectId: props.projectId,
    crewId: selectedWorker.value?.crewId ?? props.crewId ?? null,
    workerId: selected.workerId,
    workDate: selectedDate.value,
    hours: selected.hours,
    overtimeHours: selected.overtimeHours,
    workContent: selected.workContent,
  })
}

watch(
  () => [props.projectId, props.month, props.crewId] as const,
  () => {
    selected.workerId = ''
    selected.day = 0
    selected.hours = 8
    selected.overtimeHours = 0
    selected.workContent = ''
    emit('clearError')
  },
  { flush: 'sync' },
)
</script>

<template>
  <section
    data-ui="attendance-matrix"
    class="panel min-w-0 max-w-full overflow-hidden"
    aria-label="月度考勤矩阵"
    :aria-busy="interactionDisabled ? 'true' : undefined"
  >
    <SectionHeader
      title="月度考勤"
      :subtitle="`${month} · 点击或用键盘进入日期单元格；首列固定，矩阵内部横向滚动`"
      :mb="0"
    />
    <div class="attendance-grid" data-ui="attendance-grid-scroll" tabindex="0">
      <table :style="{ minWidth: tableMinWidth }">
        <thead>
          <tr>
            <th class="attendance-grid__worker">
              工人
            </th>
            <th
              v-for="day in days"
              :key="day"
              class="font-mono"
              :class="{ 'attendance-grid__weekend': isWeekend(day) }"
            >
              {{ day }}
            </th>
            <th>正常工时</th>
            <th>加班</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="worker in visibleWorkers" :key="worker.id">
            <th class="attendance-grid__worker">
              <span class="flex min-w-0 items-center gap-1.5">
                <span
                  v-if="blockedWorkers.has(worker.id)"
                  class="i-lucide-lock h-3 w-3 flex-none text-warn"
                  aria-hidden="true"
                />
                <span class="truncate" :title="worker.name">{{ worker.name }}</span>
              </span>
            </th>
            <td v-for="day in days" :key="day">
              <button
                type="button"
                :aria-label="`${worker.name} ${month}-${String(day).padStart(2, '0')} 考勤`"
                :disabled="interactionDisabled || blockedWorkers.has(worker.id)"
                :title="loading ? '正在载入当前考勤范围' : blockedWorkers.has(worker.id) ? '该月使用 C2 签工或 C1 工资已发放，考勤不可修改' : `${worker.name} · ${month}-${String(day).padStart(2, '0')}`"
                :class="{
                  'is-selected': selected.workerId === worker.id && selected.day === day,
                  'has-record': recordFor(worker.id, day),
                }"
                @click="selectCell(worker.id, day)"
              >
                <template v-if="recordFor(worker.id, day)">
                  {{ formatHours(recordFor(worker.id, day)!.hours) }}
                  <sup v-if="recordFor(worker.id, day)!.overtimeHours">
                    +{{ formatHours(recordFor(worker.id, day)!.overtimeHours) }}
                  </sup>
                </template>
                <span v-else>{{ blockedWorkers.has(worker.id) ? '锁' : '—' }}</span>
              </button>
            </td>
            <td class="whitespace-nowrap font-mono font-700">
              {{ formatHours(workerTotals.get(worker.id)?.hours ?? 0) }}
            </td>
            <td class="whitespace-nowrap font-mono">
              {{ formatHours(workerTotals.get(worker.id)?.overtime ?? 0) }}
            </td>
          </tr>
          <tr v-if="!visibleWorkers.length">
            <td :colspan="dayCount + 3" class="py-12 text-center text-ink-faint">
              当前班组暂无工人，请先在基础资料维护名册。
            </td>
          </tr>
        </tbody>
        <tfoot v-if="visibleWorkers.length">
          <tr>
            <th class="attendance-grid__worker">
              当日合计
            </th>
            <td v-for="day in days" :key="day" class="font-mono">
              {{ formatHours(dayTotals.get(day)?.hours ?? 0) }}
              <sup v-if="dayTotals.get(day)?.overtime">
                +{{ formatHours(dayTotals.get(day)!.overtime) }}
              </sup>
            </td>
            <td class="whitespace-nowrap font-mono font-800">
              {{ formatHours(grandTotal.hours) }}
            </td>
            <td class="whitespace-nowrap font-mono font-800">
              {{ formatHours(grandTotal.overtime) }}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <form
      v-if="selectedWorker"
      aria-label="考勤单元格编辑"
      class="attendance-grid__editor"
      @submit.prevent="submit"
    >
      <div class="min-w-42">
        <strong class="block text-ink">{{ selectedWorker.name }}</strong>
        <span class="font-mono text-11px text-ink-faint">{{ selectedDate }}</span>
      </div>
      <label>
        正常工时
        <input
          ref="normalHoursInput"
          v-model.number="selected.hours"
          aria-label="正常工时"
          type="number"
          min="0"
          max="24"
          step="0.5"
          :disabled="interactionDisabled"
          @input="clearError"
        >
      </label>
      <label>
        加班工时
        <input
          v-model.number="selected.overtimeHours"
          aria-label="加班工时"
          type="number"
          min="0"
          max="24"
          step="0.5"
          :disabled="interactionDisabled"
          @input="clearError"
        >
      </label>
      <label class="min-w-48 flex-1">
        施工内容
        <input
          v-model="selected.workContent"
          aria-label="施工内容"
          type="text"
          :disabled="interactionDisabled"
          @input="clearError"
        >
      </label>
      <button type="submit" class="btn-accent" :disabled="interactionDisabled">
        <span
          v-if="interactionDisabled"
          class="i-lucide-loader-circle mr-1 animate-spin"
          aria-hidden="true"
        />
        {{ loading ? '正在载入' : saving ? '正在保存' : '保存考勤' }}
      </button>
      <p
        v-if="saveError"
        class="m-0 w-full rounded-[var(--radius-sm)] bg-danger-soft px-3 py-2 text-12px text-danger"
        role="alert"
      >
        {{ saveError }}。当前填写内容已保留，请修正后重试。
      </p>
    </form>
  </section>
</template>

<style scoped>
.attendance-grid {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}

.attendance-grid table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: .75rem;
}

.attendance-grid th,
.attendance-grid td {
  height: 2.25rem;
  min-width: 2.5rem;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 0 .375rem;
  text-align: center;
}

.attendance-grid thead th {
  position: sticky;
  z-index: 2;
  top: 0;
  background: var(--surface-2);
  color: var(--ink-soft);
}

.attendance-grid .attendance-grid__worker {
  position: sticky;
  z-index: 3;
  left: 0;
  min-width: 8rem;
  max-width: 8rem;
  background: var(--panel);
  padding-left: .75rem;
  box-shadow: 1px 0 var(--line);
  text-align: left;
}

.attendance-grid thead .attendance-grid__worker,
.attendance-grid tfoot .attendance-grid__worker {
  background: var(--surface-2);
}

.attendance-grid__weekend {
  color: var(--danger-ink) !important;
}

.attendance-grid td button {
  width: 100%;
  height: 1.75rem;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-soft);
  font-family: var(--font-mono);
  font-size: 11px;
}

.attendance-grid td button:hover,
.attendance-grid td button:focus-visible,
.attendance-grid td button.is-selected {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand);
  outline: none;
}

.attendance-grid td button.has-record {
  background: var(--ok-soft);
  color: var(--ok-ink);
  font-weight: 800;
}

.attendance-grid td button:disabled {
  cursor: not-allowed;
  border-color: transparent;
  background: var(--surface-2);
  color: var(--ink-faint);
}

.attendance-grid td sup {
  color: var(--warn-ink);
}

.attendance-grid tfoot th,
.attendance-grid tfoot td {
  background: var(--surface-2);
}

.attendance-grid__editor {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: .75rem;
  border-top: 1px solid var(--line);
  background: var(--panel);
  padding: 1rem;
  color: var(--ink-soft);
  font-size: .75rem;
}

.attendance-grid__editor label {
  display: grid;
  gap: .25rem;
  font-weight: 700;
}

.attendance-grid__editor input {
  width: 100%;
  height: 2.25rem;
  min-width: 6rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-btn);
  padding: 0 .5rem;
  color: var(--ink);
}

.attendance-grid__editor input:focus-visible {
  border-color: var(--brand);
  outline: none;
  box-shadow: 0 0 0 3px var(--brand-ring);
}

@media (max-width: 480px) {
  .attendance-grid__editor > *,
  .attendance-grid__editor label {
    width: 100%;
  }
}
</style>
