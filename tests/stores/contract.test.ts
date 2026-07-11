import type { TestDb } from '../helpers/memory-db'
// #90 合同域 store 单测:mock connection 路由到 sql.js 内存库,node 直测唯一写路径 action 闭环。
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { restoreRecord, softDelete } from '~/lib/db/soft-delete'
import { useContractStore } from '~/stores/contract'
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

describe('contract store:唯一写路径 action 闭环', () => {
  it('add:默认值(kind 施工/status 履约中/金额归 0)落库,load 后 snake→camel 映射', async () => {
    const store = useContractStore()
    const id = await store.add({ name: '测试施工合同', projectId: 'p1', amount: 100.5 })
    expect(store.list).toHaveLength(1)
    expect(store.byId(id)).toMatchObject({
      id,
      name: '测试施工合同',
      kind: '施工',
      status: '履约中',
      projectId: 'p1',
      supplierId: null,
      amount: 100.5,
      changed: 0,
      settled: 0,
      invoiced: 0,
      paid: 0,
    })
  })

  it('byKind:施工/分包/材采三类切片互不串台', async () => {
    const store = useContractStore()
    await store.add({ name: 'A', kind: '施工', projectId: 'p1' })
    await store.add({ name: 'B', kind: '分包', subKind: '劳务', projectId: 'p1' })
    await store.add({ name: 'C', kind: '材采', projectId: 'p1' })
    expect(store.byKind('分包').map(c => c.name)).toEqual(['B'])
    expect(store.byKind('分包')[0]!.subKind).toBe('劳务')
    expect(store.byKind('施工').map(c => c.name)).toEqual(['A'])
    expect(store.byKind('材采').map(c => c.name)).toEqual(['C'])
  })

  it('update:回写字段并返回日志 id;记录不存在返回 null 不落日志', async () => {
    const store = useContractStore()
    const id = await store.add({ name: '旧名', projectId: 'p1' })
    const logId = await store.update(id, { ...store.byId(id)!, name: '新名', amount: 8.88 })
    expect(logId).toBeTruthy()
    expect(store.byId(id)).toMatchObject({ name: '新名', amount: 8.88 })
    expect(await store.update('con_ghost', { name: 'x' })).toBeNull()
  })

  it('remove/undo:软删隐藏出列表,按日志 id 撤回复原', async () => {
    const store = useContractStore()
    const id = await store.add({ name: '要删的', projectId: 'p1' })
    const logId = await store.remove(id)
    expect(logId).toBeTruthy()
    expect(store.list).toHaveLength(0)
    expect(await store.undo(logId!)).toBe(true)
    expect(store.list).toHaveLength(1)
    expect(store.byId(id)!.name).toBe('要删的')
  })

  it('祖先过滤:父项目软删则合同隐藏,恢复项目即重现(ADR 0003 只标父级)', async () => {
    const store = useContractStore()
    await store.add({ name: '子合同', projectId: 'p1' })
    await softDelete(mem, 'projects', 'p1')
    await store.load()
    expect(store.list).toHaveLength(0)
    await restoreRecord(mem, 'projects', 'p1')
    await store.load()
    expect(store.list).toHaveLength(1)
  })
})
