<script setup lang="ts">
import type { PayrollAFrozenDocument } from '~/lib/payroll/central-a-contract'
import { computed } from 'vue'
import { hasPayrollAFeesDocument } from '~/lib/payroll/central-a-fees-contract'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import PayrollAFeesFrozenSection from './PayrollAFeesFrozenSection.vue'

const props = defineProps<{ document: PayrollAFrozenDocument }>()
const feesDocument = computed(() => hasPayrollAFeesDocument(props.document) ? props.document : null)
const management = computed(() => feesDocument.value?.book.bookPurpose === 'management')
</script>

<template>
  <Teleport to="body">
    <div class="payroll-a-print" aria-hidden="true">
      <article class="payroll-a-print-page" data-payroll-print-page>
        <header class="payroll-a-print-title">
          <h1>{{ document.projectName }}{{ management ? '管理费进度款单' : '工资表' }}</h1><p>{{ document.month }} · {{ document.crewName || '未关联班组' }} · {{ management ? '管理人' : '负责人' }}：{{ document.leaderName }} · {{ { monthly: '月度请款', settlement: '工程结算', retention: '尾款' }[document.periodKind] }}</p><p>按实际完成现场量核算 · 支付比例 {{ document.payRatio * 100 }}%</p>
        </header>
        <table v-if="!management">
          <thead>
            <tr>
              <th>序号</th><th>姓名</th><th>分项</th><th>单位</th><th>完成量</th><th>单价</th><th>金额</th><th class="signature">
                签字确认并按手印
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="(line, index) in document.lines" :key="line.id">
              <td>{{ index + 1 }}</td><td>{{ line.workerName }}</td><td>{{ line.itemName }}</td><td>{{ line.unit }}</td><td>{{ line.quantity }}</td><td>{{ payrollAmount(line.unitPrice) }}</td><td>{{ payrollAmount(line.amount) }}</td><td />
            </tr>
          </tbody>
        </table>
        <PayrollAFeesFrozenSection v-if="feesDocument" :document="feesDocument" />
        <section class="payroll-a-print-confirmation">
          <section class="payroll-a-print-summary">
            <p>累计应付<strong>{{ payrollAmount(document.cumulativeAmount) }}</strong></p><p>此前实际已发<strong>{{ payrollAmount(document.previouslyPaid) }}</strong></p><p>本次核算应发<strong>{{ payrollAmount(document.grossAmount) }}</strong></p><p>本次实际发放<strong>{{ payrollAmount(document.actualAmount) }}</strong></p>
          </section>
          <section class="payroll-a-print-allocation">
            <h2>组内实际收款</h2><table>
              <thead>
                <tr>
                  <th>姓名</th><th>角色</th><th>实际收款</th><th class="signature">
                    签收
                  </th>
                </tr>
              </thead><tbody>
                <tr v-for="allocation in document.allocations" :key="allocation.workerId">
                  <td>{{ allocation.workerName }}</td><td>{{ allocation.isLeader ? '负责人' : '成员' }}</td><td>{{ payrollAmount(allocation.amount) }}</td><td />
                </tr>
              </tbody>
            </table>
          </section>
          <p class="payroll-a-print-note">
            {{ document.note }}<br>发放时间：{{ document.releasedAt }} · 经办人：{{ document.operatorName }}
          </p>
          <footer class="payroll-a-print-signatures">
            <span>{{ management ? '管理人' : '班组长' }}：</span><span>施工员：</span><span>安全员：</span><span>现场负责人：</span>
          </footer>
        </section>
      </article>
    </div>
  </Teleport>
</template>

<style scoped>
.payroll-a-print { display: none; }
@media print {
  :global(html:has(> body > .payroll-a-print)), :global(body:has(> .payroll-a-print)) { background: white !important; }
  :global(body:has(> .payroll-a-print) > :not(.payroll-a-print)) { display: none !important; }
  :global(body:has(> .payroll-a-print)) { height: auto !important; overflow: visible !important; }
  .payroll-a-print { display: block !important; width: 100%; color: #111827; background: white; }
  .payroll-a-print, .payroll-a-print * { visibility: visible !important; }
  .payroll-a-print-page { page: payroll-a; box-sizing: border-box; padding: 8mm 6mm; font-size: 9pt; }
  .payroll-a-print-title { margin-bottom: 5mm; text-align: center; }
  .payroll-a-print-title h1 { margin: 0; font-size: 18pt; }
  .payroll-a-print-title p { margin: 2mm 0; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { height: 9mm; padding: 1.5mm; border: .25mm solid #111827; text-align: center; overflow-wrap: anywhere; }
  th { background: #f3f4f6; print-color-adjust: exact; }
  .signature { width: 28mm; }
  .payroll-a-print-confirmation { break-inside: avoid; }
  .payroll-a-print-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin: 5mm 0; }
  .payroll-a-print-summary p { display: grid; gap: 2mm; margin: 0; padding: 2mm; border: .25mm solid #111827; }
  .payroll-a-print-allocation h2 { margin: 5mm 0 2mm; font-size: 11pt; }
  .payroll-a-print-note { margin: 4mm 0; line-height: 1.6; }
  .payroll-a-print-signatures { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5mm; margin-top: 12mm; }
}
@page payroll-a {
  size: A4 portrait;
  margin: 10mm;
  @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #374151; }
}
</style>
