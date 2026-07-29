<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { TargetCostDetailCategory } from '~/lib/target-cost/detail'

defineProps<{
  categories: readonly TargetCostDetailCategory[]
}>()

const columns: KitTableColumn[] = [
  { field: 'category', title: '成本科目', minWidth: 130 },
  { field: 'targetAmount', title: '目标成本', type: 'money', width: 142 },
  { field: 'signedAmount', title: '已签合同', type: 'money', width: 142 },
  { field: 'settledAmount', title: '动态成本', type: 'money', width: 142 },
  { field: 'paidAmount', title: '累计支付', type: 'money', width: 142 },
  { field: 'remainingAmount', title: '预算剩余', type: 'money', width: 142 },
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
        目标金额取当前版本；实际只汇总正式合同、已确认结算、已发放工资和已确认报销。
      </p>
    </div>
    <KitTable
      :columns="columns"
      :data="[...categories]"
      :min-rows="8"
      :resizable="true"
      empty="当前项目尚无成本对比事实"
    >
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
