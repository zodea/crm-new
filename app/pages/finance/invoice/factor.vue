<script setup lang="ts">
const {
  calculating,
  cancelCalculation,
  calculate,
  copyText,
  excludeFactor,
  includeFactor,
  runningElapsedMs,
  showCalculationMask,
  solverResult,
  resultTarget,
  state,
  summary,
} = useFactorSolver()
</script>

<template>
  <div data-testid="factor-workbench" class="relative min-w-0 flex flex-col gap-4 lg:h-full lg:min-h-0">
    <h1 class="sr-only">
      开票因子与税额计算
    </h1>
    <FactorTaxCalculator v-model="state.target" @copy="copyText" />
    <div class="grid min-w-0 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[330px_minmax(0,1fr)]">
      <FactorSolverConfig :factors="state.factors" @update:factors="state.factors = $event">
        <template #controls>
          <div class="grid grid-cols-2 gap-2">
            <div class="min-w-0">
              <label for="factor-include" class="field-label block">必须包含因子</label>
              <input id="factor-include" v-model.number="includeFactor" type="number" step="any" class="field-input w-full font-mono" placeholder="例如 960">
            </div>
            <div class="min-w-0">
              <label for="factor-exclude" class="field-label block">排除因子</label>
              <input id="factor-exclude" v-model.number="excludeFactor" type="number" step="any" class="field-input w-full font-mono" placeholder="例如 640">
            </div>
          </div>
          <div class="mt-3">
            <label for="factor-max-results" class="field-label block">返回解数量（上限 5,000）</label>
            <input id="factor-max-results" v-model.number="state.maxResults" type="number" min="1" max="5000" class="field-input w-full font-mono" placeholder="默认 100">
          </div>
          <div class="mt-3 flex items-center justify-between gap-2 text-11px text-ink-faint">
            <span>以顶部含税金额为求解目标</span>
            <ContextHelp label="因子求解" text="最大数量留空表示不限；小数数量只生成乘积恰为整分的组合。已计算后，包含或排除条件变化会自动重算；金额或单价修改后点击开始计算。" />
          </div>
          <KitButton type="button" variant="primary" class="mt-3 w-full" :disabled="calculating || state.factors.length === 0" data-testid="factor-calculate" @click="calculate">
            <span :class="showCalculationMask ? 'i-lucide-hourglass' : 'i-lucide-calculator'" class="mr-1.5 text-14px" />
            {{ showCalculationMask ? '计算中' : '开始计算' }}
          </KitButton>
        </template>
      </FactorSolverConfig>
      <FactorSolverResults :result="solverResult" :target="resultTarget" :summary="summary" @copy="copyText" />
    </div>
    <Transition enter-active-class="animate-in fade-in-0" leave-active-class="animate-out fade-out-0">
      <div v-if="showCalculationMask" class="fixed inset-0 z-50 grid place-items-center bg-[rgb(255_255_255/88%)] backdrop-blur-[2px]" role="status" aria-live="polite">
        <div class="w-64 rounded-[var(--radius-card)] border border-line bg-panel p-6 text-center shadow-[var(--shadow-dialog)]">
          <span class="i-lucide-hourglass text-28px text-brand" />
          <div class="mt-2 text-14px font-700 text-ink">
            计算中…
          </div>
          <div class="mt-1 font-mono text-12px text-ink-faint">
            {{ runningElapsedMs }} ms
          </div>
          <KitButton type="button" class="mt-4 px-6" @click="cancelCalculation">
            取消
          </KitButton>
        </div>
      </div>
    </Transition>
  </div>
</template>
