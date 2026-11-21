<script setup lang="ts">
import type { QuantityBoqLine } from '~/lib/quantity/central-boq'
import type { QuantityEntrySource } from '~/lib/quantity/entry-source'
import type {
  QuantityTemplateLineDraft,
  QuantityTemplateNewItemDraft,
  QuantityTemplateRoomDraft,
} from '~/lib/quantity/template'
import type { WageQuantitySource } from '~/lib/quantity/wage-source'
import { computed, reactive, shallowRef, watch } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import {
  defaultQuantityEntrySource,
  QUANTITY_ENTRY_SOURCE_OPTIONS,
} from '~/lib/quantity/entry-source'
import { evaluateQuantityFormula } from '~/lib/quantity/formula'
import { resolveWageQuantity, wageQuantityRequest } from '~/lib/quantity/wage-source'
import QuantityBoqLinkField from '~/pages/subcontract/quantity/_components/QuantityBoqLinkField.vue'
import QuantityFieldFormulaCell from '~/pages/subcontract/quantity/_components/QuantityFieldFormulaCell.vue'
import WageQuantitySourcePicker from '~/pages/subcontract/quantity/_components/WageQuantitySourcePicker.vue'

interface ItemOption {
  key: string
  label: string
}

type NewItemField = 'code' | 'name' | 'trade' | 'unit'
type LineUpdate
  = | { key: string, field: 'roomKey' | 'itemId' | 'fieldFormula' | 'note', value: string }
    | { key: string, field: 'contractQty' | 'provisionalQty', value: number | null }
    | { key: string, field: 'boqLineId', value: string | null }

const props = defineProps<{
  rooms: readonly QuantityTemplateRoomDraft[]
  newItems: readonly QuantityTemplateNewItemDraft[]
  lines: readonly QuantityTemplateLineDraft[]
  itemOptions: readonly ItemOption[]
  canLinkBoq?: boolean
  boqLines?: readonly QuantityBoqLine[]
  originalBoqIds?: Readonly<Record<string, string | null>>
  boqLoading?: boolean
  boqError?: string
}>()

const emit = defineEmits<{
  addManualItem: []
  addLine: []
  removeNewItem: [item: QuantityTemplateNewItemDraft]
  removeLine: [line: QuantityTemplateLineDraft]
  updateNewItem: [payload: { key: string, field: NewItemField, value: string }]
  updateLine: [payload: LineUpdate]
}>()

const formulaResults = computed(() => new Map(
  props.lines.map(line => [line.key, evaluateQuantityFormula(line.fieldFormula)]),
))
const entrySourceByLine = reactive<Record<string, QuantityEntrySource>>({})
const wagePreviewSource = shallowRef<WageQuantitySource>('provisional')
const wagePreview = computed(() => {
  let total = 0
  let missing = 0
  const request = wageQuantityRequest('advance', wagePreviewSource.value)
  for (const line of props.lines) {
    const resolution = resolveWageQuantity({
      provisionalQty: line.provisionalQty,
      fieldQty: formulaValue(line),
    }, request)
    if (resolution.quantity == null)
      missing += 1
    else
      total += resolution.quantity
  }
  return { total, missing }
})

watch(
  () => props.lines.map(line => line.key),
  (keys) => {
    const activeKeys = new Set(keys)
    for (const key of Object.keys(entrySourceByLine)) {
      if (!activeKeys.has(key))
        delete entrySourceByLine[key]
    }
    for (const line of props.lines) {
      entrySourceByLine[line.key] ??= defaultQuantityEntrySource(line)
    }
  },
  { immediate: true },
)

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function selectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value
}

function numberInput(event: Event): number | null {
  const raw = inputValue(event).trim()
  if (!raw)
    return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function formulaResult(line: QuantityTemplateLineDraft) {
  return formulaResults.value.get(line.key) ?? evaluateQuantityFormula(line.fieldFormula)
}

function formulaValue(line: QuantityTemplateLineDraft): number | null {
  const result = formulaResult(line)
  return result.ok ? result.value : null
}

function roomLabel(roomKey: string): string {
  return props.rooms.find(room => room.key === roomKey)?.name ?? '未知房间'
}

function itemLabel(itemId: string): string {
  return props.itemOptions.find(item => item.key === itemId)?.label ?? '未知分项'
}

function entrySource(line: QuantityTemplateLineDraft): QuantityEntrySource {
  return entrySourceByLine[line.key] ?? defaultQuantityEntrySource(line)
}

function setEntrySource(line: QuantityTemplateLineDraft, event: Event) {
  entrySourceByLine[line.key] = selectValue(event) as QuantityEntrySource
}

function quantityLabel(value: number | null): string {
  return value == null ? '—' : String(value)
}
</script>

<template>
  <section id="section-items" class="mt-6 scroll-mt-4 border-t border-line pt-5">
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <div>
        <h3 class="text-13px font-800 text-ink">
          房间 × 分项 × 三量
        </h3>
        <p class="mt-0.5 text-11px text-ink-soft">
          每行先选择当前录入口径；三量分别保存，切换不会清空其他口径。现场量由算式实时计算。
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-btn)] bg-surface-2 px-2 py-1">
        <WageQuantitySourcePicker v-model="wagePreviewSource" />
        <span class="text-10px text-ink-soft" data-testid="wage-preview-total">
          预览合计 <b class="font-mono text-ink">{{ wagePreview.total }}</b>
        </span>
        <span v-if="wagePreview.missing" class="text-10px text-warning-deep">
          缺量 {{ wagePreview.missing }} 行
        </span>
        <span class="text-9px text-ink-faint">这里只比较工程量；A 工资须核对实际完成责任与现场量</span>
      </div>
      <KitButton type="button" variant="secondary" class=" ml-auto" @click="emit('addManualItem')">
        <span class="i-lucide-list-plus mr-1" aria-hidden="true" />新增手工分项
      </KitButton>
      <KitButton type="button" variant="secondary" class="" :disabled="!props.itemOptions.length" @click="emit('addLine')">
        <span class="i-lucide-plus mr-1" aria-hidden="true" />添加明细
      </KitButton>
    </div>

    <div v-if="props.newItems.length" class="mb-3 rounded-[var(--radius-btn)] border border-brand/25 bg-brand-soft/25 p-3">
      <div class="mb-2 text-11px font-800 text-ink">
        随模板一起建立的手工分项
      </div>
      <div
        v-for="item in props.newItems"
        :key="item.key"
        class="mb-2 grid grid-cols-1 gap-2 last:mb-0 sm:grid-cols-2 xl:grid-cols-[1fr_1.4fr_1fr_0.7fr_auto]"
      >
        <input :value="item.code" class="field-input min-w-0" aria-label="新分项编码" placeholder="编码" @input="emit('updateNewItem', { key: item.key, field: 'code', value: inputValue($event) })">
        <input :value="item.name" class="field-input min-w-0" aria-label="新分项名称" placeholder="分项名称" @input="emit('updateNewItem', { key: item.key, field: 'name', value: inputValue($event) })">
        <input :value="item.trade" class="field-input min-w-0" aria-label="新分项工种" placeholder="工种" @input="emit('updateNewItem', { key: item.key, field: 'trade', value: inputValue($event) })">
        <input :value="item.unit" class="field-input min-w-0" aria-label="新分项单位" placeholder="单位" @input="emit('updateNewItem', { key: item.key, field: 'unit', value: inputValue($event) })">
        <KitButton type="button" variant="danger" class="" aria-label="删除新分项" @click="emit('removeNewItem', item)">
          <span class="i-lucide-x" aria-hidden="true" />
        </KitButton>
      </div>
    </div>

    <div class="overflow-x-auto rounded-[var(--radius-btn)] border border-line">
      <table class="min-w-[980px] w-full text-10px">
        <thead class="bg-surface-2 text-ink-soft">
          <tr>
            <th class="min-w-28 px-2 py-2 text-left">
              房间
            </th>
            <th class="min-w-44 px-2 py-2 text-left">
              分项
            </th>
            <th v-if="canLinkBoq" class="min-w-64 px-2 py-2 text-left">
              关联合同清单
            </th>
            <th class="min-w-32 px-2 py-2 text-left whitespace-nowrap">
              录入来源
            </th>
            <th class="min-w-52 px-2 py-2 text-left">
              当前录入
            </th>
            <th class="min-w-48 px-2 py-2 text-left">
              三量摘要
            </th>
            <th class="min-w-32 px-2 py-2 text-left">
              备注
            </th>
            <th class="w-10 px-1 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in props.lines" :key="line.key" class="border-t border-line align-top">
            <td class="p-1">
              <select
                :value="line.roomKey"
                class="field-input w-full"
                :aria-label="`房间 ${roomLabel(line.roomKey)}`"
                :disabled="Boolean(line.id || line.sourceLineId)"
                @change="emit('updateLine', { key: line.key, field: 'roomKey', value: selectValue($event) })"
              >
                <option v-for="room in props.rooms" :key="room.key" :value="room.key">
                  {{ room.name }}
                </option>
              </select>
            </td>
            <td class="p-1">
              <select
                :value="line.itemId"
                class="field-input w-full"
                :aria-label="`分项 ${itemLabel(line.itemId)}`"
                :disabled="Boolean(line.id || line.sourceLineId)"
                @change="emit('updateLine', { key: line.key, field: 'itemId', value: selectValue($event) })"
              >
                <option v-for="item in props.itemOptions" :key="item.key" :value="item.key">
                  {{ item.label }}
                </option>
              </select>
            </td>
            <td v-if="canLinkBoq" class="min-w-64 p-1">
              <QuantityBoqLinkField
                :value="line.boqLineId"
                :original-id="originalBoqIds?.[line.key]"
                :recognized-qty="line.recognizedContractQty"
                :lines="boqLines ?? []"
                :loading="boqLoading"
                :error="boqError"
                @change="emit('updateLine', { key: line.key, field: 'boqLineId', value: $event })"
              />
            </td>
            <td class="p-1">
              <select
                :value="entrySource(line)"
                class="field-input min-w-30 w-full"
                aria-label="录入来源"
                @change="setEntrySource(line, $event)"
              >
                <option
                  v-for="option in QUANTITY_ENTRY_SOURCE_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </td>
            <td class="p-1">
              <input
                v-if="entrySource(line) === 'contract'"
                :value="line.contractQty ?? ''"
                type="number"
                min="0"
                step="0.001"
                class="field-input w-full text-right font-mono"
                aria-label="当前合同量"
                @input="emit('updateLine', { key: line.key, field: 'contractQty', value: numberInput($event) })"
              >
              <input
                v-else-if="entrySource(line) === 'provisional'"
                :value="line.provisionalQty ?? ''"
                type="number"
                min="0"
                step="0.001"
                class="field-input w-full text-right font-mono"
                aria-label="暂估量"
                @input="emit('updateLine', { key: line.key, field: 'provisionalQty', value: numberInput($event) })"
              >
              <template v-else>
                <QuantityFieldFormulaCell
                  :formula="line.fieldFormula"
                  @update-formula="emit('updateLine', { key: line.key, field: 'fieldFormula', value: $event })"
                />
              </template>
            </td>
            <td class="p-2">
              <div class="flex flex-wrap gap-x-3 gap-y-1 text-10px text-ink-soft">
                <span>合同/对比 <b class="font-mono text-ink">{{ quantityLabel(line.contractQty) }}</b></span>
                <span>暂估量 <b class="font-mono text-ink">{{ quantityLabel(line.provisionalQty) }}</b></span>
                <span>现场量 <b class="font-mono text-brand-deep">{{ quantityLabel(formulaValue(line)) }}</b></span>
              </div>
              <div v-if="!canLinkBoq" class="mt-1 text-9px text-ink-faint">
                原识别值：{{ line.recognizedContractQty == null ? '未记录' : line.recognizedContractQty }}
              </div>
            </td>
            <td class="p-1">
              <input
                :value="line.note"
                class="field-input w-full"
                aria-label="模板明细备注"
                placeholder="备注"
                @input="emit('updateLine', { key: line.key, field: 'note', value: inputValue($event) })"
              >
            </td>
            <td class="px-1 py-1 text-center">
              <KitButton type="button" variant="danger" class=" h-7 w-7" aria-label="删除三量明细" @click="emit('removeLine', line)">
                <span class="i-lucide-x" aria-hidden="true" />
              </KitButton>
            </td>
          </tr>
          <tr v-if="!props.lines.length">
            <td :colspan="canLinkBoq ? 8 : 7" class="px-4 py-8 text-center text-ink-faint">
              暂无三量明细；可选择已有分项，或在无 BOQ 时新增手工分项。
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
