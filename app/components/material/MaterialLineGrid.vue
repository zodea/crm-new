<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { MaterialGridLine } from '~/lib/material/page'
import { useFullscreen } from '@vueuse/core'
import { computed, shallowRef, useTemplateRef } from 'vue'

const props = defineProps<{
  kind: 'mat_arrival' | 'stock_check'
  lines: MaterialGridLine[]
  readonly?: boolean
  resolveBookQty?: (line: MaterialGridLine) => Promise<number>
}>()

const emit = defineEmits<{
  update: [lines: MaterialGridLine[]]
}>()

const root = useTemplateRef<HTMLElement>('root')
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(root, { autoExit: true })
const importing = shallowRef(false)
const refreshingBookQty = shallowRef(false)
const tsv = shallowRef('')

const columns = computed<KitTableColumn[]>(() => [
  { field: 'materialName', title: '材料名称', minWidth: 180, slot: 'materialName' },
  { field: 'spec', title: '规格型号', minWidth: 130, slot: 'spec' },
  { field: 'unit', title: '单位', width: 88, slot: 'unit' },
  ...(props.kind === 'mat_arrival'
    ? [
      { field: 'qty', title: '数量', width: 120, align: 'right', slot: 'qty' },
      { field: 'unitPrice', title: '含税单价', width: 130, align: 'right', slot: 'unitPrice' },
      { field: 'amount', title: '含税金额', width: 140, align: 'right', slot: 'amount' },
      { field: 'note', title: '备注', minWidth: 160, slot: 'note' },
    ] satisfies KitTableColumn[]
    : [
      { field: 'bookQty', title: '账面量', width: 120, align: 'right', slot: 'bookQty' },
      { field: 'actualQty', title: '实盘量', width: 120, align: 'right', slot: 'actualQty' },
      { field: 'varianceQty', title: '盈亏量', width: 120, align: 'right', slot: 'varianceQty' },
      { field: 'varianceAmount', title: '盈亏金额', width: 140, align: 'right', slot: 'varianceAmount' },
    ] satisfies KitTableColumn[]),
  { type: 'action', title: '操作', width: 92, align: 'center', slot: 'action' },
])
const gridMinWidth = computed(() =>
  columns.value.reduce((width, column) => width + (column.width ?? column.minWidth ?? 0), 0),
)

const summary = computed(() => {
  if (props.kind === 'mat_arrival') {
    const qty = props.lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)
    const amount = props.lines.reduce(
      (sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unitPrice) || 0),
      0,
    )
    return `数量 ${qty.toFixed(3)} · 含税金额 ¥${amount.toFixed(2)}`
  }
  const varianceQty = props.lines.reduce(
    (sum, line) => sum + (Number(line.actualQty) || 0) - (Number(line.bookQty) || 0),
    0,
  )
  const varianceAmount = props.lines.reduce(
    (sum, line) => sum + (Number(line.varianceAmount) || 0),
    0,
  )
  return `盘点 ${props.lines.filter(line => line.materialName?.trim()).length} 项 · 盈亏 ${varianceQty.toFixed(3)} · ¥${varianceAmount.toFixed(2)}`
})

function patch(index: number, value: Partial<MaterialGridLine>) {
  emit('update', props.lines.map((line, current) =>
    current === index ? { ...line, ...value } : line,
  ))
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function inputNumber(event: Event): number | null {
  const value = inputValue(event).trim()
  if (!value)
    return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function add() {
  emit('update', [
    ...props.lines,
    props.kind === 'mat_arrival'
      ? { materialName: '', spec: '', unit: '', qty: 0, unitPrice: 0, note: '' }
      : { materialName: '', spec: '', unit: '', bookQty: 0, actualQty: 0, varianceAmount: 0 },
  ])
}

function copy(index: number) {
  const next = [...props.lines]
  next.splice(index + 1, 0, { ...props.lines[index], id: undefined })
  emit('update', next)
}

function remove(index: number) {
  emit('update', props.lines.filter((_, current) => current !== index))
}

function amount(line: MaterialGridLine): number {
  return (Number(line.qty) || 0) * (Number(line.unitPrice) || 0)
}

function varianceQty(line: MaterialGridLine): number {
  return (Number(line.actualQty) || 0) - (Number(line.bookQty) || 0)
}

async function refreshBookQuantities() {
  if (!props.resolveBookQty)
    return
  refreshingBookQty.value = true
  try {
    const next = await Promise.all(props.lines.map(async line => ({
      ...line,
      bookQty: line.materialName?.trim()
        ? await props.resolveBookQty!(line)
        : 0,
    })))
    emit('update', next)
  }
  finally {
    refreshingBookQty.value = false
  }
}

function importTsv() {
  const imported = tsv.value
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map((line): MaterialGridLine => {
      const cells = line.split('\t').map(value => value.trim())
      if (props.kind === 'mat_arrival') {
        const [materialName = '', spec = '', unit = '', qty = '', unitPrice = '', note = ''] = cells
        return {
          materialName,
          spec,
          unit,
          qty: Number(qty) || 0,
          unitPrice: Number(unitPrice) || 0,
          note,
        }
      }
      const [materialName = '', spec = '', unit = '', bookQty = '', actualQty = '', varianceAmount = ''] = cells
      return {
        materialName,
        spec,
        unit,
        bookQty: Number(bookQty) || 0,
        actualQty: Number(actualQty) || 0,
        varianceAmount: Number(varianceAmount) || 0,
      }
    })
  emit('update', [...props.lines, ...imported])
  tsv.value = ''
  importing.value = false
}
</script>

<template>
  <section
    id="section-lines"
    ref="root"
    class="panel flex min-h-0 scroll-mt-4 flex-col overflow-hidden"
    :class="{ 'h-screen p-4': isFullscreen }"
    data-testid="material-line-grid"
  >
    <div class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <SectionHeader :title="kind === 'mat_arrival' ? '到货明细' : '盘点明细'" />
      <span class="font-mono text-12px font-700 text-brand-deep">{{ summary }}</span>
      <div class="ml-auto flex flex-wrap gap-2">
        <KitButton
          v-if="kind === 'stock_check'"
          size="sm"
          variant="secondary"
          :loading="refreshingBookQty"
          :disabled="readonly"
          data-testid="refresh-book-qty"
          @click="refreshBookQuantities"
        >
          <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />刷新账面量
        </KitButton>
        <KitButton size="sm" variant="secondary" :disabled="readonly" @click="importing = !importing">
          <span class="i-lucide-clipboard-paste mr-1" aria-hidden="true" />粘贴导入
        </KitButton>
        <KitButton size="sm" variant="secondary" @click="toggleFullscreen">
          <span :class="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" class="mr-1" aria-hidden="true" />
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </KitButton>
        <KitButton size="sm" variant="secondary" :disabled="readonly" data-testid="add-material-line" @click="add">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />新增行
        </KitButton>
      </div>
    </div>

    <div v-if="importing" class="grid gap-2 border-b border-line bg-surface-2 p-3">
      <p class="text-12px text-ink-soft">
        {{ kind === 'mat_arrival'
          ? '每行：材料名称、规格、单位、数量、含税单价、备注'
          : '每行：材料名称、规格、单位、账面量、实盘量、盈亏金额' }}，字段间用 Tab 分隔。
      </p>
      <textarea v-model="tsv" rows="4" class="field-input w-full font-mono" />
      <div class="flex justify-end gap-2">
        <KitButton size="sm" variant="secondary" @click="importing = false">
          取消
        </KitButton>
        <KitButton size="sm" :disabled="!tsv.trim()" @click="importTsv">
          导入
        </KitButton>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <KitTable :style="{ minWidth: `${gridMinWidth}px` }" :columns="columns" :data="lines" :min-rows="3" empty="暂无明细">
        <template #materialName="{ row, rowIndex }">
          <input :value="row.materialName" :disabled="readonly" class="field-input w-full" aria-label="材料名称" @input="patch(rowIndex, { materialName: inputValue($event) })">
        </template>
        <template #spec="{ row, rowIndex }">
          <input :value="row.spec" :disabled="readonly" class="field-input w-full" aria-label="规格型号" @input="patch(rowIndex, { spec: inputValue($event) })">
        </template>
        <template #unit="{ row, rowIndex }">
          <input :value="row.unit" :disabled="readonly" class="field-input w-full" aria-label="单位" @input="patch(rowIndex, { unit: inputValue($event) })">
        </template>
        <template #qty="{ row, rowIndex }">
          <input :value="row.qty ?? ''" :disabled="readonly" type="number" min="0" step="0.001" class="field-input w-full text-right font-mono" aria-label="到货数量" @input="patch(rowIndex, { qty: inputNumber($event) })">
        </template>
        <template #unitPrice="{ row, rowIndex }">
          <input :value="row.unitPrice ?? ''" :disabled="readonly" type="number" min="0" step="0.01" class="field-input w-full text-right font-mono" aria-label="含税单价" @input="patch(rowIndex, { unitPrice: inputNumber($event) })">
        </template>
        <template #amount="{ row }">
          <span class="font-mono font-700">{{ amount(row).toFixed(2) }}</span>
        </template>
        <template #note="{ row, rowIndex }">
          <input :value="row.note" :disabled="readonly" class="field-input w-full" aria-label="明细备注" @input="patch(rowIndex, { note: inputValue($event) })">
        </template>
        <template #bookQty="{ row }">
          <span class="font-mono font-700">{{ Number(row.bookQty || 0).toFixed(3) }}</span>
        </template>
        <template #actualQty="{ row, rowIndex }">
          <input :value="row.actualQty ?? ''" :disabled="readonly" type="number" min="0" step="0.001" class="field-input w-full text-right font-mono" aria-label="实盘量" @input="patch(rowIndex, { actualQty: inputNumber($event) })">
        </template>
        <template #varianceQty="{ row }">
          <span class="font-mono font-700" :class="varianceQty(row) < 0 ? 'text-danger' : varianceQty(row) > 0 ? 'text-ok' : 'text-ink'">
            {{ varianceQty(row).toFixed(3) }}
          </span>
        </template>
        <template #varianceAmount="{ row, rowIndex }">
          <input :value="row.varianceAmount ?? ''" :disabled="readonly" type="number" step="0.01" class="field-input w-full text-right font-mono" aria-label="盈亏金额" @input="patch(rowIndex, { varianceAmount: inputNumber($event) })">
        </template>
        <template #action="{ rowIndex }">
          <button type="button" class="icon-btn" title="复制" :disabled="readonly" @click="copy(rowIndex)">
            <span class="i-lucide-copy" aria-hidden="true" />
          </button>
          <button type="button" class="icon-btn-danger" title="删除" :disabled="readonly" @click="remove(rowIndex)">
            <span class="i-lucide-trash-2" aria-hidden="true" />
          </button>
        </template>
      </KitTable>
    </div>
  </section>
</template>
