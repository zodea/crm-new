import type { DbDriver } from '~/lib/db/coordinator'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const events: string[] = []
let includeDemo = false
let legacyReadOnly = false
let migrationError: Error | null = null
let seedError: Error | null = null
let importError: Error | null = null
let migrationGate: Promise<void> | null = null
const runMigrations = vi.fn(async (_db: DbDriver) => {
  events.push('migrate')
  await migrationGate
  if (migrationError)
    throw migrationError
})
const seedIfEmpty = vi.fn(async (_db: DbDriver) => {
  events.push('seed')
  if (seedError)
    throw seedError
})
const bytes = new Uint8Array([1, 2, 3])

beforeEach(() => {
  vi.resetModules()
  events.length = 0
  includeDemo = false
  legacyReadOnly = false
  migrationError = null
  seedError = null
  importError = null
  migrationGate = null
  runMigrations.mockClear()
  seedIfEmpty.mockClear()
  vi.doMock('~/stores/data-visibility', () => ({ useDataVisibilityStore: () => ({ includeDemo }) }))
  vi.doMock('~/lib/db/browser-storage', () => ({
    loadLegacyProductionReadOnly: async () => {
      events.push('check:legacy-read-only')
      return legacyReadOnly
    },
    loadBrowserDatabase: async (key: string) => {
      events.push(`snapshot:${key}`)
      return bytes
    },
    saveBrowserDatabase: async (key: string, snapshot: Uint8Array) => {
      expect(snapshot).toBe(bytes)
      events.push(`persist:${key}`)
    },
  }))
  vi.doMock('~/lib/db/sqljs', () => ({
    openBrowserSqlite: async (snapshot: Uint8Array) => {
      expect(snapshot).toBe(bytes)
      events.push('open:browser')
      return {
        run: (sql: string) => { events.push(`execute:${sql}`) },
        export: () => bytes,
        close: () => { events.push('close:browser') },
        prepare: (_sql: string) => ({ bind: vi.fn(), step: () => false, free: vi.fn() }),
      }
    },
  }))
  vi.doMock('~/lib/db/migrations', () => {
    events.push('load:migrations')
    if (importError)
      throw importError
    return { runMigrations }
  })
  vi.doMock('~/lib/db/seed', () => {
    events.push('load:seed')
    return { seedIfEmpty }
  })
})

describe('数据库连接的按需初始化与既有运行边界', () => {
  it.each([
    { mode: 'demo', demo: true, legacy: false, expected: ['snapshot:demo', 'open:browser', 'load:migrations', 'migrate', 'load:seed', 'seed', 'persist:demo', 'execute:PRAGMA query_only = ON'], readProblem: null, writeProblem: 'demo-workspace-read-only' },
    { mode: 'production', demo: false, legacy: false, expected: ['check:legacy-read-only', 'snapshot:production', 'open:browser', 'load:migrations', 'migrate', 'persist:production'], readProblem: null, writeProblem: null },
    { mode: 'legacy-source', demo: false, legacy: true, expected: ['check:legacy-read-only', 'snapshot:production', 'open:browser', 'load:migrations', 'migrate', 'persist:production', 'execute:PRAGMA query_only = ON'], readProblem: 'legacy-production-read-only', writeProblem: 'legacy-production-read-only' },
  ])('浏览器 $mode 沿原快照与迁移、条件种子、持久化、只读锁顺序初始化', async (scenario) => {
    includeDemo = scenario.demo
    legacyReadOnly = scenario.legacy
    const connection = await import('~/lib/db/connection')
    expect(events).toEqual([])
    await connection.getDb()
    expect(events).toEqual(scenario.expected)
    if (scenario.readProblem)
      await expect(connection.select('SELECT id FROM originals')).rejects.toMatchObject({ code: scenario.readProblem })
    else
      await expect(connection.select('SELECT id FROM originals')).resolves.toEqual([])
    if (scenario.writeProblem)
      await expect(connection.execute('DELETE FROM originals')).rejects.toMatchObject({ code: scenario.writeProblem })
    else
      await expect(connection.execute('DELETE FROM originals')).resolves.toBeUndefined()
    await connection.closeDb()
    expect(events.at(-1)).toBe('close:browser')
  })

  it('演示种子失败不发布半初始化驱动，下次调用沿原快照完整重试', async () => {
    includeDemo = true
    const original = new Error('种子失败')
    seedError = original
    const connection = await import('~/lib/db/connection')
    await expect(connection.getDb()).rejects.toBe(original)
    expect(events).toEqual(['snapshot:demo', 'open:browser', 'load:migrations', 'migrate', 'load:seed', 'seed', 'close:browser'])
    seedError = null
    await connection.getDb()
    expect(runMigrations).toHaveBeenCalledTimes(2)
    expect(seedIfEmpty).toHaveBeenCalledTimes(2)
    expect(events.slice(-4)).toEqual(['migrate', 'seed', 'persist:demo', 'execute:PRAGMA query_only = ON'])
    await connection.closeDb()
  })

  it('软删除的同步 SQL 标识符保护不加载迁移，公共迁移 API 仍引用唯一实现', async () => {
    const deletion = await import('~/lib/db/soft-delete')
    expect(events).toEqual([])
    expect(deletion.visibleCond('projects', 'project')).toContain('project.deleted_at IS NULL')
    expect(() => deletion.visibleCond('projects', 'project;DROP TABLE projects')).toThrow('[db] 非法标识符: project;DROP TABLE projects')
    const evidence = await import('~/lib/db/schema-evidence')
    const actual = await vi.importActual<typeof import('~/lib/db/migrations')>('~/lib/db/migrations')
    expect(actual.assertIdentifier).toBe(evidence.assertIdentifier)
    expect(() => actual.assertIdentifier('_project_1')).not.toThrow()
    expect(() => actual.assertIdentifier('1project')).toThrow('[db] 非法标识符: 1project')
  })
})
