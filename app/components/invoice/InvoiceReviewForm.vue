<script setup lang="ts">
import type { Invoice } from '~/stores/invoice'

const props = defineProps<{
  invoice: Invoice
}>()

const emit = defineEmits<{
  confirm: []
}>()

const store = useInvoiceStore()

function update(field: keyof Invoice, value: unknown) {
  store.updateField(props.invoice.id, field, value)
}
</script>

<template>
  <div class="space-y-3">
    <div class="grid grid-cols-2 gap-x-3 gap-y-2.5">
      <div>
        <label class="field-label">单据编号</label>
        <input
          :value="invoice.invoiceNumber"
          class="field-input w-full font-mono"
          @change="update('invoiceNumber', ($event.target as HTMLInputElement).value)"
        >
      </div>
      <div>
        <label class="field-label">开票日期</label>
        <input
          :value="invoice.invoiceDate"
          type="date"
          class="field-input w-full font-mono"
          @change="update('invoiceDate', ($event.target as HTMLInputElement).value)"
        >
      </div>
      <div>
        <label class="field-label">购买方</label>
        <input
          :value="invoice.buyer"
          class="field-input w-full"
          @change="update('buyer', ($event.target as HTMLInputElement).value)"
        >
      </div>
      <div>
        <label class="field-label">供应商</label>
        <input
          :value="invoice.seller"
          class="field-input w-full"
          @change="update('seller', ($event.target as HTMLInputElement).value)"
        >
      </div>
      <div>
        <label class="field-label">票据类型</label>
        <select
          :value="invoice.invoiceType"
          class="field-input w-full"
          @change="update('invoiceType', ($event.target as HTMLSelectElement).value)"
        >
          <option value="增值税专用发票">增值税专用发票</option>
          <option value="增值税普通发票">增值税普通发票</option>
        </select>
      </div>
      <div>
        <label class="field-label">价税合计</label>
        <input
          :value="invoice.totalAmount"
          type="number"
          class="field-input w-full font-mono"
          @change="update('totalAmount', Number(($event.target as HTMLInputElement).value))"
        >
      </div>
    </div>

    <div>
      <label class="field-label">对应项目</label>
      <input
        :value="invoice.projectName"
        class="field-input w-full"
        @change="update('projectName', ($event.target as HTMLInputElement).value)"
      >
    </div>

    <div class="grid grid-cols-2 gap-x-3 gap-y-2.5">
      <div>
        <label class="field-label">税额</label>
        <input
          :value="invoice.taxAmount"
          type="number"
          class="field-input w-full font-mono"
          @change="update('taxAmount', Number(($event.target as HTMLInputElement).value))"
        >
      </div>
      <div>
        <label class="field-label">税率</label>
        <input
          :value="invoice.taxRate"
          class="field-input w-full font-mono"
          @change="update('taxRate', ($event.target as HTMLInputElement).value)"
        >
      </div>
    </div>

    <div>
      <label class="field-label">票面备注</label>
      <input
        :value="invoice.remark"
        class="field-input w-full"
        @change="update('remark', ($event.target as HTMLInputElement).value)"
      >
    </div>

    <!-- OCR 置信度 -->
    <div v-if="invoice.ocrConfidence != null" class="text-11px text-ink-faint">
      OCR 置信度: {{ (invoice.ocrConfidence * 100).toFixed(1) }}%
    </div>

    <!-- 操作按钮 -->
    <div class="flex items-center justify-between pt-3 border-t border-line">
      <button class="btn-danger text-12px">
        <span class="i-lucide-trash-2 text-12px mr-1" /> 废弃
      </button>
      <div class="flex gap-2">
        <button class="btn-secondary text-12px" disabled>
          <span class="i-lucide-refresh-cw text-12px mr-1" /> 重新识别
        </button>
        <button class="btn-primary text-12px" @click="emit('confirm')">
          <span class="i-lucide-file-check text-12px mr-1" /> 确认并入账
        </button>
      </div>
    </div>
  </div>
</template>
