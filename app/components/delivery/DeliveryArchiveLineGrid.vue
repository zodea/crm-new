<script setup lang="ts">
import type { DeliveryAmountSource } from '~/lib/delivery/review'
import type { KitTableColumn } from '~/lib/kit/table'
import type { DeliveryLineDraft } from '~/stores/delivery-record'
import { useFullscreen } from '@vueuse/core'
import { computed, useTemplateRef } from 'vue'
import { calculatedDeliveryAmount } from '~/lib/delivery/review'

interface EditableDeliveryLine extends Omit<DeliveryLineDraft, 'amount' | 'amountSource'> {
  key: string
  amount: number | null
  amountSource: DeliveryAmountSource
}

const props = defineProps<{
  lines: EditableDeliveryLine[]
}>()

const emit = defineEmits<{
  update: [lines: EditableDeliveryLine[]]
}>()

const root = useTemplateRef<HTMLElement>('root')
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(root, { autoExit: true })
let lineKey = 0

const columns: KitTableColumn[] = [
  { field: 'materialName', title: '材料名称', minWidth: 180, slot: 'materialName' },
  { field: 'spec', title: '规格型号', minWidth: 130, slot: 'spec' },
  { field: 'unit', title: '单位', width: 82, slot: 'unit' },
  { field: 'qty', title: '数量', width: 110, align: 'right', slot: 'qty' },
  { field: 'unitPrice', title: '单价', width: 120, align: 'right', slot: 'unitPrice' },
  { field: 'amount', title: '金额', width: 130, align: 'right', slot: 'amount' },
  { field: 'note', title: '备注', minWidth: 150, slot: 'note' },
  { type: 'action', title: '操作', width: 92, align: 'center', slot: 'action' },
]

const totalAmount = computed(() =>
  props.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0),
)

function patch(index: number, value: Partial<EditableDeliveryLine>) {
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

function patchFactor(
  index: number,
  field: 'qty' | 'unitPrice',
  event: Event,
) {
  const line = props.lines[index]!
  const next = { ...line, [field]: inputNumber(event) }
  if (next.amountSource === 'calculated')
    next.amount = calculatedDeliveryAmount(next)
  patch(index, next)
}

function patchAmount(index: number, event: Event) {
  patch(index, {
    amount: inputNumber(event),
    amountSource: 'manual',
  })
}

function add() {
  lineKey += 1
  emit('update', [
    ...props.lines,
    {
      key: `delivery-line-${Date.now()}-${lineKey}`,
      materialName: '',
      spec: '',
      unit: '',
      qty: null,
      unitPrice: null,
      amount: 0,
      amountSource: 'calculated',
      note: '',
    },
  ])
}

function copy(index: number) {
  lineKey += 1
  const next = [...props.lines]
  next.splice(index + 1, 0, {
    ...props.lines[index]!,
    key: `delivery-line-${Date.now()}-${lineKey}`,
  })
  emit('update', next)
}

function remove(index: number) {
  emit('update', props.lines.filter((_, current) => current !== index))
}
</script>

<template>
  <section
    ref="root"
    class="panel flex min-h-0 flex-col overflow-hidden"
    :class="{ 'h-screen p-4': isFullscreen }"
  >
    <div class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <SectionHeader title="材料明细" subtitle="数量×单价默认派生金额；手改金额后保留人工口径" />
      <span class="font-mono text-12px font-700 text-brand-deep">
        共 {{ lines.filter(line => line.materialName.trim()).length }} 项 · ¥{{ totalAmount.toFixed(2) }}
      </span>
      <div class="ml-auto flex gap-2">
        <KitButton size="sm" variant="secondary" @click="toggleFullscreen">
          <span :class="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" class="mr-1" aria-hidden="true" />
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </KitButton>
        <KitButton size="sm" variant="secondary" @click="add">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />新增行
        </KitButton>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <KitTable :columns="columns" :data="lines" :min-rows="3" empty="暂无材料明细">
        <template #materialName="{ row, rowIndex }">
          <input :value="row.materialName" class="field-input w-full" aria-label="材料名称" @input="patch(rowIndex, { materialName: inputValue($event) })">
        </template>
        <template #spec="{ row, rowIndex }">
          <input :value="row.spec" class="field-input w-full" aria-label="规格型号" @input="patch(rowIndex, { spec: inputValue($event) })">
        </template>
        <template #unit="{ row, rowIndex }">
          <input :value="row.unit" class="field-input w-full" aria-label="单位" @input="patch(rowIndex, { unit: inputValue($event) })">
        </template>
        <template #qty="{ row, rowIndex }">
          <input :value="row.qty ?? ''" type="number" min="0" step="0.001" class="field-input w-full text-right font-mono" aria-label="数量" @input="patchFactor(rowIndex, 'qty', $event)">
        </template>
        <template #unitPrice="{ row, rowIndex }">
          <input :value="row.unitPrice ?? ''" type="number" min="0" step="0.01" class="field-input w-full text-right font-mono" aria-label="单价" @input="patchFactor(rowIndex, 'unitPrice', $event)">
        </template>
        <template #amount="{ row, rowIndex }">
          <input :value="row.amount ?? ''" type="number" min="0" step="0.01" class="field-input w-full text-right font-mono font-700" aria-label="金额" title="人工修改后不再被数量和单价覆盖" @input="patchAmount(rowIndex, $event)">
        </template>
        <template #note="{ row, rowIndex }">
          <input :value="row.note" class="field-input w-full" aria-label="备注" @input="patch(rowIndex, { note: inputValue($event) })">
        </template>
        <template #action="{ rowIndex }">
          <button type="button" class="icon-btn" title="复制" @click="copy(rowIndex)">
            <span class="i-lucide-copy" aria-hidden="true" />
          </button>
          <button type="button" class="icon-btn-danger" title="删除" @click="remove(rowIndex)">
            <span class="i-lucide-trash-2" aria-hidden="true" />
          </button>
        </template>
      </KitTable>
    </div>
  </section>
</template>
