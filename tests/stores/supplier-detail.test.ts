import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { useSupplierStore } from '~/stores/supplier'
import { useSupplierDetailStore } from '~/stores/supplier-detail'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb
let failCredentialStatusUpdate = false
let failRefreshAfterCommit = false
let refreshReadsFail = false

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => {
    if (failCredentialStatusUpdate && sql.includes('UPDATE suppliers SET credential_status'))
      throw new Error('模拟资料状态写入失败')
    return mem.execute(sql, params)
  },
  select: async (sql: string, params?: unknown[]) => {
    if (refreshReadsFail)
      throw new Error('模拟缓存刷新失败')
    return mem.select(sql, params)
  },
  withTransaction: async <T>(work: (tx: Pick<TestDb, 'execute' | 'select'>) => Promise<T>) => {
    await mem.execute('BEGIN')
    try {
      const result = await work({
        execute: async (sql: string, params?: unknown[]) => {
          if (failCredentialStatusUpdate && sql.includes('UPDATE suppliers SET credential_status'))
            throw new Error('模拟资料状态写入失败')
          return mem.execute(sql, params)
        },
        select: (sql, params) => mem.select(sql, params),
      })
      await mem.execute('COMMIT')
      if (failRefreshAfterCommit) {
        failRefreshAfterCommit = false
        refreshReadsFail = true
      }
      return result
    }
    catch (error) {
      await mem.execute('ROLLBACK')
      throw error
    }
  },
}))

beforeEach(async () => {
  failCredentialStatusUpdate = false
  failRefreshAfterCommit = false
  refreshReadsFail = false
  mem = await createMemoryDb()
  await runMigrations(mem)
  setActivePinia(createPinia())

  await mem.execute(`INSERT INTO projects (id, name, status) VALUES ('p1', '项目甲', '在建')`)
  await mem.execute(`INSERT INTO suppliers (id, name, credential_status) VALUES ('s1', '测试分供方', 'incomplete')`)
  await mem.execute(`
    INSERT INTO project_suppliers (id, project_id, supplier_id, status)
    VALUES ('ps1', 'p1', 's1', 'contracted')
  `)
  await mem.execute(`
    INSERT INTO contracts (id, no, name, kind, project_id, supplier_id, amount, paid, status)
    VALUES ('c1', 'C-1', '采购合同', '材采', 'p1', 's1', 1000, 600, '履约中')
  `)
  await mem.execute(`
    INSERT INTO payment_applications
      (id, project_id, supplier_id, application_no, name, amount, approved_amount, paid_amount, actual_payment, payment_status)
    VALUES ('pay1', 'p1', 's1', 'PAY-1', '进度请款', 400, 300, 200, 200, '部分付款')
  `)
  await mem.execute(`
    INSERT INTO invoices
      (id, invoice_number, invoice_type, invoice_date, project_id, supplier_id, total_amount, tax_amount, account_status)
    VALUES ('inv1', 'INV-1', '增值税专票', '2026-07-01', 'p1', 's1', 120, 20, 'archived')
  `)
  await mem.execute(`
    INSERT INTO supplier_credentials (id, supplier_id, category, file_name)
    VALUES ('cred1', 's1', '营业执照', '营业执照.pdf')
  `)
  await mem.execute(`
    INSERT INTO supplier_credentials (id, supplier_id, category, file_name)
    VALUES ('cred2', 's1', '法人身份证', '法人身份证.jpg')
  `)
})

afterEach(() => {
  mem.close()
})

describe('supplier detail store', () => {
  it('按 supplierId 缓存 6 Tab 数据并实时计算跨项目汇总', async () => {
    await mem.execute(`UPDATE suppliers SET credential_status = 'reviewing' WHERE id = 's1'`)
    const supplierStore = useSupplierStore()
    const store = useSupplierDetailStore()
    await store.load('s1')

    const snapshot = store.bySupplier('s1')
    expect(snapshot.credentials).toHaveLength(2)
    expect(snapshot.projects).toEqual([
      expect.objectContaining({
        projectId: 'p1',
        contractTotal: 1000,
        paidTotal: 200,
        payableBalance: 800,
      }),
    ])
    expect(snapshot.contracts).toHaveLength(1)
    expect(snapshot.payments).toEqual([
      expect.objectContaining({ applicationNo: 'PAY-1', approvedAmount: 300 }),
    ])
    expect(snapshot.invoices).toEqual([
      expect.objectContaining({ invoiceNumber: 'INV-1', totalAmount: 120 }),
    ])
    expect(snapshot.summary).toEqual({
      projectCount: 1,
      contractCount: 1,
      contractTotal: 1000,
      claimedTotal: 300,
      invoiceTotal: 120,
      invoiceTaxTotal: 20,
      paidTotal: 200,
      payableBalance: 800,
    })
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('incomplete')
  })

  it('证照新增/软删除/撤回均持久化，并同步回算共享 Supplier 资料状态', async () => {
    const supplierStore = useSupplierStore()
    const detailStore = useSupplierDetailStore()
    await Promise.all([supplierStore.load(), detailStore.load('s1')])

    const id = await detailStore.addCredential({
      supplierId: 's1',
      category: '银行开户许可证',
      fileName: '开户许可证.pdf',
    })
    expect(detailStore.bySupplier('s1').credentials).toHaveLength(3)
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('qualified')

    const logId = await detailStore.removeCredential(id, 's1')
    expect(logId).toBeTruthy()
    expect(detailStore.bySupplier('s1').credentials).toHaveLength(2)
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('incomplete')
    expect(await mem.select(
      `SELECT deleted_at FROM supplier_credentials WHERE id = ?`,
      [id],
    )).toEqual([{ deleted_at: expect.any(String) }])

    await expect(detailStore.undoCredential(logId!, 's1')).resolves.toBe(true)
    expect(detailStore.bySupplier('s1').credentials).toHaveLength(3)
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('qualified')
    expect(await mem.select(
      `SELECT deleted_at FROM supplier_credentials WHERE id = ?`,
      [id],
    )).toEqual([{ deleted_at: null }])
  })

  it('证照写入、操作日志与资料状态同事务回滚，并校验证照归属', async () => {
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')

    failCredentialStatusUpdate = true
    await expect(detailStore.addCredential({
      supplierId: 's1',
      category: '银行开户许可证',
      fileName: '开户许可证.pdf',
    })).rejects.toThrow('模拟资料状态写入失败')
    failCredentialStatusUpdate = false

    expect(await mem.select(
      `SELECT id FROM supplier_credentials WHERE supplier_id = 's1' AND category = '银行开户许可证'`,
    )).toEqual([])
    expect(await mem.select(
      `SELECT id FROM operation_logs WHERE table_name = 'supplier_credentials' AND action = 'create'`,
    )).toEqual([])

    await mem.execute(`INSERT INTO suppliers (id, name, credential_status) VALUES ('s2', '另一分供方', 'incomplete')`)
    await expect(detailStore.removeCredential('cred1', 's2')).rejects.toThrow('证照不属于当前分供方')
    expect(await mem.select(`SELECT deleted_at FROM supplier_credentials WHERE id = 'cred1'`))
      .toEqual([{ deleted_at: null }])
  })

  it('事务已提交但双缓存刷新失败时返回明确的已保存提示', async () => {
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')

    failRefreshAfterCommit = true
    await expect(detailStore.addCredential({
      supplierId: 's1',
      category: '银行开户许可证',
      fileName: '开户许可证.pdf',
    })).rejects.toThrow('数据已保存，但界面刷新失败，请刷新后继续：模拟缓存刷新失败')

    refreshReadsFail = false
    expect(await mem.select(
      `SELECT category FROM supplier_credentials WHERE supplier_id = 's1' AND category = '银行开户许可证'`,
    )).toEqual([{ category: '银行开户许可证' }])
    expect(await mem.select(`SELECT credential_status FROM suppliers WHERE id = 's1'`))
      .toEqual([{ credential_status: 'qualified' }])
  })
})
