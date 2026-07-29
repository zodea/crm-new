<script setup lang="ts">
import type { WageStatement } from '~/lib/payroll/statements'
import { computed, ref, watch } from 'vue'
import StatePanel from '~/components/ui/StatePanel.vue'

const props = defineProps<{ statement: WageStatement | null }>()
const emit = defineEmits<{
  updatePrice: [lineId: string, unitPrice: number]
  check: []
  release: [actualAmount: number]
}>()

const actualAmount = ref(0)
const normalizedActualAmount = computed(() =>
  Math.round((actualAmount.value + Number.EPSILON) * 100) / 100,
)
watch(() => props.statement, (statement) => {
  actualAmount.value = statement?.grossAmount ?? 0
}, { immediate: true })

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
            {{ statement.quantitySource === 'field' ? '现场复核量' : '暂估量' }}
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

      <div
        v-if="statement.status === 'released'"
        class="mx-4 mt-4 rounded-md bg-success-soft px-3 py-2 text-12px text-success"
      >
        已按现场复核量快照发放 {{ money(statement.actualAmount) }}；后续改量改价不追溯本月。
      </div>
      <div
        v-else-if="statement.needsRecheck"
        class="mx-4 mt-4 rounded-md bg-danger-soft px-3 py-2 text-12px text-danger"
      >
        上游现场量或考勤已变化，必须重新核对后才能发放。
      </div>
      <div
        v-else-if="statement.status === 'draft' && statement.quantitySource === 'provisional'"
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

      <div class="payroll-detail__table" tabindex="0">
        <table>
          <thead>
            <tr>
              <th>分项</th>
              <th>工程量</th>
              <th>工资单价</th>
              <th>分项金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in statement.lines" :key="line.id">
              <td>{{ line.itemName }}</td>
              <td class="font-mono">
                {{ line.quantity }} {{ line.unit }}
              </td>
              <td>
                <input
                  v-if="statement.status === 'draft' && statement.formatFamily !== 'C1'"
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

      <footer v-if="statement.status !== 'released'" class="flex flex-wrap items-center justify-end gap-3 border-t border-line p-4">
        <button
          v-if="statement.status === 'draft' || statement.needsRecheck"
          type="button"
          class="btn-primary"
          @click="emit('check')"
        >
          {{ statement.needsRecheck ? '重新核对现场量' : '核对并锁定现场量' }}
        </button>
        <template v-else>
          <label class="flex items-center gap-2 text-12px font-700 text-ink-soft">
            实际发放
            <input v-model.number="actualAmount" aria-label="实际发放金额" class="h-9 w-36 rounded border border-line px-2 font-mono text-ink" type="number" min="0" :max="statement.grossAmount" step="0.01">
          </label>
          <button
            type="button"
            class="btn-primary"
            :disabled="statement.grossAmount <= 0 || normalizedActualAmount <= 0 || normalizedActualAmount > statement.grossAmount"
            @click="emit('release', normalizedActualAmount)"
          >
            确认已发放
          </button>
        </template>
      </footer>
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
