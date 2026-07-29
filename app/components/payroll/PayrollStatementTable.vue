<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { WageStatement } from '~/lib/payroll/statements'

defineProps<{
  statements: WageStatement[]
  selectedId: string
  loading?: boolean
}>()

const emit = defineEmits<{ select: [id: string] }>()

const columns: KitTableColumn[] = [
  { field: 'month', title: '月份', width: 92, fixed: 'left' },
  { field: 'leaderName', title: '请款负责人', minWidth: 120, fixed: 'left' },
  { field: 'crewName', title: '班组', minWidth: 120 },
  { field: 'formatFamily', title: '格式', width: 72 },
  { field: 'periodKind', title: '期间', width: 96, slot: 'period' },
  { field: 'quantitySource', title: '取数口径', width: 110, slot: 'source' },
  { field: 'payRatio', title: '比例', width: 80, slot: 'ratio', align: 'right' },
  { field: 'grossAmount', title: '核算应发', width: 120, type: 'money' },
  { field: 'actualAmount', title: '实际发放', width: 120, type: 'money' },
  { field: 'status', title: '状态', width: 92, slot: 'status' },
  { type: 'action', title: '操作', width: 132, fixed: 'right' },
]

const statusLabel = {
  draft: '草稿',
  checked: '已核对',
  released: '已发放',
}
</script>

<template>
  <section class="panel overflow-hidden" aria-label="工资单列表">
    <SectionHeader title="负责人请款簿" subtitle="负责人 × 月份；已发放单据保留当月现场量与金额快照" />
    <KitTable
      :columns="columns"
      :data="statements"
      :loading="loading"
      :min-rows="8"
      :empty="{ title: '当前范围暂无工资单', description: '可从上方选择负责人和取数口径生成月度草稿。' }"
    >
      <template #source="{ row }">
        {{ row.quantitySource === 'field' ? '现场复核量' : '暂估量' }}
      </template>
      <template #period="{ row }">
        {{ row.periodKind === 'retention' ? '尾款100%' : row.periodKind === 'settlement' ? '结算95%' : '月度' }}
      </template>
      <template #ratio="{ row }">
        {{ Math.round(row.payRatio * 100) }}%
      </template>
      <template #status="{ row }">
        <span class="status-chip" :data-state="row.needsRecheck ? 'recheck' : row.status">
          {{ row.needsRecheck ? '需重核' : statusLabel[row.status] }}
        </span>
      </template>
      <template #action="{ row }">
        <div class="flex items-center gap-3 whitespace-nowrap">
          <button type="button" class="text-12px font-700 text-brand" @click="emit('select', row.id)">
            {{ selectedId === row.id ? '查看中' : '查看' }}
          </button>
          <NuxtLink :to="`/subcontract/payroll/${row.id}`" class="text-12px font-700 text-brand">
            详情
          </NuxtLink>
        </div>
      </template>
    </KitTable>
  </section>
</template>

<style scoped>
.status-chip {
  display: inline-flex;
  border-radius: 999px;
  padding: .2rem .5rem;
  background: var(--surface-2);
  color: var(--ink-soft);
  font-size: .6875rem;
  font-weight: 800;
}
.status-chip[data-state="checked"] { background: #fff4d8; color: #9a6500; }
.status-chip[data-state="recheck"] { background: var(--danger-soft); color: var(--danger); }
.status-chip[data-state="released"] { background: #e5f8ef; color: #08784f; }
</style>
