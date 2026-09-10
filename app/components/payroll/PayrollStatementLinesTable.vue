<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { WageStatement } from '~/lib/payroll/statements'
import { computed } from 'vue'
import { wageQuantityLabel } from '~/lib/payroll/presentation'

const { statement } = defineProps<{ statement: WageStatement }>()

const columns = computed<KitTableColumn[]>(() => [
  { field: 'workerName', title: '工人', minWidth: 130, fixed: 'left' },
  { field: 'itemName', title: '分项', minWidth: 200 },
  { field: 'quantity', title: wageQuantityLabel(statement.formatFamily), width: 130, slot: 'quantity', align: 'right' },
  { field: 'unitPrice', title: '工资单价', width: 130, type: 'money' },
  { field: 'amount', title: '分项金额', width: 140, type: 'money' },
])

const rows = computed(() => {
  const workerById = new Map(statement.members.map(member => [member.workerId, member.workerName]))
  return statement.lines.map(line => ({
    ...line,
    workerName: workerById.get(line.workerId) ?? line.workerId,
  }))
})
</script>

<template>
  <section aria-label="工资核算明细">
    <SectionHeader
      title="工资核算明细"
      :subtitle="`${statement.lines.length} 条 · ${statement.status === 'released' ? '已冻结发放快照' : '当前核算数据'}`"
    />
    <KitTable
      :columns="columns"
      :data="rows"
      :min-rows="6"
      :empty="{ title: '暂无工资明细', description: '当前工资单没有可展示的核算行。' }"
    >
      <template #quantity="{ row }">
        <span class="font-mono">{{ row.quantity }} {{ row.unit }}</span>
      </template>
    </KitTable>
  </section>
</template>
