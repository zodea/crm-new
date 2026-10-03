<script setup lang="ts">
import type { ContractLineItemDraft } from '~/lib/contract/forms'
import type { KitEditGridColumn } from '~/lib/kit/edit-grid'
import { useFullscreen } from '@vueuse/core'
import { computed, shallowRef, useTemplateRef } from 'vue'
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
const clipboardError = shallowRef('')
const grid = useTemplateRef<{
  validate: () => { row: number, key: string }[]
}>('grid')
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(editor)
const total = computed(() => contractLineItemsTotal(props.lines))

type EditableContractLine = ContractLineItemDraft & Record<string, unknown>

const linesModel = computed<EditableContractLine[]>({
  get: () => props.lines as EditableContractLine[],
  set: lines => emit('update', lines),
})

const columns: KitEditGridColumn<EditableContractLine>[] = [
  {
    key: 'materialName',
    label: '物资名称',
    required: true,
    minWidth: 180,
  },
  {
    key: 'spec',
    label: '规格型号',
    minWidth: 140,
  },
  {
    key: 'brand',
    label: '品牌',
    minWidth: 120,
  },
  {
    key: 'unit',
    label: '单位',
    width: 90,
  },
  {
    key: 'qty',
    label: '数量',
    type: 'number',
    required: true,
    width: 110,
  },
  {
    key: 'taxInclusiveUnitPrice',
    label: '含税单价',
    type: 'number',
    required: true,
    width: 130,
  },
  {
    key: 'amount',
    label: '含税金额',
    type: 'readonly',
    derive: row => contractLineItemAmount(row),
    width: 140,
  },
  {
    key: 'plannedArrivalDate',
    label: '计划到货日期',
    minWidth: 150,
  },
  {
    key: 'note',
    label: '备注',
    minWidth: 160,
  },
]

function addLine() {
  emit('update', [
    ...props.lines,
    {
      materialName: '',
      spec: '',
      brand: '',
      unit: '',
      qty: 1,
      taxInclusiveUnitPrice: 0,
      plannedArrivalDate: '',
      note: '',
    },
  ])
}

function importTsv() {
  clipboardError.value = ''
  const parsed = parseExcelClipboard(tsvText.value)
  if (!parsed.ok) {
    clipboardError.value = parsed.message
    return
  }
  const imported: ContractLineItemDraft[] = []
  for (const [index, row] of parsed.rows.entries()) {
    if (row.every(cell => !cell.trim()))
      continue
    const [
      materialName = '',
      spec = '',
      brand = '',
      unit = '',
      qty = '',
      taxInclusiveUnitPrice = '',
      plannedArrivalDate = '',
      note = '',
    ] = row
    const parsedQty = clipboardNumber(qty)
    const parsedPrice = clipboardNumber(taxInclusiveUnitPrice)
    if (parsedQty === undefined || parsedPrice === undefined) {
      clipboardError.value = `第 ${index + 1} 行${parsedQty === undefined ? '数量' : '含税单价'}不是有效数值，本次导入未应用。`
      return
    }
    imported.push({
      materialName: materialName.trim(),
      spec: spec.trim(),
      brand: brand.trim(),
      unit: unit.trim(),
      qty: parsedQty,
      taxInclusiveUnitPrice: parsedPrice,
      plannedArrivalDate: plannedArrivalDate.trim(),
      note: note.trim(),
    })
  }
  if (!imported.length)
    return
  emit('update', [...props.lines, ...imported])
  tsvText.value = ''
  showImporter.value = false
}

function parseExcelClipboard(text: string): { ok: true, rows: string[][] } | { ok: false, message: string } {
  const source = text.replace(/\r\n?/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let quoteClosed = false
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index++
        }
        else {
          quoted = false
          quoteClosed = true
        }
      }
      else {
        cell += character
      }
      continue
    }
    if (character === '\t' || character === '\n') {
      row.push(cell)
      cell = ''
      quoteClosed = false
      if (character === '\n') {
        rows.push(row)
        row = []
      }
      continue
    }
    if (quoteClosed)
      return { ok: false, message: 'Excel 单元格引号后的内容无效，请重新复制；本次未应用。' }
    if (character === '"' && cell === '')
      quoted = true
    else
      cell += character
  }
  if (quoted)
    return { ok: false, message: 'Excel 单元格引号未闭合，请重新复制；本次未应用。' }
  if (row.length || cell || !source.endsWith('\n')) {
    row.push(cell)
    rows.push(row)
  }
  return { ok: true, rows }
}

function clipboardNumber(text: string): number | null | undefined {
  const raw = text.trim()
  if (!raw)
    return null
  const value = Number(raw)
  return Number.isFinite(value) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)
    ? value
    : undefined
}

function pasteColumn(event: ClipboardEvent) {
  const cell = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>('[data-kit-grid-cell]')
    : null
  const [rowPosition, key] = cell?.dataset.kitGridCell?.split(':') ?? []
  const rowIndex = Number(rowPosition)
  const column = columns.find(column => column.key === key && !column.derive && column.type !== 'readonly')
  const text = event.clipboardData?.getData('text/plain')
  if (!column || !Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= props.lines.length || text == null || text === '')
    return

  event.preventDefault()
  clipboardError.value = ''
  const parsed = parseExcelClipboard(text)
  if (!parsed.ok) {
    clipboardError.value = parsed.message
    return
  }
  if (parsed.rows.some(row => row.length !== 1)) {
    clipboardError.value = '请选择 Excel 的单列单元格后粘贴；完整明细请使用“粘贴导入”。'
    return
  }
  const next = props.lines.map(line => ({ ...line }))
  for (const [index, [cell = '']] of parsed.rows.entries()) {
    const value = column.type === 'number' ? clipboardNumber(cell) : cell.trim()
    if (value === undefined) {
      clipboardError.value = `第 ${rowIndex + index + 1} 行${column.label}不是有效数值，本次粘贴未应用。`
      return
    }
    next[rowIndex + index] = { ...next[rowIndex + index], [column.key]: value }
  }
  emit('update', next)
}

function validate() {
  return grid.value?.validate() ?? []
}

defineExpose({ validate })
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

    <div class="p-3" @paste.capture="pasteColumn">
      <p v-if="lines.length" class="mb-2 text-11px text-ink-faint">
        选中起始单元格可向下粘贴 Excel 单列；勾选明细后可批量复制或删除。
      </p>
      <p v-if="clipboardError" role="alert" class="field-error">
        {{ clipboardError }}
      </p>
      <KitEditGrid
        ref="grid"
        v-model="linesModel"
        label="采购合同明细"
        :columns="columns"
        :row-ops="['copy', 'del']"
        :summary="[{ key: 'amount', agg: 'sum' }]"
        :min-rows="4"
      >
        <template #cell-amount="{ row }">
          <span class="block px-2 text-right font-mono text-12px text-ink">
            {{ contractLineItemAmount(row).toFixed(2) }}
          </span>
        </template>
        <template #cell-plannedArrivalDate="{ row, rowIndex, update }">
          <input
            :value="row.plannedArrivalDate ?? ''"
            type="date"
            class="field-input h-7 w-full px-2 text-12px"
            :aria-label="`计划到货日期，第 ${rowIndex + 1} 行`"
            :data-kit-grid-cell="`${rowIndex}:plannedArrivalDate`"
            @input="update(($event.target as HTMLInputElement).value)"
          >
        </template>
      </KitEditGrid>
    </div>
  </section>
</template>
