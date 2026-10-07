import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAttendanceStore } from '~/stores/attendance'
import { usePayrollStore } from '~/stores/payroll'
import { useSignedDayworkStore } from '~/stores/signed-daywork'
import { createMigratedMemoryDb } from '../helpers/memory-db'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))

let db: TestDb
vi.mock('~/lib/db/connection', () => ({ getDb: () => Promise.resolve(db), withTransaction: vi.fn() }))

beforeEach(async () => {
  setActivePinia(createPinia())
  db = await createMigratedMemoryDb()
  await db.execute('INSERT INTO projects (id, name, code) VALUES (\'project-a\', \'A 项目\', \'PA\')')
  await db.execute('INSERT INTO crews (id, name, trade) VALUES (\'crew-a\', \'真实班组\', \'泥水工\')')
  await db.execute('INSERT INTO workers (id, crew_id, name, trade, current_project_id) VALUES (\'worker-a\', \'crew-a\', \'真实工人\', \'泥水工\', \'project-a\')')
})

afterEach(() => {
  db.close()
  vi.unstubAllGlobals()
})

describe('工资三入口按实际选项恢复来源范围', () => {
  it.each([
    ['工资', usePayrollStore],
    ['考勤', useAttendanceStore],
    ['签工', useSignedDayworkStore],
  ] as const)('%s 丢弃未知项目和班组，并按有效项目重读工人候选', async (_label, createStore) => {
    const store = createStore()
    Object.assign(store.filters, { projectId: 'missing', crewId: 'missing', month: '2025-11' })
    await store.load()
    expect(store.filters).toMatchObject({ projectId: 'project-a', crewId: '', month: '2025-11' })
    expect(store.options.workers.map(worker => worker.id)).toEqual(['worker-a'])
  })
})
