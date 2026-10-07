import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFinanceStore } from '~/stores/finance'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
  withTransaction: async <T>(
    work: (tx: Pick<TestDb, 'execute' | 'select'>) => Promise<T>,
  ) => {
    await mem.execute('BEGIN')
    try {
      const result = await work({
        execute: (sql, params) => mem.execute(sql, params),
        select: (sql, params) => mem.select(sql, params),
      })
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
  mem = await createMigratedMemoryDb()
  setActivePinia(createPinia())
  await mem.execute(`
    INSERT INTO projects (id, name, approval_status)
    VALUES ('project-payment-boundary', '付款边界项目', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO suppliers (id, name, approval_status)
    VALUES
      ('supplier-payment-boundary', '真实材料供应商', 'approved'),
      ('supplier-other', '另一个分供方', 'approved')
  `)
  await mem.execute(`
    INSERT INTO contracts (
      id, no, name, kind, project_id, supplier_id, amount, changed, status
    )
    VALUES
      (
        'contract-payment-material', 'MAT-PAY', '材料支出合同', '材采',
        'project-payment-boundary', 'supplier-payment-boundary', 100, 100, '履约中'
      ),
      (
        'contract-payment-income', 'IN-PAY', '施工收入合同', '施工',
        'project-payment-boundary', NULL, 100, 100, '履约中'
      )
  `)
  await mem.execute(`
    INSERT INTO expenditure_settlements (
      id, no, name, biz_type, project_id, supplier_id, contract_id,
      total_amount, settlement_date, status
    )
    VALUES (
      'settlement-payment-material', 'SET-PAY', '材料结算', '材采',
      'project-payment-boundary', 'supplier-payment-boundary',
      'contract-payment-material', 100, '2026-08-10', '已确认'
    )
  `)
})

afterEach(() => {
  mem.close()
})

describe('付款申请付款对象边界', () => {
  it('有合同付款申请只能关联匹配的真实支出合同与分供方', async () => {
    const store = useFinanceStore()
    const base = {
      name: '材料付款申请',
      bizType: '有合同-材料',
      projectId: 'project-payment-boundary',
      supplierId: 'supplier-payment-boundary',
      applyAmount: 100,
      applyDate: '2026-08-11',
      applicant: '财务',
      invoiceState: '无需发票' as const,
    }

    await expect(store.saveForm('payment_application', {
      ...base,
      contractId: 'contract-payment-income',
    }, 'submit')).rejects.toThrow('关联合同类型与付款申请业务类型不一致')

    await expect(store.saveForm('payment_application', {
      ...base,
      supplierId: 'supplier-other',
      contractId: 'contract-payment-material',
    }, 'submit')).rejects.toThrow('收款单位与关联合同不一致')

    const saved = await store.saveForm('payment_application', {
      ...base,
      contractId: 'contract-payment-material',
      settlementAllocations: [{
        settlementId: 'settlement-payment-material',
        allocatedAmount: 100,
      }],
    }, 'submit')
    expect(saved.id).toMatch(/^payment_application_/)
  })

  it('施工收入合同不能作为付款申请的付款对象依据', async () => {
    const store = useFinanceStore()
    await expect(store.saveForm('payment_application', {
      name: '预付款申请',
      bizType: '预付款',
      projectId: 'project-payment-boundary',
      supplierId: 'supplier-payment-boundary',
      contractId: 'contract-payment-income',
      applyAmount: 10,
      applyDate: '2026-08-11',
      applicant: '财务',
      invoiceState: '无需发票',
    }, 'submit')).rejects.toThrow('关联合同类型与付款申请业务类型不一致')
  })
})
