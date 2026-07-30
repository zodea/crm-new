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
const grid = useTemplateRef<{
  validate: () => { row: number, key: string }[]
}>('grid')
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(editor)
const total = computed(() => contractLineItemsTotal(props.lines))
const UNIT_OPTIONS = ['㎡', 'm', '块', '套', '吨', '包', '桶', '樘', '个']

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
    type: 'select',
    options: UNIT_OPTIONS,
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
      unit: '㎡',
      qty: 1,
      taxInclusiveUnitPrice: 0,
      plannedArrivalDate: '',
      note: '',
    },
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

    <div class="p-3">
      <p v-if="lines.length" class="mb-2 text-11px text-ink-faint">
        勾选明细后可批量复制或删除；表格只在自身区域横向滚动。
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
            @input="update(($event.target as HTMLInputElement).value)"
          >
        </template>
      </KitEditGrid>
    </div>
  </section>
</template>
