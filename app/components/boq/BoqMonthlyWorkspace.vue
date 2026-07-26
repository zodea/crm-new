<script setup lang="ts">
import type { MonthlyStatementLineView, MonthlyStatementView } from '~/lib/boq/monthly'
import type { BoqWorkspace } from '~/lib/boq/read-model'
import type { KitTableColumn } from '~/lib/kit/table'
import { BOQ_MONTHLY_STATUS_LABEL } from '~/lib/boq/presentation'
import { toLocalDateInputValue } from '~/lib/util/local-date'

defineProps<{
  workspace: BoqWorkspace
  statement: MonthlyStatementView | null
  busy?: boolean
}>()

const emit = defineEmits<{
  select: [statementId: string]
  generate: [month: string]
  adjust: [payload: { lineId: string, adjustedQty: number, note: string }]
  export: [statement: MonthlyStatementView]
}>()

const { formModal } = useKitUI()

const columns: KitTableColumn[] = [
  { type: 'seq', title: '#', width: 52 },
  { field: 'itemName', title: '分项名称', minWidth: 180, fixed: 'left' },
  { field: 'unit', title: '单位', width: 70, align: 'center' },
  { field: 'autoQty', title: '自动量', width: 100, align: 'right' },
  { field: 'adjustedQty', title: '手调量', width: 100, align: 'right' },
  { field: 'effectiveQty', title: '本期报量', width: 110, align: 'right' },
  { field: 'unitPrice', title: '合同单价', type: 'money', width: 116 },
  { field: 'amount', title: '合价', type: 'money', width: 128 },
  { field: 'note', title: '手调说明', minWidth: 160 },
  { type: 'action', title: '操作', width: 90 },
]

async function generate() {
  const values = await formModal({
    title: '生成月度报量',
    subtitle: '按 #103 已完成的报量阶段，取当前量 × 已签证合同价自动汇总。',
    saveText: '生成草稿',
    fields: [{
      key: 'month',
      label: '报量月份',
      value: toLocalDateInputValue().slice(0, 7),
      placeholder: 'yyyy-mm',
      required: true,
    }],
  })
  if (values)
    emit('generate', String(values.month))
}

async function adjust(line: MonthlyStatementLineView) {
  const values = await formModal({
    title: `调整「${line.itemName}」本期报量`,
    subtitle: `自动量 ${line.autoQty} ${line.unit} 保留不变，手调值会单独留痕。`,
    saveText: '保存调整',
    fields: [
      { key: 'qty', label: '手调工程量', type: 'number', value: line.effectiveQty, required: true },
      { key: 'note', label: '调整说明', type: 'textarea', value: line.note, required: true },
    ],
  })
  if (values) {
    emit('adjust', {
      lineId: line.id,
      adjustedQty: Number(values.qty),
      note: String(values.note),
    })
  }
}
</script>

<template>
  <div class="monthly-workspace grid min-w-0 grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)] gap-3">
    <aside class="panel min-w-0 overflow-hidden">
      <div class="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-2.5">
        <div>
          <h2 class="text-13px font-800 text-ink">
            月度报量
          </h2>
          <p class="text-10px text-ink-faint">
            自动汇总 + 手调留痕
          </p>
        </div>
        <button type="button" class="icon-btn-accent" :disabled="busy" aria-label="生成月度报量" @click="generate">
          <span class="i-lucide-plus" />
        </button>
      </div>
      <div class="space-y-1 p-2">
        <button
          v-for="item in workspace.monthlyStatements"
          :key="item.id"
          type="button"
          class="w-full rounded-[var(--radius-btn)] px-2.5 py-2 text-left transition-colors"
          :class="statement?.id === item.id ? 'bg-brand-soft' : 'hover:bg-surface-3'"
          @click="emit('select', item.id)"
        >
          <div class="flex items-center justify-between gap-2">
            <strong class="text-12px text-ink">{{ item.month }}</strong>
            <span :class="item.status === 'exported' ? 'chip-ok' : item.status === 'adjusted' ? 'chip-warn' : 'chip-brand'">
              {{ BOQ_MONTHLY_STATUS_LABEL[item.status] }}
            </span>
          </div>
          <div class="mt-1 font-mono text-12px tabular-nums text-ink-soft">
            ¥{{ item.totalAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
          </div>
        </button>
        <div v-if="!workspace.monthlyStatements.length" class="px-3 py-10 text-center text-11px text-ink-faint">
          尚无月度报量，点击右上角 + 生成。
        </div>
      </div>
    </aside>

    <section class="min-w-0">
      <div v-if="statement" class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-14px font-800 text-ink">
            {{ statement.month }} 月度报量
          </h2>
          <p class="text-11px text-ink-soft">
            {{ BOQ_MONTHLY_STATUS_LABEL[statement.status] }} · 共 {{ statement.lines.length }} 个分项
          </p>
        </div>
        <button type="button" class="btn-primary" @click="emit('export', statement)">
          <span class="i-lucide-download mr-1" /> 导出本月
        </button>
      </div>
      <KitTable
        v-if="statement"
        :columns="columns"
        :data="[...statement.lines]"
        :loading="busy"
        :min-rows="10"
      >
        <template #action="{ row }">
          <button
            type="button"
            class="btn-ghost px-2 py-1 text-11px"
            :disabled="statement.status === 'exported'"
            @click="adjust(row)"
          >
            调整
          </button>
        </template>
      </KitTable>
      <div v-else class="panel grid min-h-96 place-items-center p-6 text-center">
        <div>
          <span class="i-lucide-chart-no-axes-column-increasing text-28px text-brand" />
          <p class="mt-2 text-13px font-700 text-ink">
            选择或生成一份月度报量
          </p>
          <p class="mt-1 text-11px text-ink-soft">
            自动量来自已完成的报量阶段，合同价来自已签证 BOQ。
          </p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.monthly-workspace { container-type: inline-size; }
@container (max-width: 52rem) {
  .monthly-workspace { grid-template-columns: minmax(0, 1fr); }
}
</style>
