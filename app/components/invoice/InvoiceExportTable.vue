<script setup lang="ts">
import type { InvoiceLedgerExportRow, InvoiceResolvedStyleConfig } from '~/lib/invoice/excel'
import { computed } from 'vue'
import { INVOICE_LEDGER_EXPORT_COLUMNS as columnDefinitions } from '~/lib/invoice/excel'
import { invoiceBorderPreviewStyle } from '~/lib/invoice/xlsx-border'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  rows: readonly InvoiceLedgerExportRow[]
  totalAmount: number | null
  styleConfig: InvoiceResolvedStyleConfig
}>()
type FontKey = 'headerFont' | 'dataFont' | 'totalFont'
type ColumnKey = keyof InvoiceLedgerExportRow
const PREVIEW_LIMIT = 200
const visibleRows = computed(() => props.rows.slice(0, PREVIEW_LIMIT))
const hiddenCount = computed(() => Math.max(0, props.rows.length - PREVIEW_LIMIT))

function display(value: string | number): string {
  return value === '' ? '—' : String(value)
}

function fontStyle(key: FontKey) {
  const font = props.styleConfig[key]
  return {
    fontFamily: font.name,
    fontSize: `${Math.max(8, font.sz)}px`,
    fontWeight: font.bold ? '700' : '400',
    fontStyle: font.italic ? 'italic' : 'normal',
    color: font.color ? `#${font.color.replace(/^#/, '').slice(-6)}` : undefined,
  }
}

const headerBorderStyle = computed(() => invoiceBorderPreviewStyle(props.styleConfig.headerBorder))
const dataBorderStyle = computed(() => invoiceBorderPreviewStyle(props.styleConfig.dataBorder))
const totalBorderStyle = computed(() => invoiceBorderPreviewStyle(props.styleConfig.border))

function previewColumnStyle(key: ColumnKey) {
  return { minWidth: `${Math.max(4, props.styleConfig.columnWidths[key]) * 8}px` }
}
function dataColumnStyle(key: ColumnKey) {
  return { ...previewColumnStyle(key), ...dataBorderStyle.value }
}
</script>

<template>
  <section class="min-w-0" aria-label="Excel 数据预览">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-11px text-ink-faint">
      <span>数据预览（实际导出包含全部记录）</span>
      <span>冻结前 {{ styleConfig.freezeRows }} 行 · {{ styleConfig.mergeTitle ? '标题合并' : '标题不合并' }}</span>
    </div>
    <div class="overflow-x-auto border border-line rounded-[var(--radius-card)] bg-panel">
      <table class="min-w-[980px] w-full border-collapse text-12px" data-testid="invoice-export-preview-table">
        <thead class="sticky top-0 z-1 bg-surface-2">
          <tr class="text-left" :style="{ ...fontStyle('headerFont'), height: `${styleConfig.headerRowHeight}px` }">
            <th class="whitespace-nowrap px-3 py-2" :style="headerBorderStyle">
              #
            </th>
            <th v-for="column in columnDefinitions" :key="column.key" class="whitespace-nowrap px-3 py-2" :style="{ ...previewColumnStyle(column.key), ...headerBorderStyle }">
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in visibleRows"
            :key="`${row.invoiceNumber}-${index}`"
            :style="{ ...fontStyle('dataFont'), height: `${styleConfig.dataRowHeight}px` }"
          >
            <td class="px-3 py-2 font-mono tabular-nums" :style="dataBorderStyle">
              {{ index + 1 }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-ink" :style="dataColumnStyle('invoiceDate')">
              {{ display(row.invoiceDate) }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-ink font-mono" :style="dataColumnStyle('invoiceNumber')">
              {{ display(row.invoiceNumber) }}
            </td>
            <td class="max-w-[240px] truncate px-3 py-2 text-ink" :title="row.seller" :style="dataColumnStyle('seller')">
              {{ display(row.seller) }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-ink-soft" :style="dataColumnStyle('invoiceType')">
              {{ display(row.invoiceType) }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-right text-ink font-mono tabular-nums" :style="dataColumnStyle('totalAmount')">
              {{ row.totalAmount === null ? '未填写' : yuan(row.totalAmount) }}
            </td>
            <td class="max-w-[220px] truncate px-3 py-2 text-ink" :title="row.projectName" :style="dataColumnStyle('projectName')">
              {{ display(row.projectName) }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-ink-soft" :style="dataColumnStyle('source')">
              {{ display(row.source) }}
            </td>
            <td class="max-w-[220px] truncate px-3 py-2 text-ink-soft" :title="row.remark" :style="dataColumnStyle('remark')">
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
          <tr class="bg-surface-2" :style="{ ...fontStyle('totalFont'), height: `${styleConfig.totalRowHeight}px` }">
            <td colspan="5" class="px-3 py-2 text-ink" :style="totalBorderStyle">
              合计
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-right text-ink font-mono tabular-nums" :style="totalBorderStyle">
              {{ totalAmount === null ? '未统计' : yuan(totalAmount) }}
            </td>
            <td colspan="3" :style="totalBorderStyle" />
          </tr>
        </tfoot>
      </table>
    </div>
    <p v-if="hiddenCount" class="mt-2 text-11px text-ink-faint">
      预览显示前 {{ PREVIEW_LIMIT }} 条，实际导出仍包含全部 {{ hiddenCount }} 条其余记录。
    </p>
  </section>
</template>
