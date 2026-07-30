<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { WageStatement } from '~/lib/payroll/statements'

defineProps<{ statement: WageStatement }>()

const columns: KitTableColumn[] = [
  { field: 'workDate', title: '日期', width: 112, fixed: 'left' },
  { field: 'workContent', title: '施工内容', minWidth: 210 },
  { field: 'timeRange', title: '起止时间', width: 130 },
  { field: 'workerName', title: '用工人', minWidth: 120 },
  { field: 'laborUnits', title: '用工数', width: 92, align: 'right' },
  { field: 'witness', title: '证明人', minWidth: 120 },
  { field: 'confirmedOn', title: '确认日期', width: 112 },
]
</script>

<template>
  <section aria-label="零星签工快照">
    <SectionHeader
      title="零星签工快照"
      :subtitle="`${statement.dayworkRecords.length} 条已确认记录 · 半工按 0.5 工`"
    />
    <KitTable
      :columns="columns"
      :data="statement.dayworkRecords.map(record => ({
        ...record,
        timeRange: `${record.startTime}–${record.endTime}`,
      }))"
      :min-rows="5"
      :empty="{ title: '暂无签工记录', description: '当前 C2 工资单没有关联的已确认签工。' }"
    />
  </section>
</template>
