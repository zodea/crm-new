<script setup lang="ts">
import type { PayrollActualFact } from '~/lib/payroll/central-actual-contract'
import { payrollActualLocation, payrollActualRefQuery } from '~/lib/payroll/adjustment-navigation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

defineProps<{ rows: PayrollActualFact[], origin: 'real' | 'demo', returnTo: string, writable?: boolean }>()
const labels = { 'initial-release': '原工资发放', 'supplement': '实际补发', 'refund': '实际退款', 'recording-reversal': '错记冲销' }
const qualificationLabels: Record<PayrollActualFact['qualification'], string> = { 'proven': '依据完整', 'scoped-amount-proven': '按原工资范围计入', 'historical-amount-proven': '仅历史整单金额可证明', 'unproven': '待核实' }
</script>

<template>
  <div tabindex="0" aria-label="工资实际收付明细表" class="min-w-0 overflow-x-auto">
    <table class="w-full min-w-760px text-left text-12px">
      <thead>
        <tr class="border-b border-line">
          <th class="p-2">
            实际来源
          </th><th class="p-2">
            发生日期
          </th><th class="p-2">
            有符号实额
          </th><th class="p-2">
            个人分配
          </th><th class="p-2">
            记录资格
          </th><th class="p-2">
            操作
          </th>
        </tr>
      </thead><tbody>
        <tr v-for="row in rows" :key="row.identity" class="border-b border-line">
          <td class="p-2">
            <NuxtLink :to="payrollActualLocation(row.ref, origin, returnTo)" class="link-brand">
              {{ labels[row.kind] }}
            </NuxtLink><p v-if="row.kind === 'recording-reversal'" class="mt-1 text-ink-soft">
              不是工人实际退款
            </p>
          </td><td class="p-2">
            {{ row.occurredOn || '未记录' }}
          </td><td class="p-2 font-mono">
            {{ payrollAmount(row.signedAmount.value) }}<p v-if="row.signedAmount.state !== 'known'" class="mt-1 font-sans text-warn">
              {{ row.signedAmount.reasons.join('；') || '金额尚未完整核实' }}
            </p>
          </td><td class="max-w-60 p-2">
            <p v-for="allocation in row.allocations" :key="allocation.workerId" class="break-words">
              {{ allocation.workerName || '姓名未记录' }}：{{ payrollAmount(allocation.amount) }}
            </p><p v-if="row.allocationState !== 'complete'" class="text-warn">
              {{ row.qualification === 'scoped-amount-proven' ? '各原工资的个人分配未完整记录' : '原个人分配未完整记录' }}
            </p>
          </td><td class="max-w-56 break-words p-2">
            {{ qualificationLabels[row.qualification] }}
            <template v-if="row.qualification === 'scoped-amount-proven'">
              <p v-for="diagnostic in row.diagnostics" :key="diagnostic.code" class="mt-1 text-ink-soft">
                {{ diagnostic.message }}
              </p>
            </template>
          </td><td class="p-2">
            <NuxtLink v-if="writable && origin === 'real' && row.qualification === 'proven'" :to="{ path: '/subcontract/payroll/payments/reversal/new', query: { origin, ...payrollActualRefQuery(row.ref), returnTo } }" class="link-brand">
              {{ row.kind === 'recording-reversal' ? '纠正这次错记冲销' : '核实错记冲销' }}
            </NuxtLink><span v-else>只读</span>
          </td>
        </tr><tr v-if="!rows.length">
          <td colspan="6" class="p-4 text-center text-ink-faint">
            当前范围没有工资实际收付记录。
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
