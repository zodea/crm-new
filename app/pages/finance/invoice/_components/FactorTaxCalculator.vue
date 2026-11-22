<script setup lang="ts">
import type { NumericDraft } from '~/types/finance-factor'
import { computed, shallowRef } from 'vue'
import { yuanToFen } from '~/lib/finance/factor-combination'
import { moneyToChinese } from '~/lib/util/chinese-amount'

const emit = defineEmits<{ copy: [text: string] }>()
const total = defineModel<NumericDraft>({ required: true })
const rate = shallowRef<number | null>(13)

const calculation = computed(() => {
  if (!Number.isInteger(rate.value) || rate.value == null || rate.value < 1 || rate.value > 13)
    return { result: null, error: '税率请输入 1-13 的正整数' }
  if (total.value === '' || total.value == null)
    return { result: null, error: '' }
  const totalFen = yuanToFen(total.value)
  if (totalFen == null || totalFen < 0)
    return { result: null, error: '请输入有效的含税金额' }
  const noTaxFen = Math.round(totalFen / (1 + rate.value / 100))
  return { result: { totalFen, noTaxFen, taxFen: totalFen - noTaxFen }, error: '' }
})

const cells = computed(() => {
  const result = calculation.value.result
  const money = (label: string, fen: number | undefined) => ({
    label,
    raw: fen == null ? '' : (fen / 100).toFixed(2),
    display: fen == null ? '—' : (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  })
  const uppercase = result ? moneyToChinese(result.totalFen / 100) : ''
  return [
    money('价税合计', result?.totalFen),
    money('不含税金额', result?.noTaxFen),
    money('税额', result?.taxFen),
    { label: '大写', raw: uppercase, display: uppercase || '—' },
  ]
})

function updateTaxRate(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  if (input.value === '') {
    rate.value = null
    return
  }
  if (!Number.isInteger(input.valueAsNumber)) {
    input.value = rate.value == null ? '' : String(rate.value)
    return
  }
  rate.value = Math.min(13, Math.max(1, input.valueAsNumber))
  input.value = String(rate.value)
}
</script>

<template>
  <section data-testid="factor-tax-panel" class="rounded-[var(--radius-card)] border border-line bg-panel p-3">
    <div class="grid items-center gap-y-3 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div class="grid grid-cols-[auto_minmax(0,1fr)_86px] items-center gap-2 lg:pr-3">
        <h2 class="text-13px font-800 text-ink">
          税额计算
        </h2>
        <div class="min-w-0">
          <label for="factor-target" class="sr-only">含税金额</label>
          <input
            id="factor-target" v-model.number="total" type="number" min="0" step="0.01"
            class="field-input w-full font-mono font-700 tabular-nums" placeholder="含税金额" title="同时作为组合求解目标"
          >
        </div>
        <div class="min-w-0 flex items-center gap-1">
          <label for="factor-tax-rate" class="shrink-0 text-11px text-ink-soft">税率%</label>
          <input
            id="factor-tax-rate" :value="rate ?? ''" type="number" min="1" max="13" step="1" inputmode="numeric"
            class="field-input min-w-0 w-full text-center font-mono !px-1" placeholder="13" title="税率（%）" @input="updateTaxRate"
          >
        </div>
      </div>
      <div data-testid="tax-result-grid" class="grid grid-cols-2 sm:grid-cols-4">
        <button
          v-for="cell in cells" :key="cell.label" type="button" data-testid="tax-result-item"
          class="min-w-0 border-0 border-l border-line bg-transparent px-3 py-1.5 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default"
          :aria-label="`复制${cell.label}`" :title="cell.raw ? `点击复制：${cell.raw}` : '输入有效金额后可复制'"
          :disabled="!calculation.result" @click="emit('copy', cell.raw)"
        >
          <span class="block text-11px text-ink-faint">{{ cell.label }}</span>
          <span
            class="mt-1 block font-700 text-ink [overflow-wrap:anywhere]"
            :class="cell.label === '大写' ? 'text-12px leading-5' : 'font-mono text-14px tabular-nums'"
          >{{ cell.display }}</span>
        </button>
      </div>
    </div>
    <p v-if="calculation.error" class="mt-2 text-12px text-danger" role="alert">
      {{ calculation.error }}
    </p>
  </section>
</template>
