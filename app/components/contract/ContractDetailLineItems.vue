<script setup lang="ts">
import type { ContractLineItem } from '~/lib/contract/detail'
import type { KitTableColumn } from '~/lib/kit/table'
import { computed } from 'vue'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  rows: readonly ContractLineItem[]
}>()

const tableRows = computed(() => [...props.rows])

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'materialName', title: '物资名称', minWidth: 190, fixed: 'left', slot: 'name' },
  { field: 'spec', title: '规格', width: 150 },
  { field: 'brand', title: '品牌', width: 120 },
  { field: 'unit', title: '单位', width: 80 },
  { field: 'qty', title: '数量', width: 110, align: 'right', slot: 'qty' },
  { field: 'unitPrice', title: '含税单价', width: 130, align: 'right', slot: 'unitPrice' },
  { field: 'amount', title: '含税金额', width: 140, align: 'right', slot: 'amount' },
  { field: 'plannedArrivalDate', title: '计划到货', width: 120 },
]
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="contract-lines-title">
    <SectionHeader
      id="contract-lines-title"
      title="采购合同明细"
      subtitle="仅材料采购合同展示持久化明细；施工和分包合同不补造明细"
    />
    <div v-if="rows.length" data-testid="contract-lines-scroll" class="mt-3 min-w-0">
      <KitTable :columns="columns" :data="tableRows" :min-rows="5">
        <template #name="{ row }">
          <span class="block truncate" :title="row.materialName">{{ row.materialName }}</span>
        </template>
        <template #qty="{ row }">
          <span class="font-mono tabular-nums">{{ row.qty ?? '—' }}</span>
        </template>
        <template #unitPrice="{ row }">
          <span class="font-mono tabular-nums">{{ row.unitPrice == null ? '—' : yuan(row.unitPrice) }}</span>
        </template>
        <template #amount="{ row }">
          <span class="font-mono font-700 tabular-nums">{{ row.amount == null ? '—' : yuan(row.amount) }}</span>
        </template>
      </KitTable>
    </div>
    <StatePanel
      v-else
      class="mt-3"
      kind="empty"
      title="暂无采购明细"
      description="当前材料采购合同没有已保存的明细行。"
      compact
    />
  </section>
</template>
