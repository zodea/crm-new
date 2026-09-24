import type { ProjectListItemDTO, ProjectListQueryDTO, ProjectListSummaryDTO } from '~/lib/project/repository'
import type { PageDTO, ProblemDTO } from '~/types/read-model'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectRepositoryProblem } from '~/lib/project/repository'
import { useProjectListStore } from '~/stores/project-list'

const QUERY: ProjectListQueryDTO = {
  includeDemo: false,
  search: '',
  status: null,
  filters: {
    statuses: [],
    plannedEnds: [],
    managers: [],
    customerIds: [],
  },
  sort: 'updated-desc',
  page: 1,
  pageSize: 10,
}

const PAGE = {
  items: [],
  pagination: { page: 1, pageSize: 10, total: 0 },
  summary: {
    facets: { statuses: [], plannedEnds: [], managers: [], customers: [] },
    origins: {
      real: { projectCount: 0, statusCounts: {}, income: null, budget: null },
      demo: { projectCount: 0, statusCounts: {}, income: null, budget: null },
    },
  },
  empty: { reason: 'no-records', missingRelations: [] },
  asOf: '2026-08-15T00:00:00.000Z',
  sourceVersion: 'test-v1',
  capabilities: ['project:list:read'],
} as unknown as PageDTO<ProjectListItemDTO, ProjectListSummaryDTO>

describe('project list read state', () => {
  const list = vi.fn()

  beforeEach(() => {
    setActivePinia(createPinia())
    list.mockReset()
    vi.stubGlobal('useNuxtApp', () => ({
      $repositories: { projectList: { list, get: vi.fn() } },
    }))
  })

  it('收起测试数据后等待与失败态均不保留上次范围快照', async () => {
    list.mockResolvedValueOnce(PAGE)
    const store = useProjectListStore()
    await store.load({ ...QUERY, includeDemo: true })
    list.mockRejectedValueOnce(new Error('network failed'))
    const next = store.load(QUERY)
    expect(store.state).toMatchObject({ kind: 'loading', previous: null })
    await next
    expect(store.state).toMatchObject({ kind: 'error', previous: null })
  })

  it('moves loading to a real empty state', async () => {
    let resolve!: (page: typeof PAGE) => void
    list.mockImplementationOnce(() => new Promise((done) => {
      resolve = done
    }))
    const store = useProjectListStore()

    const request = store.load(QUERY)
    expect(store.state).toEqual({ kind: 'loading', previous: null })
    resolve(PAGE)
    await request

    expect(store.state).toEqual({ kind: 'empty', data: PAGE, empty: PAGE.empty })
  })

  it('keeps previous data on retryable failure and exposes the normalized problem', async () => {
    const problem: ProblemDTO = {
      code: 'unavailable',
      message: '中央后台暂时不可用',
      retryable: true,
      fieldErrors: {},
      traceId: 'trace-unavailable',
    }
    list
      .mockResolvedValueOnce({ ...PAGE, empty: null, items: [{}], pagination: { ...PAGE.pagination, total: 1 } })
      .mockRejectedValueOnce(new ProjectRepositoryProblem(problem))
    const store = useProjectListStore()

    await store.load(QUERY)
    const previous = 'data' in store.state ? store.state.data : null
    await store.load(QUERY)

    expect(store.state).toEqual({ kind: 'error', problem, previous })
  })

  it('uses forbidden instead of an empty state and ignores stale requests', async () => {
    const forbidden: ProblemDTO = {
      code: 'forbidden',
      message: '无项目查看权限',
      retryable: false,
      fieldErrors: {},
      traceId: null,
    }
    let rejectFirst!: (reason: unknown) => void
    list
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectFirst = reject
      }))
      .mockResolvedValueOnce(PAGE)
    const store = useProjectListStore()

    const first = store.load(QUERY)
    await store.load(QUERY)
    rejectFirst(new ProjectRepositoryProblem(forbidden))
    await first

    expect(store.state.kind).toBe('empty')

    list.mockRejectedValueOnce(new ProjectRepositoryProblem(forbidden))
    await store.load(QUERY)
    expect(store.state).toEqual({ kind: 'forbidden', problem: forbidden })
  })

  it('reads every filtered page for export without truncating at the visible page', async () => {
    const firstItems = Array.from({ length: 100 }, (_, index) => ({ project: { id: `p-${index}` } }))
    const lastItem = { project: { id: 'p-100' } }
    list
      .mockResolvedValueOnce({
        ...PAGE,
        items: firstItems,
        empty: null,
        pagination: { page: 1, pageSize: 100, total: 101 },
      })
      .mockResolvedValueOnce({
        ...PAGE,
        items: [lastItem],
        empty: null,
        pagination: { page: 2, pageSize: 100, total: 101 },
      })
    const store = useProjectListStore()

    const items = await store.listAll(QUERY)

    expect(items).toHaveLength(101)
    expect(items.at(-1)).toEqual(lastItem)
    expect(list).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 1, pageSize: 100 }))
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2, pageSize: 100 }))
  })

  it.each([
    ['not-found', 'not-found'],
    ['relationship-mismatch', 'mismatch'],
  ] as const)('maps %s into an explicit %s read state', async (code, kind) => {
    const problem: ProblemDTO = {
      code,
      message: code,
      retryable: false,
      fieldErrors: {},
      traceId: null,
    }
    list.mockRejectedValueOnce(new ProjectRepositoryProblem(problem))
    const store = useProjectListStore()

    await store.load(QUERY)

    expect(store.state).toEqual({ kind, problem })
  })
})
