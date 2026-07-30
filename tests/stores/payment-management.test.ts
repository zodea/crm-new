import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { usePaymentManagementStore } from '~/stores/payment-management'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  setActivePinia(createPinia())

  await mem.execute(`
    INSERT INTO projects (id, name, code, status)
    VALUES
      ('project-a', '合和新城', 'HHXC-01', '施工中'),
      ('project-b', '锦绣华庭', 'JXHT-01', '施工中')
  `)
  await mem.execute(`
    INSERT INTO suppliers (id, name)
    VALUES ('supplier-a', '穗建五金机电经营部')
  `)
  await mem.execute(`
    INSERT INTO payment_applications (
      id, no, name, biz_type, project_id, supplier_id,
      apply_amount, apply_date, applicant, invoice_state,
      approved_amount, status
    )
    VALUES
      (
        'application-partial', 'FK-001', '五金采购首期请款', '无合同-零星采购',
        'project-a', 'supplier-a', 1000, '2026-07-01', '材料员',
        '先款后票', 800, 'approved'
      ),
      (
        'application-paid', 'FK-002', '灯具采购结清请款', '有合同-材料',
        'project-b', 'supplier-a', 500, '2026-07-02', '材料员',
        '无需发票', 500, '已审批'
      ),
      (
        'application-submitted', 'FK-003', '仍在审批的请款', '项目费用',
        'project-a', NULL, 300, '2026-07-03', '项目经理',
        '先款后票', 300, 'submitted'
      ),
      (
        'application-deleted', 'FK-004', '已删除请款', '项目费用',
        'project-a', NULL, 200, '2026-07-04', '项目经理',
        '先款后票', 200, 'approved'
      )
  `)
  await mem.execute(`
    UPDATE payment_applications
    SET deleted_at = '2026-07-05T00:00:00.000Z'
    WHERE id = 'application-deleted'
  `)
  await mem.execute(`
    INSERT INTO payment_records (
      id, no, project_id, supplier_id, payee_name, payment_date, amount,
      voucher_no, bank_serial_no, confirmation_status, confirmed_by, confirmed_at
    )
    VALUES
      (
        'payment-confirmed-partial', 'ZF-001', 'project-a', 'supplier-a',
        '穗建五金机电经营部', '2026-07-05', 300, 'V-001', 'BANK-001', 'needs_review',
        '测试财务', '2026-07-05T09:00:00.000Z'
      ),
      (
        'payment-needs-review', 'ZF-002', 'project-a', 'supplier-a',
        '穗建五金机电经营部', '2026-07-06', 400, 'V-002', 'BANK-002', 'needs_review',
        '', NULL
      ),
      (
        'payment-confirmed-paid', 'ZF-003', 'project-b', 'supplier-a',
        '穗建五金机电经营部', '2026-07-07', 500, 'V-003', 'BANK-003', 'needs_review',
        '测试财务', '2026-07-07T09:00:00.000Z'
      )
  `)
  await mem.execute(`
    INSERT INTO payment_record_application_allocations (
      id, payment_record_id, payment_application_id, allocated_amount
    )
    VALUES
      ('allocation-partial', 'payment-confirmed-partial', 'application-partial', 300),
      ('allocation-review', 'payment-needs-review', 'application-partial', 400),
      ('allocation-paid', 'payment-confirmed-paid', 'application-paid', 500)
  `)
  await mem.execute(`
    UPDATE payment_records
    SET confirmation_status = 'confirmed'
    WHERE id IN ('payment-confirmed-partial', 'payment-confirmed-paid')
  `)
})

afterEach(() => {
  mem.close()
})

describe('payment management store', () => {
  it('只展示已批复申请，并从已确认银行支付分摊派生已付和应付余额', async () => {
    const store = usePaymentManagementStore()

    await store.load()

    expect(store.rows).toEqual([
      expect.objectContaining({
        id: 'application-paid',
        projectName: '锦绣华庭',
        approvedAmount: 500,
        paidAmount: 500,
        dueAmount: 0,
        paymentStatus: '已付清',
        invoiceStatus: '无需发票',
      }),
      expect.objectContaining({
        id: 'application-partial',
        projectName: '合和新城',
        supplierName: '穗建五金机电经营部',
        approvedAmount: 800,
        paidAmount: 300,
        dueAmount: 500,
        paymentStatus: '部分支付',
        pendingInvoiceAmount: 1000,
        invoiceStatus: '待回票',
      }),
    ])
    expect(store.rows.some(row => row.id === 'application-submitted')).toBe(false)
    expect(store.rows.some(row => row.id === 'application-deleted')).toBe(false)
  })

  it('按真实工作台数据生成项目筛选项与汇总，不把待核对支付计入资金事实', async () => {
    const store = usePaymentManagementStore()

    await store.load()

    expect(store.projectOptions).toEqual([
      { key: 'all', label: '全部项目' },
      { key: 'project-a', label: '合和新城' },
      { key: 'project-b', label: '锦绣华庭' },
    ])
    expect(store.summary).toEqual({
      applicationCount: 2,
      approvedAmount: 1300,
      paidAmount: 800,
      dueAmount: 500,
      dueCount: 1,
    })
  })
})
