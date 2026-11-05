<script setup lang="ts">
// 发票示意图 —— 复刻设计稿 InvoiceShared.jsx invoiceSvg：无真实扫描件时的占位票面
// （台账卡片视图预览 / 打印排版共用；编辑页与工作台不用它冒充原件）。纯展示，仅消费 Invoice 字段。
import type { InvoicePrintViewModel } from '~/lib/invoice/print-layout'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  invoice: Pick<InvoicePrintViewModel, 'invoiceType' | 'invoiceNumber' | 'buyer' | 'seller' | 'totalAmount' | 'remark'>
}>()

const title = computed(() => props.invoice.invoiceType || '增值税发票')
const buyerShort = computed(() => (props.invoice.buyer || '').slice(0, 16))
const sellerShort = computed(() => (props.invoice.seller || '').slice(0, 16))
</script>

<template>
  <svg
    viewBox="0 0 440 300"
    class="w-full [filter:drop-shadow(0_2px_6px_rgba(31,35,41,0.10))]"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="`发票示意图 ${invoice.invoiceNumber}`"
  >
    <rect x="4" y="4" width="432" height="292" rx="8" fill="#fff" stroke="var(--line-strong)" />
    <text x="220" y="40" text-anchor="middle" style="font-size: 17px; letter-spacing: 8px" font-weight="800" fill="var(--ink-faint)">{{ title }}</text>
    <text x="416" y="26" text-anchor="end" style="font-size: 9px" fill="var(--ink-faint)" font-family="var(--font-mono)">No.{{ invoice.invoiceNumber || '————' }}</text>
    <rect x="24" y="60" width="188" height="46" rx="4" fill="var(--surface-3)" />
    <rect x="228" y="60" width="188" height="46" rx="4" fill="var(--surface-3)" />
    <text x="34" y="79" style="font-size: 9px" fill="var(--ink-faint)">购买方</text>
    <text x="34" y="96" style="font-size: 8px" fill="var(--ink-soft)">{{ buyerShort }}</text>
    <text x="238" y="79" style="font-size: 9px" fill="var(--ink-faint)">销售方</text>
    <text x="238" y="96" style="font-size: 8px" fill="var(--ink-soft)">{{ sellerShort }}</text>
    <rect x="24" y="120" width="392" height="96" fill="none" stroke="var(--line)" />
    <line x1="24" y1="142" x2="416" y2="142" stroke="var(--line)" />
    <text x="34" y="236" style="font-size: 10px" fill="var(--ink-faint)">价税合计</text>
    <text x="406" y="236" text-anchor="end" style="font-size: 12px" font-weight="700" font-family="var(--font-mono)" fill="var(--ink-soft)">{{ yuan(invoice.totalAmount) }}</text>
    <text x="34" y="262" style="font-size: 9px" fill="var(--ink-faint)">备注：{{ invoice.remark || '—' }}</text>
    <g transform="rotate(-12 372 250)">
      <circle cx="372" cy="250" r="28" fill="none" stroke="rgba(220,38,38,0.4)" stroke-width="1.5" />
      <text x="372" y="254" text-anchor="middle" style="font-size: 8px" fill="rgba(220,38,38,0.55)" font-weight="700">发票专用章</text>
    </g>
  </svg>
</template>
