<script setup lang="ts">
import type { WageStatement } from '~/lib/payroll/statements'
import { computed } from 'vue'
import { createPayrollDocumentView } from '~/lib/payroll/output'

const props = defineProps<{ statement: WageStatement }>()
const document = computed(() => createPayrollDocumentView(props.statement))

function money(value: number | null) {
  return value == null ? '—' : `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
}
</script>

<template>
  <div class="payroll-print-output" aria-hidden="true">
    <article
      v-if="document.formatFamily === 'C2'"
      class="payroll-print-page"
      data-payroll-print-page
      data-payroll-print-kind="daywork"
    >
      <header class="payroll-print-title">
        <h1>零星用工记录表</h1>
        <p>{{ document.projectName }} · {{ document.month }} · {{ document.crewName }}</p>
      </header>
      <table>
        <thead>
          <tr>
            <th>序号</th>
            <th>日期</th>
            <th>施工内容</th>
            <th>起止时间</th>
            <th>用工人</th>
            <th>用工数</th>
            <th>证明人</th>
            <th>确认日期</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(record, index) in document.dayworkRecords" :key="record.id">
            <td>{{ index + 1 }}</td>
            <td>{{ record.workDate }}</td>
            <td>{{ record.workContent }}</td>
            <td>{{ record.startTime }}–{{ record.endTime }}</td>
            <td>{{ record.workerName }}</td>
            <td>{{ record.laborUnits }}</td>
            <td>{{ record.witness }}</td>
            <td>{{ record.confirmedOn }}</td>
          </tr>
        </tbody>
      </table>
      <p class="payroll-print-note">
        {{ document.note || '证明人确认后进入工资核算；半工按 0.5 工计。' }}
      </p>
      <footer class="payroll-print-signatures">
        <span>班组长：</span>
        <span>施工员：</span>
        <span>安全员：</span>
        <span>现场负责人：</span>
      </footer>
    </article>

    <article
      class="payroll-print-page"
      data-payroll-print-page
      data-payroll-print-kind="wage"
    >
      <header class="payroll-print-title">
        <h1>{{ document.projectName }}工资表</h1>
        <p>
          {{ document.month }} · {{ document.crewName }} ·
          请款负责人：{{ document.leaderName }} · {{ document.formatFamily }} 族 · {{ document.sourceLabel }}
        </p>
      </header>
      <table>
        <thead>
          <tr>
            <th>序号</th>
            <th>姓名</th>
            <th>分项</th>
            <th>单位</th>
            <th>工程量</th>
            <th>工资单价</th>
            <th>分项金额</th>
            <th class="payroll-print-sign-cell">
              签字确认并按手印
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in document.wageRows" :key="line.id">
            <td>{{ index + 1 }}</td>
            <td>{{ line.workerName }}</td>
            <td>{{ line.itemName }}</td>
            <td>{{ line.unit }}</td>
            <td>{{ line.quantity }}</td>
            <td>{{ money(line.unitPrice) }}</td>
            <td>{{ money(line.amount) }}</td>
            <td />
          </tr>
        </tbody>
      </table>

      <section class="payroll-print-summary">
        <div>
          <span>累计应付</span>
          <strong>{{ money(document.cumulativeAmount) }}</strong>
        </div>
        <div>
          <span>此前已发</span>
          <strong>{{ money(document.previouslyPaid) }}</strong>
        </div>
        <div>
          <span>本次核算应发</span>
          <strong>{{ money(document.grossAmount) }}</strong>
        </div>
        <div>
          <span>本次实际发放</span>
          <strong>{{ money(document.actualAmount) }}</strong>
        </div>
      </section>

      <section class="payroll-print-allocation">
        <h2>组内实际发放</h2>
        <div v-if="document.allocationRecorded" class="payroll-print-allocation-grid">
          <p v-for="allocation in document.allocations" :key="allocation.workerId">
            <span>{{ allocation.workerName }}{{ allocation.isLeader ? '（负责人）' : '' }}</span>
            <strong>{{ money(allocation.amount) }}</strong>
          </p>
        </div>
        <p v-else>
          历史工资单未记录组内分配。
        </p>
      </section>

      <footer class="payroll-print-signatures">
        <span>班组长：</span>
        <span>施工员：</span>
        <span>安全员：</span>
        <span>现场负责人：</span>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.payroll-print-output { display: none; }

@media print {
  :global(body:has(.payroll-print-output) *) { visibility: hidden !important; }
  .payroll-print-output,
  .payroll-print-output * { visibility: visible !important; }
  .payroll-print-output {
    display: block !important;
    position: absolute;
    inset: 0;
    width: 100%;
    color: #111827;
    background: white;
  }
  .payroll-print-page {
    box-sizing: border-box;
    min-height: 277mm;
    padding: 8mm 10mm;
    break-after: page;
    page-break-after: always;
    font-size: 9pt;
  }
  .payroll-print-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .payroll-print-title {
    margin-bottom: 5mm;
    text-align: center;
  }
  .payroll-print-title h1 {
    margin: 0;
    font-size: 18pt;
  }
  .payroll-print-title p {
    margin: 2mm 0 0;
    color: #374151;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th,
  td {
    height: 9mm;
    border: .25mm solid #111827;
    padding: 1.5mm 2mm;
    text-align: center;
    overflow-wrap: anywhere;
  }
  th {
    background: #f3f4f6 !important;
    print-color-adjust: exact;
  }
  .payroll-print-sign-cell { width: 30mm; }
  .payroll-print-note {
    margin: 4mm 0 0;
    line-height: 1.6;
  }
  .payroll-print-summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    margin-top: 5mm;
    border: .25mm solid #111827;
  }
  .payroll-print-summary div {
    display: grid;
    gap: 1.5mm;
    padding: 3mm;
    border-right: .25mm solid #111827;
  }
  .payroll-print-summary div:last-child { border-right: 0; }
  .payroll-print-allocation { margin-top: 5mm; }
  .payroll-print-allocation h2 { margin: 0 0 2mm; font-size: 11pt; }
  .payroll-print-allocation-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 2mm 8mm;
  }
  .payroll-print-allocation p {
    display: flex;
    justify-content: space-between;
    margin: 0;
    border-bottom: .2mm solid #9ca3af;
    padding: 1.5mm 0;
  }
  .payroll-print-signatures {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 5mm;
    margin-top: 12mm;
  }
}

@page {
  size: A4 portrait;
  margin: 10mm;
}
</style>
