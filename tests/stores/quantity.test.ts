import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { useQuantityStore } from '~/stores/quantity'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb
let selectError: Error | null = null

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => db.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => {
    if (selectError)
      throw selectError
    return db.select(sql, params)
  },
}))

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute(`INSERT INTO projects (id, name, code) VALUES ('p1', '项目一', 'P1')`)
  await db.execute(`INSERT INTO buildings (id, project_id, code, name) VALUES ('b1', 'p1', '1', '1栋')`)
  await db.execute(`INSERT INTO floors (id, building_id, code, name) VALUES ('f1', 'b1', '1', '1层')`)
  await db.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES ('t1', 'p1', 'A', 'A户型')`)
  await db.execute(`INSERT INTO units (id, floor_id, house_type_template_id, code, name) VALUES ('u1', 'f1', 't1', '01', '101户')`)
  selectError = null
  setActivePinia(createPinia())
})

afterEach(() => db.close())

describe('quantity store', () => {
  it('加载目录与项目快照，不产生写操作日志', async () => {
    const store = useQuantityStore()

    await store.loadCatalog()
    await store.loadProject('p1')

    expect(store.catalog).toEqual([
      { id: 'p1', code: 'P1', name: '项目一', hasQuantityData: true },
    ])
    expect(store.snapshot?.units.map(unit => unit.id)).toEqual(['u1'])
    expect(store.loading).toBe(false)
    expect(store.error).toBe('')
    const [logs] = await db.select<{ total: number }>('SELECT COUNT(*) AS total FROM operation_logs')
    expect(logs?.total).toBe(0)
  })

  it('查询失败暴露错误状态并保证 loading 收口', async () => {
    const store = useQuantityStore()
    selectError = new Error('database unavailable')

    await store.loadCatalog()

    expect(store.catalog).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.error).toContain('database unavailable')
  })

  it('切换项目时立即移除旧快照，避免新项目筛选短暂展示旧矩阵', async () => {
    const store = useQuantityStore()
    await store.loadProject('p1')
    await db.execute(`INSERT INTO projects (id, name, code) VALUES ('p2', '项目二', 'P2')`)

    const loadingNext = store.loadProject('p2')
    expect(store.snapshot).toBeNull()
    await loadingNext
    expect(store.snapshot?.projectId).toBe('p2')
  })
})
