<script setup lang="ts">
import type {
  WageAllocationInput,
  WageStatement,
  WageStatementFilter,
} from '~/lib/payroll/statements'
import { shallowRef } from 'vue'
import PayrollPrintSheet from '~/components/payroll/PayrollPrintSheet.vue'
import PayrollReleaseAllocationDialog from '~/components/payroll/PayrollReleaseAllocationDialog.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { payrollFilterQuery } from '~/lib/payroll/navigation'
import { wageCheckLabel, wageQuantityLabel, wageSourceLabel } from '~/lib/payroll/presentation'

defineProps<{ statement: WageStatement | null, returnFilters?: WageStatementFilter }>()
const emit = defineEmits<{
  updatePrice: [lineId: string, unitPrice: number]
  check: []
  release: [actualAmount: number, allocations: WageAllocationInput[]]
  print: []
  export: []
}>()

const releaseDialogOpen = shallowRef(false)

function money(value: number | null) {
  return value == null ? '—' : `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-label="工资单详情">
    <StatePanel
      v-if="!statement"
      kind="empty"
      title="选择一份工资单查看"
      description="明细、核对与发放动作都在此区域完成。"
    />
    <template v-else>
      <header class="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
        <div>
          <p class="text-11px font-700 text-brand">
            {{ statement.month }} · {{ statement.crewName || '个人责任' }}
          </p>
          <h2 class="mt-1 text-16px font-800 text-ink">
            {{ statement.leaderName }}请款簿
          </h2>
          <p class="mt-1 text-12px text-ink-soft">
            {{ statement.formatFamily }} 族 ·
            {{ statement.periodKind === 'retention' ? '尾款 100%' : statement.periodKind === 'settlement' ? '结算档' : '月度进度' }} ·
            {{ wageSourceLabel(statement) }}
            × {{ Math.round(statement.payRatio * 100) }}%
          </p>
        </div>
        <div class="text-right">
          <p class="text-11px text-ink-faint">
            核算应发
          </p>
          <p class="font-mono text-18px font-800 text-ink">
            {{ money(statement.grossAmount) }}
          </p>
          <p class="mt-1 text-11px text-ink-faint">
            累计口径 {{ money(statement.cumulativeAmount) }} − 已发 {{ money(statement.previouslyPaid) }}
          </p>
        </div>
      </header>

      <p v-if="statement.formatFamily === 'B'" role="status" class="mx-4 mt-4 rounded-md bg-surface-2 px-3 py-2 text-12px text-ink-soft">
        B 类工资已退役，历史记录只读；保留原金额与状态，不重新生成、核对或发放。
      </p>
      <div
        v-if="statement.status === 'released'"
        class="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-success-soft px-3 py-2 text-12px text-success"
      >
        <span>
          {{ statement.formatFamily === 'B' ? '历史记录已发放' : `已按${statement.formatFamily === 'C2' ? '签工' : statement.formatFamily === 'C1' ? '考勤' : '现场复核量'}快照发放` }}
          {{ money(statement.actualAmount) }}；后续改量改价不追溯本月。
        </span>
        <span v-if="statement.formatFamily !== 'B'" class="flex flex-wrap gap-2">
          <button type="button" class="btn-ghost" @click="emit('print')">
            打印 A4
          </button>
          <button type="button" class="btn-ghost" @click="emit('export')">
            导出 Excel
          </button>
        </span>
      </div>
      <section
        v-if="statement.status === 'released'"
        class="mx-4 mt-3 overflow-hidden rounded-md border border-line"
        aria-label="组内实际发放分配"
      >
        <header class="flex items-center justify-between gap-3 bg-surface-2 px-3 py-2">
          <h3 class="text-12px font-800 text-ink">
            组内实际发放
          </h3>
          <span class="text-11px text-ink-faint">
            {{ statement.allocationRecorded ? `${statement.allocations.length} 人` : '无历史记录' }}
          </span>
        </header>
        <div
          v-if="statement.allocationRecorded"
          class="grid gap-x-4 gap-y-2 px-3 py-2.5 sm:grid-cols-2"
        >
          <div
            v-for="allocation in statement.allocations"
            :key="allocation.workerId"
            class="flex min-w-0 items-center justify-between gap-3 text-12px"
          >
            <span class="min-w-0 truncate text-ink-soft">
              {{ allocation.workerName }}
              <small v-if="allocation.isLeader" class="ml-1 text-brand">负责人</small>
            </span>
            <strong class="shrink-0 font-mono text-ink">
              {{ money(allocation.amount) }}
            </strong>
          </div>
        </div>
        <p v-else class="px-3 py-2.5 text-12px text-ink-soft">
          该历史工资单生成时尚未记录组内分配，系统不会推测收款人。
        </p>
      </section>
      <div
        v-else-if="statement.formatFamily !== 'B' && statement.needsRecheck"
        class="mx-4 mt-4 rounded-md bg-danger-soft px-3 py-2 text-12px text-danger"
      >
        {{ wageSourceLabel(statement) }}来源已变化，必须重新核对后才能发放。
      </div>
      <div
        v-else-if="statement.formatFamily === 'A' && statement.status === 'draft' && statement.quantitySource === 'provisional'"
        class="mx-4 mt-4 rounded-md bg-warn-soft px-3 py-2 text-12px text-warn"
      >
        当前为进度预付草稿。核对时会重新读取现场复核量，不会沿用暂估量发放。
      </div>
      <p v-if="statement.sourceVersion" class="mx-4 mt-3 text-11px text-ink-faint">
        来源版本 {{ statement.sourceVersion }}
        <template v-if="statement.sourceUpdatedAt">
          · 更新于 {{ statement.sourceUpdatedAt }}
        </template>
        <template v-if="statement.operatorName">
          · 经办 {{ statement.operatorName }}
        </template>
      </p>

      <section v-if="statement.formatFamily === 'C2'" class="mx-4 mt-4 overflow-hidden rounded-md border border-line">
        <header class="flex flex-wrap items-center justify-between gap-2 bg-surface-2 px-3 py-2">
          <div>
            <h3 class="text-13px font-800 text-ink">
              零星签工核对
            </h3>
            <p class="mt-0.5 text-11px text-ink-soft">
              {{ statement.dayworkRecords.length }} 条确认记录 · 半工按 0.5 工
            </p>
          </div>
          <NuxtLink :to="{ path: '/subcontract/daywork', query: payrollFilterQuery(returnFilters ?? { projectId: statement.projectId, month: statement.month, crewId: statement.crewId ?? '', status: statement.status }) }" class="btn-ghost">
            打开签工台账
          </NuxtLink>
        </header>
        <div class="max-w-full overflow-x-auto">
          <table class="min-w-180">
            <thead>
              <tr>
                <th>日期</th>
                <th>施工内容</th>
                <th>起止时间</th>
                <th>用工人</th>
                <th>用工数</th>
                <th>证明人</th>
                <th>确认日期</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in statement.dayworkRecords" :key="record.id">
                <td class="font-mono">
                  {{ record.workDate }}
                </td>
                <td>{{ record.workContent }}</td>
                <td class="font-mono">
                  {{ record.startTime }}–{{ record.endTime }}
                </td>
                <td>{{ record.workerName }}</td>
                <td class="font-mono">
                  {{ record.laborUnits }}
                </td>
                <td>{{ record.witness }}</td>
                <td class="font-mono">
                  {{ record.confirmedOn }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="statement.note" class="border-t border-line px-3 py-2 text-11px leading-5 text-ink-soft">
          {{ statement.note }}
        </p>
      </section>

      <div class="payroll-detail__table" tabindex="0">
        <table>
          <thead>
            <tr>
              <th>工人</th>
              <th>分项</th>
              <th>{{ wageQuantityLabel(statement.formatFamily) }}</th>
              <th>工资单价</th>
              <th>分项金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in statement.lines" :key="line.id">
              <td>{{ statement.members.find(member => member.workerId === line.workerId)?.workerName || line.workerId }}</td>
              <td>{{ line.itemName }}</td>
              <td class="font-mono">
                {{ line.quantity }} {{ line.unit }}
              </td>
              <td>
                <input
                  v-if="statement.status === 'draft' && statement.formatFamily === 'A'"
                  :aria-label="`${line.itemName}工资单价`"
                  type="number"
                  min="0"
                  step="0.01"
                  :value="line.unitPrice"
                  @change="emit('updatePrice', line.id, Number(($event.target as HTMLInputElement).value))"
                >
                <span v-else class="font-mono">{{ money(line.unitPrice) }}</span>
              </td>
              <td class="font-mono font-700">
                {{ money(line.amount) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="statement.status !== 'released' && statement.formatFamily !== 'B'" class="flex flex-wrap items-center justify-end gap-3 border-t border-line p-4">
        <button
          v-if="statement.status === 'draft' || statement.needsRecheck"
          type="button"
          class="btn-primary"
          @click="emit('check')"
        >
          {{
            statement.needsRecheck
              ? `重新核对${wageCheckLabel(statement.formatFamily)}`
              : `核对并锁定${wageCheckLabel(statement.formatFamily)}`
          }}
        </button>
        <template v-else>
          <button
            type="button"
            class="btn-primary"
            :disabled="statement.grossAmount <= 0"
            @click="releaseDialogOpen = true"
          >
            填写发放分配
          </button>
        </template>
      </footer>

      <PayrollReleaseAllocationDialog
        v-if="statement.formatFamily !== 'B'"
        :open="releaseDialogOpen"
        :statement="statement"
        @update:open="releaseDialogOpen = $event"
        @confirm="(actualAmount, allocations) => emit('release', actualAmount, allocations)"
      />
      <PayrollPrintSheet
        v-if="statement.status === 'released' && statement.formatFamily !== 'B'"
        :statement="statement"
      />
    </template>
  </section>
</template>

<style scoped>
.payroll-detail__table {
  max-width: 100%;
  overflow-x: auto;
  padding: 1rem;
}
table { width: 100%; min-width: 38rem; border-collapse: collapse; font-size: .8125rem; }
th, td { height: 2.5rem; border-bottom: 1px solid var(--line); padding: 0 .75rem; text-align: left; white-space: nowrap; }
th { background: var(--surface-2); color: var(--ink-soft); font-size: .75rem; }
td input { width: 7rem; height: 2rem; border: 1px solid var(--line); border-radius: .25rem; padding: 0 .5rem; }
</style>
