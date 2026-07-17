<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { DeliveryAmountSummary } from '~/lib/delivery/review'
import type { DeliveryItem } from '~/stores/delivery'
import { yuan } from '~/lib/util/money'

type ItemTextPatch = Partial<Pick<DeliveryItem, 'name' | 'spec' | 'unit' | 'note'>>

const props = defineProps<{
  items: readonly DeepReadonly<DeliveryItem>[]
  summary: DeliveryAmountSummary
}>()

const emit = defineEmits<{
  add: []
  remove: [index: number]
  patch: [index: number, patch: ItemTextPatch]
  editAmount: [index: number, field: 'qty' | 'unitPrice' | 'amount', value: number]
}>()

function textValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function numberValue(event: Event): number {
  const value = Number((event.target as HTMLInputElement).value)
  return Number.isFinite(value) ? value : 0
}

function isMismatch(id: string): boolean {
  return props.summary.mismatchedLineIds.includes(id)
}
</script>

<template>
  <section class="mt-4">
    <div class="mb-2 flex items-center gap-2">
      <span class="text-11px font-800 text-ink">材料明细</span>
      <span class="text-9px text-ink-faint">{{ items.length }} 行 · {{ yuan(summary.total) }}</span>
      <span v-if="summary.mismatchedLineIds.length" class="chip-danger text-8px">
        {{ summary.mismatchedLineIds.length }} 行金额不平
      </span>
      <div class="flex-1" />
      <button type="button" class="btn-secondary px-2 py-1 text-10px" @click="emit('add')">
        <span class="i-lucide-plus mr-1" />添加行
      </button>
    </div>

    <div class="overflow-x-auto rounded-[var(--radius-btn)] border border-line">
      <table class="min-w-[820px] w-full text-10px">
        <thead class="bg-surface-2 text-ink-soft">
          <tr>
            <th class="w-8 px-1 py-1.5 text-center">
              #
            </th>
            <th class="min-w-36 px-1 py-1.5 text-left">
              材料名称
            </th>
            <th class="min-w-25 px-1 py-1.5 text-left">
              规格
            </th>
            <th class="w-16 px-1 py-1.5 text-left">
              单位
            </th>
            <th class="w-20 px-1 py-1.5 text-right">
              数量
            </th>
            <th class="w-22 px-1 py-1.5 text-right">
              单价
            </th>
            <th class="w-25 px-1 py-1.5 text-right">
              金额
            </th>
            <th class="w-9 px-1 py-1.5" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(item, index) in items"
            :key="item.id"
            class="border-t border-line"
            :class="isMismatch(item.id) ? 'bg-danger-soft/55' : item.note ? 'bg-warn-soft/35' : ''"
          >
            <td class="px-1 text-center font-mono text-ink-faint">
              {{ index + 1 }}
            </td>
            <td class="p-0.5">
              <input :value="item.name" class="field-input w-full px-1.5 py-1 text-10px" placeholder="材料名称" @input="emit('patch', index, { name: textValue($event) })">
              <div v-if="item.note" class="mt-0.5 truncate px-1 text-8px text-warn-ink" :title="item.note">
                {{ item.note }}
              </div>
            </td>
            <td class="p-0.5">
              <input :value="item.spec" class="field-input w-full px-1.5 py-1 text-10px" placeholder="规格" @input="emit('patch', index, { spec: textValue($event) })">
            </td>
            <td class="p-0.5">
              <input :value="item.unit" class="field-input w-full px-1.5 py-1 text-10px" placeholder="单位" @input="emit('patch', index, { unit: textValue($event) })">
            </td>
            <td class="p-0.5">
              <input :value="item.qty" type="number" step="0.001" class="field-input w-full px-1.5 py-1 text-right font-mono text-10px" @input="emit('editAmount', index, 'qty', numberValue($event))">
            </td>
            <td class="p-0.5">
              <input :value="item.unitPrice" type="number" step="0.01" class="field-input w-full px-1.5 py-1 text-right font-mono text-10px" @input="emit('editAmount', index, 'unitPrice', numberValue($event))">
            </td>
            <td class="p-0.5">
              <input
                :value="item.amount"
                type="number"
                step="0.01"
                class="field-input w-full px-1.5 py-1 text-right font-mono text-10px"
                :class="isMismatch(item.id) ? 'border-danger text-danger' : ''"
                :title="item.amountSource === 'manual' ? '人工金额，不会被数量/单价覆盖' : item.amountSource === 'ocr' ? 'OCR 票面金额' : '数量×单价自动金额'"
                @input="emit('editAmount', index, 'amount', numberValue($event))"
              >
            </td>
            <td class="px-1 text-center">
              <button type="button" class="icon-btn-danger h-6 w-6" title="删除明细" @click="emit('remove', index)">
                <span class="i-lucide-x text-11px" />
              </button>
            </td>
          </tr>
          <tr v-if="!items.length">
            <td colspan="8" class="px-3 py-6 text-center text-ink-faint">
              未识别到材料明细，请手工添加
            </td>
          </tr>
        </tbody>
        <tfoot class="border-t border-line bg-surface-2">
          <tr>
            <td colspan="6" class="px-2 py-2 text-right font-600 text-ink-soft">
              复核后合计
            </td>
            <td class="px-2 py-2 text-right font-mono text-12px font-800 text-brand-deep">
              {{ yuan(summary.total) }}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>
