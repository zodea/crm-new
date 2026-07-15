import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { usePhaseTaskStore } from '~/stores/phase-task'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`INSERT INTO projects (id, name) VALUES ('p1', '演示项目')`)
  setActivePinia(createPinia())
})

describe('phase task store:阶段任务唯一写路径', () => {
  it('ensureProject:无任务项目按六阶段默认清单落 phase_tasks', async () => {
    const store = usePhaseTaskStore()
    await store.ensureProject('p1')
    expect(store.byProject('p1')).toHaveLength(15)
    expect(store.byProject('p1').filter(task => task.phaseIndex === 1)).toHaveLength(5)
  })

  it('saveProject:编辑、新增与移除一次保存持久化，移除走软删除', async () => {
    const store = usePhaseTaskStore()
    await store.ensureProject('p1')
    const initial = store.byProject('p1')
    const removed = initial[1]!
    const next = initial
      .filter(task => task.id !== removed.id)
      .map(task => task.id === initial[0]!.id
        ? { ...task, title: '已修改立项资料', status: 'confirmed' as const }
        : { ...task })
    next.push({
      id: '',
      projectId: 'p1',
      phaseIndex: 5,
      taskIndex: 0,
      title: '保修回访记录',
      description: '项目经理回访',
      responsible: '项目经理',
      status: 'pending',
    })

    await store.saveProject('p1', next)
    expect(store.byProject('p1')).toHaveLength(15)
    expect(store.byProject('p1')[0]!.title).toBe('已修改立项资料')
    expect(store.byProject('p1').some(task => task.title === '保修回访记录')).toBe(true)

    const [deleted] = await mem.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM phase_tasks WHERE id = ?',
      [removed.id],
    )
    expect(deleted?.deleted_at).toBeTruthy()
  })
})
