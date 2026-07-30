<script setup lang="ts">
import type { WorkerDetailSummary } from '~/lib/worker/detail'
import { formatMoney } from '~/lib/util/money'

defineProps<{
  summary: WorkerDetailSummary
}>()

function money(value: number): string {
  return formatMoney(value, { currency: true })
}
</script>

<template>
  <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
    <div class="summary-tile">
      <span>参与项目</span><strong>{{ summary.projectCount }}</strong>
    </div>
    <div class="summary-tile">
      <span>责任户</span><strong>{{ summary.assignedUnitCount }}</strong>
    </div>
    <div class="summary-tile">
      <span>考勤</span><strong>{{ summary.attendanceDays }} 天</strong>
    </div>
    <div class="summary-tile">
      <span>确认签工</span><strong>{{ summary.confirmedDayworkUnits }} 工</strong>
    </div>
    <div class="summary-tile">
      <span>已记录个人收款</span><strong>{{ money(summary.knownAllocatedAmount) }}</strong>
    </div>
    <div class="summary-tile">
      <span>项目扣罚</span><strong>{{ money(summary.penaltyAmount) }}</strong>
    </div>
  </div>
</template>

<style scoped>
.summary-tile { min-width: 0; padding: .65rem .75rem; border-radius: var(--radius-control); background: var(--surface-2); }
.summary-tile span { display: block; color: var(--ink-faint); font-size: 10px; }
.summary-tile strong { display: block; margin-top: .25rem; overflow-wrap: anywhere; font-size: 13px; }
</style>
