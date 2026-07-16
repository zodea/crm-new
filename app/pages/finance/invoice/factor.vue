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
  state,
  summary,
} = useFactorSolver()
</script>

<template>
  <div data-testid="factor-workbench" class="relative overflow-hidden rounded-[var(--radius-card)] border border-line shadow-[var(--shadow-card)]" style="background-color: var(--panel)">
    <header class="grid items-end gap-3 border-b border-line px-4 py-4 md:grid-cols-2 xl:grid-cols-[minmax(250px,1fr)_minmax(220px,0.85fr)_150px_160px]" style="background-color: var(--panel)">
      <div class="self-center">
        <h1 class="text-16px font-800 text-ink">
          精确加法组合
        </h1>
        <p class="mt-1 max-w-[42ch] text-11px leading-4 text-ink-faint">
          金额按分精确计算，仅返回恰好等于目标值的组合
        </p>
      </div>
      <div>
        <label for="factor-target" class="field-label block">目标值</label>
        <input
          id="factor-target"
          v-model.number="state.target"
          type="number"
          min="0"
          step="any"
          class="field-input w-full font-mono text-16px font-700 tabular-nums"
          placeholder="请输入目标值"
        >
      </div>
      <div>
        <label for="factor-max-results" class="field-label block">返回解数量</label>
        <input
          id="factor-max-results"
          v-model.number="state.maxResults"
          type="number"
          min="1"
          max="5000"
          class="field-input w-full font-mono"
          placeholder="默认 100"
        >
      </div>
      <button
        type="button"
        class="btn-primary h-[34px] w-full whitespace-nowrap text-13px active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="calculating || state.factors.length === 0"
        data-testid="factor-calculate"
        @click="calculate"
      >
        <span :class="calculating ? 'i-lucide-hourglass' : 'i-lucide-calculator'" class="mr-1.5 text-14px" />
        {{ calculating ? '计算中' : '开始计算' }}
      </button>
    </header>

    <div class="grid xl:grid-cols-[390px_minmax(560px,1fr)]" style="background-color: var(--panel)">
      <FactorSolverConfig :factors="state.factors" @update:factors="state.factors = $event" />
      <FactorSolverResults
        v-model:include-factor="includeFactor"
        v-model:exclude-factor="excludeFactor"
        :result="solverResult"
        :summary="summary"
        @copy="copyText"
      />
    </div>

    <FactorTaxCalculator @copy="copyText" />

    <Transition enter-active-class="animate-in fade-in-0" leave-active-class="animate-out fade-out-0">
      <div
        v-if="showCalculationMask"
        class="fixed inset-0 z-50 grid place-items-center bg-[rgb(255_255_255/88%)] backdrop-blur-[2px]"
        role="status"
        aria-live="polite"
      >
        <div class="w-64 rounded-[var(--radius-card)] border border-line bg-panel p-6 text-center shadow-[var(--shadow-dialog)]">
          <span class="i-lucide-hourglass text-28px text-brand" />
          <div class="mt-2 text-14px font-700 text-ink">
            计算中…
          </div>
          <div class="mt-1 font-mono text-12px text-ink-faint">
            {{ runningElapsedMs }} ms
          </div>
          <button type="button" class="btn-secondary mt-4 px-6 active:translate-y-px" @click="cancelCalculation">
            取消
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
