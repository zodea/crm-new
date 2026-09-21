<script setup lang="ts">
import type { PayrollHollowSnapshot } from '~/lib/payroll/central-hollow-deduction-contract'
import { computed } from 'vue'
import { payrollAmountSummary } from '~/lib/payroll/a-presentation'
import { payrollHollowFrozenRows } from '~/lib/payroll/hollow-export'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const props = defineProps<{ snapshot: PayrollHollowSnapshot }>()
const rows = computed(() => payrollHollowFrozenRows(props.snapshot))
</script>

<template>
  <section class="hollow-frozen" aria-label="发放冻结空鼓扣款">
    <h2>本次空鼓扣款依据</h2>
    <p>以下为本次发放采用时的原检查与整改记录；后来的整改及配置变化不回填。</p>
    <table v-if="rows.length">
      <thead><tr><th>原位置 / 原责任</th><th>检查 / 整改 / 当时余量</th><th>本单采用</th><th>采用单处金额</th><th>本单扣款</th></tr></thead><tbody>
        <tr v-for="row in rows" :key="row.原记录身份">
          <td>{{ row.原位置 }}<br>{{ row.原责任 }}</td><td class="number">
            {{ row.检查总处数 }} / {{ row.已整改处数 }} / {{ row.当时未整改处数 }} 处
          </td><td>{{ row.本单采用 }}<span v-if="row.本单采用处数 !== null"> · {{ row.本单采用处数 }} 处</span></td><td class="number">
            {{ row.采用单处金额 === null ? '未采用' : payrollAmount(row.采用单处金额) }}
          </td><td class="number">
            {{ row.本单扣款金额 === null ? '未采用' : payrollAmount(row.本单扣款金额) }}
          </td>
        </tr>
      </tbody>
    </table>
    <div class="hollow-frozen-summary">
      <p>本次请款合计 <strong>{{ payrollAmountSummary(snapshot.totals.claimSubtotal) }}</strong></p><p>同簿此前已处理扣款 <strong>{{ payrollAmountSummary(snapshot.totals.previousProcessed) }}</strong></p><p>本单空鼓扣款 <strong>{{ payrollAmountSummary(snapshot.totals.currentDeduction) }}</strong></p><p>扣款后核算应发 <strong>{{ payrollAmountSummary(snapshot.totals.grossAmount) }}</strong></p>
    </div>
    <p v-for="reason in snapshot.reasons" :key="reason">
      {{ reason }}
    </p>
  </section>
</template>

<style scoped>
.hollow-frozen { margin: 5mm 0; font-size: 8.5pt; }
.hollow-frozen h2 { margin: 3mm 0; font-size: 11pt; break-after: avoid; }
.hollow-frozen table { width: 100%; border-collapse: collapse; }
.hollow-frozen th, .hollow-frozen td { border: 0.2mm solid #333; padding: 2mm; overflow-wrap: anywhere; }
.hollow-frozen thead { display: table-header-group; }
.hollow-frozen tr { break-inside: avoid; }
.hollow-frozen .number { white-space: nowrap; text-align: right; }
.hollow-frozen-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1mm 5mm; break-inside: avoid; }
</style>
