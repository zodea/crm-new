<script setup lang="ts">
import type { PayrollANegativeLineRevision } from '~/lib/payroll/central-a-fees-contract'
import { computed } from 'vue'
import { payrollAmount, payrollNumber } from '~/lib/payroll/read-presentation'

const props = defineProps<{ lines: PayrollANegativeLineRevision[] }>()
const active = computed(() => props.lines.filter(line => !line.removed))
</script>

<template>
  <div class="negative-scroll min-w-0 overflow-x-auto" tabindex="0" role="region" aria-label="负价代付核算组成">
    <table class="negative-table w-full min-w-700px text-12px">
      <thead><tr><th>清单</th><th>数量</th><th>单位</th><th>负单价</th><th>有符号金额</th><th>事由 / 确认依据</th></tr></thead><tbody>
        <tr v-for="line in active" :key="line.id">
          <td>{{ line.label }}</td><td>{{ line.quantity === null ? '未知' : payrollNumber(line.quantity) }}</td><td>{{ line.unit || '未记录' }}</td><td>{{ payrollAmount(line.unitPrice) }}</td><td>{{ payrollAmount(line.signedAmountFen === null ? null : line.signedAmountFen / 100) }}</td><td>
            <div class="negative-reason max-h-30 overflow-auto whitespace-pre-wrap break-words leading-5" tabindex="0">
              <p>{{ line.reason }}</p><p>{{ line.evidenceNote }}</p><p class="text-ink-faint">
                {{ line.actualRef ? '保留原实际事实引用' : '未关联实际收付' }} · {{ line.scope.assignments.length }} 份明确原责任
              </p>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!active.length" class="p-3 text-12px text-ink-faint">
      当前管理单没有负价代付行。
    </p>
  </div>
</template>

<style scoped>
.negative-table { border-collapse: collapse; }
.negative-table th, .negative-table td { padding: 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.negative-table th { white-space: nowrap; }
.negative-table td:nth-child(n+2):nth-child(-n+5) { white-space: nowrap; overflow-wrap: normal; }
@media screen {
  .negative-table { min-width: 860px; table-layout: fixed; }
  .negative-table th:nth-child(1) { width: 16%; }
  .negative-table th:nth-child(2) { width: 8%; }
  .negative-table th:nth-child(3) { width: 7%; }
  .negative-table th:nth-child(4) { width: 12%; }
  .negative-table th:nth-child(5) { width: 15%; }
  .negative-table th:nth-child(6) { width: 42%; }
}
@media print {
  .negative-scroll { overflow: visible; }
  .negative-table { min-width: 0; table-layout: fixed; font-size: 8pt; }
  .negative-table th, .negative-table td { padding: 1.5mm; border: .25mm solid #111827; }
  .negative-table thead { display: table-header-group; }
  .negative-table tr { break-inside: avoid; }
  .negative-reason { max-height: none; overflow: visible; }
}
</style>
