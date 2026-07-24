<script setup lang="ts">
import { yuanToFen } from '~/lib/finance/factor-combination'
import { moneyToChinese } from '~/lib/util/chinese-amount'

interface TaxResult {
  totalFen: number
  noTaxFen: number
  taxFen: number
}

const emit = defineEmits<{
  copy: [text: string]
}>()

const total = shallowRef<number | null>(null)
const rate = shallowRef<number | null>(13)
const result = shallowRef<TaxResult | null>(null)
const error = shallowRef('')

function calculateTax() {
  const totalFen = total.value == null ? null : yuanToFen(total.value)
  const taxRate = Number(rate.value)
  if (totalFen == null || totalFen < 0) {
    error.value = '请输入有效的含税金额'
    result.value = null
    return
  }
  if (!Number.isInteger(taxRate) || taxRate < 1 || taxRate > 13) {
    error.value = '税率请输入 1-13 的正整数'
    result.value = null
    return
  }

  const noTaxFen = Math.round(totalFen / (1 + taxRate / 100))
  result.value = {
    totalFen,
    noTaxFen,
    taxFen: totalFen - noTaxFen,
  }
  error.value = ''
}

function updateTaxRate(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  if (input.value === '') {
    rate.value = null
    return
  }

  const nextRate = input.valueAsNumber
  if (!Number.isInteger(nextRate)) {
    input.value = rate.value == null ? '' : String(rate.value)
    return
  }

  const constrainedRate = Math.min(13, Math.max(1, nextRate))
  rate.value = constrainedRate
  input.value = String(constrainedRate)
}

function formatMoneyFromFen(fen: number): string {
  return (fen / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function chineseFromFen(fen: number): string {
  return moneyToChinese(fen / 100)
}

function copyMoney(fen: number) {
  emit('copy', (fen / 100).toFixed(2))
}
</script>

<template>
  <section class="border-t border-line" style="background-color: var(--surface-2)">
    <div class="grid xl:grid-cols-[360px_minmax(0,1fr)]">
      <div class="self-center px-4 py-3">
        <div class="flex items-center gap-2">
          <span class="i-lucide-receipt-text text-15px text-brand" />
          <h2 class="text-13px font-800 text-ink">
            税额计算
          </h2>
        </div>
        <p class="mt-1 text-10px text-ink-faint">
          金额按分计算，结果自动勾稽
        </p>
      </div>
      <div class="grid items-end gap-3 border-t border-line px-4 py-3 md:grid-cols-[minmax(220px,1fr)_104px_190px] xl:border-l xl:border-t-0">
        <div>
          <label for="factor-tax-total" class="field-label block">含税合同金额</label>
          <input
            id="factor-tax-total"
            v-model.number="total"
            type="number"
            min="0"
            step="0.01"
            class="field-input w-full font-mono"
            placeholder="597140.00"
          >
        </div>
        <div>
          <label for="factor-tax-rate" class="field-label block">税率（%）</label>
          <input
            id="factor-tax-rate"
            :value="rate ?? ''"
            type="number"
            min="1"
            max="13"
            step="1"
            inputmode="numeric"
            class="field-input w-full font-mono"
            placeholder="13"
            @input="updateTaxRate"
          >
        </div>
        <button type="button" class="btn-primary h-[34px] w-full whitespace-nowrap active:translate-y-px" @click="calculateTax">
          计算税额和不含税金额
        </button>
      </div>
    </div>

    <p v-if="error" class="border-t border-line px-4 py-2 text-12px text-danger" role="alert">
      {{ error }}
    </p>

    <div v-if="result" data-testid="tax-result-grid" class="grid border-t border-line text-12px md:grid-cols-3">
      <div data-testid="tax-result-item" class="min-w-0 px-4 py-3 md:border-r md:border-line">
        <span class="block text-11px font-600 text-ink-faint">不含税金额</span>
        <button type="button" class="mt-1 block max-w-full border-0 bg-transparent p-0 text-left font-mono text-14px font-700 tabular-nums text-brand hover:underline" @click="copyMoney(result.noTaxFen)">
          {{ formatMoneyFromFen(result.noTaxFen) }}
        </button>
        <button type="button" data-testid="tax-uppercase" class="mt-1 block w-full border-0 bg-transparent p-0 text-left leading-5 text-ink-soft [overflow-wrap:anywhere] hover:text-brand hover:underline" @click="emit('copy', chineseFromFen(result.noTaxFen))">
          {{ chineseFromFen(result.noTaxFen) }}
        </button>
      </div>
      <div data-testid="tax-result-item" class="min-w-0 border-t border-line px-4 py-3 md:border-r md:border-t-0">
        <span class="block text-11px font-600 text-ink-faint">税额</span>
        <button type="button" class="mt-1 block max-w-full border-0 bg-transparent p-0 text-left font-mono text-14px font-700 tabular-nums text-brand hover:underline" @click="copyMoney(result.taxFen)">
          {{ formatMoneyFromFen(result.taxFen) }}
        </button>
        <button type="button" data-testid="tax-uppercase" class="mt-1 block w-full border-0 bg-transparent p-0 text-left leading-5 text-ink-soft [overflow-wrap:anywhere] hover:text-brand hover:underline" @click="emit('copy', chineseFromFen(result.taxFen))">
          {{ chineseFromFen(result.taxFen) }}
        </button>
      </div>
      <div data-testid="tax-result-item" class="min-w-0 border-t border-line px-4 py-3 md:border-t-0">
        <span class="block text-11px font-600 text-ink-faint">含税金额</span>
        <button type="button" class="mt-1 block max-w-full border-0 bg-transparent p-0 text-left font-mono text-14px font-700 tabular-nums text-brand hover:underline" @click="copyMoney(result.totalFen)">
          {{ formatMoneyFromFen(result.totalFen) }}
        </button>
        <button type="button" data-testid="tax-uppercase" class="mt-1 block w-full border-0 bg-transparent p-0 text-left leading-5 text-ink-soft [overflow-wrap:anywhere] hover:text-brand hover:underline" @click="emit('copy', chineseFromFen(result.totalFen))">
          {{ chineseFromFen(result.totalFen) }}
        </button>
      </div>
      <div class="border-t border-line px-4 py-2 font-mono text-10px text-ink-faint md:col-span-3">
        校验：{{ formatMoneyFromFen(result.noTaxFen) }} + {{ formatMoneyFromFen(result.taxFen) }} = {{ formatMoneyFromFen(result.totalFen) }}
      </div>
    </div>
  </section>
</template>
