<script setup lang="ts">
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { centralInvoiceSourceLabel } from '~/lib/invoice/central-source-label'

defineProps<{
  records: readonly CentralInvoiceRecord[]
  checked: readonly string[]
  busy?: boolean
  projectLabel: (record: CentralInvoiceRecord) => string
}>()
const emit = defineEmits<{ selection: [id: string, selected: boolean], open: [id: string], discard: [id: string] }>()
</script>

<template>
  <div class="invoice-card-grid p-3" aria-label="发票卡片">
    <article v-for="record in records" :key="record.id" class="invoice-card min-w-0 rounded border border-line bg-surface-2 p-3 text-sm">
      <div class="flex items-start justify-between gap-3">
        <label class="flex min-w-0 items-center gap-2">
          <input type="checkbox" :checked="checked.includes(record.id)" :disabled="busy" :aria-label="`选择发票 ${record.fields.invoiceNumber || record.id}`" @change="emit('selection', record.id, ($event.target as HTMLInputElement).checked)">
          <span class="text-ink-soft">选择</span>
        </label>
        <span class="text-ink-soft">字段预览，非原件</span>
      </div>
      <dl class="mt-3 grid gap-2">
        <div>
          <dt class="text-ink-soft">
            {{ '发票号码' }}
          </dt><dd>
            <button type="button" class="text-left text-brand" @click="emit('open', record.id)">
              {{ record.fields.invoiceNumber || '未填写' }}
            </button>
          </dd>
        </div>
        <div>
          <dt class="text-ink-soft">
            {{ '日期' }}
          </dt><dd>{{ record.fields.invoiceDate || '未填写' }}</dd>
        </div>
        <div>
          <dt class="text-ink-soft">
            {{ '购买方' }}
          </dt><dd>{{ record.fields.buyer || '未填写' }}</dd>
        </div>
        <div>
          <dt class="text-ink-soft">
            {{ '销售方' }}
          </dt><dd>{{ record.fields.seller || '未填写' }}</dd>
        </div>
        <div>
          <dt class="text-ink-soft">
            {{ '价税合计' }}
          </dt><dd>{{ record.fields.totalAmount === null ? '未填写' : record.fields.totalAmount.toFixed(2) }}</dd>
        </div>
        <div>
          <dt class="text-ink-soft">
            {{ '归属' }}
          </dt><dd>{{ projectLabel(record) }}</dd>
        </div>
        <div>
          <dt class="text-ink-soft">
            {{ '来源' }}
          </dt><dd>{{ centralInvoiceSourceLabel(record) }}</dd>
        </div>
        <div>
          <dt class="text-ink-soft">
            {{ '打印' }}
          </dt><dd>{{ record.printCount ? `已打印 ${record.printCount} 次` : '未打印' }}</dd>
          <dd v-if="record.sourceKind === 'excel'" class="text-ink-soft">{{ record.originalVerificationId ? '原件已核验' : '原件待核验' }}</dd>
        </div>
      </dl>
      <div class="mt-3 flex flex-wrap gap-3">
        <NuxtLink v-if="!busy && record.sourceKind === 'excel'" :to="{ path: '/finance/invoice/manual-new', query: { invoice: record.id } }" :aria-label="`核验原件 ${record.fields.invoiceNumber || record.id}`" class="text-brand underline">
          核验原件
        </NuxtLink>
        <NuxtLink v-if="!busy" :to="`/finance/invoice/correction/${encodeURIComponent(record.id)}`" :aria-label="`更正发票 ${record.fields.invoiceNumber || record.id}`" class="text-brand underline">
          {{ '更正' }}
        </NuxtLink>
        <button type="button" :disabled="busy" class="text-danger" @click="emit('discard', record.id)">
          {{ '删除' }}
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.invoice-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: 0.75rem;
}

.invoice-card {
  overflow-wrap: anywhere;
}
</style>
