<script setup lang="ts">
import type {
  InvoiceBorderStyle,
  InvoiceFontStyle,
  InvoiceLedgerExportRow,
  InvoiceXlsxStyleConfig,
  InvoiceResolvedStyleConfig as StyleDraft,
} from '~/lib/invoice/excel'
import { ref, watch } from 'vue'
import InvoiceBorderSettings from '~/components/invoice/InvoiceBorderSettings.vue'
import InvoiceExportTable from '~/components/invoice/InvoiceExportTable.vue'
import { Button } from '~/components/ui/button'
import {
  INVOICE_LEDGER_EXPORT_COLUMNS as columnDefinitions,
  createDefaultInvoiceXlsxStyleConfig,
  DATE_FORMAT,
  MONEY_FORMAT,
  normalizeInvoiceXlsxStyleConfig,
} from '~/lib/invoice/excel'
import { resolveInvoiceBorder } from '~/lib/invoice/xlsx-border'
import { yuan } from '~/lib/util/money'
import { useInvoiceStore } from '~/stores/invoice'

defineProps<{
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
type FontKey = 'titleFont' | 'headerFont' | 'dataFont' | 'totalFont'
type ColumnKey = keyof InvoiceLedgerExportRow

const styleSaved = ref(false)
const styleLoading = ref(false)
const styleSaving = ref(false)
const styleSaveError = ref('')

const fontDefinitions: readonly { key: FontKey, label: string }[] = [
  { key: 'titleFont', label: '标题带' },
  { key: 'headerFont', label: '表头' },
  { key: 'dataFont', label: '数据行' },
  { key: 'totalFont', label: '合计行' },
]

const moneyFormats = [
  { value: MONEY_FORMAT, label: '1234.56（负数红色括号）' },
  { value: '#,##0.00', label: '1,234.56' },
  { value: '0.00', label: '1234.56' },
]

function toDraft(config: InvoiceXlsxStyleConfig): StyleDraft {
  const defaults = createDefaultInvoiceXlsxStyleConfig()
  const border = resolveInvoiceBorder(config.border, defaults.border as InvoiceBorderStyle)
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
    border,
    headerBorder: resolveInvoiceBorder(config.headerBorder, border),
    dataBorder: resolveInvoiceBorder(config.dataBorder, border),
  }
}

function toConfig(draft: StyleDraft): InvoiceXlsxStyleConfig {
  return normalizeInvoiceXlsxStyleConfig({
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
    headerBorder: draft.headerBorder,
    dataBorder: draft.dataBorder,
  })
}

const draft = ref<StyleDraft>(toDraft(invoiceStore.invoiceExportStyle))
watch(draft, () => {
  styleSaved.value = false
}, { deep: true })
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

async function saveDefaultStyle() {
  const config = validatedConfig()
  if (!config)
    return
  styleSaving.value = true
  styleSaveError.value = ''
  try {
    await invoiceStore.saveInvoiceExportStyle(config)
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
  styleSaveError.value = ''
}

function validatedConfig() {
  styleSaveError.value = ''
  try {
    return toConfig(draft.value)
  }
  catch (cause) {
    styleSaveError.value = cause instanceof Error ? cause.message : '请检查边框线型与颜色。'
    return null
  }
}

function confirmExport() {
  const config = validatedConfig()
  if (config)
    emit('confirm', config)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="w-[min(1380px,calc(100vw-24px))] p-0"
      :show-close="!saving && !styleSaving"
      @escape-key-down="(saving || styleSaving) && $event.preventDefault()"
      @interact-outside="(saving || styleSaving) && $event.preventDefault()"
    >
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
            <InvoiceExportTable :rows="rows" :total-amount="totalAmount" :style-config="draft" />

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
                :disabled="styleLoading || styleSaving"
                :aria-busy="styleLoading || styleSaving"
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
                  <InvoiceBorderSettings v-model="draft.headerBorder" label="表头" />
                  <InvoiceBorderSettings v-model="draft.dataBorder" label="数据行" class="mt-4" />
                  <p class="mt-2 text-10px leading-4 text-ink-faint">
                    每边可单独填写颜色，如 #336699 或 FF336699；留空使用黑色。标题和合计沿用原边框。
                  </p>
                </section>

                <section class="border-b border-line py-4">
                  <h3 class="mb-2 text-11px font-800 text-ink">
                    格式与合并
                  </h3>
                  <div class="grid gap-2">
                    <label class="text-10px text-ink-soft">日期格式<select v-model="draft.dateFormat" class="field-input mt-1 w-full text-11px"><option value="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;;@">2026年8月11日</option><option value="yyyy-mm-dd">2026-08-11</option><option value="yyyy/mm/dd">2026/08/11</option></select></label>
                    <label class="text-10px text-ink-soft">金额格式<select v-model="draft.moneyFormat" class="field-input mt-1 w-full text-11px"><option v-if="!moneyFormats.some(option => option.value === draft.moneyFormat)" :value="draft.moneyFormat">自定义（{{ draft.moneyFormat }}）</option><option v-for="option in moneyFormats" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
                    <label class="text-10px text-ink-soft">文本格式<input v-model="draft.textFormat" class="field-input mt-1 w-full text-11px" placeholder="如 @ 或 @ &quot;文本&quot;"></label>
                    <label class="inline-flex items-center gap-2 text-11px text-ink-soft"><input v-model="draft.mergeTitle" type="checkbox" class="accent-brand">合并标题行</label>
                    <label class="inline-flex items-center gap-2 text-11px text-ink-soft"><input v-model="draft.mergeRepeatedValues" type="checkbox" class="accent-brand">合并连续相同的供应商和归属项目</label>
                  </div>
                </section>

                <div class="mt-4 flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" :disabled="styleSaving" @click="restoreDefaultStyle">
                    恢复默认
                  </Button>
                  <Button type="button" size="sm" :disabled="styleSaving" @click="saveDefaultStyle">
                    {{ styleSaving ? '正在保存…' : '保存为台账默认样式' }}
                  </Button>
                </div>
              </fieldset>
            </aside>
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p v-if="styleSaveError" class="w-full text-11px text-danger" role="alert">
            {{ styleSaveError }}
          </p>
          <p class="text-11px text-ink-faint">
            导出文件会包含当前设置、标题带、格式、合并单元格和合计行。
          </p>
          <div class="flex items-center gap-2">
            <Button type="button" variant="ghost" :disabled="saving || styleSaving" @click="open = false">
              取消
            </Button>
            <Button type="button" variant="primary" :disabled="saving || styleLoading || styleSaving || !rows.length" @click="confirmExport">
              <span v-if="saving" class="i-lucide-loader-circle mr-1 animate-spin" aria-hidden="true" />
              {{ saving ? '正在保存…' : '确认导出' }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
