<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { OwnerDocumentKind } from '~/lib/owner-document/forms'
import type { OwnerDocumentBoqLine } from '~/lib/owner-document/page'
import { useFullscreen } from '@vueuse/core'
import { computed, useTemplateRef } from 'vue'

type GridKind = Extract<OwnerDocumentKind, 'owner_change' | 'owner_report'>
type GridLine = Record<string, unknown>

const props = defineProps<{
  kind: GridKind
  lines: GridLine[]
  boqLines: OwnerDocumentBoqLine[]
  readonly?: boolean
  auditMode?: boolean
}>()

const emit = defineEmits<{
  update: [lines: GridLine[]]
}>()

const root = useTemplateRef<HTMLElement>('root')
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(root, { autoExit: true })

const columns = computed<KitTableColumn[]>(() => props.kind === 'owner_change'
  ? [
      { field: 'operation', title: '操作', width: 104, slot: 'operation' },
      { field: 'boqLineId', title: '合同清单项', minWidth: 220, slot: 'boqLineId' },
      { field: 'itemName', title: '分项名称', minWidth: 180, slot: 'itemName' },
      { field: 'unit', title: '单位', width: 82, slot: 'unit' },
      { field: 'deltaQty', title: '变更量', width: 112, align: 'right', slot: 'deltaQty' },
      { field: 'newUnitPrice', title: '新单价', width: 120, align: 'right', slot: 'newUnitPrice' },
      { field: 'amount', title: '变更金额', width: 130, align: 'right', slot: 'amount' },
      { field: 'note', title: '备注', minWidth: 140, slot: 'note' },
      { type: 'action', title: '操作', width: 92, slot: 'action' },
    ]
  : [
      { field: 'boqLineId', title: '合同清单项', minWidth: 230, slot: 'boqLineId' },
      { field: 'itemName', title: '分项名称', minWidth: 180, slot: 'itemName' },
      { field: 'unit', title: '单位', width: 74, slot: 'unit' },
      { field: 'autoQty', title: '自动完成量', width: 118, align: 'right', slot: 'autoQty' },
      { field: 'reportedQty', title: '申报量', width: 112, align: 'right', slot: 'reportedQty' },
      { field: 'auditedQty', title: '审定量', width: 112, align: 'right', slot: 'auditedQty' },
      { field: 'unitPrice', title: '合同单价', width: 112, align: 'right', slot: 'unitPrice' },
      { field: 'amount', title: '申报金额', width: 126, align: 'right', slot: 'amount' },
      { type: 'action', title: '操作', width: 72, slot: 'action' },
    ],
)

const summary = computed(() => {
  const amount = props.lines.reduce((sum, line) => sum + lineAmount(line), 0)
  if (props.kind === 'owner_change')
    return `${props.lines.length} 项变更 · 合计 ¥${amount.toFixed(2)}`
  const audited = props.lines.reduce(
    (sum, line) => sum + (Number(line.auditedQty) || 0) * (Number(line.unitPrice) || 0),
    0,
  )
  return `${props.lines.length} 项报量 · 申报 ¥${amount.toFixed(2)}${props.auditMode ? ` · 审定 ¥${audited.toFixed(2)}` : ''}`
})

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function inputNumber(event: Event): number | null {
  const value = inputValue(event).trim()
  if (!value)
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function patch(index: number, value: GridLine) {
  emit('update', props.lines.map((line, current) =>
    current === index ? { ...line, ...value } : line,
  ))
}

function selectBoqLine(index: number, id: string) {
  const boqLine = props.boqLines.find(line => line.id === id)
  if (!boqLine) {
    patch(index, { boqLineId: id })
    return
  }
  patch(index, {
    boqLineId: id,
    itemName: boqLine.itemName,
    unit: boqLine.unit,
    qty: boqLine.qty,
    unitPrice: boqLine.unitPrice,
    autoQty: boqLine.autoQty,
    reportedQty: props.lines[index]?.reportedQty ?? boqLine.autoQty,
  })
}

function add() {
  emit('update', [
    ...props.lines,
    props.kind === 'owner_change'
      ? {
          operation: 'qty',
          boqLineId: '',
          itemName: '',
          unit: '',
          deltaQty: null,
          newUnitPrice: null,
          note: '',
        }
      : {
          boqLineId: '',
          itemName: '',
          unit: '',
          autoQty: 0,
          reportedQty: null,
          auditedQty: null,
          unitPrice: 0,
          note: '',
        },
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

function lineAmount(line: GridLine): number {
  if (props.kind === 'owner_report')
    return (Number(line.reportedQty) || 0) * (Number(line.unitPrice) || 0)
  const operation = String(line.operation ?? 'qty')
  const qty = Number(line.qty) || 0
  const deltaQty = Number(line.deltaQty) || 0
  const unitPrice = Number(line.unitPrice) || 0
  const newUnitPrice = Number(line.newUnitPrice) || 0
  if (operation === 'add')
    return deltaQty * newUnitPrice
  if (operation === 'price')
    return qty * (newUnitPrice - unitPrice)
  return deltaQty * unitPrice
}
</script>

<template>
  <section
    id="section-lines"
    ref="root"
    class="panel scroll-mt-4 overflow-hidden"
    :class="{ 'fixed inset-3 z-[var(--z-shell-modal)] flex flex-col bg-panel': isFullscreen }"
  >
    <div class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <div>
        <h2 class="text-14px font-800 text-ink">
          {{ kind === 'owner_change' ? '变更明细' : '报量明细' }}
        </h2>
        <p class="mt-0.5 text-11px text-ink-faint">
          {{ kind === 'owner_change'
            ? '单据类型与行操作类型彼此独立；签证后量价及台账锁定。'
            : '自动完成量只读，申报量可调整，审定阶段填写审定量。' }}
        </p>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <span class="text-12px font-700 text-ink-soft">{{ summary }}</span>
        <KitButton variant="ghost" size="sm" :title="isFullscreen ? '退出全屏' : '全屏编辑'" @click="toggleFullscreen">
          <span :class="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" aria-hidden="true" />
        </KitButton>
        <KitButton v-if="!readonly" size="sm" data-testid="owner-document-add-line" @click="add">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />新增明细
        </KitButton>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <KitTable :columns="columns" :data="lines" :min-rows="3" empty="暂无明细">
        <template #operation="{ row, rowIndex }">
          <select
            :value="row.operation"
            :disabled="readonly"
            class="field-input w-full"
            aria-label="变更操作"
            @change="patch(rowIndex, { operation: inputValue($event), boqLineId: inputValue($event) === 'add' ? '' : row.boqLineId })"
          >
            <option value="qty">
              工程量调整
            </option>
            <option value="price">
              单价调整
            </option>
            <option value="add">
              新增清单项
            </option>
          </select>
        </template>
        <template #boqLineId="{ row, rowIndex }">
          <select
            :value="row.boqLineId"
            :disabled="readonly || (kind === 'owner_change' && row.operation === 'add')"
            class="field-input w-full"
            aria-label="合同清单项"
            @change="selectBoqLine(rowIndex, inputValue($event))"
          >
            <option value="">
              请选择清单项
            </option>
            <option v-for="line in boqLines" :key="line.id" :value="line.id">
              {{ line.itemName }} · {{ line.qty }} {{ line.unit }} × {{ line.unitPrice }}
            </option>
          </select>
        </template>
        <template #itemName="{ row, rowIndex }">
          <input
            :value="row.itemName"
            :disabled="readonly || (kind === 'owner_change' && row.operation !== 'add')"
            class="field-input w-full"
            aria-label="分项名称"
            @input="patch(rowIndex, { itemName: inputValue($event) })"
          >
        </template>
        <template #unit="{ row, rowIndex }">
          <input
            :value="row.unit"
            :disabled="readonly || (kind === 'owner_change' && row.operation !== 'add')"
            class="field-input w-full"
            aria-label="单位"
            @input="patch(rowIndex, { unit: inputValue($event) })"
          >
        </template>
        <template #deltaQty="{ row, rowIndex }">
          <input
            :value="row.deltaQty ?? ''"
            :disabled="readonly || row.operation === 'price'"
            type="number"
            step="0.001"
            class="field-input w-full text-right font-mono"
            aria-label="变更量"
            @input="patch(rowIndex, { deltaQty: inputNumber($event) })"
          >
        </template>
        <template #newUnitPrice="{ row, rowIndex }">
          <input
            :value="row.newUnitPrice ?? ''"
            :disabled="readonly || row.operation === 'qty'"
            type="number"
            min="0"
            step="0.01"
            class="field-input w-full text-right font-mono"
            aria-label="新单价"
            @input="patch(rowIndex, { newUnitPrice: inputNumber($event) })"
          >
        </template>
        <template #autoQty="{ row }">
          <span class="font-mono font-700">{{ Number(row.autoQty || 0).toFixed(3) }}</span>
        </template>
        <template #reportedQty="{ row, rowIndex }">
          <input
            :value="row.reportedQty ?? ''"
            :disabled="readonly"
            type="number"
            min="0"
            step="0.001"
            class="field-input w-full text-right font-mono"
            aria-label="申报量"
            @input="patch(rowIndex, { reportedQty: inputNumber($event) })"
          >
        </template>
        <template #auditedQty="{ row, rowIndex }">
          <input
            :value="row.auditedQty ?? ''"
            :disabled="!auditMode"
            type="number"
            min="0"
            step="0.001"
            class="field-input w-full text-right font-mono"
            aria-label="审定量"
            @input="patch(rowIndex, { auditedQty: inputNumber($event) })"
          >
        </template>
        <template #unitPrice="{ row }">
          <span class="font-mono font-700">{{ Number(row.unitPrice || 0).toFixed(2) }}</span>
        </template>
        <template #amount="{ row }">
          <span class="font-mono font-700" :class="{ 'text-danger': lineAmount(row) < 0 }">
            {{ lineAmount(row).toFixed(2) }}
          </span>
        </template>
        <template #note="{ row, rowIndex }">
          <input
            :value="row.note"
            :disabled="readonly"
            class="field-input w-full"
            aria-label="明细备注"
            @input="patch(rowIndex, { note: inputValue($event) })"
          >
        </template>
        <template #action="{ rowIndex }">
          <button v-if="kind === 'owner_change'" type="button" class="icon-btn" title="复制" :disabled="readonly" @click="copy(rowIndex)">
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
