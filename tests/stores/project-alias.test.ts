import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectAliasStore } from '~/stores/project-alias'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
}))

beforeEach(async ({ onTestFinished }) => {
  mem = await createMigratedMemoryDb()
  onTestFinished(mem.close)
  await mem.execute(`INSERT INTO projects (id, name) VALUES ('p1', '合和新城'), ('p2', '花城广场')`)
  setActivePinia(createPinia())
})

describe('project alias store', () => {
  it('首次人工归项目后记忆工地写法，同写法不重复写入', async () => {
    const store = useProjectAliasStore()
    const first = await store.remember('p1', ' 合和新城项目部 ')
    const second = await store.remember('p1', '合和新城项目部')

    expect(second).toBe(first)
    expect(store.list).toEqual([
      expect.objectContaining({ projectId: 'p1', alias: '合和新城项目部' }),
    ])
  })

  it('同一归一化写法已属于其他项目时拒绝静默改绑', async () => {
    const store = useProjectAliasStore()
    await store.remember('p1', '和新-北门')

    await expect(store.remember('p2', '和新 北门')).rejects.toThrow('已绑定其他项目')
  })
})
