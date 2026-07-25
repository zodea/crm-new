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
  withTransaction: async <T>(
    work: (tx: Pick<TestDb, 'execute' | 'select'>) => Promise<T>,
  ) => {
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
  await mem.execute(`INSERT INTO customers (id, name) VALUES ('customer-1', '演示客户')`)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id)
    VALUES ('p1', '演示项目', 'customer-1')
  `)
  await mem.execute(`INSERT INTO suppliers (id, name) VALUES ('supplier-1', '演示分供方')`)
  setActivePinia(createPinia())
})

describe('contract store:唯一写路径 action 闭环', () => {
  it('saveForm: canonical action 落库并聚合只读金额', async () => {
    const store = useContractStore()
    const { id } = await store.saveForm('construction', {
      name: '测试施工合同',
      projectId: 'p1',
      customerId: 'customer-1',
      amount: 100.5,
    }, 'draft')
    expect(store.list).toHaveLength(1)
    expect(store.byId(id)).toMatchObject({
      id,
      name: '测试施工合同',
      kind: '施工',
      status: '草稿',
      projectId: 'p1',
      supplierId: null,
      amount: 100.5,
      changed: 100.5,
      settled: 0,
      invoiced: 0,
      paid: 0,
    })
  })

  it('byKind:施工/分包/材采三类切片互不串台', async () => {
    const store = useContractStore()
    await store.saveForm('construction', {
      name: 'A',
      projectId: 'p1',
      customerId: 'customer-1',
    }, 'draft')
    await store.saveForm('subcontract', {
      name: 'B',
      subKind: '劳务',
      projectId: 'p1',
      supplierId: 'supplier-1',
    }, 'draft')
    await store.saveForm('material', {
      name: 'C',
      projectId: 'p1',
      supplierId: 'supplier-1',
    }, 'draft')
    expect(store.byKind('分包').map(c => c.name)).toEqual(['B'])
    expect(store.byKind('分包')[0]!.subKind).toBe('劳务')
    expect(store.byKind('施工').map(c => c.name)).toEqual(['A'])
    expect(store.byKind('材采').map(c => c.name)).toEqual(['C'])
  })

  it('编辑仍经 canonical action 回写并返回日志 id', async () => {
    const store = useContractStore()
    const created = await store.saveForm('construction', {
      name: '旧名',
      projectId: 'p1',
      customerId: 'customer-1',
    }, 'draft')
    const updated = await store.saveForm('construction', {
      id: created.id,
      name: '新名',
      projectId: 'p1',
      customerId: 'customer-1',
      amount: 8.88,
    }, 'draft')
    expect(updated.logId).toBeTruthy()
    expect(store.byId(created.id)).toMatchObject({ name: '新名', amount: 8.88 })
  })

  it('removeForm/undoForm:软删隐藏出列表,按日志 id 撤回复原', async () => {
    const store = useContractStore()
    const { id } = await store.saveForm('construction', {
      name: '要删的',
      projectId: 'p1',
      customerId: 'customer-1',
    }, 'draft')
    const logId = await store.removeForm('construction', id)
    expect(logId).toBeTruthy()
    expect(store.list).toHaveLength(0)
    expect(await store.undoForm('construction', logId!)).toBe(true)
    expect(store.list).toHaveLength(1)
    expect(store.byId(id)!.name).toBe('要删的')
  })

  it('祖先过滤:父项目软删则合同隐藏,恢复项目即重现(ADR 0003 只标父级)', async () => {
    const store = useContractStore()
    await store.saveForm('construction', {
      name: '子合同',
      projectId: 'p1',
      customerId: 'customer-1',
    }, 'draft')
    await softDelete(mem, 'projects', 'p1')
    await store.load()
    expect(store.list).toHaveLength(0)
    await restoreRecord(mem, 'projects', 'p1')
    await store.load()
    expect(store.list).toHaveLength(1)
  })
})
