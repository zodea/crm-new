import type { FactorInput, FactorSolverResult } from '~/lib/finance/factor-combination'
import type { FactorSolverStoredState, NumericDraft } from '~/types/finance-factor'
import type { FactorSolverWorkerJob } from '~/workers/factor-combination.worker'
import { useLocalStorage } from '@vueuse/core'
import {
  FACTOR_SOLVER_MAX_RESULTS,
  FACTOR_SOLVER_TIME_LIMIT_MS,
} from '~/lib/finance/factor-combination'

const DEFAULT_STATE: FactorSolverStoredState = {
  target: 10,
  maxResults: 100,
  factors: [
    { id: 1, value: 2, maxQuantity: null, allowDecimal: false },
    { id: 2, value: 4, maxQuantity: 5, allowDecimal: false },
  ],
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value == null)
    return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function migrateStoredState(
  stored: FactorSolverStoredState,
  defaults: FactorSolverStoredState,
): FactorSolverStoredState {
  const rawFactors = (stored as unknown as {
    factors?: Array<Partial<FactorSolverStoredState['factors'][number]> & {
      f?: unknown
      m?: unknown
      d?: unknown
    }>
  }).factors
  const factors = Array.isArray(rawFactors)
    ? rawFactors.map((factor, index) => ({
        id: Number(factor.id) || index + 1,
        value: numberOrNull(factor.value ?? factor.f),
        maxQuantity: numberOrNull(factor.maxQuantity ?? factor.m),
        allowDecimal: Boolean(factor.allowDecimal ?? factor.d),
      }))
    : defaults.factors

  return {
    target: numberOrNull(stored.target) ?? defaults.target,
    maxResults: numberOrNull(stored.maxResults) ?? defaults.maxResults,
    factors: factors.length ? factors : defaults.factors,
  }
}

export function useFactorSolver() {
  const { success, error } = useKitUI()
  const state = useLocalStorage<FactorSolverStoredState>(
    'sum-solver-state',
    DEFAULT_STATE,
    { mergeDefaults: migrateStoredState },
  )

  const includeFactor = shallowRef<NumericDraft>(null)
  const excludeFactor = shallowRef<NumericDraft>(null)
  const solverResult = shallowRef<FactorSolverResult | null>(null)
  const statusMessage = shallowRef('配置目标值和因子后开始计算')
  const calculating = shallowRef(false)
  const showCalculationMask = shallowRef(false)
  const runningElapsedMs = shallowRef(0)
  const runStartedAt = shallowRef(0)
  const activeWorker = shallowRef<Worker | null>(null)

  const { copy: copyToClipboard } = useClipboard({ legacy: true })
  const { start: startMaskDelay, stop: stopMaskDelay } = useTimeoutFn(
    () => {
      if (calculating.value)
        showCalculationMask.value = true
    },
    150,
    { immediate: false },
  )
  const { resume: startElapsedTimer, pause: stopElapsedTimer } = useIntervalFn(
    () => {
      runningElapsedMs.value = Math.round(performance.now() - runStartedAt.value)
    },
    80,
    { immediate: false },
  )

  const summary = computed(() => {
    const result = solverResult.value
    if (!result || statusMessage.value)
      return statusMessage.value

    const shown = result.solutions.length
    if (result.note)
      return `${result.note}，用时 ${result.elapsedMs} ms`
    if (result.timeUp)
      return `超过 ${FACTOR_SOLVER_TIME_LIMIT_MS / 1000} 秒时限已中止，找到 ${shown} 条（可能不完整），用时 ${result.elapsedMs} ms`
    if (result.totalCount != null) {
      const count = formatCount(result.totalCount)
      return result.totalCount > shown
        ? `共 ${count} 条解，已展示前 ${shown} 条，用时 ${result.elapsedMs} ms`
        : `共 ${count} 条解，用时 ${result.elapsedMs} ms`
    }
    return result.truncated
      ? `已找到 ${shown} 条（达到返回上限，总数未统计），用时 ${result.elapsedMs} ms`
      : `共 ${shown} 条解（总数未统计），用时 ${result.elapsedMs} ms`
  })

  function formatCount(count: number): string {
    return Number.isSafeInteger(count)
      ? count.toLocaleString('zh-CN')
      : `约 ${count.toExponential(2)}`
  }

  function validFactors(): FactorInput[] {
    return state.value.factors
      .filter(factor => Number.isFinite(Number(factor.value)) && Number(factor.value) > 0)
      .map(factor => ({
        id: factor.id,
        value: Number(factor.value),
        maxQuantity: factor.maxQuantity == null || !Number.isFinite(factor.maxQuantity)
          ? null
          : Math.max(0, Number(factor.maxQuantity)),
        allowDecimal: factor.allowDecimal,
      }))
  }

  function stopCurrentWorker() {
    activeWorker.value?.terminate()
    activeWorker.value = null
  }

  function finishCalculation() {
    calculating.value = false
    showCalculationMask.value = false
    stopMaskDelay()
    stopElapsedTimer()
    stopCurrentWorker()
  }

  function calculate() {
    const target = Number(state.value.target)
    if (!Number.isFinite(target) || target <= 0) {
      statusMessage.value = '请输入有效的目标值'
      solverResult.value = null
      return
    }

    const factors = validFactors()
    if (factors.length === 0) {
      statusMessage.value = '请至少添加一个有效因子'
      solverResult.value = null
      return
    }

    stopCurrentWorker()
    calculating.value = true
    showCalculationMask.value = false
    runStartedAt.value = performance.now()
    runningElapsedMs.value = 0
    startMaskDelay()
    startElapsedTimer()

    const worker = new Worker(
      new URL('../workers/factor-combination.worker.ts', import.meta.url),
      { type: 'module' },
    )
    activeWorker.value = worker

    worker.onmessage = (event: MessageEvent<FactorSolverResult>) => {
      solverResult.value = event.data
      statusMessage.value = ''
      finishCalculation()
    }
    worker.onerror = () => {
      statusMessage.value = '计算出错，请调整因子后重试'
      finishCalculation()
    }

    const maxResults = Math.min(
      FACTOR_SOLVER_MAX_RESULTS,
      Math.max(1, Math.floor(Number(state.value.maxResults) || 100)),
    )
    const job: FactorSolverWorkerJob = {
      factors,
      target,
      options: {
        maxResults,
        includeFactor: numberOrNull(includeFactor.value),
        excludeFactor: numberOrNull(excludeFactor.value),
        timeLimitMs: FACTOR_SOLVER_TIME_LIMIT_MS,
      },
    }
    worker.postMessage(job)
  }

  function cancelCalculation() {
    finishCalculation()
    statusMessage.value = '已取消计算'
  }

  const rerunForFilter = useDebounceFn(() => {
    if (Number(state.value.target) > 0)
      calculate()
  }, 300)

  watch([includeFactor, excludeFactor], () => {
    void rerunForFilter()
  })

  onBeforeUnmount(() => {
    stopMaskDelay()
    stopElapsedTimer()
    stopCurrentWorker()
  })

  async function copyText(text: string) {
    try {
      await copyToClipboard(text)
      success('已复制')
    }
    catch {
      error('复制失败')
    }
  }

  return {
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
  }
}
