import type {
  FactorInput,
  FactorSolverResult,
  SolveFactorCombinationsOptions,
} from '../lib/finance/factor-combination'
import { solveFactorCombinations } from '../lib/finance/factor-combination'

export interface FactorSolverWorkerJob {
  factors: FactorInput[]
  target: number
  options: Omit<SolveFactorCombinationsOptions, 'now'>
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<FactorSolverWorkerJob>) => void) | null
  postMessage: (result: FactorSolverResult) => void
}

workerScope.onmessage = (event: MessageEvent<FactorSolverWorkerJob>) => {
  let result: FactorSolverResult
  try {
    result = solveFactorCombinations(
      event.data.factors,
      event.data.target,
      event.data.options,
    )
  }
  catch (error) {
    result = {
      solutions: [],
      totalCount: 0,
      truncated: false,
      timeUp: false,
      note: error instanceof Error ? `计算出错：${error.message}` : '计算出错',
      elapsedMs: 0,
    }
  }
  workerScope.postMessage(result)
}
