<script setup lang="ts">
import type { AttendanceRecord } from '~/lib/payroll/attendance'
import type { PayrollOption } from '~/lib/payroll/statements'
import { computed, reactive } from 'vue'

const props = defineProps<{
  projectId: string
  crewId?: string
  month: string
  workers: readonly PayrollOption[]
  records: readonly AttendanceRecord[]
  blockedWorkerIds?: readonly string[]
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
}>()

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

function selectCell(workerId: string, day: number) {
  if (blockedWorkers.value.has(workerId))
    return
  selected.workerId = workerId
  selected.day = day
  const record = byCell.value.get(`${workerId}:${day}`)
  selected.hours = record?.hours ?? 8
  selected.overtimeHours = record?.overtimeHours ?? 0
  selected.workContent = record?.workContent ?? ''
}

function submit() {
  if (!props.projectId || !selected.workerId || !selected.day)
    return
  emit('save', {
    projectId: props.projectId,
    crewId: selectedWorker.value?.crewId ?? props.crewId ?? null,
    workerId: selected.workerId,
    workDate: `${props.month}-${String(selected.day).padStart(2, '0')}`,
    hours: selected.hours,
    overtimeHours: selected.overtimeHours,
    workContent: selected.workContent,
  })
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-label="月度考勤矩阵">
    <SectionHeader title="月度考勤" :subtitle="`${month} · 工人 × 日期；点击单元格录入`" />
    <div class="attendance-grid" tabindex="0">
      <table>
        <thead>
          <tr>
            <th class="attendance-grid__worker">
              工人
            </th>
            <th v-for="day in days" :key="day">
              {{ day }}
            </th>
            <th>工时</th>
            <th>加班</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="worker in visibleWorkers" :key="worker.id">
            <th class="attendance-grid__worker">
              {{ worker.name }}
            </th>
            <td v-for="day in days" :key="day">
              <button
                type="button"
                :aria-label="`${worker.name} ${month}-${String(day).padStart(2, '0')} 考勤`"
                :disabled="blockedWorkers.has(worker.id)"
                :title="blockedWorkers.has(worker.id) ? '该月使用签工或工资已发放，考勤不可修改' : undefined"
                :class="{ 'is-selected': selected.workerId === worker.id && selected.day === day }"
                @click="selectCell(worker.id, day)"
              >
                <template v-if="byCell.get(`${worker.id}:${day}`)">
                  {{ byCell.get(`${worker.id}:${day}`)?.hours }}
                  <sup v-if="byCell.get(`${worker.id}:${day}`)?.overtimeHours">+</sup>
                </template>
                <span v-else>{{ blockedWorkers.has(worker.id) ? '锁' : '—' }}</span>
              </button>
            </td>
            <td class="font-mono">
              {{ records.filter(record => record.workerId === worker.id).reduce((sum, record) => sum + record.hours, 0) }}
            </td>
            <td class="font-mono">
              {{ records.filter(record => record.workerId === worker.id).reduce((sum, record) => sum + record.overtimeHours, 0) }}
            </td>
          </tr>
          <tr v-if="!visibleWorkers.length">
            <td :colspan="dayCount + 3" class="py-12 text-center text-ink-faint">
              当前班组暂无工人，请先在基础资料维护名册。
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <form v-if="selectedWorker" class="attendance-grid__editor" @submit.prevent="submit">
      <strong>{{ selectedWorker.name }} · {{ month }}-{{ String(selected.day).padStart(2, '0') }}</strong>
      <label>正常工时 <input v-model.number="selected.hours" aria-label="正常工时" type="number" min="0" max="24" step="0.5"></label>
      <label>加班 <input v-model.number="selected.overtimeHours" aria-label="加班工时" type="number" min="0" max="24" step="0.5"></label>
      <label class="min-w-0 flex-1">施工内容 <input v-model="selected.workContent" aria-label="施工内容" type="text"></label>
      <button type="submit" class="btn-primary">
        保存考勤
      </button>
    </form>
  </section>
</template>

<style scoped>
.attendance-grid { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
table { min-width: 70rem; border-collapse: separate; border-spacing: 0; font-size: .75rem; }
th, td { height: 2.25rem; min-width: 2.5rem; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 0 .375rem; text-align: center; }
thead th { position: sticky; top: 0; z-index: 2; background: var(--surface-2); color: var(--ink-soft); }
.attendance-grid__worker { position: sticky; left: 0; z-index: 3; min-width: 8rem; background: white; text-align: left; padding-left: .75rem; box-shadow: 1px 0 var(--line); }
thead .attendance-grid__worker { background: var(--surface-2); }
td button { width: 100%; height: 1.75rem; border-radius: .25rem; color: var(--ink-soft); }
td button:hover, td button.is-selected { background: var(--brand-soft); color: var(--brand); font-weight: 800; }
td button:disabled { cursor: not-allowed; background: var(--surface-2); color: var(--ink-faint); }
td sup { color: var(--warn); }
.attendance-grid__editor { display: flex; flex-wrap: wrap; align-items: end; gap: .75rem; border-top: 1px solid var(--line); padding: 1rem; font-size: .75rem; color: var(--ink-soft); }
.attendance-grid__editor label { display: grid; gap: .25rem; font-weight: 700; }
.attendance-grid__editor input { height: 2.25rem; min-width: 6rem; border: 1px solid var(--line); border-radius: .375rem; padding: 0 .5rem; color: var(--ink); }
</style>
