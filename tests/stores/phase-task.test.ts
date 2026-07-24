import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { createDefaultPhaseTasks } from '~/lib/project/phases'
import { usePhaseTaskStore } from '~/stores/phase-task'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
  withTransaction: async <T>(work: (tx: TestDb) => Promise<T>) => {
    await mem.execute('BEGIN')
    try {
      const result = await work(mem)
      await mem.execute('COMMIT')
      return result
    }
    catch (error) {
      await mem.execute('ROLLBACK')
      throw error
    }
  },
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`INSERT INTO projects (id, name) VALUES ('p1', '演示项目')`)
  setActivePinia(createPinia())
})

describe('phase task store:阶段任务唯一写路径', () => {
  it('load:浏览无任务项目只读，不因打开详情自动写库', async () => {
    const store = usePhaseTaskStore()
    await store.load()
    expect(store.byProject('p1')).toHaveLength(0)
    const [{ n }] = await mem.select<{ n: number }>('SELECT COUNT(*) AS n FROM operation_logs')
    expect(n).toBe(0)
  })

  it('saveProject:编辑、新增与移除持久化，并可按整次保存撤回', async () => {
    const store = usePhaseTaskStore()
    await store.load()
    await store.saveProject('p1', createDefaultPhaseTasks('p1'))
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

    const logIds = await store.saveProject('p1', next)
    expect(store.byProject('p1')).toHaveLength(15)
    expect(store.byProject('p1')[0]!.title).toBe('已修改立项资料')
    expect(store.byProject('p1').some(task => task.title === '保修回访记录')).toBe(true)

    const [deleted] = await mem.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM phase_tasks WHERE id = ?',
      [removed.id],
    )
    expect(deleted?.deleted_at).toBeTruthy()

    await store.undoSave(logIds)
    expect(store.byProject('p1')).toHaveLength(15)
    expect(store.byProject('p1')[0]!.title).toBe('项目立项审批表')
    expect(store.byProject('p1').some(task => task.id === removed.id)).toBe(true)
    expect(store.byProject('p1').some(task => task.title === '保修回访记录')).toBe(false)
  })
})
