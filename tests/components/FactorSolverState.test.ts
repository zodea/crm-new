import type { FactorSolverStoredState } from '~/types/finance-factor'
import type { FactorSolverWorkerJob } from '~/workers/factor-combination.worker'
import { render } from '@testing-library/vue'
import { useClipboard, useDebounceFn, useIntervalFn, useTimeoutFn } from '@vueuse/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useFactorSolver } from '~/composables/useFactorSolver'
import { solveFactorCombinations } from '~/lib/finance/factor-combination'

beforeEach(() => {
  localStorage.clear()
  for (const [name, value] of Object.entries({ computed, onBeforeUnmount, shallowRef, watch, useClipboard, useDebounceFn, useIntervalFn, useTimeoutFn }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn() }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

function readState(stored?: unknown): FactorSolverStoredState {
  if (stored !== undefined)
    localStorage.setItem('sum-solver-state', JSON.stringify(stored))
  const view = render(defineComponent({
    setup() {
      const { state } = useFactorSolver()
      return () => h('pre', { 'data-testid': 'state' }, JSON.stringify(state.value))
    },
  }))
  const state = JSON.parse(view.getByTestId('state').textContent!)
  view.unmount()
  return state
}

describe('因子工具保存配置兼容', () => {
  it('完成后的目标与实际按分求解的组合一致，不以显示舍入另算金额', () => {
    vi.stubGlobal('Worker', class {
      onmessage?: (event: MessageEvent) => void
      postMessage(job: FactorSolverWorkerJob) {
        this.onmessage?.({ data: solveFactorCombinations(job.factors, job.target, job.options) } as MessageEvent)
      }

      terminate() {}
    })
    let solver: ReturnType<typeof useFactorSolver> | undefined
    const view = render(defineComponent({
      setup() {
        solver = useFactorSolver()
        return () => h('div')
      },
    }))
    solver!.state.value = { target: 1.005, maxResults: 100, factors: [{ id: 1, value: 1, maxQuantity: null, allowDecimal: false }] }
    solver!.calculate()
    expect(solver!.solverResult.value?.solutions).toHaveLength(1)
    const actualAmount = solver!.solverResult.value!.solutions[0]!.reduce((sum, item) => sum + item.amount, 0) / 100
    expect(actualAmount).toBe(1)
    expect(solver!.resultTarget.value).toBe(actualAmount)
    view.unmount()
  })

  it('首次使用的开票量级默认配置产生 68 条精确解', () => {
    const state = readState()
    expect(state.target).toBe(128640)
    const result = solveFactorCombinations(state.factors.map(factor => ({
      ...factor,
      value: Number(factor.value),
      maxQuantity: factor.maxQuantity == null ? null : Number(factor.maxQuantity),
    })), Number(state.target), { now: () => 0 })
    expect(result.totalCount).toBe(68)
    expect(result.solutions).toHaveLength(68)
    expect(result.solutions.every(solution => solution.reduce((sum, item) => sum + item.amount, 0) === 12864000)).toBe(true)
  })

  it('保留用户已存旧默认及明确数量上限', () => {
    const stored = { target: 10, maxResults: 50, factors: [{ id: 1, value: 2, maxQuantity: null, allowDecimal: false }, { id: 2, value: 4, maxQuantity: 5, allowDecimal: false }] }
    expect(readState(stored)).toEqual(stored)
  })

  it('兼容参考 HTML 的旧 f/m/d 字段', () => {
    expect(readState({ target: 12.5, maxResults: 25, factors: [{ f: 2.5, m: 3, d: true }] })).toEqual({
      target: 12.5,
      maxResults: 25,
      factors: [{ id: 1, value: 2.5, maxQuantity: 3, allowDecimal: true }],
    })
  })

  it.each(['', null])('保留用户清空的目标 %s 和空因子列表', (target) => {
    const state = readState({ target, maxResults: '', factors: [] })
    expect(state).toEqual({ target, maxResults: '', factors: [] })
  })

  it('只给缺失字段补默认，不让旧字段覆盖明确清空的新字段', () => {
    const state = readState({ factors: [{ id: 1, value: null, f: 640, maxQuantity: null, m: 2, allowDecimal: false, d: true }] })
    expect(state.target).toBe(128640)
    expect(state.maxResults).toBe(100)
    expect(state.factors).toEqual([{ id: 1, value: null, maxQuantity: null, allowDecimal: false }])
  })
})
