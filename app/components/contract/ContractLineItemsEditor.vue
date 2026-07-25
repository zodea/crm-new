<script setup lang="ts">
import type { ContractLineItemDraft } from '~/lib/contract/forms'
import { useFullscreen } from '@vueuse/core'
import { computed, shallowRef } from 'vue'
import {
  contractLineItemAmount,
  contractLineItemsTotal,
} from '~/lib/contract/forms'

const props = defineProps<{
  lines: ContractLineItemDraft[]
}>()

const emit = defineEmits<{
  update: [lines: ContractLineItemDraft[]]
}>()

const editor = shallowRef<HTMLElement>()
const showImporter = shallowRef(false)
const tsvText = shallowRef('')
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(editor)
const total = computed(() => contractLineItemsTotal(props.lines))
const UNIT_OPTIONS = ['㎡', 'm', '块', '套', '吨', '包', '桶', '樘', '个']
  .map(unit => ({ key: unit, label: unit }))

function addLine() {
  emit('update', [
    ...props.lines,
    {
      materialName: '',
      spec: '',
      brand: '',
      unit: '㎡',
      qty: 1,
      taxInclusiveUnitPrice: 0,
      plannedArrivalDate: '',
      note: '',
    },
  ])
}

function patchLine(index: number, patch: Partial<ContractLineItemDraft>) {
  emit('update', props.lines.map((line, lineIndex) =>
    lineIndex === index ? { ...line, ...patch } : line,
  ))
}

function removeLine(index: number) {
  emit('update', props.lines.filter((_, lineIndex) => lineIndex !== index))
}

function copyLine(index: number) {
  const source = props.lines[index]
  if (!source)
    return
  const copy = { ...source, id: undefined }
  emit('update', [
    ...props.lines.slice(0, index + 1),
    copy,
    ...props.lines.slice(index + 1),
  ])
}

function importTsv() {
  const imported = tsvText.value
    .split(/\r?\n/)
    .map(row => row.trim())
    .filter(Boolean)
    .map((row): ContractLineItemDraft => {
      const [
        materialName = '',
        spec = '',
        brand = '',
        unit = '',
        qty = '',
        taxInclusiveUnitPrice = '',
        plannedArrivalDate = '',
        note = '',
      ] = row.split('\t')
      return {
        materialName: materialName.trim(),
        spec: spec.trim(),
        brand: brand.trim(),
        unit: unit.trim() || '㎡',
        qty: qty.trim() ? Number(qty) : null,
        taxInclusiveUnitPrice: taxInclusiveUnitPrice.trim()
          ? Number(taxInclusiveUnitPrice)
          : null,
        plannedArrivalDate: plannedArrivalDate.trim(),
        note: note.trim(),
      }
    })
  if (!imported.length)
    return
  emit('update', [...props.lines, ...imported])
  tsvText.value = ''
  showImporter.value = false
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function inputNumber(event: Event): number {
  return Number((event.target as HTMLInputElement).value) || 0
}
</script>

<template>
  <section
    id="section-lines"
    ref="editor"
    class="panel scroll-mt-4 overflow-hidden fullscreen:bg-page"
  >
    <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
      <div>
        <h2 class="text-14px font-800 text-ink">
          采购合同明细
        </h2>
        <p class="mt-0.5 text-11px text-ink-faint">
          含税金额由数量 × 含税单价派生；提交时与合同头金额勾稽。
        </p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <span class="text-12px text-ink-soft">
          {{ lines.length }} 行 · 合计
          <b class="font-mono text-ink">{{ total.toFixed(2) }}</b> 元
        </span>
        <KitButton
          type="button"
          variant="secondary"
          data-testid="import-contract-lines"
          @click="showImporter = !showImporter"
        >
          <span class="i-lucide-clipboard-paste mr-1" aria-hidden="true" />
          粘贴导入
        </KitButton>
        <KitButton
          type="button"
          variant="secondary"
          data-testid="fullscreen-contract-lines"
          @click="toggleFullscreen"
        >
          <span :class="isFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" class="mr-1" aria-hidden="true" />
          {{ isFullscreen ? '退出全屏' : '全屏编辑' }}
        </KitButton>
        <KitButton type="button" variant="secondary" data-testid="add-contract-line" @click="addLine">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />
          新增明细
        </KitButton>
      </div>
    </div>

    <div v-if="showImporter" class="border-b border-line bg-surface-2 p-4">
      <label class="field-block">
        <span class="field-label">从 Excel 复制后粘贴（列序：物资、规格、品牌、单位、数量、含税单价、到货日、备注）</span>
        <textarea
          v-model="tsvText"
          rows="5"
          class="field-input w-full font-mono"
          data-testid="contract-lines-tsv"
          placeholder="瓷砖&#9;600×600&#9;品牌&#9;㎡&#9;10&#9;23.8&#9;2026-08-01&#9;首批"
        />
      </label>
      <div class="mt-2 flex justify-end gap-2">
        <KitButton type="button" variant="ghost" @click="showImporter = false">
          取消
        </KitButton>
        <KitButton type="button" data-testid="confirm-contract-lines-import" @click="importTsv">
          导入明细
        </KitButton>
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-1100px w-full border-collapse text-12px">
        <thead class="bg-surface-2 text-left text-ink-soft">
          <tr>
            <th class="w-10 px-2 py-2 text-center">
              #
            </th>
            <th class="min-w-36 px-2 py-2">
              物资名称 *
            </th>
            <th class="min-w-28 px-2 py-2">
              规格型号
            </th>
            <th class="min-w-24 px-2 py-2">
              品牌
            </th>
            <th class="w-20 px-2 py-2">
              单位
            </th>
            <th class="w-24 px-2 py-2 text-right">
              数量 *
            </th>
            <th class="w-28 px-2 py-2 text-right">
              含税单价 *
            </th>
            <th class="w-28 px-2 py-2 text-right">
              含税金额
            </th>
            <th class="w-34 px-2 py-2">
              计划到货日期
            </th>
            <th class="min-w-28 px-2 py-2">
              备注
            </th>
            <th class="w-20 px-2 py-2">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(line, index) in lines"
            :key="line.id ?? `new-${index}`"
            class="border-t border-line"
          >
            <td class="px-2 py-2 text-center font-mono text-ink-faint">
              {{ index + 1 }}
            </td>
            <td class="px-2 py-2">
              <input
                :value="line.materialName"
                class="field-input w-full"
                :data-testid="`contract-line-name-${index}`"
                @input="patchLine(index, { materialName: inputValue($event) })"
              >
            </td>
            <td class="px-2 py-2">
              <input :value="line.spec" class="field-input w-full" @input="patchLine(index, { spec: inputValue($event) })">
            </td>
            <td class="px-2 py-2">
              <input :value="line.brand" class="field-input w-full" @input="patchLine(index, { brand: inputValue($event) })">
            </td>
            <td class="px-2 py-2">
              <SelectFilter
                :model-value="line.unit"
                :options="UNIT_OPTIONS"
                aria-label="计量单位"
                :min-width="64"
                full-width
                @update:model-value="patchLine(index, { unit: $event })"
              />
            </td>
            <td class="px-2 py-2">
              <input
                :value="line.qty ?? 0"
                type="number"
                min="0"
                step="0.01"
                class="field-input w-full text-right font-mono"
                :data-testid="`contract-line-qty-${index}`"
                @input="patchLine(index, { qty: inputNumber($event) })"
              >
            </td>
            <td class="px-2 py-2">
              <input
                :value="line.taxInclusiveUnitPrice ?? 0"
                type="number"
                min="0"
                step="0.01"
                class="field-input w-full text-right font-mono"
                :data-testid="`contract-line-price-${index}`"
                @input="patchLine(index, { taxInclusiveUnitPrice: inputNumber($event) })"
              >
            </td>
            <td class="px-2 py-2 text-right font-mono text-ink">
              {{ contractLineItemAmount(line).toFixed(2) }}
            </td>
            <td class="px-2 py-2">
              <input
                :value="line.plannedArrivalDate"
                type="date"
                class="field-input w-full"
                @input="patchLine(index, { plannedArrivalDate: inputValue($event) })"
              >
            </td>
            <td class="px-2 py-2">
              <input :value="line.note" class="field-input w-full" @input="patchLine(index, { note: inputValue($event) })">
            </td>
            <td class="px-2 py-2">
              <div class="flex items-center gap-1">
                <button type="button" class="icon-btn" title="复制明细" @click="copyLine(index)">
                  <span class="i-lucide-copy text-12px" aria-hidden="true" />
                </button>
                <button type="button" class="icon-btn-danger" title="删除明细" @click="removeLine(index)">
                  <span class="i-lucide-trash-2 text-12px" aria-hidden="true" />
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="lines.length === 0">
            <td colspan="11" class="px-4 py-8 text-center text-12px text-ink-faint">
              暂无采购明细，点击“新增明细”开始录入。
            </td>
          </tr>
        </tbody>
        <tfoot v-if="lines.length" class="border-t border-line-strong bg-surface-2">
          <tr>
            <td colspan="7" class="px-3 py-2 text-right font-700 text-ink-soft">
              合计
            </td>
            <td class="px-2 py-2 text-right font-mono font-800 text-brand-deep">
              {{ total.toFixed(2) }}
            </td>
            <td colspan="3" />
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>
