<script setup lang="ts">
import type { MonthlyStatementLineView, MonthlyStatementView } from '~/lib/boq/monthly'
import type { BoqWorkspace } from '~/lib/boq/read-model'
import type { KitTableColumn } from '~/lib/kit/table'
import type { QuantityBasis } from '~/lib/quantity/basis'
import { nextTick, watch } from 'vue'
import { DEFAULT_PROGRESS_QUANTITY_BASIS } from '~/lib/boq/monthly'
import { BOQ_MONTHLY_STATUS_LABEL } from '~/lib/boq/presentation'
import {
  QUANTITY_BASIS_LABELS,
  QUANTITY_BASIS_OPTIONS,
} from '~/lib/quantity/basis'
import { toLocalDateInputValue } from '~/lib/util/local-date'

const props = defineProps<{
  workspace: BoqWorkspace
  statement: MonthlyStatementView | null
  busy?: boolean
  focusId?: string | null
}>()

const emit = defineEmits<{
  select: [statementId: string]
  generate: [payload: { month: string, basis: QuantityBasis }]
  regenerate: [payload: { statementId: string, basis: QuantityBasis }]
  basisMismatch: [label: string]
  adjust: [payload: { lineId: string, adjustedQty: number, note: string }]
  export: [statement: MonthlyStatementView]
}>()

watch(() => props.focusId, async (focusId) => {
  if (!focusId)
    return
  await nextTick()
  document.getElementById(`boq-monthly-focus-${focusId}`)?.focus({ preventScroll: false })
}, { immediate: true })

const { formModal } = useKitUI()
const statusClass: Record<MonthlyStatementView['status'], string> = {
  draft: 'chip-brand',
  adjusted: 'chip-warn',
  exported: 'chip-ok',
}

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
    subtitle: '按已完成的报量阶段，取所选基准量 × 已签证合同价汇总；所选基准缺量时不代用其他口径。',
    saveText: '生成草稿',
    fields: [
      {
        key: 'month',
        label: '报量月份',
        value: toLocalDateInputValue().slice(0, 7),
        placeholder: 'yyyy-mm',
        required: true,
      },
      {
        key: 'basis',
        label: '取数基准',
        type: 'select',
        options: QUANTITY_BASIS_OPTIONS.map(option => option.label),
        value: QUANTITY_BASIS_LABELS[DEFAULT_PROGRESS_QUANTITY_BASIS],
        required: true,
      },
    ],
  })
  if (!values)
    return
  // formModal 的 select 只承载标签，这里按标签回查枚举。回查不中说明标签与枚举
  // 已经不同步，此时必须报错：静默落回默认基准会让用户选「合同量」却拿到现场量单据。
  const basis = QUANTITY_BASIS_OPTIONS
    .find(option => option.label === String(values.basis))
    ?.value
  if (!basis) {
    emit('basisMismatch', String(values.basis))
    return
  }
  emit('generate', { month: String(values.month), basis })
}

async function changeBasis(statement: MonthlyStatementView) {
  const values = await formModal({
    title: `更换「${statement.month}」取数基准`,
    subtitle: '仅草稿可换。重算会按新基准覆盖自动量与合价，已填的手调量将被清除。',
    saveText: '重算草稿',
    fields: [{
      key: 'basis',
      label: '取数基准',
      type: 'select',
      options: QUANTITY_BASIS_OPTIONS.map(option => option.label),
      value: QUANTITY_BASIS_LABELS[statement.quantityBasis],
      required: true,
    }],
  })
  if (!values)
    return
  const basis = QUANTITY_BASIS_OPTIONS
    .find(option => option.label === String(values.basis))
    ?.value
  if (!basis) {
    emit('basisMismatch', String(values.basis))
    return
  }
  if (basis !== statement.quantityBasis)
    emit('regenerate', { statementId: statement.id, basis })
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
          :id="`boq-monthly-focus-${item.id}`"
          :key="item.id"
          type="button"
          class="w-full rounded-[var(--radius-btn)] px-2.5 py-2 text-left transition-colors"
          :class="statement?.id === item.id ? 'bg-brand-soft' : 'hover:bg-surface-3'"
          @click="emit('select', item.id)"
        >
          <div class="flex items-center justify-between gap-2">
            <strong class="text-12px text-ink">{{ item.month }}</strong>
            <span :class="statusClass[item.status]">
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
            · 取数基准 {{ statement.quantityBasisLabel }}
          </p>
          <p v-if="statement.sourceVersion" class="mt-0.5 text-10px text-ink-faint">
            来源版本 {{ statement.sourceVersion }}
            <template v-if="statement.sourceUpdatedAt">
              · 数据更新于 {{ statement.sourceUpdatedAt }}
            </template>
            <template v-if="statement.submittedAt">
              · 申报于 {{ statement.submittedAt }}
            </template>
            <template v-if="statement.operatorName">
              · 经办 {{ statement.operatorName }}
            </template>
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-if="statement.status === 'draft'"
            type="button"
            class="btn-secondary"
            :disabled="busy"
            @click="changeBasis(statement)"
          >
            <span class="i-lucide-refresh-cw mr-1" /> 换基准重算
          </button>
          <NuxtLink
            :to="`/owner/report/${statement.id}`"
            class="btn-secondary"
          >
            <span class="i-lucide-external-link mr-1" /> 打开甲方报量单
          </NuxtLink>
          <button type="button" class="btn-primary" @click="emit('export', statement)">
            <span class="i-lucide-download mr-1" /> 导出本月
          </button>
        </div>
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
            :disabled="statement.status !== 'draft'"
            :title="statement.status === 'draft' ? '调整本期报量' : '已申报或已审定，请在甲方报量单中处理'"
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
            自动量来自已完成的报量阶段按所选基准取数，合同价来自已签证 BOQ。
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
