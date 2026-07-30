<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { TargetCostListRow } from '~/lib/target-cost/list'

defineProps<{
  rows: readonly TargetCostListRow[]
  loading: boolean
  page: number
  pageSize: number
  total: number
  filtered: boolean
}>()

const emit = defineEmits<{
  pageChange: [payload: { page: number, pageSize: number }]
  action: [action: string, row: TargetCostListRow]
}>()

const columns: KitTableColumn[] = [
  { type: 'seq', title: '#', width: 52, fixed: 'left' },
  { field: 'name', title: '版本名', minWidth: 210, fixed: 'left', slot: 'name' },
  { field: 'projectName', title: '项目', minWidth: 200, slot: 'project' },
  { field: 'isBaseline', title: '版本属性', width: 112, slot: 'baseline' },
  { field: 'contractRevenue', title: '合同收入', type: 'money', width: 142 },
  { field: 'plannedProfit', title: '计划利润', type: 'money', width: 142 },
  { field: 'signedContractSum', title: '已签合同额（录入）', type: 'money', width: 166 },
  { field: 'taxInclusiveTotal', title: '含税合价', type: 'money', width: 142 },
  { field: 'taxExclusiveTotal', title: '不含税合价', type: 'money', width: 142 },
  { field: 'taxAmount', title: '税金', type: 'money', width: 132 },
  { field: 'profitRate', title: '利润率', width: 102, align: 'right', slot: 'profitRate' },
  { field: 'status', title: '状态', width: 96, slot: 'status' },
  { field: 'updatedAt', title: '最近更新', type: 'date', width: 118 },
  { title: '操作', type: 'action', width: 56, fixed: 'right' },
]

const rowActions = [
  { key: 'detail', label: '查看详情', icon: 'i-lucide-file-text' },
  { key: 'edit', label: '编辑版本', icon: 'i-lucide-square-pen' },
  { key: 'delete', label: '删除', icon: 'i-lucide-trash-2', tone: 'danger' as const },
]
</script>

<template>
  <KitTable
    :columns="columns"
    :data="[...rows]"
    :loading="loading"
    :page="{ page, pageSize, total }"
    :empty="{
      title: filtered ? '没有符合条件的目标成本' : '尚未建立目标成本版本',
      description: filtered ? '可调整项目、基线、状态或搜索条件。' : '新建首个版本后，可在详情维护科目明细。',
    }"
    @page-change="emit('pageChange', $event)"
  >
    <template #name="{ row }">
      <NuxtLink :to="`/project/target-cost/${row.id}`" class="cell--link" :title="row.name">
        {{ row.name }}
      </NuxtLink>
    </template>
    <template #project="{ row }">
      <NuxtLink v-if="row.projectId" :to="`/project/${row.projectId}`" class="cell--link">
        {{ row.projectName || row.projectId }}
      </NuxtLink>
      <span v-else class="text-ink-faint">未关联项目</span>
    </template>
    <template #baseline="{ row }">
      <span v-if="row.isBaseline" class="chip-brand">当前基线</span>
      <span v-else class="chip bg-surface-3 text-ink-faint">历史/非基线</span>
    </template>
    <template #profitRate="{ row }">
      <span class="font-mono tabular-nums" :class="row.profitRate != null && row.profitRate < 0 ? 'text-danger' : 'text-ink'">
        {{ row.profitRate == null ? '—' : `${(row.profitRate * 100).toFixed(2)}%` }}
      </span>
    </template>
    <template #status="{ row }">
      <span class="chip" :class="row.status === 'submitted' ? 'chip-ok' : 'chip-warn'">
        {{ row.status === 'submitted' ? '已提交' : row.status === 'draft' ? '草稿' : row.status || '—' }}
      </span>
    </template>
    <template #action="{ row }">
      <RowActionMenu
        :items="rowActions"
        :label="`${row.name}目标成本操作`"
        @select="emit('action', $event, row)"
      />
    </template>
  </KitTable>
</template>
