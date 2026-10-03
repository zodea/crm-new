import { render } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, onBeforeUnmount, shallowRef } from 'vue'
import { useAuxiliaryContractRead } from '~/composables/useAuxiliaryContractRead'
import { AuxiliaryContractProblem } from '~/lib/auxiliary-contract/contract'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

function harness(read: () => Promise<{ id: string }>, snapshotKey?: () => string) {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
  let result!: ReturnType<typeof useAuxiliaryContractRead<{ id: string }>>
  const view = render(defineComponent({
    setup() {
      result = useAuxiliaryContractRead(read, undefined, snapshotKey ? { snapshotKey } : undefined)
      return () => null
    },
  }))
  return { result, view }
}

describe('辅助合同列表快照', () => {
  it('同来源刷新保留数据和可重试错误，切换来源清空，较早请求不能覆盖新结果', async () => {
    let source = 'company_expense:real'
    const refresh = deferred<{ id: string }>()
    const oldRequest = deferred<{ id: string }>()
    const switched = deferred<{ id: string }>()
    const read = vi.fn().mockResolvedValueOnce({ id: 'first' }).mockImplementationOnce(() => refresh.promise).mockImplementationOnce(() => oldRequest.promise).mockImplementationOnce(() => switched.promise)
    const { result } = harness(read, () => source)
    await result.load()
    const refreshing = result.load()
    expect(result.data.value).toEqual({ id: 'first' })
    expect(result.state.value).toMatchObject({ kind: 'loading', previous: { id: 'first' } })
    refresh.reject(new Error('offline'))
    await refreshing
    expect(result.state.value).toMatchObject({ kind: 'error', previous: { id: 'first' } })
    expect(result.data.value).toEqual({ id: 'first' })
    const older = result.load()
    source = 'other_expense:demo'
    const switching = result.load()
    expect(result.data.value).toBeNull()
    expect(result.state.value).toEqual({ kind: 'loading', previous: null })
    switched.resolve({ id: 'new-source' })
    await switching
    oldRequest.resolve({ id: 'stale' })
    await older
    expect(result.data.value).toEqual({ id: 'new-source' })
  })

  it.each(['forbidden', 'not-found', 'relationship-mismatch'] as const)('%s 清除已有快照', async (code) => {
    const read = vi.fn().mockResolvedValueOnce({ id: 'first' }).mockRejectedValueOnce(new AuxiliaryContractProblem({ code, message: '不可用', retryable: false, fieldErrors: {}, traceId: null }))
    const { result } = harness(read, () => 'real')
    await result.load()
    await result.load()
    expect(result.data.value).toBeNull()
    expect(result.problem.value?.code).toBe(code)
  })

  it('未配置快照身份的详情调用仍在重新读取时清空旧数据', async () => {
    const next = deferred<{ id: string }>()
    const { result } = harness(vi.fn().mockResolvedValueOnce({ id: 'first' }).mockImplementationOnce(() => next.promise))
    await result.load()
    const loading = result.load()
    expect(result.data.value).toBeNull()
    next.resolve({ id: 'second' })
    await loading
    expect(result.data.value).toEqual({ id: 'second' })
  })
})
