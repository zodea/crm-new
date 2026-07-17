<script setup lang="ts">
import type { FactorSolutionItem, FactorSolverResult } from '~/lib/finance/factor-combination'
import type { NumericDraft } from '~/types/finance-factor'

interface Props {
  result: FactorSolverResult | null
  summary: string
}

defineProps<Props>()

const emit = defineEmits<{
  copy: [text: string]
}>()

const includeFactor = defineModel<NumericDraft>('includeFactor', { required: true })
const excludeFactor = defineModel<NumericDraft>('excludeFactor', { required: true })

function formatFactor(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(2)))
}

function fenToYuan(fen: number): string {
  return (fen / 100).toFixed(2)
}

function formatPart(item: FactorSolutionItem): string {
  const amount = item.allowDecimal && !Number.isInteger(item.quantity)
    ? `(=${fenToYuan(item.amount)})`
    : ''
  return `${formatFactor(item.factorValue)}×${formatQuantity(item.quantity)}${amount}`
}

function expression(items: FactorSolutionItem[]): string {
  return items.map(formatPart).join(' + ')
}

function totalQuantity(items: FactorSolutionItem[]): string {
  return formatQuantity(items.reduce((total, item) => total + item.quantity, 0))
}
</script>

<template>
  <section class="flex min-w-0 flex-col xl:min-h-0" style="background-color: var(--panel)">
    <div class="shrink-0 border-b border-line p-4">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 class="text-14px font-800 text-ink">
            精确组合结果
          </h2>
          <p class="mt-1 text-11px text-ink-faint">
            筛选条件变化后自动重算，保证展示结果完整准确
          </p>
        </div>
        <span v-if="result?.mode" class="text-11px font-600 text-ink-faint">
          {{ result.mode === 'light' ? '轻量搜索' : '可达性剪枝' }}
        </span>
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        <div>
          <label for="factor-include" class="field-label block">必须包含因子</label>
          <input
            id="factor-include"
            v-model.number="includeFactor"
            type="number"
            step="any"
            class="field-input w-full font-mono"
            placeholder="例如 4"
          >
        </div>
        <div>
          <label for="factor-exclude" class="field-label block">排除因子</label>
          <input
            id="factor-exclude"
            v-model.number="excludeFactor"
            type="number"
            step="any"
            class="field-input w-full font-mono"
            placeholder="例如 2"
          >
        </div>
      </div>

      <div class="mt-3 flex items-center gap-2 rounded-[var(--radius-btn)] bg-surface-2 px-3 py-2 text-12px text-ink-soft" aria-live="polite">
        <span class="i-lucide-info shrink-0 text-13px text-brand" />
        <span>{{ summary }}</span>
      </div>
    </div>

    <div
      v-if="result?.solutions.length"
      data-testid="factor-results-scroll"
      class="max-h-[520px] overflow-auto overscroll-contain xl:min-h-0 xl:flex-1 xl:max-h-none"
    >
      <table class="w-full min-w-[620px] border-collapse text-14px">
        <thead class="sticky top-0 z-1 bg-surface-2">
          <tr class="border-b border-line text-left text-13px text-ink-soft">
            <th class="h-10 w-14 px-1.5 py-0 font-700">
              #
            </th>
            <th class="h-10 px-1.5 py-0 font-700">
              表达式（点击复制）
            </th>
            <th class="h-10 px-1.5 py-0 font-700">
              使用项（单项可点）
            </th>
            <th class="h-10 w-20 px-1.5 py-0 text-right font-700">
              总数
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(solution, index) in result.solutions"
            :key="`${index}-${expression(solution)}`"
            class="border-b border-line transition-colors last:border-b-0 hover:bg-surface-2/70"
          >
            <td class="h-10 px-1.5 py-0 text-ink-faint">
              {{ index + 1 }}
            </td>
            <td class="h-10 px-1.5 py-0">
              <button
                type="button"
                class="border-0 bg-transparent p-0 text-left font-mono font-700 text-brand hover:underline active:scale-97"
                title="复制整条表达式"
                @click="emit('copy', expression(solution))"
              >
                {{ expression(solution) }}
              </button>
            </td>
            <td class="h-10 px-1.5 py-0">
              <div class="flex flex-wrap gap-x-2 gap-y-1">
                <button
                  v-for="item in solution"
                  :key="`${item.factorId}-${item.quantity}`"
                  type="button"
                  class="border-0 bg-transparent p-0 font-mono text-ink-soft hover:text-brand hover:underline active:scale-97"
                  title="复制该使用项"
                  @click="emit('copy', formatPart(item))"
                >
                  {{ formatPart(item) }}
                </button>
              </div>
            </td>
            <td class="h-10 px-1.5 py-0 text-right font-mono font-700 tabular-nums text-ink">
              {{ totalQuantity(solution) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="grid min-h-64 flex-1 place-items-center p-8 text-center">
      <div>
        <span class="i-lucide-sigma text-32px text-ink-faint" />
        <p class="mt-2 text-13px font-600 text-ink-soft">
          暂无组合结果
        </p>
        <p class="mt-1 text-11px text-ink-faint">
          配置目标值和因子后点击“开始计算”
        </p>
      </div>
    </div>
  </section>
</template>
