import type { FactorInput, FactorSolverResult } from '~/lib/finance/factor-combination'
import type { FactorSolverStoredState, NumericDraft } from '~/types/finance-factor'
import type { FactorSolverWorkerJob } from '~/workers/factor-combination.worker'
import { useLocalStorage } from '@vueuse/core'
import {
  FACTOR_SOLVER_MAX_RESULTS,
  FACTOR_SOLVER_TIME_LIMIT_MS,
  yuanToFen,
} from '~/lib/finance/factor-combination'

const DEFAULT_STATE: FactorSolverStoredState = {
  target: 128640,
  maxResults: 100,
  factors: [
    { id: 1, value: 640, maxQuantity: null, allowDecimal: false },
    { id: 2, value: 960, maxQuantity: null, allowDecimal: false },
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
  const numericDraft = (value: unknown): NumericDraft => value === '' ? '' : numberOrNull(value)
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
        value: numericDraft(Object.hasOwn(factor, 'value') ? factor.value : factor.f),
        maxQuantity: numericDraft(Object.hasOwn(factor, 'maxQuantity') ? factor.maxQuantity : factor.m),
        allowDecimal: Boolean(Object.hasOwn(factor, 'allowDecimal') ? factor.allowDecimal : factor.d),
      }))
    : defaults.factors

  return {
    target: Object.hasOwn(stored, 'target') ? numericDraft(stored.target) : defaults.target,
    maxResults: Object.hasOwn(stored, 'maxResults') ? numericDraft(stored.maxResults) : defaults.maxResults,
    factors,
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
  const resultTarget = shallowRef<number | null>(null)
  const statusMessage = shallowRef('配置目标值和因子后开始计算')
  const calculating = shallowRef(false)
  const showCalculationMask = shallowRef(false)
  const runningElapsedMs = shallowRef(0)
  const runStartedAt = shallowRef(0)
  const activeWorker = shallowRef<Worker | null>(null)
  let jobSequence = 0

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

  // 空闲复用：热 worker 免去每次冷启动（dev 下含 Vite worker chunk 编译），
  // 第二次起的求解往返远低于 150ms mask 阈值，显著压低短计算闪 loading 的概率。
  // terminate 收敛三处：在途任务被新计算抢占、取消计算、组件卸载；出错的 worker 状态不明也杀掉。
  function ensureWorker(): Worker {
    if (!activeWorker.value) {
      activeWorker.value = new Worker(
        new URL('../workers/factor-combination.worker.ts', import.meta.url),
        { type: 'module' },
      )
    }
    return activeWorker.value
  }

  function finishCalculation() {
    calculating.value = false
    showCalculationMask.value = false
    stopMaskDelay()
    stopElapsedTimer()
  }

  function calculate() {
    const target = Number(state.value.target)
    const targetFen = yuanToFen(target)
    if (targetFen == null || target <= 0) {
      statusMessage.value = '请输入有效的目标值'
      solverResult.value = null
      resultTarget.value = null
      return
    }

    const factors = validFactors()
    if (factors.length === 0) {
      statusMessage.value = '请至少添加一个有效因子'
      solverResult.value = null
      resultTarget.value = null
      return
    }

    // 在途的同步求解无法中断，只能杀掉重建；空闲 worker 直接复用。
    if (calculating.value)
      stopCurrentWorker()
    const jobId = ++jobSequence
    calculating.value = true
    showCalculationMask.value = false
    runStartedAt.value = performance.now()
    runningElapsedMs.value = 0
    startMaskDelay()
    startElapsedTimer()

    const worker = ensureWorker()

    worker.onmessage = (event: MessageEvent<FactorSolverResult>) => {
      // 迟到消息（已被抢占/取消的旧 job）不得写入新一轮结果。
      if (jobId !== jobSequence)
        return
      solverResult.value = event.data
      resultTarget.value = targetFen / 100
      statusMessage.value = ''
      finishCalculation()
    }
    worker.onerror = () => {
      if (jobId !== jobSequence)
        return
      statusMessage.value = '计算出错，请调整因子后重试'
      finishCalculation()
      stopCurrentWorker()
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
    jobSequence += 1
    stopCurrentWorker()
    finishCalculation()
    statusMessage.value = '已取消计算'
  }

  const rerunForFilter = useDebounceFn(() => {
    if (solverResult.value && Number(state.value.target) > 0)
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
    resultTarget,
    state,
    summary,
  }
}
