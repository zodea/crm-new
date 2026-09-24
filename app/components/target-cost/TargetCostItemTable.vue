<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { TargetCostDetailItem } from '~/lib/target-cost/detail'

withDefaults(defineProps<{
  items: readonly TargetCostDetailItem[]
  editable?: boolean
}>(), {
  editable: true,
})

const emit = defineEmits<{
  edit: []
}>()

const columns: KitTableColumn[] = [
  { type: 'seq', title: '#', width: 52 },
  { field: 'category', title: '成本科目', width: 112, filterable: true },
  { field: 'itemName', title: '分项名称', minWidth: 220, slot: 'itemName' },
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
      <KitButton
        v-if="editable"
        type="button"
        variant="secondary"
        @click="emit('edit')"
      >
        <span class="i-lucide-list-pen mr-1" aria-hidden="true" />
        编辑科目明细
      </KitButton>
    </div>
    <KitTable
      :columns="columns"
      :data="[...items]"
      :min-rows="8"
      :resizable="true"
      :empty="{
        title: '当前版本尚无科目明细',
        description: '点击“编辑科目明细”，按成本科目补充预算行。',
      }"
    >
      <template #itemName="{ row }">
        <span v-if="row.itemName">{{ row.itemName }}</span><span v-else class="text-ink-faint">未填写分项名称（历史记录）</span>
      </template>
    </KitTable>
  </section>
</template>
