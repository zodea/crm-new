<script setup lang="ts">
import type { InvoiceLedgerExportRow } from '~/lib/invoice/excel'
import { computed } from 'vue'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  rows: readonly InvoiceLedgerExportRow[]
  totalAmount: number
  fileName: string
  saving: boolean
}>()

const emit = defineEmits<{
  confirm: []
}>()

const open = defineModel<boolean>('open', { required: true })
const PREVIEW_LIMIT = 200
const visibleRows = computed(() => props.rows.slice(0, PREVIEW_LIMIT))
const hiddenCount = computed(() => Math.max(0, props.rows.length - PREVIEW_LIMIT))

function display(value: string | number): string {
  return value === '' ? '—' : String(value)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="w-[min(1180px,calc(100vw-24px))] p-0" :show-close="!saving">
      <div class="flex max-h-[min(820px,calc(100dvh-32px))] flex-col">
        <DialogHeader class="shrink-0 border-b border-line px-5 py-4">
          <DialogTitle>导出 Excel 预览</DialogTitle>
          <DialogDescription>
            这里显示即将写入 Excel 的业务表格，不是效果图；确认后才会保存文件。
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-5 py-3 text-11px text-ink-soft">
          <span class="font-mono text-ink">{{ fileName }}</span>
          <span>共 {{ rows.length }} 条 · 合计 {{ yuan(totalAmount) }}</span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div class="overflow-x-auto border border-line rounded-[var(--radius-card)] bg-panel">
            <table class="min-w-[980px] w-full border-collapse text-12px">
              <thead class="sticky top-0 z-1 bg-surface-2">
                <tr class="border-b border-line text-left text-11px text-ink-soft">
                  <th class="whitespace-nowrap px-3 py-2 font-700">
                    #
                  </th>
                  <th class="whitespace-nowrap px-3 py-2 font-700">
                    发票日期
                  </th>
                  <th class="whitespace-nowrap px-3 py-2 font-700">
                    发票号码
                  </th>
                  <th class="whitespace-nowrap px-3 py-2 font-700">
                    供应商
                  </th>
                  <th class="whitespace-nowrap px-3 py-2 text-right font-700">
                    价税合计
                  </th>
                  <th class="whitespace-nowrap px-3 py-2 font-700">
                    票据类型
                  </th>
                  <th class="whitespace-nowrap px-3 py-2 font-700">
                    归属项目
                  </th>
                  <th class="whitespace-nowrap px-3 py-2 font-700">
                    来源
                  </th>
                  <th class="whitespace-nowrap px-3 py-2 font-700">
                    备注
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in visibleRows" :key="`${row.invoiceNumber}-${index}`" class="border-b border-line last:border-b-0">
                  <td class="px-3 py-2 text-ink-faint font-mono tabular-nums">
                    {{ index + 1 }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-ink">
                    {{ display(row.invoiceDate) }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-ink font-mono">
                    {{ display(row.invoiceNumber) }}
                  </td>
                  <td class="max-w-[240px] truncate px-3 py-2 text-ink" :title="row.seller">
                    {{ display(row.seller) }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-right text-ink font-mono tabular-nums">
                    {{ yuan(row.totalAmount) }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-ink-soft">
                    {{ display(row.invoiceType) }}
                  </td>
                  <td class="max-w-[220px] truncate px-3 py-2 text-ink" :title="row.projectName">
                    {{ display(row.projectName) }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-2 text-ink-soft">
                    {{ display(row.source) }}
                  </td>
                  <td class="max-w-[220px] truncate px-3 py-2 text-ink-soft" :title="row.remark">
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
                <tr class="bg-surface-2 font-700">
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
        </div>

        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p class="text-11px text-ink-faint">
            导出文件会包含标题带、格式、合并单元格和合计行。
          </p>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-ghost" :disabled="saving" @click="open = false">
              取消
            </button>
            <button type="button" class="btn-primary" :disabled="saving || !rows.length" @click="emit('confirm')">
              <span v-if="saving" class="i-lucide-loader-circle mr-1 animate-spin" aria-hidden="true" />
              {{ saving ? '正在保存…' : '确认导出' }}
            </button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
