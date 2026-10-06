<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type { TargetCostDetailCategory } from '~/lib/target-cost/detail'
import { COST_AMOUNT_FIELDS } from '~/lib/project/cost-amounts'
import TargetCostMetricValue from './TargetCostMetricValue.vue'

defineProps<{
  categories: DeepReadonly<TargetCostDetailCategory[]>
}>()

const columns: KitTableColumn[] = [
  { field: 'category', title: '成本科目', minWidth: 130 },
  { field: 'targetAmount', title: '目标成本', type: 'money', width: 142, slot: 'cost-targetAmount' },
  { field: 'signedAmount', title: '已签合同', type: 'money', width: 142, slot: 'cost-signedAmount' },
  { field: 'settledAmount', title: '动态成本', type: 'money', width: 142, slot: 'cost-settledAmount' },
  { field: 'paidAmount', title: '累计支付', type: 'money', width: 142, slot: 'cost-paidAmount' },
  { field: 'remainingAmount', title: '预算剩余', type: 'money', width: 142, slot: 'cost-remainingAmount' },
  { field: 'source', title: '事实来源', minWidth: 210, slot: 'source' },
]
</script>

<template>
  <section class="min-w-0" aria-labelledby="target-cost-comparison-title">
    <div class="mb-2">
      <h3 id="target-cost-comparison-title" class="text-14px font-800 text-ink">
        目标与实际对比
      </h3>
      <p class="mt-0.5 text-11px text-ink-faint">
        目标金额取当前版本；实际取正式合同、已确认结算、实际支付和原费用。尚未接入的工资实际来源保留未知。
      </p>
    </div>
    <KitTable
      :columns="columns"
      :data="[...categories]"
      :min-rows="8"
      :row-height="96"
      :resizable="true"
      empty="当前项目尚无成本对比事实"
    >
      <template v-for="field in COST_AMOUNT_FIELDS" :key="field" #[`cost-${field}`]="{ row }">
        <div class="max-h-20 overflow-y-auto whitespace-normal break-words" tabindex="0" :aria-label="`${row.category} ${columns.find(column => column.field === field)?.title}来源`">
          <TargetCostMetricValue :metric="row.metrics[field]" />
        </div>
      </template>
      <template #source="{ row }">
        <div class="flex flex-wrap gap-2">
          <NuxtLink v-if="row.contractCount" :to="row.contractPath" class="cell--link">
            合同 {{ row.contractCount }}
          </NuxtLink>
          <NuxtLink v-if="row.settlementCount" :to="row.settlementPath" class="cell--link">
            结算 {{ row.settlementCount }}
          </NuxtLink>
          <NuxtLink v-if="row.paymentCount" :to="row.paymentPath" class="cell--link">
            {{ row.category === '工人工资' ? '工资单' : '支付' }} {{ row.paymentCount }}
          </NuxtLink>
          <NuxtLink v-if="row.reimbursementCount" :to="row.reimbursementPath" class="cell--link">
            报销 {{ row.reimbursementCount }}
          </NuxtLink>
          <span
            v-if="!(
              row.contractCount
              || row.settlementCount
              || row.paymentCount
              || row.reimbursementCount
            )"
            class="text-ink-faint"
          >
            —
          </span>
        </div>
      </template>
    </KitTable>
  </section>
</template>
