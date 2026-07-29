<script setup lang="ts">
import type {
  BoqColumnMapping,
  BoqFormatClass,
  BoqImportField,
  BoqImportRow,
  BoqParsedWorkbook,
} from '~/lib/boq/import'
import type { KitTableColumn } from '~/lib/kit/table'
import { useDropZone, useFileDialog, useStepper } from '@vueuse/core'
import {
  autoMapBoqColumns,
  buildBoqImportRows,
  parseBoqWorkbook,
} from '~/lib/boq/import'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  projectId: string
  contractId: string
  busy?: boolean
}>()

const emit = defineEmits<{
  import: [payload: {
    fileName: string
    formatClass: BoqFormatClass
    rows: readonly BoqImportRow[]
  }]
}>()

const { error: toastError } = useKitUI()
const stepper = useStepper(['upload', 'confirm', 'preview'] as const, 'upload')
const dropZoneRef = useTemplateRef<HTMLElement>('dropZoneRef')
const parsed = shallowRef<BoqParsedWorkbook | null>(null)
const selectedSheetName = shallowRef('')
const mappings = shallowRef<Record<string, BoqColumnMapping>>({})
const previewRows = ref<BoqImportRow[]>([])
const excludedRowKeys = ref<Set<string>>(new Set())
const parsing = shallowRef(false)
const parseError = shallowRef('')
const reviewConfirmed = shallowRef(false)

const fieldDefinitions: readonly {
  key: BoqImportField
  label: string
  required?: boolean
}[] = [
  { key: 'section', label: '分部 / 章节' },
  { key: 'trade', label: '工种' },
  { key: 'itemCode', label: '分项编码' },
  { key: 'itemName', label: '分项名称', required: true },
  { key: 'unit', label: '单位' },
  { key: 'qty', label: '工程量', required: true },
  { key: 'totalQty', label: '清单总量' },
  { key: 'unitPrice', label: '合同单价', required: true },
  { key: 'amount', label: '合价' },
  { key: 'building', label: '楼栋' },
  { key: 'unitType', label: '户型' },
  { key: 'multiplier', label: '套数 / 倍数' },
  { key: 'room', label: '房间 / 部位' },
  { key: 'floorZone', label: '楼层 / 层区' },
  { key: 'spec', label: '特征描述' },
  { key: 'taxRate', label: '税率' },
  { key: 'ownerSupplied', label: '甲供标记' },
]

const selectedSheet = computed(() =>
  parsed.value?.sheets.find(sheet => sheet.name === selectedSheetName.value) ?? null,
)
const currentMapping = computed(() => mappings.value[selectedSheetName.value] ?? {})
const includedPreviewRows = computed(() => previewRows.value.filter(row =>
  !excludedRowKeys.value.has(rowKey(row)),
))
const reviewSummary = computed(() => ({
  zeroQty: includedPreviewRows.value.filter(row => row.qty === 0).length,
  quantityDifference: includedPreviewRows.value.filter(row => (
    row.multiplier != null
    && row.totalQty != null
    && Math.abs(row.qty * row.multiplier - row.totalQty) > 0.001
  )).length,
  mirrorUnitType: includedPreviewRows.value.filter(row => /镜像|变异/.test(row.unitType)).length,
}))
const requiresReview = computed(() => Object.values(reviewSummary.value).some(Boolean))

const processSteps = computed(() => {
  const names = ['upload', 'confirm', 'preview'] as const
  const labels = ['上传识别格式', '人工确认映射', '拆表结果预览']
  return names.map((name, index) => ({
    id: name,
    label: labels[index]!,
    status: name === 'upload' && parsed.value && stepper.isCurrent(name)
      ? 'completed' as const
      : stepper.isCurrent(name) && (name !== 'upload' || parsing.value)
        ? 'active' as const
        : stepper.isAfter(name)
          ? 'completed' as const
          : 'pending' as const,
  }))
})

const previewColumns: KitTableColumn[] = [
  { field: 'included', title: '入库', width: 62, fixed: 'left', slot: 'included' },
  { field: 'section', title: '分部', minWidth: 110 },
  { field: 'trade', title: '工种', width: 90 },
  { field: 'itemName', title: '分项名称', minWidth: 180 },
  { field: 'unitType', title: '户型', width: 110, slot: 'unitType' },
  { field: 'room', title: '房间 / 部位', minWidth: 130, slot: 'room' },
  { field: 'unit', title: '单位', width: 68 },
  { field: 'qty', title: '单套量', width: 110, align: 'right', slot: 'qty' },
  { field: 'multiplier', title: '套数', width: 96, align: 'right', slot: 'multiplier' },
  { field: 'totalQty', title: '清单总量', width: 110, align: 'right', slot: 'totalQty' },
  { field: 'unitPrice', title: '合同单价', type: 'money', width: 116 },
  { field: 'amount', title: '合价', type: 'money', width: 126 },
  { field: 'sourceSheet', title: '来源 sheet', width: 120 },
  { field: 'sourceRow', title: '来源行', width: 78, align: 'right' },
]

const { onChange, open: openFileDialog } = useFileDialog({
  accept: '.xlsx,.xls,.csv',
  multiple: false,
  reset: true,
})

async function handleFile(file: File) {
  parsing.value = true
  parseError.value = ''
  try {
    const result = parseBoqWorkbook(await file.arrayBuffer(), file.name)
    parsed.value = result
    selectedSheetName.value = result.sheets[0]?.name ?? ''
    mappings.value = Object.fromEntries(result.sheets.map(sheet => [
      sheet.name,
      autoMapBoqColumns(sheet.columns),
    ]))
    previewRows.value = []
    excludedRowKeys.value = new Set()
    reviewConfirmed.value = false
    stepper.goTo('upload')
  }
  catch (cause) {
    parsed.value = null
    parseError.value = toErrorMessage(cause)
    toastError(parseError.value)
  }
  finally {
    parsing.value = false
  }
}

onChange((files) => {
  const file = files?.[0]
  if (file)
    void handleFile(file)
})

const { isOverDropZone } = useDropZone(dropZoneRef, {
  multiple: false,
  dataTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
  ],
  onDrop(files) {
    const file = files?.[0]
    if (file)
      void handleFile(file)
  },
})

function updateMapping(field: BoqImportField, column: string | undefined) {
  const next = { ...(mappings.value[selectedSheetName.value] ?? {}) }
  if (column && column !== '__skip__')
    next[field] = column
  else
    delete next[field]
  mappings.value = { ...mappings.value, [selectedSheetName.value]: next }
}

function rowKey(row: BoqImportRow): string {
  return `${row.sourceSheet}:${row.sourceRow}:${row.itemName}:${row.unitType}`
}

function setRowIncluded(row: BoqImportRow, included: boolean) {
  const next = new Set(excludedRowKeys.value)
  if (included)
    next.delete(rowKey(row))
  else
    next.add(rowKey(row))
  excludedRowKeys.value = next
  reviewConfirmed.value = false
}

function optionalEditedNumber(value: unknown, label: string): number | null {
  if (value == null || value === '')
    return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${label}必须是非负有效数字`)
  return parsed
}

function finalizedRows(): BoqImportRow[] {
  return includedPreviewRows.value.map((row) => {
    const qty = optionalEditedNumber(row.qty, `第 ${row.sourceRow} 行单套量`)
    const unitPrice = optionalEditedNumber(row.unitPrice, `第 ${row.sourceRow} 行合同单价`)
    if (qty == null || unitPrice == null)
      throw new Error(`第 ${row.sourceRow} 行单套量与合同单价必填`)
    return {
      ...row,
      qty,
      unitPrice,
      multiplier: optionalEditedNumber(row.multiplier, `第 ${row.sourceRow} 行套数`),
      totalQty: optionalEditedNumber(row.totalQty, `第 ${row.sourceRow} 行清单总量`),
      amount: Math.round((qty * unitPrice + Number.EPSILON) * 100) / 100,
    }
  })
}

function mappingComplete(sheetName: string): boolean {
  const mapping = mappings.value[sheetName] ?? {}
  return fieldDefinitions
    .filter(field => field.required && !(field.key === 'qty' && parsed.value?.formatClass === 'E'))
    .every(field => Boolean(mapping[field.key]))
}

function goToConfirm() {
  if (parsed.value)
    stepper.goTo('confirm')
}

function buildPreview() {
  const source = parsed.value
  if (!source)
    return
  const incomplete = source.sheets.find(sheet => !mappingComplete(sheet.name))
  if (incomplete) {
    selectedSheetName.value = incomplete.name
    toastError(`工作表「${incomplete.name}」缺少必填映射`)
    return
  }
  try {
    previewRows.value = source.sheets.flatMap(sheet =>
      buildBoqImportRows(sheet, mappings.value[sheet.name] ?? {}, source.formatClass),
    )
    excludedRowKeys.value = new Set()
    reviewConfirmed.value = false
    if (!previewRows.value.length)
      throw new Error('映射后没有可导入的分项行')
    stepper.goTo('preview')
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}

function confirmImport() {
  if (!parsed.value || !props.projectId || !props.contractId)
    return
  if (!includedPreviewRows.value.length) {
    toastError('请至少保留一行入库')
    return
  }
  if (requiresReview.value && !reviewConfirmed.value) {
    toastError('请先确认差额、镜像/变异户型或零量行的人工校验结果')
    return
  }
  try {
    emit('import', {
      fileName: parsed.value.fileName,
      formatClass: parsed.value.formatClass,
      rows: finalizedRows(),
    })
  }
  catch (cause) {
    toastError(toErrorMessage(cause))
  }
}
</script>

<template>
  <div class="space-y-4">
    <section class="panel p-4">
      <ProcessStepper :steps="processSteps" />
    </section>

    <section v-if="stepper.current.value === 'upload'" class="panel p-4">
      <div
        ref="dropZoneRef"
        class="grid min-h-72 cursor-pointer place-items-center border-2 rounded-[var(--radius-card)] border-dashed p-6 text-center transition-colors"
        :class="isOverDropZone ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface-2 hover:border-brand'"
        role="button"
        tabindex="0"
        @click="openFileDialog()"
        @keydown.enter.prevent="openFileDialog()"
        @keydown.space.prevent="openFileDialog()"
      >
        <div>
          <span class="i-lucide-file-spreadsheet text-36px text-brand" />
          <h2 class="mt-3 text-15px font-800 text-ink">
            拖入或选择施工清单
          </h2>
          <p class="mt-1 text-12px text-ink-soft">
            支持 XLSX / XLS / CSV；自动扫描前 20 行识别真实表头。
          </p>
          <button type="button" class="btn-primary mt-4" :disabled="parsing">
            {{ parsing ? '正在识别…' : '选择文件' }}
          </button>
        </div>
      </div>

      <div v-if="parsed" class="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div class="rounded-lg bg-ok-soft p-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="chip-ok">已识别 {{ parsed.formatClass }} 类</span>
            <strong class="text-13px text-ok-ink">{{ parsed.formatLabel }}</strong>
          </div>
          <p class="mt-1 text-11px text-ink-soft">
            {{ parsed.fileName }} · {{ parsed.sheets.length }} 个 sheet ·
            {{ parsed.sheets.reduce((total, sheet) => total + sheet.rows.length, 0) }} 个候选数据行
          </p>
          <p v-if="parsed.ignoredSheets.length" class="mt-1 text-11px text-warning">
            已跳过 {{ parsed.ignoredSheets.length }} 个无清单表头 sheet：{{ parsed.ignoredSheets.join('、') }}
          </p>
        </div>
        <button type="button" class="btn-accent self-center" @click="goToConfirm">
          下一步：人工确认
        </button>
      </div>
      <p v-if="parseError" class="mt-3 text-12px text-danger" role="alert">
        {{ parseError }}
      </p>
    </section>

    <section v-else-if="stepper.current.value === 'confirm'" class="panel overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-3">
        <div>
          <h2 class="text-14px font-800 text-ink">
            人工确认列映射
          </h2>
          <p class="text-11px text-ink-soft">
            每个 sheet 独立确认；必填字段未映上时不能预览。
          </p>
        </div>
        <SelectFilter
          v-model="selectedSheetName"
          label="工作表"
          :options="(parsed?.sheets ?? []).map(sheet => ({ key: sheet.name, label: `${sheet.name} · 表头第 ${sheet.headerRow} 行` }))"
          :min-width="220"
        />
      </div>
      <div v-if="selectedSheet" class="grid gap-[1px] bg-line sm:grid-cols-2 lg:grid-cols-3">
        <label
          v-for="field in fieldDefinitions"
          :key="field.key"
          class="min-w-0 bg-panel p-3"
        >
          <span class="mb-1 flex items-center gap-1 text-12px font-700 text-ink-soft">
            {{ field.label }} <b v-if="field.required" class="text-danger">*</b>
          </span>
          <SelectFilter
            :model-value="currentMapping[field.key]"
            :aria-label="field.label"
            :options="[
              { key: '__skip__', label: '不导入' },
              ...selectedSheet.columns.map(column => ({ key: column, label: column })),
            ]"
            :min-width="180"
            :placeholder="field.required && !(field.key === 'qty' && parsed?.formatClass === 'E') ? '请选择必填列' : '不导入'"
            @update:model-value="updateMapping(field.key, $event)"
          />
        </label>
      </div>
      <div class="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
        <button type="button" class="btn-secondary" @click="stepper.goBackTo('upload')">
          上一步
        </button>
        <button type="button" class="btn-accent" @click="buildPreview">
          下一步：结果预览
        </button>
      </div>
    </section>

    <section v-else class="space-y-3">
      <div class="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 class="text-14px font-800 text-ink">
            拆表结果预览
          </h2>
          <p class="mt-0.5 text-11px text-ink-soft">
            保留 {{ includedPreviewRows.length }} / {{ previewRows.length }} 行 · 来源追溯键按 文件 · sheet · 行号 固化
          </p>
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn-secondary" @click="stepper.goBackTo('confirm')">
            返回映射
          </button>
          <button
            type="button"
            class="btn-accent"
            :disabled="busy || !projectId || !contractId"
            @click="confirmImport"
          >
            {{ busy ? '正在入库…' : `确认导入 ${includedPreviewRows.length} 行` }}
          </button>
        </div>
      </div>
      <div v-if="requiresReview" class="panel border-warning/40 bg-warning-soft p-4">
        <h3 class="text-13px font-800 text-warning-ink">
          入库前人工校验
        </h3>
        <div class="mt-2 flex flex-wrap gap-2 text-11px text-ink-soft">
          <span v-if="reviewSummary.quantityDifference" class="chip-warn">
            单套量 × 套数与总量不符 {{ reviewSummary.quantityDifference }} 行
          </span>
          <span v-if="reviewSummary.mirrorUnitType" class="chip-warn">
            镜像 / 变异户型 {{ reviewSummary.mirrorUnitType }} 行
          </span>
          <span v-if="reviewSummary.zeroQty" class="chip-warn">
            零量行 {{ reviewSummary.zeroQty }} 行
          </span>
        </div>
        <label class="mt-3 flex items-start gap-2 text-12px text-ink">
          <input v-model="reviewConfirmed" type="checkbox" class="mt-0.5 accent-[var(--brand)]">
          <span>我已核对以上行；零量/补充行可取消入库，户型归并与单套量、套数、总量可在下表直接修正。</span>
        </label>
      </div>
      <KitTable
        :columns="previewColumns"
        :data="previewRows.slice(0, 100)"
        :loading="busy"
        :min-rows="10"
      >
        <template #included="{ row }">
          <input
            type="checkbox"
            :checked="!excludedRowKeys.has(rowKey(row))"
            :aria-label="`导入 ${row.itemName} 第 ${row.sourceRow} 行`"
            class="accent-[var(--brand)]"
            @change="setRowIncluded(row, ($event.target as HTMLInputElement).checked)"
          >
        </template>
        <template #unitType="{ row }">
          <input v-model.trim="row.unitType" class="field-input h-7 w-full px-2 text-11px" :aria-label="`户型 ${row.itemName}`">
        </template>
        <template #room="{ row }">
          <input v-model.trim="row.room" class="field-input h-7 w-full px-2 text-11px" :aria-label="`房间 ${row.itemName}`">
        </template>
        <template #qty="{ row }">
          <input v-model.number="row.qty" type="number" min="0" step="any" class="field-input h-7 w-full px-2 text-right text-11px" :aria-label="`单套量 ${row.itemName}`">
        </template>
        <template #multiplier="{ row }">
          <input v-model.number="row.multiplier" type="number" min="0" step="any" class="field-input h-7 w-full px-2 text-right text-11px" :aria-label="`套数 ${row.itemName}`">
        </template>
        <template #totalQty="{ row }">
          <input v-model.number="row.totalQty" type="number" min="0" step="any" class="field-input h-7 w-full px-2 text-right text-11px" :aria-label="`清单总量 ${row.itemName}`">
        </template>
      </KitTable>
      <p v-if="previewRows.length > 100" class="text-center text-11px text-ink-faint">
        预览只显示前 100 行，确认后将导入全部 {{ previewRows.length }} 行。
      </p>
    </section>
  </div>
</template>
