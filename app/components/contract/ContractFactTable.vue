<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { NavigationIntentDTO } from '~/types/read-model'
import { computed } from 'vue'
import KitTable from '~/components/ui/KitTable.vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { yuan } from '~/lib/util/money'

export interface ContractFactRow {
  id: string
  no: string | null
  name: string
  date: string | null
  amount: string | null
  paidAmount?: string | null
  status: string | null
  navigation: NavigationIntentDTO
}

const props = defineProps<{
  rows: readonly ContractFactRow[]
  emptyLabel: string
  paidColumn?: boolean
  focusId?: string | null
  anchorPrefix?: string
}>()

const columns = computed<KitTableColumn[]>(() => [
  { field: 'no', title: '单号', width: 150, slot: 'no' },
  { field: 'name', title: '名称', minWidth: 200, slot: 'name' },
  { field: 'date', title: '日期', width: 120, slot: 'date' },
  { field: 'amount', title: '金额', width: 140, align: 'right', slot: 'amount' },
  ...(props.paidColumn ? [{ field: 'paidAmount', title: '已支付', width: 140, align: 'right', slot: 'paidAmount' } satisfies KitTableColumn] : []),
  { field: 'status', title: '状态', width: 120, slot: 'status' },
])

function target(row: ContractFactRow) {
  const result = resolveNavigationTarget(row.navigation)
  return result.state === 'resolved' ? result.to : null
}

function anchorId(row: ContractFactRow) {
  return props.anchorPrefix ? `${props.anchorPrefix}-${row.id}` : undefined
}
</script>

<template>
  <KitTable
    :columns="columns"
    :data="[...rows]"
    :min-rows="5"
    row-key="id"
    :empty="{ title: emptyLabel, description: '仅展示通过稳定合同外键关联的真实事实。' }"
  >
    <template #no="{ row }">
      <span class="font-mono">{{ row.no || '—' }}</span>
    </template>
    <template #name="{ row }">
      <NuxtLink
        v-if="target(row)"
        :id="anchorId(row)"
        :to="target(row)!"
        :tabindex="focusId === row.id ? -1 : undefined"
        class="font-700 text-brand hover:underline"
        :class="focusId === row.id ? 'rounded bg-brand-soft/60 px-1' : ''"
      >
        {{ row.name || row.no || '查看来源' }}
      </NuxtLink>
      <span v-else :id="anchorId(row)" :tabindex="focusId === row.id ? -1 : undefined">{{ row.name || '—' }}</span>
    </template>
    <template #date="{ row }">
      <span class="font-mono">{{ row.date || '—' }}</span>
    </template>
    <template #amount="{ row }">
      <span class="font-mono">{{ row.amount == null ? '—' : yuan(Number(row.amount)) }}</span>
    </template>
    <template #paidAmount="{ row }">
      <span class="font-mono">{{ yuan(Number(row.paidAmount ?? 0)) }}</span>
    </template>
    <template #status="{ row }">
      <span class="chip bg-surface-3 text-ink-soft">{{ row.status || '未记录' }}</span>
    </template>
  </KitTable>
</template>
