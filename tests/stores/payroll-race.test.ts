import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePayrollStore } from '~/stores/payroll'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const mocks = vi.hoisted(() => ({
  loadOptions: vi.fn(),
  listStatements: vi.fn(),
}))

vi.mock('~/lib/db/connection', () => ({
  getDb: vi.fn().mockResolvedValue({}),
  withTransaction: vi.fn(),
}))

vi.mock('~/lib/payroll/statements', async importOriginal => ({
  ...await importOriginal<typeof import('~/lib/payroll/statements')>(),
  buildWageDraftSource: vi.fn(),
  checkWageStatement: vi.fn(),
  createWageStatementDraft: vi.fn(),
  listWageStatements: mocks.listStatements,
  loadPayrollWorkbenchOptions: mocks.loadOptions,
  releaseWageStatement: vi.fn(),
  updateDraftLinePrice: vi.fn(),
}))

vi.mock('~/lib/payroll/daywork', () => ({
  upsertC2SubjectConfig: vi.fn(),
}))

function options(projectId: string) {
  return {
    projects: [
      { id: 'project-a', name: '项目甲', code: 'A' },
      { id: 'project-b', name: '项目乙', code: 'B' },
    ],
    crews: [],
    workers: [{ id: `worker-${projectId}`, name: projectId, crewId: null }],
    c2SubjectConfigs: [],
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.loadOptions.mockReset()
  mocks.listStatements.mockReset()
})

describe('payroll store latest-wins', () => {
  it('下一次路由同步尚未开始读取时，旧响应也不得覆盖刚改的月份', async () => {
    mocks.loadOptions.mockImplementation((_: unknown, projectId: string) => Promise.resolve(options(projectId)))
    const old = deferred<Array<{ id: string }>>()
    mocks.listStatements.mockReturnValueOnce(old.promise)
    const store = usePayrollStore()
    Object.assign(store.filters, { projectId: 'project-a', month: '2025-11' })
    const pending = store.load()
    await vi.waitFor(() => expect(mocks.listStatements).toHaveBeenCalledOnce())
    store.filters.month = '2025-12'
    old.resolve([{ id: 'november' }])
    await pending
    expect(store.filters.month).toBe('2025-12')
    expect(store.statements).toEqual([])
  })

  it('同范围刷新保留列表快照含空结果，跨项目先清空', async () => {
    mocks.loadOptions.mockImplementation((_: unknown, projectId: string) => Promise.resolve(options(projectId)))
    mocks.listStatements.mockResolvedValueOnce([{ id: 'statement-a' }])
    const store = usePayrollStore()
    store.filters.projectId = 'project-a'
    await store.load()
    const refresh = deferred<Array<{ id: string }>>()
    mocks.listStatements.mockReturnValueOnce(refresh.promise)
    store.filters.status = ['checked']
    const sameScope = store.load()
    expect(store.statements.map(row => row.id)).toEqual(['statement-a'])
    expect(store.hasSnapshot).toBe(true)
    expect(store.selected).toBeNull()
    refresh.resolve([])
    await sameScope
    expect(store.statements).toEqual([])
    expect(store.hasSnapshot).toBe(true)
    mocks.listStatements.mockResolvedValueOnce([])
    const emptyRefresh = store.load()
    expect(store.hasSnapshot).toBe(true)
    await emptyRefresh
    store.filters.projectId = 'project-b'
    const otherScope = store.load()
    expect(store.hasSnapshot).toBe(false)
    expect(store.statements).toEqual([])
    await otherScope
  })

  it('旧项目选项请求后完成时不得覆盖最新项目', async () => {
    const projectA = deferred<ReturnType<typeof options>>()
    const projectB = deferred<ReturnType<typeof options>>()
    mocks.loadOptions.mockImplementation((_: unknown, projectId: string) =>
      projectId === 'project-a' ? projectA.promise : projectB.promise,
    )
    const store = usePayrollStore()

    const loadingA = store.loadOptions('project-a')
    const loadingB = store.loadOptions('project-b')
    projectB.resolve(options('project-b'))
    await loadingB
    projectA.resolve(options('project-a'))
    await loadingA

    expect(store.filters.projectId).toBe('project-b')
    expect(store.options.workers.map(worker => worker.id)).toEqual(['worker-project-b'])
    expect(store.loading).toBe(false)
  })

  it('旧列表请求后完成时不得覆盖最新筛选、列表或选中单据', async () => {
    const listA = deferred<Array<{ id: string }>>()
    const listB = deferred<Array<{ id: string }>>()
    mocks.loadOptions.mockImplementation((_: unknown, projectId: string) =>
      Promise.resolve(options(projectId)),
    )
    mocks.listStatements.mockImplementation((_: unknown, filter: { projectId?: string }) =>
      filter.projectId === 'project-a' ? listA.promise : listB.promise,
    )
    const store = usePayrollStore()

    store.filters.projectId = 'project-a'
    const loadingA = store.load()
    expect(store.statements).toEqual([])
    expect(store.selectedId).toBe('')
    await vi.waitFor(() => expect(mocks.listStatements).toHaveBeenCalledTimes(1))
    store.filters.projectId = 'project-b'
    const loadingB = store.load()
    await vi.waitFor(() => expect(mocks.listStatements).toHaveBeenCalledTimes(2))

    listB.resolve([{ id: 'statement-b' }])
    await loadingB
    listA.resolve([{ id: 'statement-a' }])
    await loadingA

    expect(store.filters.projectId).toBe('project-b')
    expect(store.statements.map(statement => statement.id)).toEqual(['statement-b'])
    expect(store.selectedId).toBe('statement-b')
    expect(store.loading).toBe(false)
  })
})
