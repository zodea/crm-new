import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { usePaymentManagementStore } from '~/stores/payment-management'
import { createMemoryDb } from '../helpers/memory-db'

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
  it.each([
    ['先款后票', 1000, '待回票'],
    ['先票后款', 0, '待关联发票'],
    ['无需发票', 0, '无需发票'],
    ['旧回票类型待核实', null, '回票类型待核实'],
  ] as const)('native工作台%s同源待回票派生不改变实际已付和可付', async (state, pending, invoiceStatus) => {
    // An explicitly damaged synthetic legacy row must retain an unknown state, not inherit post-payment invoicing.
    if (state === '旧回票类型待核实')
      await mem.execute('PRAGMA ignore_check_constraints=ON')
    await mem.execute('UPDATE payment_applications SET invoice_state=? WHERE id=\'application-partial\'', [state])
    await mem.execute('PRAGMA ignore_check_constraints=OFF')
    const store = usePaymentManagementStore()
    await store.load()
    expect(store.rows.find(row => row.id === 'application-partial')).toMatchObject({ invoiceStatus, pendingInvoiceAmount: pending, paidAmount: 300, dueAmount: 500, approvedAmount: 800 })
  })
  it('原金额与实际分摊逐行核实，未知不产生零、付清或可登记余额，旧快照标记失效', async () => {
    const store = usePaymentManagementStore()
    await store.load()
    await mem.execute(`UPDATE payment_applications SET apply_amount='unknown' WHERE id='application-partial'`)
    await expect(store.load()).rejects.toThrow('不能按零')
    expect(store.currentRead).toBe(false)
    expect(store.hasSnapshot).toBe(true)
    expect(store.rows.find(row => row.id === 'application-partial')?.paidAmount).toBe(300)
    await mem.execute(`UPDATE payment_applications SET apply_amount=1000 WHERE id='application-partial'`)
    const guards = await mem.select<{ name: string, sql: string }>(`SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='payment_record_application_allocations'`)
    for (const guard of guards)
      await mem.execute(`DROP TRIGGER ${guard.name}`)
    await mem.execute(`UPDATE payment_record_application_allocations SET allocated_amount='unknown' WHERE id='allocation-partial'`)
    for (const guard of guards)
      await mem.execute(guard.sql)
    await expect(store.load()).rejects.toThrow('不能按零')
    expect(store.currentRead).toBe(false)
    expect(await mem.select(`SELECT allocated_amount FROM payment_record_application_allocations WHERE id='allocation-partial'`)).toEqual([{ allocated_amount: 'unknown' }])
    expect(await mem.select(`SELECT amount,confirmation_status FROM payment_records WHERE id='payment-confirmed-partial'`)).toEqual([{ amount: 300, confirmation_status: 'confirmed' }])
  })
  it('已证明的空集是真实零，原金额小数精度不在读取或合计时先舍去', async () => {
    await mem.execute('DELETE FROM payment_record_application_allocations WHERE payment_record_id=\'payment-needs-review\'')
    await mem.execute(`UPDATE payment_applications SET status='draft'`)
    const store = usePaymentManagementStore()
    await store.load()
    expect(store.summary).toEqual({ applicationCount: 0, approvedAmount: 0, paidAmount: 0, dueAmount: 0, dueCount: 0 })
    await mem.execute(`INSERT INTO payment_applications(id,name,apply_amount,approved_amount,status) VALUES('native-precision','精确小数',10.000001,NULL,'approved')`)
    await store.load()
    expect(store.rows).toContainEqual(expect.objectContaining({ id: 'native-precision', dueAmount: 10.000001, paidAmount: 0 }))
    expect(store.summary.dueAmount).toBe(10.000001)
  })
  it('明确改为零元后保留真实已付，并指出超额而非已付清', async () => {
    await mem.execute('UPDATE payment_applications SET approved_amount = 0, approved_amount_origin = \'user-entry\' WHERE id = \'application-partial\'')
    const store = usePaymentManagementStore()
    await store.load()
    expect(store.rows.find(row => row.id === 'application-partial')).toMatchObject({ approvedAmount: 0, dueAmount: 0, paidAmount: 300, paymentStatus: '超额支付' })
  })
  it('未知批复不显示已付清或零元；明确零保持零，未填按申请额派生余额', async () => {
    for (const [id, value, origin] of [['legacy', 0, 'legacy'], ['empty', null, 'user-entry'], ['zero', 0, 'user-entry']] as const)
      await mem.execute('INSERT INTO payment_applications (id, apply_amount, approved_amount, approved_amount_origin, status) VALUES (?, 100, ?, ?, ?)', [id, value, origin, 'approved'])
    const store = usePaymentManagementStore()
    await store.load()
    expect(store.rows.find(row => row.id === 'legacy')).toMatchObject({ approvedAmount: null, dueAmount: null, paymentStatus: '历史批复待核验' })
    expect(store.rows.find(row => row.id === 'empty')).toMatchObject({ approvedAmount: null, dueAmount: 100, paymentStatus: '待支付' })
    expect(store.rows.find(row => row.id === 'zero')).toMatchObject({ approvedAmount: 0, dueAmount: 0, paymentStatus: '批复为 0' })
    expect(store.summary).toMatchObject({ approvedAmount: null, dueAmount: null, dueCount: null, paidAmount: 800 })
  })
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
