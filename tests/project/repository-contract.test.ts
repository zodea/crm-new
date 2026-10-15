import type { ProjectListRepository } from '~/lib/project/repository'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import {
  createProjectReadTestInstance,
} from '../../server/utils/project-read-test-instance'

const QUERY = {
  includeDemo: true,
  search: '',
  status: null,
  filters: {
    statuses: [],
    plannedEnds: [],
    managers: [],
    customerIds: [],
  },
  sort: 'updated-desc' as const,
  page: 1,
  pageSize: 10 as const,
}

function contract(repository: () => Promise<ProjectListRepository>) {
  it('preserves stable identity, fixed-point money, null, zero, filtering, pagination and summaries', async () => {
    const repo = await repository()

    const first = await repo.list(QUERY)
    expect(first.pagination).toEqual({ requestedPage: 1, page: 1, pageSize: 10, total: 12 })
    expect(first.items).toHaveLength(10)
    expect(first.items[0]?.project).toMatchObject({
      state: 'resolved',
      entity: 'project',
      id: 'proj_demo_001',
      label: '合和新城',
    })
    expect(first.items[0]?.navigation).toEqual({
      kind: 'entity-detail',
      subject: first.items[0]?.project,
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'demo' },
    })
    expect(JSON.stringify(first.items[0]?.navigation)).not.toContain('/project')
    expect(first.items[0]?.dataOrigin).toBe('demo')
    const zeroBudget = first.items.find(item => item.project.id === 'proj_demo_002')
    expect(zeroBudget?.contractAmount).toBe('2560.00')
    expect(zeroBudget?.income.value).toBeNull()
    expect(zeroBudget?.budget.value).toBe('0.00')
    expect(zeroBudget?.secondaryCustomer).toEqual({
      state: 'missing',
      entity: 'customer',
      id: null,
      label: null,
      reason: 'not-configured',
    })
    expect(first.summary.origins.demo.income).toMatchObject({ value: null, status: 'partial' })
    expect(first.summary.origins.demo.income.missingSources).toHaveLength(10)
    expect(first.summary.origins.demo.budget).toMatchObject({ value: null, status: 'partial' })
    expect(first.summary.origins.demo.budget.missingSources).toHaveLength(10)
    expect(first.summary.origins.real.projectCount).toBe(0)

    const second = await repo.list({ ...QUERY, page: 2 })
    expect(second.pagination).toEqual({ requestedPage: 2, page: 2, pageSize: 10, total: 12 })
    expect(second.items).toHaveLength(2)
    expect(second.items.find(item => item.project.id === 'proj_demo_012')?.plannedEnd)
      .toBeNull()

    const filtered = await repo.list({ ...QUERY, search: '合和', status: '施工中' })
    expect(filtered.items.map(item => item.project.id)).toEqual(['proj_demo_001'])
    expect(filtered.summary.origins.demo.income.value).toBe('25367027.00')
    expect(filtered.empty).toBeNull()
    expect(filtered.summary.origins.demo.statusCounts).toEqual({ 施工中: 1 })

    const fullSnapshotFilter = await repo.list({
      ...QUERY,
      filters: {
        ...QUERY.filters,
        customerIds: ['customer_demo_013'],
      },
    })
    expect(fullSnapshotFilter.items.map(item => item.project.id)).toEqual(['proj_demo_012'])
    expect(fullSnapshotFilter.pagination.total).toBe(1)
    expect(fullSnapshotFilter.summary.origins.demo.projectCount).toBe(1)

    const crossFilterNoMatch = await repo.list({
      ...QUERY,
      filters: {
        ...QUERY.filters,
        managers: ['张工'],
        customerIds: ['customer_demo_013'],
      },
    })
    expect(crossFilterNoMatch.empty?.reason).toBe('no-filter-match')
    expect(crossFilterNoMatch.summary.facets.managers).toContainEqual({
      value: '张工',
      label: '张工',
    })
    expect(crossFilterNoMatch.summary.facets.customers).toContainEqual({
      value: 'customer_demo_013',
      label: '广州市政集团',
    })

    const noMatch = await repo.list({ ...QUERY, search: '不存在' })
    expect(noMatch.items).toEqual([])
    expect(noMatch.empty).toEqual({ reason: 'no-filter-match', missingRelations: [] })
  })

  it('does not leak a forbidden relationship identity or label', async () => {
    const repo = await repository()
    const page = await repo.list({ ...QUERY, search: '翠湖花园' })

    expect(page.items[0]?.customer).toEqual({
      state: 'forbidden',
      entity: 'customer',
      id: null,
      label: null,
      reason: 'permission-denied',
    })

    expect(JSON.stringify(page.items[0])).not.toContain('customer_demo_003')
    expect(JSON.stringify(page.items[0])).not.toContain('翠湖投资')

    const inferred = await repo.list({ ...QUERY, search: '翠湖投资' })
    expect(inferred.items).toEqual([])
    expect(inferred.empty?.reason).toBe('no-filter-match')
  })
}

describe('project repository contract', () => {
  describe('central HTTP adapter', () => {
    const instance = createProjectReadTestInstance()

    beforeEach(() => {
      instance.reset('ready')
    })

    contract(async () => createHttpProjectListRepository({
      fetcher: async (_url, options) => instance.list(options?.query),
    }))

    it('maps an HTTP forbidden problem without turning it into an empty page', async () => {
      const problem = {
        code: 'forbidden' as const,
        message: '无项目查看权限',
        retryable: false,
        fieldErrors: {},
        traceId: 'trace-forbidden',
      }
      const failure = Object.assign(new Error('forbidden'), {
        response: { status: 403, _data: problem },
      })
      const repo = createHttpProjectListRepository({
        fetcher: async () => Promise.reject(failure),
      })

      await expect(repo.list(QUERY)).rejects.toMatchObject({ problem })
    })

    it('rejects a malformed nested DTO at the HTTP boundary', async () => {
      const repo = createHttpProjectListRepository({
        fetcher: async (_url, options) => {
          const page = await instance.list(options?.query)
          return {
            ...page,
            items: [{ ...page.items[0], status: 42 }],
          }
        },
      })

      await expect(repo.list(QUERY)).rejects.toMatchObject({
        problem: { code: 'internal-error' },
      })
    })

    it('rejects a backend route string in place of semantic navigation intent', async () => {
      const repo = createHttpProjectListRepository({
        fetcher: async (_url, options) => {
          const page = await instance.list(options?.query)
          return {
            ...page,
            items: [{ ...page.items[0], navigation: '/project/proj_demo_001' }],
          }
        },
      })

      await expect(repo.list(QUERY)).rejects.toMatchObject({
        problem: { code: 'internal-error' },
      })
    })

    it('rejects an empty stable project id at the HTTP boundary', async () => {
      const repo = createHttpProjectListRepository({
        fetcher: async (_url, options) => {
          const page = await instance.list(options?.query)
          const item = page.items[0]!
          const project = { ...item.project, id: '' }
          return {
            ...page,
            items: [{
              ...item,
              project,
              navigation: { ...item.navigation, subject: project },
            }],
          }
        },
      })

      await expect(repo.list(QUERY)).rejects.toMatchObject({
        problem: { code: 'internal-error' },
      })
    })

    it('rejects non-ISO dates and timestamps at the HTTP boundary', async () => {
      const repo = createHttpProjectListRepository({
        fetcher: async (_url, options) => {
          const page = await instance.list(options?.query)
          return {
            ...page,
            asOf: 'tomorrow',
            items: [{ ...page.items[0], plannedEnd: 'next-week' }],
          }
        },
      })

      await expect(repo.list(QUERY)).rejects.toMatchObject({
        problem: { code: 'internal-error' },
      })
    })

    it('rejects counts outside the JavaScript safe-integer range', async () => {
      const repo = createHttpProjectListRepository({
        fetcher: async (_url, options) => {
          const page = await instance.list(options?.query)
          return {
            ...page,
            pagination: { ...page.pagination, total: Number.MAX_SAFE_INTEGER + 1 },
          }
        },
      })

      await expect(repo.list(QUERY)).rejects.toMatchObject({
        problem: { code: 'internal-error' },
      })
    })

    it('rejects non-ISO planned-end filters before querying', async () => {
      await expect(instance.list({
        filterPlannedEnds: JSON.stringify(['tomorrow']),
      })).rejects.toMatchObject({
        problem: { code: 'invalid-query' },
      })
    })

    it('rejects non-canonical HTTP problem codes and field error shapes', async () => {
      const failure = Object.assign(new Error('malformed problem'), {
        response: {
          status: 500,
          _data: {
            code: 'something-else',
            message: 'bad',
            retryable: false,
            fieldErrors: { search: 'not-an-array' },
            traceId: null,
          },
        },
      })
      const repo = createHttpProjectListRepository({
        fetcher: async () => Promise.reject(failure),
      })

      await expect(repo.list(QUERY)).rejects.toMatchObject({
        problem: { code: 'unavailable', retryable: true },
      })
    })
  })
})
