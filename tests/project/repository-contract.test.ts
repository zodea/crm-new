import type { TestDb } from '../helpers/memory-db'
import type { ProjectListRepository, ProjectListSourceRow } from '~/lib/project/repository'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import { ProjectRepositoryProblem } from '~/lib/project/repository'
import { createSqliteProjectListRepository } from '~/lib/project/sqlite-repository'
import {
  createProjectReadTestInstance,
  PROJECT_READ_FIXTURE,
} from '../../server/utils/project-read-test-instance'
import { createMemoryDb } from '../helpers/memory-db'

const NOW = '2026-08-15T00:00:00.000Z'
const QUERY = {
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

async function seedProjectFixture(db: TestDb, rows: readonly ProjectListSourceRow[]) {
  await db.execute(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contract_name TEXT NOT NULL,
      code TEXT NOT NULL,
      address TEXT NOT NULL,
      region TEXT NOT NULL,
      contract_amount REAL,
      operation_type TEXT NOT NULL,
      start_date TEXT,
      planned_end TEXT,
      actual_end TEXT,
      planned_duration REAL,
      status TEXT NOT NULL,
      manager TEXT NOT NULL,
      exec_manager TEXT NOT NULL,
      builder TEXT NOT NULL,
      customer_id TEXT,
      secondary_customer_id TEXT,
      contractor TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `)
  await db.execute('CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, deleted_at TEXT)')
  await db.execute(`
    CREATE TABLE receipt_registrations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      deleted_at TEXT
    )
  `)
  await db.execute(`
    CREATE TABLE target_costs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      tax_inclusive_total REAL,
      is_baseline INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `)
  const customers = new Map<string, string>()
  for (const row of rows) {
    if (row.customerId && row.customerName)
      customers.set(row.customerId, row.customerName)
    if (row.secondaryCustomerId && row.secondaryCustomerName)
      customers.set(row.secondaryCustomerId, row.secondaryCustomerName)
  }
  for (const [id, name] of customers)
    await db.execute('INSERT INTO customers (id, name, deleted_at) VALUES (?, ?, NULL)', [id, name])
  for (const row of rows) {
    await db.execute(
      `INSERT INTO projects VALUES (${Array.from({ length: 22 }).fill('?').join(', ')})`,
      [
        row.id,
        row.name,
        row.contractName,
        row.code,
        row.address,
        row.region,
        row.contractAmount,
        row.operationType,
        row.startDate,
        row.plannedEnd,
        row.actualEnd,
        row.plannedDuration,
        row.status,
        row.manager,
        row.execManager,
        row.builder,
        row.customerId,
        row.secondaryCustomerId,
        row.contractor,
        row.riskLevel,
        row.updatedAt,
        null,
      ],
    )
    if (row.income != null) {
      await db.execute(
        'INSERT INTO receipt_registrations VALUES (?, ?, ?, ?, NULL)',
        [`receipt-${row.id}`, row.id, row.income, 'confirmed'],
      )
    }
    if (row.budget != null) {
      await db.execute(
        'INSERT INTO target_costs VALUES (?, ?, ?, 1, ?, ?, NULL)',
        [`target-${row.id}`, row.id, row.budget, 'submitted', row.updatedAt],
      )
    }
  }
}

function contract(repository: () => Promise<ProjectListRepository>) {
  it('preserves stable identity, fixed-point money, null, zero, filtering, pagination and summaries', async () => {
    const repo = await repository()

    const first = await repo.list(QUERY)
    expect(first.pagination).toEqual({ page: 1, pageSize: 10, total: 12 })
    expect(first.items).toHaveLength(10)
    expect(first.items[0]?.project).toMatchObject({
      state: 'resolved',
      entity: 'project',
      id: 'proj_demo_001',
      label: '合和新城',
    })
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
    expect(first.summary.income).toMatchObject({ value: null, status: 'partial' })
    expect(first.summary.income.missingSources).toHaveLength(10)
    expect(first.summary.budget).toMatchObject({ value: null, status: 'partial' })
    expect(first.summary.budget.missingSources).toHaveLength(10)

    const second = await repo.list({ ...QUERY, page: 2 })
    expect(second.pagination).toEqual({ page: 2, pageSize: 10, total: 12 })
    expect(second.items).toHaveLength(2)
    expect(second.items.find(item => item.project.id === 'proj_demo_012')?.plannedEnd)
      .toBeNull()

    const filtered = await repo.list({ ...QUERY, search: '合和', status: '施工中' })
    expect(filtered.items.map(item => item.project.id)).toEqual(['proj_demo_001'])
    expect(filtered.summary.income.value).toBe('25367027.00')
    expect(filtered.empty).toBeNull()
    expect(filtered.summary.statusCounts).toEqual({ 施工中: 1 })

    const fullSnapshotFilter = await repo.list({
      ...QUERY,
      filters: {
        ...QUERY.filters,
        customerIds: ['customer_demo_013'],
      },
    })
    expect(fullSnapshotFilter.items.map(item => item.project.id)).toEqual(['proj_demo_012'])
    expect(fullSnapshotFilter.pagination.total).toBe(1)
    expect(fullSnapshotFilter.summary.projectCount).toBe(1)

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

  it('does not leak a forbidden relationship label', async () => {
    const repo = await repository()
    const page = await repo.list({ ...QUERY, search: '翠湖花园' })

    expect(page.items[0]?.customer).toEqual({
      state: 'forbidden',
      entity: 'customer',
      id: 'customer_demo_003',
      label: null,
      reason: 'permission-denied',
    })

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

  describe('sQLite migration-source adapter', () => {
    let db: TestDb

    beforeEach(async () => {
      db = await createMemoryDb()
      await seedProjectFixture(db, PROJECT_READ_FIXTURE)
    })

    contract(async () => createSqliteProjectListRepository({
      gateway: db,
      canReadCustomer: id => id !== 'customer_demo_003',
      now: () => NOW,
      sourceVersion: 'project-read-fixture-v1',
    }))

    it('uses the same whole-page permission problem as HTTP', async () => {
      const repo = createSqliteProjectListRepository({
        gateway: db,
        canReadProjects: false,
        now: () => NOW,
        sourceVersion: 'project-read-fixture-v1',
      })

      await expect(repo.list(QUERY)).rejects.toBeInstanceOf(ProjectRepositoryProblem)
      await expect(repo.list(QUERY)).rejects.toMatchObject({
        problem: { code: 'forbidden', retryable: false },
      })
    })

    it('hides both primary and secondary customer labels without customer capability', async () => {
      const repo = createSqliteProjectListRepository({
        gateway: db,
        canReadCustomers: false,
        now: () => NOW,
        sourceVersion: 'project-read-fixture-v1',
      })

      const page = await repo.list(QUERY)
      for (const item of page.items) {
        if (item.customer.state !== 'missing')
          expect(item.customer).toMatchObject({ state: 'forbidden', label: null })
        if (item.secondaryCustomer.state !== 'missing')
          expect(item.secondaryCustomer).toMatchObject({ state: 'forbidden', label: null })
      }
    })

    it('rejects a non-ISO SQLite snapshot timestamp', async () => {
      const repo = createSqliteProjectListRepository({
        gateway: db,
        now: () => 'tomorrow',
      })

      await expect(repo.list(QUERY)).rejects.toMatchObject({
        problem: { code: 'internal-error' },
      })
    })
  })
})
