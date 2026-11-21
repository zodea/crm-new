import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFinanceStore } from '~/stores/finance'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
  withTransaction: async <T>(work: (tx: TestDb) => Promise<T>) => {
    await mem.execute('BEGIN')
    try {
      const result = await work(mem)
      await mem.execute('COMMIT')
      return result
    }
    catch (cause) {
      await mem.execute('ROLLBACK')
      throw cause
    }
  },
}))

beforeEach(async () => {
  mem = await createMigratedMemoryDb()
  setActivePinia(createPinia())

  await mem.execute(`
    INSERT INTO customers (id, name, tax_no, status)
    VALUES
      ('customer-1', '睿航建设', '914400001', 'submitted'),
      ('customer-deleted', '已删客户', '914400002', 'submitted')
  `)
  await mem.execute(`
    UPDATE customers SET deleted_at = '2026-07-26T00:00:00.000Z'
    WHERE id = 'customer-deleted'
  `)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id)
    VALUES ('project-1', '合和新城', 'customer-1')
  `)
  await mem.execute(`
    INSERT INTO contracts (id, no, name, kind, project_id, customer_id, amount)
    VALUES (
      'contract-1', 'SG-001', '合和新城施工合同', '施工',
      'project-1', 'customer-1', 120000
    )
  `)
  await mem.execute(`
    INSERT INTO receipt_registrations (
      id, no, receipt_date, project_id, contract_id, customer_id,
      amount, payment_method, status
    )
    VALUES (
      'receipt-1', 'SK-001', '2026-07-26', 'project-1',
      'contract-1', 'customer-1', 50000, '银行转账', 'submitted'
    )
  `)
})

afterEach(() => {
  mem.close()
})

describe('finance read store', () => {
  it('工人和分供方清单返回全部匹配的合法身份，不截断为固定前五十条或按姓名合并', async () => {
    const workerIds = Array.from({ length: 61 }, (_, index) => `global-worker-${String(index).padStart(3, '0')}`)
    const supplierIds = Array.from({ length: 61 }, (_, index) => `global-supplier-${String(index).padStart(3, '0')}`)
    for (const id of workerIds)
      await mem.execute('INSERT INTO workers(id,name,current_project_id) VALUES(?,?,?)', [id, '完整候选同名工人', 'project-1'])
    for (const id of supplierIds)
      await mem.execute('INSERT INTO suppliers(id,name) VALUES(?,?)', [id, '完整候选同名分供方'])
    await mem.execute(`INSERT INTO workers(id,name,deleted_at) VALUES('deleted-worker','完整候选同名工人','2026-10-05')`)
    await mem.execute(`INSERT INTO suppliers(id,name,deleted_at) VALUES('deleted-supplier','完整候选同名分供方','2026-10-05')`)
    const store = useFinanceStore()
    expect(await store.searchWorkers('完整候选')).toEqual(workerIds.map(id => ({ id, label: '完整候选同名工人' })))
    expect(await store.searchSuppliers('完整候选')).toEqual(supplierIds.map(id => ({ id, label: '完整候选同名分供方' })))
  })

  it('由 store 统一加载列表并解析真实关联名称', async () => {
    const store = useFinanceStore()

    await expect(store.loadList('receipt')).resolves.toEqual([
      {
        id: 'receipt-1',
        no: 'SK-001',
        name: '睿航建设',
        projectName: '合和新城',
        partyName: '合和新城施工合同',
        amount: 50000,
        date: '2026-07-26',
        status: 'submitted',
        customerId: 'customer-1',
        dataOrigin: null,
      },
    ])
    expect(store.listRows.receipt).toHaveLength(1)
    expect(store.loading).toBe(false)
  })

  it('正式本地工作区不把未接入中央仓库的收款伪装成 demo', async () => {
    const store = useFinanceStore()

    await expect(store.loadList('receipt')).resolves.toEqual([
      expect.objectContaining({
        id: 'receipt-1',
        customerId: 'customer-1',
        dataOrigin: null,
      }),
    ])
  })

  it('lookup 由 store 统一限定项目、合同类型并隐藏软删记录', async () => {
    const store = useFinanceStore()

    await expect(store.searchCustomers('睿航')).resolves.toEqual([
      { id: 'customer-1', label: '睿航建设' },
    ])
    await expect(store.searchCustomers('已删')).resolves.toEqual([])
    await expect(store.searchContracts('project-1', ['施工'], '施工')).resolves.toEqual([
      {
        id: 'contract-1',
        label: '合和新城施工合同',
        hint: 'SG-001 · ¥120000.00',
      },
    ])
    await expect(store.searchContracts('project-1', ['分包'], '')).resolves.toEqual([])
    await expect(store.loadCustomerSnapshot('customer-1')).resolves.toEqual({
      name: '睿航建设',
      taxNo: '914400001',
    })
  })
})
