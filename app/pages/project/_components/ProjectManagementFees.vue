<script setup lang="ts">
import type { ProjectManagementFeeRead } from '~/lib/project/management-fee'
import { payrollActualLocation } from '~/lib/payroll/adjustment-navigation'
import { MANAGEMENT_FEE_SOURCE_LABELS } from '~/lib/project/management-fee'
import { yuan } from '~/lib/util/money'

defineProps<{ fees: ProjectManagementFeeRead, returnTo: string }>()
defineEmits<{ retry: [] }>()
const sourceStates = { complete: '已核实来源', partial: '来源不完整', forbidden: '无查看权限', unavailable: '暂不可核实' } as const
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="project-management-fee-title">
    <div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 id="project-management-fee-title" class="m-0 text-14px font-700 text-ink">
          管理费实际成本
        </h2>
        <p class="mb-0 mt-2 text-13px text-ink" aria-label="管理费合计">
          {{ fees.actualCost.value === null ? '总额未知' : yuan(String(fees.actualCost.value)) }}
          <span v-if="fees.actualCost.knownValue !== null" class="ml-2 text-ink-soft">已核实小计 {{ yuan(String(fees.actualCost.knownValue)) }}</span>
        </p>
        <p class="mb-0 mt-2 text-11px text-ink-soft">
          按原费用身份统计；已经计入工资或其他实际成本、原支付渠道的同一费用，不再重复计成本或扣现金。
        </p>
      </div>
      <button type="button" class="btn-secondary h-8 px-3 text-12px" @click="$emit('retry')">
        重新读取管理费
      </button>
    </div>
    <div class="mt-4 grid min-w-0 gap-3 lg:grid-cols-3">
      <section v-for="source in fees.sources" :key="source.key" class="min-w-0 border border-line p-3" :aria-label="MANAGEMENT_FEE_SOURCE_LABELS[source.key]">
        <h3 class="m-0 text-12px font-700 text-ink">
          {{ MANAGEMENT_FEE_SOURCE_LABELS[source.key] }}
        </h3>
        <p class="mb-0 mt-2 text-11px text-ink-soft">
          {{ sourceStates[source.state] }}
        </p>
        <p class="mb-0 mt-2 text-13px text-ink">
          {{ source.actualCost.value === null ? '未知' : yuan(String(source.actualCost.value)) }}
          <span v-if="source.actualCost.value === null && source.actualCost.knownValue !== null" class="block text-11px text-ink-soft">已核实小计 {{ yuan(String(source.actualCost.knownValue)) }}</span>
        </p>
        <p v-if="source.asOf" class="mb-0 mt-1 break-words text-10px text-ink-faint">
          读取时点 {{ source.asOf }}
        </p>
        <ul v-if="source.reasons.length" class="mb-0 mt-2 pl-4 text-11px text-ink-soft">
          <li v-for="reason in source.reasons" :key="reason" class="break-words">
            {{ reason }}
          </li>
        </ul>
        <p v-if="source.state === 'complete' && !source.rows.length" class="mb-0 mt-2 text-11px text-ink-soft">
          已核实该来源当前无有效管理簿实际记录。
        </p>
        <details v-if="source.rows.length" class="mt-3 text-11px text-ink-soft">
          <summary class="cursor-pointer text-ink">
            查看原实际记录（{{ source.rows.length }}）
          </summary>
          <ul class="mb-0 mt-2 space-y-2 pl-4">
            <li v-for="row in source.rows" :key="row.identity" class="break-words">
              <NuxtLink :to="payrollActualLocation(row.ref, fees.dataOrigin, returnTo)" class="text-brand hover:underline">
                {{ row.ref.kind === 'released-statement' ? '原工资发放' : '原补退或冲销记录' }}
              </NuxtLink>
              <span class="ml-2">{{ row.amount === null ? '金额未知' : yuan(row.amount) }}</span>
              <span v-if="row.occurredOn" class="ml-2">{{ row.occurredOn }}</span>
            </li>
          </ul>
        </details>
      </section>
    </div>
  </section>
</template>
