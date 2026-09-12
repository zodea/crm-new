<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { TargetCostCategory } from '~/lib/target-cost/central-contract'
import type { NavigationIntentDTO } from '~/types/read-model'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{ categories: readonly TargetCostCategory[], returnTo: string }>()
function source(intent: NavigationIntentDTO | null) {
  if (!intent)
    return null
  const result = resolveNavigationTarget(intent, { returnTo: props.returnTo })
  return result.state === 'resolved' ? result.to : null
}
const columns: KitTableColumn[] = [
  { field: 'category', title: '成本科目', width: 120 },
  { field: 'targetAmount', title: '目标成本', type: 'money', width: 140 },
  { field: 'signedAmount', title: '正式已签合同', width: 180, slot: 'signed' },
  { field: 'settledAmount', title: '动态成本', width: 180, slot: 'settled' },
  { field: 'paidAmount', title: '累计支付', width: 180, slot: 'paid' },
  { field: 'remainingAmount', title: '预算剩余', width: 180, slot: 'remaining' },
  { field: 'source', title: '实际来源', minWidth: 220, slot: 'source' },
]
</script>

<template>
  <section class="min-w-0" aria-label="目标成本来源完整性对比">
    <h3 class="text-14px font-800">
      目标与实际对比
    </h3>
    <p class="mb-3 mt-1 text-12px leading-5 text-ink-faint">
      预算取本版本；实际只读取已接管且有明确关系的事实。未接入、无权或缺关系时保留来源缺口，预算剩余不按零成本计算。
    </p>
    <KitTable :columns="columns" :data="[...categories]" :min-rows="7" :row-height="96" :resizable="true" empty="当前版本尚无成本科目">
      <template #signed="{ row }">
        <div class="max-h-20 overflow-y-auto whitespace-normal break-words" tabindex="0" :aria-label="`${row.category} 已签合同来源`">
          <TargetCostMetricValue :metric="row.signedAmount" />
        </div>
      </template>
      <template #settled="{ row }">
        <div class="max-h-20 overflow-y-auto whitespace-normal break-words" tabindex="0" :aria-label="`${row.category} 动态成本来源`">
          <TargetCostMetricValue :metric="row.settledAmount" />
        </div>
      </template>
      <template #paid="{ row }">
        <div class="max-h-20 overflow-y-auto whitespace-normal break-words" tabindex="0" :aria-label="`${row.category} 支付来源`">
          <TargetCostMetricValue :metric="row.paidAmount" />
        </div>
      </template>
      <template #remaining="{ row }">
        <div class="max-h-20 overflow-y-auto whitespace-normal break-words" tabindex="0" :aria-label="`${row.category} 余额来源`">
          <TargetCostMetricValue :metric="row.remainingAmount" />
        </div>
      </template>
      <template #source="{ row }">
        <div class="grid max-h-20 gap-1 overflow-y-auto whitespace-normal break-words text-12px" tabindex="0" :aria-label="`${row.category} 可用事实入口`">
          <NuxtLink v-if="source(row.sources.contract)" :to="source(row.sources.contract)!" class="text-brand underline">
            查看正式合同
          </NuxtLink>
          <NuxtLink v-if="source(row.sources.settlement)" :to="source(row.sources.settlement)!" class="text-brand underline">
            查看已确认结算
          </NuxtLink>
          <NuxtLink v-if="source(row.sources.payment)" :to="source(row.sources.payment)!" class="text-brand underline">
            查看支付事实
          </NuxtLink>
          <NuxtLink v-if="source(row.sources.reimbursement)" :to="source(row.sources.reimbursement)!" class="text-brand underline">
            查看已确认报销
          </NuxtLink>
          <p v-if="!row.sources.contract && !row.sources.settlement && !row.sources.payment && !row.sources.reimbursement" class="text-ink-faint">
            当前没有可进入的正式来源；请展开对应来源缺口核对。
          </p>
        </div>
      </template>
    </KitTable>
  </section>
</template>
