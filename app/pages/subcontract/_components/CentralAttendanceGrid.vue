<script setup lang="ts">
import type { PayrollAttendanceFact, PayrollAttendanceWorker, PayrollSourceExclusion } from '~/lib/payroll/central-attendance-contract'
import { computed } from 'vue'
import { c1MonthDays, c1Number } from '~/lib/payroll/c1-presentation'

const props = defineProps<{ month: string, workers: readonly PayrollAttendanceWorker[], records: readonly PayrollAttendanceFact[], locks: readonly PayrollSourceExclusion[], busy?: boolean }>()
const emit = defineEmits<{ select: [workerId: string, workDate: string] }>()
const days = computed(() => c1MonthDays(props.month))
const cells = computed(() => {
  const result = new Map<string, PayrollAttendanceFact[]>()
  for (const record of props.records) {
    const key = `${record.workerId}:${record.workDate}`
    result.set(key, [...result.get(key) || [], record])
  }
  return result
})
const rows = computed(() => props.workers.map((worker) => {
  const records = props.records.filter(row => row.workerId === worker.id)
  const total = (field: 'hours' | 'overtimeHours') => records.some(row => row[field] === null) ? null : Number(records.reduce((sum, row) => sum + row[field]!, 0).toFixed(10))
  return { worker, hours: total('hours'), overtime: total('overtimeHours'), locked: props.locks.some(lock => lock.workerId === worker.id), cells: days.value.map((date) => {
    const records = cells.value.get(`${worker.id}:${date}`) || []
    return { date, label: records.length > 1 ? '重复记录' : records[0] ? `${c1Number(records[0].hours)}${records[0].overtimeHours === 0 ? '' : ` + ${c1Number(records[0].overtimeHours)}`}` : '', saved: records.length > 0 }
  }) }
}))
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-label="月度考勤矩阵">
    <div class="border-b border-line p-4">
      <h2 class="font-700">
        月度考勤
      </h2><p class="mt-1 text-12px text-ink-soft">
        {{ month }} · 空格尚未登记；0 为已登记零工时。点击日期查看原内容或登记，表格可在内部横向滚动。
      </p>
    </div>
    <div class="c1-attendance-scroll" data-ui="attendance-grid-scroll" tabindex="0">
      <table :style="{ minWidth: `${160 + days.length * 64 + 180}px` }">
        <thead>
          <tr>
            <th class="c1-attendance-worker">
              工人
            </th><th v-for="date in days" :key="date">
              {{ Number(date.slice(-2)) }} 日
            </th><th>正常工时</th><th>加班工时</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.worker.id">
            <th class="c1-attendance-worker">
              <span class="block break-words">{{ row.worker.name || '姓名未记录' }}</span><span v-if="row.locked || !row.worker.eligible || row.worker.historical" class="mt-1 block text-11px font-400 text-warn">{{ row.locked ? '本月已占用' : row.worker.historical ? '原考勤人员' : '当前不可登记' }}</span>
            </th><td v-for="cell in row.cells" :key="cell.date">
              <button type="button" :disabled="busy" :aria-label="`${row.worker.name || '姓名未记录'} ${cell.date} 考勤`" :class="{ 'is-saved': cell.saved }" @click="emit('select', row.worker.id, cell.date)">
                {{ cell.label || '—' }}
              </button>
            </td><td>{{ c1Number(row.hours) }}</td><td>{{ c1Number(row.overtime) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.c1-attendance-scroll { max-width:100%; overflow-x:auto; overscroll-behavior-inline:contain; }
table { width:100%; border-spacing:0; font-size:12px; }
th, td { height:48px; padding:6px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); text-align:center; }
thead th { background:var(--surface-2); white-space:nowrap; }
.c1-attendance-worker { position:sticky; left:0; z-index:1; min-width:160px; max-width:160px; background:var(--panel); text-align:left; padding:10px 12px; box-shadow:1px 0 var(--line); }
thead .c1-attendance-worker { background:var(--surface-2); }
td button { width:100%; min-height:32px; border:1px solid transparent; border-radius:var(--radius-sm); color:var(--ink-faint); font-family:var(--font-mono); }
td button.is-saved { background:var(--ok-soft); color:var(--ok-ink); }
td button:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
td button:disabled { opacity:.5; }
</style>
