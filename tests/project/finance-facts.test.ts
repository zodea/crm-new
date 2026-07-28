import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadProjectDetailAggregates } from '~/lib/project/detail-aggregate'
import { loadProjectFinanceFacts } from '~/lib/project/finance-facts'
import { createMemoryDb } from '../helpers/memory-db'

describe('project finance facts read model', () => {
  it('separates current transfers, payment applications and confirmed payment facts', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO customers (id, name) VALUES ('customer-finance', '资金客户')`)
    await db.execute(`
      INSERT INTO projects (id, name, customer_id)
      VALUES
        ('project-finance', '资金项目', 'customer-finance'),
        ('project-finance-other', '其他资金项目', 'customer-finance')
    `)
    await db.execute(`
      INSERT INTO current_transactions (
        id, no, direction, project_id, counterparty, purpose, amount,
        payment_method, transaction_date, bank_serial_no, handler, status
      )
      VALUES
        (
          'current-receipt', 'WL-SK', 'receipt', 'project-finance', '公司总部',
          '项目调入', 100, '银行转账', '2026-07-01', 'BANK-SK', '财务', 'submitted'
        ),
        (
          'current-payment', 'WL-FK', 'payment', 'project-finance', '兄弟项目',
          '项目调出', 20, '银行转账', '2026-07-02', 'BANK-FK', '财务', 'submitted'
        ),
        (
          'current-draft', 'WL-DRAFT', 'payment', 'project-finance', '待确认单位',
          '草稿调出', 900, '银行转账', '2026-07-03', '', '', 'draft'
        ),
        (
          'current-other', 'WL-OTHER', 'receipt', 'project-finance-other', '公司总部',
          '其他项目调入', 800, '银行转账', '2026-07-01', '', '', 'submitted'
        )
    `)
    await db.execute(`
      INSERT INTO payment_applications (
        id, no, name, biz_type, project_id, apply_amount, approved_amount, status
      )
      VALUES
        (
          'payment-application-confirmed', 'FK-CONFIRMED', '已付申请',
          '项目费用', 'project-finance', 60, 60, 'approved'
        ),
        (
          'payment-application-review', 'FK-REVIEW', '待核对申请',
          '项目费用', 'project-finance', 40, 40, 'approved'
        )
    `)
    await db.execute(`
      INSERT INTO payment_records (
        id, no, project_id, payee_name, purpose, payment_date, amount,
        payment_method, voucher_no, bank_serial_no, source,
        recognition_status, confirmation_status, confirmed_by
      )
      VALUES
        (
          'payment-confirmed', 'ZF-CONFIRMED', 'project-finance', '项目收款方',
          '正式付款', '2026-07-03', 60, '银行转账', 'V-CONFIRMED',
          'BANK-CONFIRMED', 'manual', 'not_applicable', 'needs_review', '财务'
        ),
        (
          'payment-review', 'ZF-REVIEW', 'project-finance', '待核对收款方',
          '待核对付款', '2026-07-04', 40, '银行转账', 'V-REVIEW',
          'BANK-REVIEW', 'image_ocr', 'reviewed', 'needs_review', ''
        )
    `)
    await db.execute(`
      INSERT INTO payment_record_application_allocations (
        id, payment_record_id, payment_application_id, allocated_amount
      )
      VALUES
        (
          'allocation-confirmed', 'payment-confirmed',
          'payment-application-confirmed', 60
        ),
        (
          'allocation-review', 'payment-review',
          'payment-application-review', 35
        )
    `)
    await db.execute(`
      UPDATE payment_records
      SET confirmation_status = 'confirmed',
          confirmed_at = '2026-07-03T09:00:00.000Z'
      WHERE id = 'payment-confirmed'
    `)

    const result = await loadProjectFinanceFacts(db)
    expect(result.currentReceipts.filter(row => row.projectId === 'project-finance')).toEqual([
      expect.objectContaining({
        id: 'current-receipt',
        amount: 100,
        effectiveAmount: 100,
        sourcePath: '/finance/current/current-receipt',
      }),
    ])
    expect(result.currentPayments.filter(row => row.projectId === 'project-finance')).toEqual([
      expect.objectContaining({
        id: 'current-draft',
        amount: 900,
        effectiveAmount: 0,
        status: 'draft',
      }),
      expect.objectContaining({
        id: 'current-payment',
        amount: 20,
        effectiveAmount: 20,
      }),
    ])
    expect(result.paymentRecords.filter(row => row.projectId === 'project-finance')).toEqual([
      expect.objectContaining({
        id: 'payment-review',
        amount: 40,
        effectiveAmount: 0,
        allocationCount: 1,
        allocatedAmount: 35,
        allocationDifference: 5,
        status: 'needs_review',
      }),
      expect.objectContaining({
        id: 'payment-confirmed',
        amount: 60,
        effectiveAmount: 60,
        allocationCount: 1,
        allocatedAmount: 60,
        allocationDifference: 0,
        status: 'confirmed',
        sourcePath: '/finance/records/payment-confirmed',
      }),
    ])

    const aggregate = (await loadProjectDetailAggregates(db))
      .find(row => row.projectId === 'project-finance')
    expect(aggregate).toMatchObject({
      paymentAmount: 60,
      currentReceipt: 100,
      currentPayment: 20,
      availableBalance: 20,
    })
  })
})
