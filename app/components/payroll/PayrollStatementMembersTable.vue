<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { WageStatement } from '~/lib/payroll/statements'
import { computed } from 'vue'

const { statement } = defineProps<{ statement: WageStatement }>()

const columns: KitTableColumn[] = [
  { field: 'workerName', title: '成员', minWidth: 150, fixed: 'left' },
  { field: 'role', title: '角色', width: 96 },
  { field: 'amount', title: '实际发放', width: 140, type: 'money' },
]

const rows = computed(() => {
  const allocationByWorker = new Map(
    statement.allocations.map(allocation => [allocation.workerId, allocation.amount]),
  )
  return statement.members.map(member => ({
    id: member.workerId,
    workerName: member.workerName,
    role: member.isLeader ? '负责人' : '组员',
    amount: statement.status === 'released' && statement.allocationRecorded
      ? (allocationByWorker.get(member.workerId) ?? 0)
      : null,
  }))
})

const emptyDescription = computed(() => {
  if (statement.status !== 'released')
    return '工资单发放时才记录组内实际分配。'
  if (!statement.allocationRecorded)
    return '该历史工资单未记录组内分配，系统不会推测收款人。'
  return '当前工资单没有成员记录。'
})
</script>

<template>
  <section aria-label="工资单成员与实际分配">
    <SectionHeader
      title="成员与实际分配"
      :subtitle="statement.status === 'released' && statement.allocationRecorded
        ? `已记录 ${statement.allocations.length} 人`
        : statement.status === 'released' ? '历史分配未知' : '尚未发放'"
    />
    <KitTable
      :columns="columns"
      :data="rows"
      :min-rows="4"
      :empty="{ title: '暂无成员', description: emptyDescription }"
    />
  </section>
</template>
