<script setup lang="ts">
import type { PayrollAdjustmentApplicationHistory } from '~/lib/payroll/central-adjustment-contract'
import { payrollActualLocation } from '~/lib/payroll/adjustment-navigation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

defineProps<{ rows: PayrollAdjustmentApplicationHistory[], origin: 'real' | 'demo', returnTo: string }>()
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" aria-label="更正逐次处理历史">
    <SectionHeader title="逐次处理历史" /><p v-if="!rows.length" class="text-12px text-ink-faint">
      尚未记录实际补退或后续工资处理。
    </p><div v-else tabindex="0" aria-label="更正处理历史表" class="min-w-0 overflow-x-auto">
      <table class="w-full min-w-680px text-left text-12px">
        <thead>
          <tr class="border-b border-line">
            <th class="p-2">
              处理方式
            </th><th class="p-2">
              处理差额
            </th><th class="p-2">
              真实事实 / 日期
            </th><th class="p-2">
              依据与限制
            </th>
          </tr>
        </thead><tbody>
          <tr v-for="row in rows" :key="row.id" class="border-b border-line">
            <td class="p-2">
              {{ row.kind === 'later-release' ? '后续工资处理' : row.kind === 'recording-reversal' ? '错记冲销' : '实际补退' }}
            </td><td class="p-2 font-mono">
              {{ payrollAmount(row.appliedDelta.value) }}
            </td><td class="p-2">
              <NuxtLink v-if="row.fact" :to="payrollActualLocation(row.fact.ref, origin, returnTo)" class="link-brand">
                查看{{ row.fact.kind === 'initial-release' ? '后续工资原发放' : row.fact.kind === 'refund' ? '实际退款' : row.fact.kind === 'recording-reversal' ? '错记冲销' : '实际补发' }}
              </NuxtLink><span v-else>原事实暂未核实</span><p class="mt-1">
                {{ row.fact?.occurredOn || '日期未记录' }}
              </p>
            </td><td class="max-w-72 break-words p-2">
              {{ row.reasons.join('；') || (row.kind === 'later-release' ? '处理关联不另算一次现金收付' : row.kind === 'recording-reversal' ? '冲销登记效果，不是实际退款' : '仅按真实收付来源计一次') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
