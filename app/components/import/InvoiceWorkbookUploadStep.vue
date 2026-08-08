<script setup lang="ts">
import type { RawImportSheet, RawImportWorkbook } from '~/lib/util/excel'
import { useDropZone } from '@vueuse/core'
import { computed, shallowRef, useTemplateRef } from 'vue'
import { createInvoiceImportTemplateXlsx, INVOICE_XLSX_MIME } from '~/lib/invoice/excel'
import { toErrorMessage } from '~/lib/util/error'
import { parseWorkbookForMapping } from '~/lib/util/excel'

const emit = defineEmits<{
  loaded: [sheet: RawImportSheet]
}>()

const parsing = shallowRef(false)
const error = shallowRef<string | null>(null)
const workbook = shallowRef<RawImportWorkbook | null>(null)
const selectedSheetName = shallowRef('')
const fileName = shallowRef('')
const { exportFile } = useKitUI()

const dropZone = useTemplateRef('dropZone')
const { isOverDropZone } = useDropZone(dropZone, {
  onDrop: files => handleFile(files?.[0]),
})

const selectedSheet = computed(() =>
  workbook.value?.sheets.find(sheet => sheet.name === selectedSheetName.value)
  ?? workbook.value?.sheets[0]
  ?? null,
)

function chooseDefaultSheet(sheets: readonly RawImportSheet[]) {
  selectedSheetName.value = sheets.find(sheet => sheet.rows.length && sheet.columns.length)?.name
    ?? sheets[0]?.name
    ?? ''
}

async function handleFile(file: File | undefined) {
  if (!file || parsing.value)
    return
  if (!/\.(?:xlsx|xls|csv)$/i.test(file.name)) {
    error.value = '仅支持 .xlsx / .xls / .csv 文件'
    return
  }

  parsing.value = true
  error.value = null
  try {
    const parsed = await parseWorkbookForMapping(file)
    if (!parsed.sheets.length)
      throw new Error('文件中没有工作表')
    workbook.value = parsed
    fileName.value = file.name
    chooseDefaultSheet(parsed.sheets)
  }
  catch (cause) {
    error.value = toErrorMessage(cause)
    workbook.value = null
  }
  finally {
    parsing.value = false
  }
}

function onPick(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  void handleFile(input.files?.[0] ?? undefined)
  input.value = ''
}

async function downloadTemplate() {
  try {
    await exportFile({
      data: createInvoiceImportTemplateXlsx(),
      defaultName: '发票导入模板.xlsx',
      mimeType: INVOICE_XLSX_MIME,
    })
  }
  catch (cause) {
    error.value = `模板下载失败：${toErrorMessage(cause)}`
  }
}

function useSelectedSheet() {
  const sheet = selectedSheet.value
  if (!sheet)
    return
  emit('loaded', sheet)
}

function reset() {
  workbook.value = null
  selectedSheetName.value = ''
  fileName.value = ''
  error.value = null
}
</script>

<template>
  <section aria-label="上传发票工作簿">
    <div v-if="!workbook" class="mb-3 flex flex-wrap items-center justify-between gap-3 border border-brand/25 rounded-[var(--radius-card)] bg-brand-soft p-4">
      <div class="min-w-0">
        <p class="text-13px text-brand-deep font-700">
          第一次导入？先下载标准模板
        </p>
        <p class="mt-1 text-11px text-ink-soft">
          模板已包含发票号码、价税合计、归属项目等字段，并附有填写说明。
        </p>
      </div>
      <button type="button" class="btn-secondary shrink-0" @click="downloadTemplate">
        <span class="i-lucide-download mr-1 text-13px" aria-hidden="true" />
        下载发票模板
      </button>
    </div>

    <label
      v-if="!workbook"
      ref="dropZone"
      class="grid cursor-pointer place-items-center gap-2 border-2 rounded-[var(--radius-card)] border-dashed bg-panel p-8 text-center transition-colors duration-[var(--dur-fast)] focus-within:border-brand focus-within:[box-shadow:0_0_0_2px_var(--brand-soft)]"
      :class="isOverDropZone ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand/60'"
    >
      <span class="i-lucide-file-spreadsheet h-7 w-7 text-brand" aria-hidden="true" />
      <span class="text-13px text-ink font-700">拖入发票 Excel，或点击选择</span>
      <span class="text-11px text-ink-faint">支持多 Sheet、标题行、合并单元格和 WPS 公式缓存</span>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        class="sr-only"
        aria-label="选择发票 Excel 文件"
        @change="onPick"
      >
    </label>

    <div v-else class="border border-line rounded-[var(--radius-card)] bg-panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-13px text-ink font-700">
            {{ fileName }}
          </p>
          <p class="mt-1 text-11px text-ink-soft">
            已解析 {{ workbook.sheets.length }} 个工作表；先选择实际业务明细 Sheet，再进入字段映射。
          </p>
        </div>
        <button type="button" class="btn-ghost text-12px" @click="reset">
          重新选择
        </button>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div class="min-w-0 flex flex-col">
          <label class="field-label" for="invoice-workbook-sheet">
            工作表
          </label>
          <select id="invoice-workbook-sheet" v-model="selectedSheetName" class="field-input w-full">
            <option v-for="sheet in workbook.sheets" :key="sheet.name" :value="sheet.name">
              {{ sheet.name }} · {{ sheet.rows.length }} 行
            </option>
          </select>
        </div>

        <div v-if="selectedSheet" class="min-w-0 flex flex-wrap items-end gap-1.5 pb-0.5">
          <span class="chip-brand">表头第 {{ selectedSheet.headerRow + 1 }} 行</span>
          <span v-if="selectedSheet.mergeRanges.length" class="chip-ok">
            合并 {{ selectedSheet.mergeRanges.length }} 处
          </span>
          <span v-if="selectedSheet.formulaCount" class="chip-warn">
            公式 {{ selectedSheet.formulaCount }} 个
          </span>
        </div>
      </div>

      <div v-if="selectedSheet?.formulaCount" class="mt-3 border border-warn/35 rounded-[var(--radius-btn)] bg-warn-soft p-3 text-11px text-warn-ink">
        检测到公式单元格。导入预览使用工作簿已保存的显示/缓存值，公式文本不会被当作金额覆盖；若缓存为空或异常，请在预览中删除该行并留待人工复核。
      </div>
      <div v-if="selectedSheet?.mergeRanges.length" class="mt-3 border border-brand/25 rounded-[var(--radius-btn)] bg-brand-soft p-3 text-11px text-brand-deep">
        已识别合并区域，数据区的合并续行会展开为每条业务行；标题合并只作为来源布局元数据保留。
      </div>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <p class="text-11px text-ink-faint">
          {{ selectedSheet?.range || '—' }} · 仅导入当前选中的工作表
        </p>
        <button type="button" class="btn-accent" :disabled="!selectedSheet?.rows.length" @click="useSelectedSheet">
          使用此工作表
        </button>
      </div>
    </div>

    <p v-if="parsing" class="mt-3 text-12px text-ink-soft" role="status">
      正在读取工作簿、合并区域和公式信息…
    </p>
    <p v-else-if="error" class="mt-3 text-12px text-danger font-600" role="alert">
      {{ error }}
    </p>
  </section>
</template>
