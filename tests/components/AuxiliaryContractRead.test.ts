import { render, waitFor } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useAuxiliaryContractForm } from '~/composables/useAuxiliaryContractForm'
import { useAuxiliaryContractRead } from '~/composables/useAuxiliaryContractRead'
import { useContractFormAttachments } from '~/composables/useContractFormAttachments'
import { AuxiliaryContractProblem } from '~/lib/auxiliary-contract/contract'
import { createAuxiliaryContractRepository } from '~/lib/auxiliary-contract/repository'
import { decodeAuxiliaryCommand } from '~/lib/auxiliary-contract/validation'
import { useAuxiliaryContractCommandStore } from '~/stores/auxiliary-contract-command'
import { createAuxiliaryContractTestInstance } from '../../server/utils/auxiliary-contract-test-instance'

vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }))

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.unstubAllGlobals())

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
    expect(result.state.value).toMatchObject({ kind: 'unavailable', previous: { id: 'first' }, problem: { code: 'unavailable' } })
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

  it.each(['unauthenticated', 'forbidden', 'not-found', 'relationship-mismatch'] as const)('%s 清除已有快照', async (code) => {
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

it('auxiliary整页表单实际save回执后GET失败，恢复保后来文本与本次之外附件，采用真实ID与状态且只读不重写', async () => {
  const actor = { workspaceId: 'component-aux-workspace', actorId: 'component-aux-owner', capabilities: ['auxiliary-contract:read', 'auxiliary-contract:write'] }
  const server = createAuxiliaryContractTestInstance({ createId: () => 'actual-aux-saved-target', now: () => '2026-10-07T10:00:00.000Z' })
  let readsFail = true
  let writes = 0
  let resolves = 0
  const repository = createAuxiliaryContractRepository(async (url, options) => {
    if (url.endsWith('/context'))
      return server.context(actor)
    if (url.endsWith('/resolve')) {
      resolves++
      throw new Error('Known receipt recovery must only read its actual target')
    }
    if (options?.method === 'POST') {
      writes++
      return server.execute(decodeAuxiliaryCommand(options.body), actor)
    }
    if (readsFail) {
      readsFail = false
      throw new Error('Actual saved-target GET failed')
    }
    return server.detail('actual-aux-saved-target', options?.query ?? {}, actor)
  })
  const values = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {
    values.set(key, value)
  }, removeItem: (key: string) => {
    values.delete(key)
  } })
  for (const [name, value] of Object.entries({ computed, ref, shallowRef, watch, onBeforeUnmount, nextTick }))
    vi.stubGlobal(name, value)
  vi.stubGlobal('useRoute', () => ({ params: {}, query: {}, fullPath: '/contract/company-expense/form' }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { auxiliaryContracts: repository } }))
  vi.stubGlobal('useAuxiliaryContractCommandStore', useAuxiliaryContractCommandStore)
  vi.stubGlobal('useContractFormAttachments', useContractFormAttachments)
  const navigate = vi.fn()
  vi.stubGlobal('navigateTo', navigate)
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), confirm: async () => false }))
  let form!: ReturnType<typeof useAuxiliaryContractForm>
  render(defineComponent({ setup() {
    form = useAuxiliaryContractForm(() => 'company_expense')
    return () => null
  } }))
  await waitFor(() => expect(form.loading.value).toBe(false))
  form.patch({ name: '原提交合同', amount: 0 })
  form.files.appendDrafts([{ fileName: '原提交附件.txt', fileSize: 3, payloadBase64: 'YWJj' }])
  await form.save('draft')
  expect(form.pending.value).toBe(true)
  expect(writes).toBe(1)
  form.draft.value = { ...form.draft.value, name: '后来输入仍保留', note: '不覆盖后来备注' }
  form.files.appendDrafts([{ fileName: '后来另一个附件.txt', fileSize: 3, payloadBase64: 'ZGVm' }])
  await form.recover()
  expect(form.draft.value).toMatchObject({ id: 'actual-aux-saved-target', name: '后来输入仍保留', note: '不覆盖后来备注', status: '草稿' })
  expect(form.files.pendingAttachments.value.map(file => file.fileName)).toEqual(['后来另一个附件.txt'])
  expect(form.files.attachments.value).toHaveLength(1)
  expect(form.files.attachments.value[0]).toMatchObject({ ownerId: 'actual-aux-saved-target', fileName: '原提交附件.txt' })
  expect(form.dirty.value).toBe(true)
  expect(form.pending.value).toBe(false)
  expect(writes).toBe(1)
  expect(resolves).toBe(0)
  expect(navigate).not.toHaveBeenCalled()
  expect(values.size).toBe(0)
})
