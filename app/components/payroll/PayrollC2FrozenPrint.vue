<script setup lang="ts">
import type { PayrollC2FrozenDocument } from '~/lib/payroll/central-c2-contract'
import type { PayrollOfficialIssue } from '~/lib/payroll/central-numbering-contract'
import { c2Number } from '~/lib/payroll/c2-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import PayrollHollowFrozenSection from './PayrollHollowFrozenSection.vue'

defineProps<{ document: PayrollC2FrozenDocument, officialIssue?: PayrollOfficialIssue }>()
</script>

<template>
  <Teleport to="body">
    <div class="payroll-c2-print" aria-hidden="true">
      <article class="c2-paper" data-payroll-print-page>
        <header><h1>{{ document.projectName }} C2 工资表</h1><p>{{ document.month }} · {{ document.crewName || '未关联班组' }} · 负责人：{{ document.leaderName }}</p><p>本月已确认签工工资 · 月度 100%</p><PayrollOfficialIdentity v-if="officialIssue" :issue="officialIssue" /></header>
        <table>
          <thead>
            <tr>
              <th>姓名</th><th>项目</th><th>工</th><th>元/工</th><th>核算金额</th><th class="signature">
                签字确认并按手印
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="line in document.lines" :key="line.id">
              <td>{{ line.workerName }}</td><td>{{ line.itemName }}</td><td>{{ c2Number(line.quantity) }}</td><td>{{ c2Number(line.unitPrice) }}</td><td>{{ payrollAmount(line.amount) }}</td><td />
            </tr>
          </tbody>
        </table>
        <PayrollHollowFrozenSection v-if="document.hollow" :snapshot="document.hollow" />
        <section class="summary">
          <p>核算应发 <strong>{{ payrollAmount(document.grossAmount) }}</strong></p><p>实际发放 <strong>{{ payrollAmount(document.actualAmount) }}</strong></p>
        </section><h2>实际收款分配</h2><table>
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
        </table><p>{{ document.note }}</p><p>发放：{{ document.releasedAt }} · 经办：{{ document.operatorName }}</p><footer><span>班组长：</span><span>施工员：</span><span>安全员：</span><span>现场负责人：</span></footer>
      </article>
      <article class="c2-paper" data-payroll-print-page>
        <header><h1>{{ document.projectName }} 零星签工表</h1><p>{{ document.month }} · 负责人：{{ document.leaderName }}</p><p>本表与工资表来自同一次发放冻结。</p><PayrollOfficialIdentity v-if="officialIssue" :issue="officialIssue" /></header><p>每工标准：{{ c2Number(document.config.unitRate) }} 元</p><p class="rule">
          计算规则：{{ document.config.ruleText == null ? '未记录' : document.config.ruleText === '' ? '已明确保存为空规则' : document.config.ruleText }}
        </p><table>
          <thead><tr><th>姓名 / 日期</th><th>施工内容</th><th>时段 / 工</th><th>证明人 / 确认日</th><th>签字</th></tr></thead><tbody>
            <tr v-for="fact in document.daywork" :key="fact.id">
              <td>{{ document.members.find(member => member.workerId === fact.workerId)?.workerName }}<br>{{ fact.workDate }}</td><td>{{ fact.workContent }}</td><td>{{ fact.startTime }}—{{ fact.endTime }}<br>{{ c2Number(fact.laborUnits) }} 工</td><td>{{ fact.witness }}<br>{{ fact.confirmedOn }}</td><td />
            </tr>
          </tbody>
        </table><footer><span>班组长：</span><span>施工员：</span><span>安全员：</span><span>现场负责人：</span></footer>
      </article>
    </div>
  </Teleport>
</template>

<style scoped>
.payroll-c2-print { display:none; }
@media print {
  :global(html:has(body > .payroll-c2-print)) { background:white !important; }
  :global(body:has(> .payroll-c2-print) > :not(.payroll-c2-print)) { display:none !important; }
  :global(body:has(> .payroll-c2-print)) { height:auto !important; overflow:visible !important; background:white !important; }
  .payroll-c2-print { display:block !important; width:100%; color:#111; background:white; }
  .c2-paper { padding:6mm; font-size:9pt; break-after:page; }
  .c2-paper:last-child { break-after:auto; }
  header { text-align:center; margin-bottom:5mm; }
  h1 { font-size:17pt; font-weight:700; }
  h2 { margin:5mm 0 2mm; font-size:11pt; }
  p { margin:2mm 0; overflow-wrap:anywhere; }
  .rule { white-space:pre-wrap; }
  table { width:100%; table-layout:fixed; border-collapse:collapse; }
  th, td { border:1px solid #555; padding:2mm; overflow-wrap:anywhere; vertical-align:middle; }
  thead { display:table-header-group; }
  tr { break-inside:avoid; }
  .signature { width:28mm; }
  .summary { display:flex; justify-content:space-between; margin:4mm 0; }
  footer { display:grid; grid-template-columns:repeat(4,1fr); gap:4mm; padding:8mm 0; break-inside:avoid; }
}
</style>
