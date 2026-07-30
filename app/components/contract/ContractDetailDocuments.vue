<script setup lang="ts">
import type { ContractRelatedDocument } from '~/lib/contract/detail'
import type { KitTableColumn } from '~/lib/kit/table'
import { computed } from 'vue'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  rows: readonly ContractRelatedDocument[]
}>()

const tableRows = computed(() => [...props.rows])

const columns: KitTableColumn[] = [
  { field: 'group', title: '单据类型', width: 112, fixed: 'left' },
  { field: 'no', title: '单据编号', width: 170, slot: 'no' },
  { field: 'name', title: '名称 / 摘要', minWidth: 240, slot: 'name' },
  { field: 'amount', title: '关联金额', width: 150, align: 'right', slot: 'amount' },
  { field: 'date', title: '业务日期', width: 120 },
  { field: 'status', title: '状态', width: 110, slot: 'status' },
]
</script>

<template>
  <section class="panel min-w-0 p-4" aria-labelledby="contract-documents-title">
    <SectionHeader
      id="contract-documents-title"
      title="关联单据"
      subtitle="仅展示通过合同外键关联的真实单据，不按项目、名称或金额猜测"
    />
    <div v-if="rows.length" data-testid="contract-documents-scroll" class="mt-3 min-w-0">
      <KitTable :columns="columns" :data="tableRows" :min-rows="5">
        <template #no="{ row }">
          <NuxtLink v-if="row.to" :to="row.to" class="cell--link font-mono" :title="row.no || row.name">
            {{ row.no || '查看' }}
          </NuxtLink>
          <span v-else class="font-mono">{{ row.no || '—' }}</span>
        </template>
        <template #name="{ row }">
          <span class="block truncate" :title="row.name || row.group">{{ row.name || '—' }}</span>
        </template>
        <template #amount="{ row }">
          <span class="font-mono tabular-nums">{{ row.amount == null ? '—' : yuan(row.amount) }}</span>
        </template>
        <template #status="{ row }">
          <span class="chip bg-surface-3 text-ink-soft">{{ row.status || '—' }}</span>
        </template>
      </KitTable>
    </div>
    <StatePanel
      v-else
      class="mt-3"
      kind="empty"
      title="暂无关联单据"
      description="当前合同尚无通过合同外键关联的补充协议、变洽签、结算、票款或物资单据。"
      compact
    />
  </section>
</template>
