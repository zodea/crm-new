<script setup lang="ts">
import type { PayrollAFeesFrozenDocument } from '~/lib/payroll/central-a-fees-contract'
import { payrollAmountSummary } from '~/lib/payroll/a-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import PayrollAFeeLinesTable from './PayrollAFeeLinesTable.vue'
import PayrollANegativeLinesTable from './PayrollANegativeLinesTable.vue'

defineProps<{ document: PayrollAFeesFrozenDocument }>()
</script>

<template>
  <section class="frozen-fees" aria-label="冻结费用与独立管理簿">
    <h2>{{ document.book.bookPurpose === 'management' ? '管理费清单' : '逐条补贴组成' }}</h2>
    <p v-if="document.fees.management">
      管理依据：{{ document.fees.management.revision.evidenceNote }}
    </p>
    <PayrollAFeeLinesTable :lines="document.fees.lines" />
    <template v-if="document.book.bookPurpose === 'management'">
      <h2>负价代付清单</h2><PayrollANegativeLinesTable :lines="document.fees.negativeLines" />
    </template>
    <p class="frozen-fees-totals">
      工作 {{ payrollAmountSummary(document.fees.totals.workAmount) }} · 补贴 {{ payrollAmountSummary(document.fees.totals.subsidyAmount) }} · 管理费 {{ payrollAmountSummary(document.fees.totals.managementAmount) }} · 负价 {{ payrollAmountSummary(document.fees.totals.negativeAmount) }} · 清单合计 {{ payrollAmount(document.listAmount) }}
    </p>
    <h2>本簿此前实际已领</h2>
    <table>
      <thead><tr><th>月份</th><th>原工资单</th><th>实际已领</th></tr></thead><tbody>
        <tr v-for="payment in document.previousBookPayments" :key="payment.statementId">
          <td>{{ payment.month }}</td><td>{{ payment.statementId }}</td><td>{{ payrollAmount(payment.amount) }}</td>
        </tr><tr v-if="!document.previousBookPayments.length">
          <td colspan="3">
            无本簿此前实际已领记录
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.frozen-fees { margin: 4mm 0; font-size: 9pt; }
.frozen-fees h2 { margin: 4mm 0 2mm; font-size: 11pt; }
.frozen-fees p { line-height: 1.6; overflow-wrap: anywhere; }
.frozen-fees-totals { padding: 2mm 0; font-weight: 700; }
.frozen-fees table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.frozen-fees th, .frozen-fees td { border: .25mm solid #111827; padding: 1.5mm; overflow-wrap: anywhere; }
.frozen-fees thead { display: table-header-group; }
.frozen-fees tr { break-inside: avoid; }
</style>
