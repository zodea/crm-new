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
  if (totalFen == null || !Number.isFinite(taxRate) || totalFen < 0 || taxRate < 0) {
    error.value = '请输入有效的含税金额和税率'
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
  <section class="border-t border-line p-4" style="background-color: var(--surface-2)">
    <div class="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[190px_minmax(220px,1fr)_104px_190px]">
      <div class="self-center">
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
          v-model.number="rate"
          type="number"
          min="0"
          step="0.01"
          class="field-input w-full font-mono"
          placeholder="13"
        >
      </div>
      <button type="button" class="btn-primary h-[34px] w-full whitespace-nowrap active:translate-y-px" @click="calculateTax">
        计算税额和不含税金额
      </button>
    </div>

    <p v-if="error" class="mt-3 text-12px text-danger" role="alert">
      {{ error }}
    </p>

    <div v-if="result" class="mt-3 grid gap-x-5 gap-y-2 border-t border-line pt-3 text-12px md:grid-cols-2 xl:grid-cols-3">
      <div class="min-w-0">
        <span class="text-ink-faint">不含税金额：</span>
        <button class="border-0 bg-transparent p-0 font-mono font-700 text-brand hover:underline" @click="copyMoney(result.noTaxFen)">
          {{ formatMoneyFromFen(result.noTaxFen) }}
        </button>
        <span class="text-ink-faint"> 元 ｜ </span>
        <button class="border-0 bg-transparent p-0 text-brand hover:underline" @click="emit('copy', chineseFromFen(result.noTaxFen))">
          {{ chineseFromFen(result.noTaxFen) }}
        </button>
      </div>
      <div class="min-w-0">
        <span class="text-ink-faint">税额：</span>
        <button class="border-0 bg-transparent p-0 font-mono font-700 text-brand hover:underline" @click="copyMoney(result.taxFen)">
          {{ formatMoneyFromFen(result.taxFen) }}
        </button>
        <span class="text-ink-faint"> 元 ｜ </span>
        <button class="border-0 bg-transparent p-0 text-brand hover:underline" @click="emit('copy', chineseFromFen(result.taxFen))">
          {{ chineseFromFen(result.taxFen) }}
        </button>
      </div>
      <div class="min-w-0">
        <span class="text-ink-faint">含税金额大写：</span>
        <button class="border-0 bg-transparent p-0 text-brand hover:underline" @click="emit('copy', chineseFromFen(result.totalFen))">
          {{ chineseFromFen(result.totalFen) }}
        </button>
      </div>
      <div class="font-mono text-10px text-ink-faint md:col-span-2 xl:col-span-3">
        校验：{{ formatMoneyFromFen(result.noTaxFen) }} + {{ formatMoneyFromFen(result.taxFen) }} = {{ formatMoneyFromFen(result.totalFen) }}
      </div>
    </div>
  </section>
</template>
