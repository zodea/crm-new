<script setup lang="ts">
import type {
  InvoiceBorderSide,
  InvoiceBorderStyle,
  InvoiceFontStyle,
  InvoiceLedgerExportRow,
  InvoiceXlsxStyleConfig,
} from '~/lib/invoice/excel'
import { computed, ref, watch } from 'vue'
import {
  createDefaultInvoiceXlsxStyleConfig,
  DATE_FORMAT,
  MONEY_FORMAT,
} from '~/lib/invoice/excel'
import { yuan } from '~/lib/util/money'
import { useInvoiceStore } from '~/stores/invoice'

const props = defineProps<{
  rows: readonly InvoiceLedgerExportRow[]
  totalAmount: number
  fileName: string
  saving: boolean
}>()

const emit = defineEmits<{
  confirm: [styleConfig: InvoiceXlsxStyleConfig]
}>()

const open = defineModel<boolean>('open', { required: true })
const invoiceStore = useInvoiceStore()
const PREVIEW_LIMIT = 200
const visibleRows = computed(() => props.rows.slice(0, PREVIEW_LIMIT))
const hiddenCount = computed(() => Math.max(0, props.rows.length - PREVIEW_LIMIT))

type FontKey = 'titleFont' | 'headerFont' | 'dataFont' | 'totalFont'
type ColumnKey = keyof InvoiceLedgerExportRow
type BorderKey = keyof InvoiceBorderStyle

interface StyleDraft {
  freezeRows: number
  titleRowHeight: number
  headerRowHeight: number
  dataRowHeight: number
  totalRowHeight: number
  columnWidths: Record<ColumnKey, number>
  dateFormat: string
  moneyFormat: string
  textFormat: string
  mergeTitle: boolean
  mergeRepeatedValues: boolean
  titleFont: InvoiceFontStyle
  headerFont: InvoiceFontStyle
  dataFont: InvoiceFontStyle
  totalFont: InvoiceFontStyle
  border: InvoiceBorderStyle
}

const styleSaved = ref(false)
const styleLoading = ref(false)
const styleSaving = ref(false)
const styleSaveError = ref('')

const columnDefinitions: readonly { key: ColumnKey, label: string }[] = [
  { key: 'invoiceDate', label: '发票日期' },
  { key: 'invoiceNumber', label: '发票号码' },
  { key: 'seller', label: '供应商' },
  { key: 'invoiceType', label: '票据类型' },
  { key: 'totalAmount', label: '价税合计' },
  { key: 'projectName', label: '归属项目' },
  { key: 'source', label: '来源' },
  { key: 'remark', label: '备注' },
]

const fontDefinitions: readonly { key: FontKey, label: string }[] = [
  { key: 'titleFont', label: '标题带' },
  { key: 'headerFont', label: '表头' },
  { key: 'dataFont', label: '数据行' },
  { key: 'totalFont', label: '合计行' },
]

const borderDefinitions: readonly { key: BorderKey, label: string }[] = [
  { key: 'top', label: '上边框' },
  { key: 'bottom', label: '下边框' },
  { key: 'left', label: '左边框' },
  { key: 'right', label: '右边框' },
]

const borderStyles = [
  { value: 'thin', label: '细线' },
  { value: 'medium', label: '中线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
  { value: 'none', label: '无' },
]

function toDraft(config: InvoiceXlsxStyleConfig): StyleDraft {
  const defaults = createDefaultInvoiceXlsxStyleConfig()
  return {
    freezeRows: config.freezeRows ?? defaults.freezeRows!,
    titleRowHeight: config.titleRowHeight ?? defaults.titleRowHeight!,
    headerRowHeight: config.headerRowHeight ?? defaults.headerRowHeight!,
    dataRowHeight: config.dataRowHeight ?? defaults.dataRowHeight!,
    totalRowHeight: config.totalRowHeight ?? defaults.totalRowHeight!,
    columnWidths: {
      ...defaults.columnWidths,
      ...config.columnWidths,
    } as Record<ColumnKey, number>,
    dateFormat: config.dateFormat || defaults.dateFormat || DATE_FORMAT,
    moneyFormat: config.moneyFormat || defaults.moneyFormat || MONEY_FORMAT,
    textFormat: config.textFormat || defaults.textFormat || '@',
    mergeTitle: config.mergeTitle ?? defaults.mergeTitle ?? true,
    mergeRepeatedValues: config.mergeRepeatedValues ?? defaults.mergeRepeatedValues ?? true,
    titleFont: { ...defaults.titleFont, ...config.titleFont } as InvoiceFontStyle,
    headerFont: { ...defaults.headerFont, ...config.headerFont } as InvoiceFontStyle,
    dataFont: { ...defaults.dataFont, ...config.dataFont } as InvoiceFontStyle,
    totalFont: { ...defaults.totalFont, ...config.totalFont } as InvoiceFontStyle,
    border: {
      top: { ...defaults.border?.top, ...config.border?.top },
      bottom: { ...defaults.border?.bottom, ...config.border?.bottom },
      left: { ...defaults.border?.left, ...config.border?.left },
      right: { ...defaults.border?.right, ...config.border?.right },
    } as InvoiceBorderStyle,
  }
}

function toConfig(draft: StyleDraft): InvoiceXlsxStyleConfig {
  return {
    freezeRows: Math.max(0, Math.trunc(draft.freezeRows || 0)),
    titleRowHeight: Math.max(1, draft.titleRowHeight || 1),
    headerRowHeight: Math.max(1, draft.headerRowHeight || 1),
    dataRowHeight: Math.max(1, draft.dataRowHeight || 1),
    totalRowHeight: Math.max(1, draft.totalRowHeight || 1),
    columnWidths: Object.fromEntries(
      columnDefinitions.map(column => [column.key, Math.max(4, draft.columnWidths[column.key] || 4)]),
    ) as Partial<Record<ColumnKey, number>>,
    dateFormat: draft.dateFormat,
    moneyFormat: draft.moneyFormat,
    textFormat: draft.textFormat,
    mergeTitle: draft.mergeTitle,
    mergeRepeatedValues: draft.mergeRepeatedValues,
    titleFont: { ...draft.titleFont },
    headerFont: { ...draft.headerFont },
    dataFont: { ...draft.dataFont },
    totalFont: { ...draft.totalFont },
    border: {
      top: { ...draft.border.top },
      bottom: { ...draft.border.bottom },
      left: { ...draft.border.left },
      right: { ...draft.border.right },
    },
  }
}

const draft = ref<StyleDraft>(toDraft(invoiceStore.invoiceExportStyle))
let styleLoadAttempt = 0

watch(open, async (isOpen) => {
  const attempt = ++styleLoadAttempt
  if (!isOpen) {
    styleLoading.value = false
    return
  }
  styleLoading.value = true
  styleSaved.value = false
  styleSaveError.value = ''
  try {
    if (!invoiceStore.invoiceExportStyleLoaded)
      await invoiceStore.loadInvoiceExportStyle()
    if (open.value && attempt === styleLoadAttempt)
      draft.value = toDraft(invoiceStore.invoiceExportStyle)
  }
  catch {
    if (attempt === styleLoadAttempt)
      styleSaveError.value = '默认样式读取失败，本次仍可使用初始样式导出。'
  }
  finally {
    if (attempt === styleLoadAttempt)
      styleLoading.value = false
  }
}, { immediate: true })

function display(value: string | number): string {
  return value === '' ? '—' : String(value)
}

async function saveDefaultStyle() {
  styleSaving.value = true
  styleSaveError.value = ''
  try {
    await invoiceStore.saveInvoiceExportStyle(toConfig(draft.value))
    styleSaved.value = true
  }
  catch {
    styleSaved.value = false
    styleSaveError.value = '默认样式保存失败，请稍后重试。'
  }
  finally {
    styleSaving.value = false
  }
}

function restoreDefaultStyle() {
  draft.value = toDraft(createDefaultInvoiceXlsxStyleConfig())
  styleSaved.value = false
}

function confirmExport() {
  emit('confirm', toConfig(draft.value))
}

function fontStyle(key: FontKey) {
  const font = draft.value[key]
  return {
    fontFamily: font.name,
    fontSize: `${Math.max(8, font.sz)}px`,
    fontWeight: font.bold ? '700' : '400',
    fontStyle: font.italic ? 'italic' : 'normal',
    color: font.color ? `#${font.color.replace(/^#/, '').slice(-6)}` : undefined,
  }
}

function borderStyle(side: InvoiceBorderSide) {
  return side.style === 'none' ? 'none' : `${side.style} ${side.color ? `#${side.color.replace(/^#/, '').slice(-6)}` : 'var(--line)'}`
}

function previewColumnStyle(key: ColumnKey) {
  return { minWidth: `${Math.max(4, draft.value.columnWidths[key]) * 8}px` }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="w-[min(1380px,calc(100vw-24px))] p-0" :show-close="!saving">
      <div class="flex max-h-[min(900px,calc(100dvh-32px))] flex-col">
        <DialogHeader class="shrink-0 border-b border-line px-5 py-4">
          <DialogTitle>导出 Excel 预览与样式设置</DialogTitle>
          <DialogDescription>
            左侧预览当前数据，右侧设置会直接写入本次 XLSX；保存为默认后，下次打开仍可复用。
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-5 py-3 text-11px text-ink-soft">
          <span class="font-mono text-ink">{{ fileName }}</span>
          <span>共 {{ rows.length }} 条 · 合计 {{ yuan(totalAmount) }}</span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-4 md:p-5">
          <div class="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_370px]">
            <section class="min-w-0" aria-label="Excel 数据预览">
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-11px text-ink-faint">
                <span>数据预览（实际导出包含全部记录）</span>
                <span>冻结前 {{ draft.freezeRows }} 行 · {{ draft.mergeTitle ? '标题合并' : '标题不合并' }}</span>
              </div>
              <div class="overflow-x-auto border border-line rounded-[var(--radius-card)] bg-panel">
                <table class="min-w-[980px] w-full border-collapse text-12px" data-testid="invoice-export-preview-table">
                  <thead class="sticky top-0 z-1 bg-surface-2">
                    <tr class="border-b border-line text-left text-11px text-ink-soft" :style="{ height: `${draft.headerRowHeight}px` }">
                      <th class="whitespace-nowrap px-3 py-2 font-700">
                        #
                      </th>
                      <th v-for="column in columnDefinitions" :key="column.key" class="whitespace-nowrap px-3 py-2 font-700" :style="previewColumnStyle(column.key)">
                        {{ column.label }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(row, index) in visibleRows"
                      :key="`${row.invoiceNumber}-${index}`"
                      class="border-b last:border-b-0"
                      :style="{ ...fontStyle('dataFont'), height: `${draft.dataRowHeight}px`, borderBottom: borderStyle(draft.border.bottom) }"
                    >
                      <td class="px-3 py-2 text-ink-faint font-mono tabular-nums">
                        {{ index + 1 }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2 text-ink" :style="previewColumnStyle('invoiceDate')">
                        {{ display(row.invoiceDate) }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2 text-ink font-mono" :style="previewColumnStyle('invoiceNumber')">
                        {{ display(row.invoiceNumber) }}
                      </td>
                      <td class="max-w-[240px] truncate px-3 py-2 text-ink" :title="row.seller" :style="previewColumnStyle('seller')">
                        {{ display(row.seller) }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2 text-right text-ink font-mono tabular-nums" :style="previewColumnStyle('totalAmount')">
                        {{ yuan(row.totalAmount) }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2 text-ink-soft" :style="previewColumnStyle('invoiceType')">
                        {{ display(row.invoiceType) }}
                      </td>
                      <td class="max-w-[220px] truncate px-3 py-2 text-ink" :title="row.projectName" :style="previewColumnStyle('projectName')">
                        {{ display(row.projectName) }}
                      </td>
                      <td class="whitespace-nowrap px-3 py-2 text-ink-soft" :style="previewColumnStyle('source')">
                        {{ display(row.source) }}
                      </td>
                      <td class="max-w-[220px] truncate px-3 py-2 text-ink-soft" :title="row.remark" :style="previewColumnStyle('remark')">
                        {{ display(row.remark) }}
                      </td>
                    </tr>
                    <tr v-if="!rows.length">
                      <td colspan="9" class="px-3 py-8 text-center text-ink-faint">
                        没有可导出的记录。
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr class="bg-surface-2" :style="{ ...fontStyle('totalFont'), height: `${draft.totalRowHeight}px` }">
                      <td colspan="4" class="px-3 py-2 text-ink">
                        合计
                      </td>
                      <td class="whitespace-nowrap px-3 py-2 text-right text-ink font-mono tabular-nums">
                        {{ yuan(totalAmount) }}
                      </td>
                      <td colspan="4" />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p v-if="hiddenCount" class="mt-2 text-11px text-ink-faint">
                预览显示前 {{ PREVIEW_LIMIT }} 条，实际导出仍包含全部 {{ hiddenCount }} 条其余记录。
              </p>
            </section>

            <aside class="min-w-0 border border-line rounded-[var(--radius-card)] bg-panel" data-testid="invoice-export-style-settings" aria-label="Excel 样式设置">
              <div class="flex items-start justify-between gap-3 border-b border-line bg-surface-2 px-4 py-3">
                <div>
                  <h2 class="text-13px font-800 text-ink">
                    导出样式设置
                  </h2>
                  <p class="mt-0.5 text-10px leading-4 text-ink-faint">
                    设置保存在本机，仅作用于发票台账导出。
                  </p>
                </div>
                <span v-if="styleSaved" class="chip-ok shrink-0" role="status">已保存</span>
              </div>

              <p v-if="styleLoading" class="px-4 pt-3 text-11px text-ink-soft" role="status">
                正在载入默认样式…
              </p>
              <fieldset
                :disabled="styleLoading"
                :aria-busy="styleLoading"
                class="m-0 max-h-[620px] min-w-0 overflow-y-auto border-0 p-4"
              >
                <section class="border-b border-line pb-4">
                  <h3 class="mb-2 text-11px font-800 text-ink">
                    版式与行高
                  </h3>
                  <div class="grid grid-cols-2 gap-2">
                    <label class="text-10px text-ink-soft">冻结行数<input v-model.number="draft.freezeRows" type="number" min="0" max="20" class="field-input mt-1 w-full text-11px"></label>
                    <label class="text-10px text-ink-soft">标题行高<input v-model.number="draft.titleRowHeight" type="number" min="1" class="field-input mt-1 w-full text-11px"></label>
                    <label class="text-10px text-ink-soft">表头行高<input v-model.number="draft.headerRowHeight" type="number" min="1" class="field-input mt-1 w-full text-11px"></label>
                    <label class="text-10px text-ink-soft">数据行高<input v-model.number="draft.dataRowHeight" type="number" min="1" class="field-input mt-1 w-full text-11px"></label>
                    <label class="text-10px text-ink-soft">合计行高<input v-model.number="draft.totalRowHeight" type="number" min="1" class="field-input mt-1 w-full text-11px"></label>
                  </div>
                </section>

                <section class="border-b border-line py-4">
                  <h3 class="mb-2 text-11px font-800 text-ink">
                    字体
                  </h3>
                  <div class="grid gap-2">
                    <div v-for="fontDefinition in fontDefinitions" :key="fontDefinition.key" class="grid grid-cols-[54px_minmax(0,1fr)_58px] items-center gap-1.5">
                      <span class="text-10px text-ink-soft">{{ fontDefinition.label }}</span>
                      <input v-model="draft[fontDefinition.key].name" class="field-input min-w-0 text-11px" :aria-label="`${fontDefinition.label}字体`">
                      <input v-model.number="draft[fontDefinition.key].sz" type="number" min="8" max="72" class="field-input min-w-0 text-11px" :aria-label="`${fontDefinition.label}字号`">
                      <label class="col-span-2 ml-[55px] inline-flex items-center gap-1 text-10px text-ink-soft"><input v-model="draft[fontDefinition.key].bold" type="checkbox" class="accent-brand">粗体</label>
                      <label class="inline-flex items-center gap-1 text-10px text-ink-soft"><input v-model="draft[fontDefinition.key].italic" type="checkbox" class="accent-brand">斜体</label>
                      <input v-model="draft[fontDefinition.key].color" class="field-input col-span-2 ml-[55px] text-11px" placeholder="颜色，如 FF000000" :aria-label="`${fontDefinition.label}颜色`">
                    </div>
                  </div>
                </section>

                <section class="border-b border-line py-4">
                  <h3 class="mb-2 text-11px font-800 text-ink">
                    列宽（Excel 字符宽度）
                  </h3>
                  <div class="grid gap-1.5">
                    <label v-for="column in columnDefinitions" :key="column.key" class="grid grid-cols-[minmax(0,1fr)_70px] items-center gap-2 text-10px text-ink-soft">
                      <span>{{ column.label }}</span>
                      <input v-model.number="draft.columnWidths[column.key]" type="number" min="4" max="100" class="field-input text-right text-11px">
                    </label>
                  </div>
                </section>

                <section class="border-b border-line py-4">
                  <h3 class="mb-2 text-11px font-800 text-ink">
                    边框
                  </h3>
                  <div class="grid grid-cols-2 gap-2">
                    <label v-for="borderDefinition in borderDefinitions" :key="borderDefinition.key" class="text-10px text-ink-soft">{{ borderDefinition.label }}<select v-model="draft.border[borderDefinition.key].style" class="field-input mt-1 w-full text-11px"><option v-for="option in borderStyles" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                  </div>
                  <label class="mt-2 block text-10px text-ink-soft">边框颜色<input v-model="draft.border.bottom.color" class="field-input mt-1 w-full text-11px" placeholder="如 FF000000"></label>
                </section>

                <section class="border-b border-line py-4">
                  <h3 class="mb-2 text-11px font-800 text-ink">
                    格式与合并
                  </h3>
                  <div class="grid gap-2">
                    <label class="text-10px text-ink-soft">日期格式<select v-model="draft.dateFormat" class="field-input mt-1 w-full text-11px"><option value="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;;@">2026年8月11日</option><option value="yyyy-mm-dd">2026-08-11</option><option value="yyyy/mm/dd">2026/08/11</option></select></label>
                    <label class="text-10px text-ink-soft">金额格式<select v-model="draft.moneyFormat" class="field-input mt-1 w-full text-11px"><option value="0.00_);[Red]\\(0.00\\)">1,234.56（负数红色）</option><option value="#,##0.00">1,234.56</option><option value="0.00">1234.56</option></select></label>
                    <label class="text-10px text-ink-soft">文本格式<input v-model="draft.textFormat" class="field-input mt-1 w-full text-11px" placeholder="如 @ 或 @ &quot;文本&quot;"></label>
                    <label class="inline-flex items-center gap-2 text-11px text-ink-soft"><input v-model="draft.mergeTitle" type="checkbox" class="accent-brand">合并标题行</label>
                    <label class="inline-flex items-center gap-2 text-11px text-ink-soft"><input v-model="draft.mergeRepeatedValues" type="checkbox" class="accent-brand">合并连续相同的供应商和归属项目</label>
                  </div>
                </section>

                <div class="mt-4 flex flex-wrap items-center gap-2">
                  <button type="button" class="btn-secondary text-11px" @click="restoreDefaultStyle">
                    恢复默认
                  </button>
                  <button type="button" class="btn-secondary text-11px" :disabled="styleSaving" @click="saveDefaultStyle">
                    {{ styleSaving ? '正在保存…' : '保存为台账默认样式' }}
                  </button>
                </div>
                <p v-if="styleSaveError" class="mt-2 text-11px text-danger" role="alert">
                  {{ styleSaveError }}
                </p>
              </fieldset>
            </aside>
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p class="text-11px text-ink-faint">
            导出文件会包含当前设置、标题带、格式、合并单元格和合计行。
          </p>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-ghost" :disabled="saving" @click="open = false">
              取消
            </button>
            <button type="button" class="btn-primary" :disabled="saving || styleLoading || !rows.length" @click="confirmExport">
              <span v-if="saving" class="i-lucide-loader-circle mr-1 animate-spin" aria-hidden="true" />
              {{ saving ? '正在保存…' : '确认导出' }}
            </button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
