<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { TargetCostDetailItem } from '~/lib/target-cost/detail'

defineProps<{
  items: readonly TargetCostDetailItem[]
}>()

const columns: KitTableColumn[] = [
  { type: 'seq', title: '#', width: 52 },
  { field: 'category', title: '成本科目', width: 112, filterable: true },
  { field: 'itemName', title: '分项名称', minWidth: 220 },
  { field: 'unit', title: '单位', width: 76 },
  { field: 'qty', title: '数量', width: 110, align: 'right' },
  { field: 'unitPrice', title: '单价', type: 'money', width: 132 },
  { field: 'amount', title: '目标金额', type: 'money', width: 142 },
  { field: 'note', title: '备注', minWidth: 180 },
]
</script>

<template>
  <section class="min-w-0" aria-labelledby="target-cost-items-title">
    <div class="mb-2 flex min-w-0 flex-wrap items-end justify-between gap-2">
      <div>
        <h3 id="target-cost-items-title" class="text-14px font-800 text-ink">
          科目明细
        </h3>
        <p class="mt-0.5 text-11px text-ink-faint">
          当前版本共 {{ items.length }} 行；金额来自该版本自身明细。
        </p>
      </div>
    </div>
    <KitTable
      :columns="columns"
      :data="[...items]"
      :min-rows="8"
      :resizable="true"
      :empty="{
        title: '当前版本尚无科目明细',
        description: '可先编辑版本头；科目维护能力后续仍在本详情工作台内闭环。',
      }"
    />
  </section>
</template>
