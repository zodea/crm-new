<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type {
  WorkerAttendance,
  WorkerDaywork,
  WorkerPenalty,
  WorkerWageStatement,
} from '~/lib/worker/detail'
import { formatMoney } from '~/lib/util/money'

defineProps<{
  attendance: DeepReadonly<WorkerAttendance[]>
  daywork: DeepReadonly<WorkerDaywork[]>
  wageStatements: DeepReadonly<WorkerWageStatement[]>
  penalties: DeepReadonly<WorkerPenalty[]>
}>()

const attendanceColumns: KitTableColumn[] = [
  { field: 'workDate', title: '日期', type: 'date', fixed: 'left' },
  { field: 'projectName', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'hours', title: '工时', width: 82, align: 'right' },
  { field: 'overtimeHours', title: '加班', width: 82, align: 'right' },
  { field: 'workContent', title: '内容', minWidth: 200 },
]

const dayworkColumns: KitTableColumn[] = [
  { field: 'workDate', title: '日期', type: 'date', fixed: 'left' },
  { field: 'projectName', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'workContent', title: '内容', minWidth: 200 },
  { field: 'laborUnits', title: '工数', width: 82, align: 'right' },
  { field: 'witness', title: '见证人', width: 110 },
  { field: 'status', title: '状态', width: 90, slot: 'dayworkStatus' },
]

const penaltyColumns: KitTableColumn[] = [
  { field: 'penaltyDate', title: '日期', type: 'date', fixed: 'left' },
  { field: 'projectName', title: '项目', minWidth: 150, slot: 'penaltyProject' },
  { field: 'sourceLabel', title: '来源', width: 110 },
  { field: 'location', title: '位置', minWidth: 170 },
  { field: 'reason', title: '原因', minWidth: 200 },
  { field: 'amount', title: '金额', width: 120, align: 'right', slot: 'penaltyAmount' },
  { field: 'statusLabel', title: '状态', width: 96 },
  { title: '源单', width: 104, slot: 'action', align: 'right', resizable: false },
]

function money(value: number | null): string {
  return value == null ? '历史未记录' : formatMoney(value, { currency: true })
}

function wageStatusLabel(status: string): string {
  return ({
    draft: '草稿',
    checked: '已核对',
    released: '已发放',
  }[status] ?? (status || '未定'))
}
</script>

<template>
  <section class="panel min-w-0 p-4" data-testid="worker-labor-facts">
    <SectionHeader title="考勤、签工、工资与扣罚" subtitle="只展示真实业务记录；未记录的个人工资分配不做反推" />

    <details open>
      <summary>考勤记录（{{ attendance.length }}）</summary>
      <div
        class="mt-2 min-w-0"
        role="region"
        tabindex="0"
        aria-label="工人考勤记录表格，可横向滚动"
      >
        <KitTable
          :columns="attendanceColumns"
          :data="[...attendance]"
          :min-rows="3"
          :empty="{ title: '暂无考勤记录', description: '当前没有该工人的有效考勤事实。' }"
        >
          <template #project="{ row }">
            <NuxtLink :to="`/project/${row.projectId}`" class="cell--link">
              {{ row.projectName || '查看项目' }}
            </NuxtLink>
          </template>
        </KitTable>
      </div>
    </details>

    <details class="mt-4">
      <summary>签工记录（{{ daywork.length }}）</summary>
      <div
        class="mt-2 min-w-0"
        role="region"
        tabindex="0"
        aria-label="工人签工记录表格，可横向滚动"
      >
        <KitTable
          :columns="dayworkColumns"
          :data="[...daywork]"
          :min-rows="3"
          :empty="{ title: '暂无签工记录', description: '当前没有该工人的有效签工事实。' }"
        >
          <template #project="{ row }">
            <NuxtLink :to="`/project/${row.projectId}`" class="cell--link">
              {{ row.projectName || '查看项目' }}
            </NuxtLink>
          </template>
          <template #dayworkStatus="{ row }">
            <span :class="row.status === 'confirmed' ? 'chip chip-ok' : 'chip chip-warn'">
              {{ row.status === 'confirmed' ? '已确认' : '草稿' }}
            </span>
          </template>
        </KitTable>
      </div>
    </details>

    <details class="mt-4">
      <summary>工资单关联（{{ wageStatements.length }}）</summary>
      <div v-if="wageStatements.length" class="mt-2 grid gap-2">
        <details v-for="statement in wageStatements" :key="statement.id" class="rounded border border-line p-3">
          <summary>{{ statement.month }} · {{ statement.projectName }} · {{ wageStatusLabel(statement.status) }}</summary>
          <div class="mt-2 grid gap-2 text-12px sm:grid-cols-2 lg:grid-cols-4">
            <span>个人清单：<b>{{ money(statement.workerLineAmount) }}</b></span>
            <span>个人收款：<b>{{ money(statement.allocatedAmount) }}</b></span>
            <span>整单毛额：<b>{{ money(statement.statementGrossAmount) }}</b></span>
            <span>口径：<b>{{ statement.quantitySource === 'field' ? '现场复核量' : '暂估量' }}</b></span>
          </div>
          <p v-if="!statement.allocationRecorded" class="m-0 mt-2 text-11px text-warning">
            历史未记录个人分配金额。
          </p>
          <NuxtLink
            :to="`/subcontract/payroll/${statement.id}`"
            :aria-label="`查看 ${statement.month} 工资单`"
            class="mt-3 inline-flex text-12px text-brand"
          >
            查看工资单
          </NuxtLink>
        </details>
      </div>
      <p v-else class="m-0 mt-2 text-12px text-ink-faint">
        暂无工资单关联。
      </p>
    </details>

    <details class="mt-4">
      <summary>项目扣罚（{{ penalties.length }}）</summary>
      <div
        class="mt-2 min-w-0"
        data-testid="worker-penalty-scroll"
        role="region"
        tabindex="0"
        aria-label="工人项目扣罚表格，可横向滚动"
      >
        <KitTable
          :columns="penaltyColumns"
          :data="[...penalties]"
          :min-rows="3"
          :empty="{
            title: '暂无与该工人直接关联的项目扣罚',
            description: '当前没有与该工人直接关联的有效项目扣罚。',
          }"
        >
          <template #penaltyProject="{ row }">
            <NuxtLink v-if="row.projectId" :to="`/project/${row.projectId}`" class="cell--link">
              {{ row.projectName || '查看项目' }}
            </NuxtLink>
            <span v-else>{{ row.projectName || '—' }}</span>
          </template>
          <template #penaltyAmount="{ row }">
            <span class="font-mono tabular-nums">{{ money(row.amount) }}</span>
          </template>
          <template #action="{ row }">
            <NuxtLink :to="`/project/penalty/${row.id}`" class="cell--link whitespace-nowrap">
              查看扣罚
            </NuxtLink>
          </template>
        </KitTable>
      </div>
    </details>
  </section>
</template>

<style scoped>
summary { cursor: pointer; color: var(--ink); font-size: 13px; font-weight: 700; }
</style>
