<script setup lang="ts">
import type { PayrollC1FrozenDocument } from '~/lib/payroll/central-c1-contract'
import { computed } from 'vue'
import { c1FrozenAttendanceRows } from '~/lib/payroll/c1-export'
import { c1MonthDays, c1Number } from '~/lib/payroll/c1-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const props = defineProps<{ document: PayrollC1FrozenDocument }>()
const attendance = computed(() => c1FrozenAttendanceRows(props.document))
const days = computed(() => c1MonthDays(props.document.month))
</script>

<template>
  <Teleport to="body">
    <div class="payroll-c1-print" aria-hidden="true">
      <article class="c1-paper" data-payroll-print-page>
        <header><h1>{{ document.projectName }} C1 工资表</h1><p>{{ document.month }} · {{ document.crewName || '未关联班组' }} · 负责人：{{ document.leaderName }}</p><p>本月正常工时与加班工资 · 月度 100%</p></header>
        <table>
          <thead>
            <tr>
              <th>姓名</th><th>项目</th><th>小时</th><th>元/小时</th><th>核算金额</th><th class="signature">
                签字确认并按手印
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="line in document.lines" :key="line.id">
              <td>{{ line.workerName }}</td><td>{{ line.itemName }}</td><td>{{ c1Number(line.quantity) }}</td><td>{{ c1Number(line.unitPrice) }}</td><td>{{ payrollAmount(line.amount) }}</td><td />
            </tr>
          </tbody>
        </table>
        <section class="summary">
          <p>核算应发 <strong>{{ payrollAmount(document.grossAmount) }}</strong></p><p>实际发放 <strong>{{ payrollAmount(document.actualAmount) }}</strong></p>
        </section>
        <h2>实际收款分配</h2><table>
          <thead>
            <tr>
              <th>姓名</th><th>角色</th><th>实际收款</th><th class="signature">
                签收
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="row in document.allocations" :key="row.workerId">
              <td>{{ row.workerName }}</td><td>{{ row.isLeader ? '负责人' : '成员' }}</td><td>{{ payrollAmount(row.amount) }}</td><td />
            </tr>
          </tbody>
        </table>
        <p>{{ document.note }}</p><p>发放：{{ document.releasedAt }} · 经办：{{ document.operatorName }}</p><footer><span>班组长：</span><span>施工员：</span><span>安全员：</span><span>现场负责人：</span></footer>
      </article>
      <article class="c1-paper attendance-paper" data-payroll-print-page>
        <header><h1>{{ document.projectName }} 月度考勤表</h1><p>{{ document.month }} · 负责人：{{ document.leaderName }}</p><p>正常 / 加班工时，空白为未登记；本表与工资表来自同一次发放冻结。</p></header>
        <table class="month-grid">
          <thead>
            <tr>
              <th>姓名</th><th v-for="day in days" :key="day">
                {{ Number(day.slice(-2)) }}
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="member in attendance" :key="member.workerId">
              <th>{{ member.workerName }}</th><td v-for="day in member.days" :key="day.date">
                {{ day.label }}
              </td>
            </tr>
          </tbody>
        </table>
        <h2>逐日施工内容</h2><table>
          <thead><tr><th>姓名</th><th>日期</th><th>正常</th><th>加班</th><th>施工内容</th></tr></thead><tbody>
            <tr v-for="fact in document.attendance" :key="fact.id">
              <td>{{ document.members.find(member => member.workerId === fact.workerId)?.workerName }}</td><td>{{ fact.workDate }}</td><td>{{ c1Number(fact.hours) }}</td><td>{{ c1Number(fact.overtimeHours) }}</td><td>{{ fact.workContent || '未记录' }}</td>
            </tr>
          </tbody>
        </table><footer><span>班组长：</span><span>施工员：</span><span>安全员：</span><span>现场负责人：</span></footer>
      </article>
    </div>
  </Teleport>
</template>

<style scoped>
.payroll-c1-print { display:none; }
@media print {
  :global(body:has(> .payroll-c1-print) > :not(.payroll-c1-print)) { display:none !important; }
  :global(body:has(> .payroll-c1-print)) { height:auto !important; overflow:visible !important; background:white !important; }
  .payroll-c1-print { display:block !important; width:100%; color:#111; background:white; }
  .c1-paper { padding:6mm; font-size:9pt; break-after:page; }
  .c1-paper:last-child { break-after:auto; }
  header { text-align:center; margin-bottom:5mm; }
  h1 { font-size:17pt; font-weight:700; }
  h2 { margin:5mm 0 2mm; font-size:11pt; }
  p { margin:2mm 0; overflow-wrap:anywhere; }
  table { width:100%; table-layout:fixed; border-collapse:collapse; }
  th, td { border:1px solid #555; padding:2mm; overflow-wrap:anywhere; vertical-align:middle; }
  thead { display:table-header-group; }
  tr { break-inside:avoid; }
  .signature { width:28mm; }
  .summary { display:flex; justify-content:space-between; margin:4mm 0; }
  footer { display:grid; grid-template-columns:repeat(4,1fr); gap:4mm; padding:8mm 0; break-inside:avoid; }
  .month-grid { font-size:6pt; }
  .month-grid th:first-child { width:16mm; }
  .month-grid td, .month-grid th { padding:1mm .3mm; }
  .attendance-paper { page:c1-attendance; }
  @page c1-attendance { size:A4 landscape; margin:8mm; }
}
</style>
