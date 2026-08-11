import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  buildPaymentApplicationInsight,
  loadPaymentApplicationDetail,
} from '~/lib/finance/payment-detail'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`
    INSERT INTO projects (id, name, approval_status)
    VALUES ('detail-project', '详情项目', 'submitted'), ('other-project', '其他项目', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO suppliers (id, name, approval_status)
    VALUES ('detail-supplier', '详情分供方', 'approved')
  `)
  await mem.execute(`
    INSERT INTO contracts (id, no, name, kind, project_id, supplier_id, amount, status)
    VALUES ('detail-contract', 'HT-DETAIL', '详情材料合同', '材采', 'detail-project', 'detail-supplier', 500, '履约中')
  `)
  await mem.execute(`
    INSERT INTO expenditure_settlements (
      id, no, name, biz_type, project_id, supplier_id, contract_id,
      total_amount, settlement_date, status
    ) VALUES (
      'detail-settlement', 'JS-DETAIL', '详情材料结算', '材采', 'detail-project',
      'detail-supplier', 'detail-contract', 100, '2026-08-01', '已审批'
    )
  `)
  await mem.execute(`
    INSERT INTO invoices (
      id, invoice_number, invoice_date, total_amount, project_id, supplier_id,
      review_status, account_status
    ) VALUES (
      'detail-invoice', 'INV-DETAIL', '2026-08-02', 100, 'detail-project',
      'detail-supplier', 'reviewed', 'archived'
    )
  `)
  await mem.execute(`
    INSERT INTO payment_applications (
      id, no, name, biz_type, project_id, supplier_id, contract_id,
      cost_name, apply_amount, apply_date, applicant, invoice_state,
      approved_amount, status
    ) VALUES (
      'detail-application', 'FK-DETAIL', '详情付款申请', '有合同-材料',
      'detail-project', 'detail-supplier', 'detail-contract', '材料', 100,
      '2026-08-03', '详情财务', '先款后票', 100, 'submitted'
    )
  `)
  await mem.execute(`
    INSERT INTO payment_application_settlement_allocations (
      id, payment_application_id, settlement_id, allocated_amount
    ) VALUES ('detail-settlement-allocation', 'detail-application', 'detail-settlement', 100)
  `)
  await mem.execute(`
    INSERT INTO payment_application_invoice_allocations (
      id, payment_application_id, invoice_id, allocated_amount
    ) VALUES ('detail-invoice-allocation', 'detail-application', 'detail-invoice', 40)
  `)
  await mem.execute(`
    INSERT INTO payment_applications (
      id, no, name, biz_type, project_id, supplier_id, apply_amount,
      apply_date, applicant, invoice_state, status
    ) VALUES (
      'other-application', 'FK-OTHER', '其他项目付款', '项目费用', 'other-project',
      'detail-supplier', 60, '2026-08-04', '其他财务', '无需发票', 'submitted'
    )
  `)
  await mem.execute(`
    INSERT INTO payment_records (
      id, no, project_id, supplier_id, payee_name, payment_date, amount,
      payment_method, voucher_no, bank_serial_no, confirmation_status,
      confirmed_by, confirmed_at
    ) VALUES (
      'detail-payment', 'ZF-DETAIL', 'detail-project', 'detail-supplier',
      '详情分供方', '2026-08-05', 30, '银行转账', 'V-DETAIL', 'B-DETAIL',
      'needs_review', '', NULL
    )
  `)
  await mem.execute(`
    INSERT INTO payment_record_application_allocations (
      id, payment_record_id, payment_application_id, allocated_amount
    ) VALUES ('detail-payment-allocation', 'detail-payment', 'detail-application', 30)
  `)
  await mem.execute(`
    UPDATE payment_records
    SET confirmation_status = 'confirmed', confirmed_by = '详情财务',
        confirmed_at = '2026-08-05T08:00:00.000Z'
    WHERE id = 'detail-payment'
  `)
})

afterEach(() => mem.close())

describe('付款申请智能业务洞察', () => {
  it('只把真实勾稽异常标成待处理，正常的待支付余额不误报', () => {
    const insight = buildPaymentApplicationInsight({
      status: 'submitted',
      bizType: '有合同-材料',
      invoiceState: '先款后票',
      applyAmount: 100,
      approvedAmount: 100,
      settlementAllocated: 100,
      invoiceAllocated: 40,
      paidAmount: 0,
    })

    expect(insight.attentionCount).toBe(1)
    expect(insight.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'settlement', level: 'ok' }),
      expect.objectContaining({ key: 'invoice', level: 'warn' }),
      expect.objectContaining({ key: 'payment', level: 'info' }),
    ]))
  })

  it('识别结算金额不平和无需发票却挂票两类阻断问题', () => {
    const insight = buildPaymentApplicationInsight({
      status: 'submitted',
      bizType: '有合同-材料',
      invoiceState: '无需发票',
      applyAmount: 100,
      approvedAmount: 90,
      settlementAllocated: 80,
      invoiceAllocated: 10,
      paidAmount: 0,
    })

    expect(insight.attentionCount).toBe(2)
    expect(insight.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'settlement', level: 'danger' }),
      expect.objectContaining({ key: 'invoice', level: 'danger' }),
      expect.objectContaining({ key: 'payment', level: 'info' }),
    ]))
  })

  it('详情读取真实源单、支付分摊和分供方跨项目汇总', async () => {
    const detail = await loadPaymentApplicationDetail('detail-application')

    expect(detail).toMatchObject({
      id: 'detail-application',
      no: 'FK-DETAIL',
      projectName: '详情项目',
      supplierName: '详情分供方',
      contractNo: 'HT-DETAIL',
      settlementAllocated: 100,
      settlementDifference: 0,
      invoiceAllocated: 40,
      pendingInvoiceAmount: 60,
      paidAmount: 30,
      unpaidAmount: 70,
      supplierOtherProjectCount: 1,
      supplierOtherProjectPaidAmount: 0,
    })
    expect(detail?.settlements).toEqual([
      expect.objectContaining({ id: 'detail-settlement', allocatedAmount: 100 }),
    ])
    expect(detail?.invoices).toEqual([
      expect.objectContaining({ invoiceNumber: 'INV-DETAIL', allocatedAmount: 40 }),
    ])
    expect(detail?.payments).toEqual([
      expect.objectContaining({ no: 'ZF-DETAIL', allocatedAmount: 30, confirmationStatus: 'confirmed' }),
    ])
  })
})
