import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPaymentApplicationSummary } from '~/lib/finance/forms'
import {
  buildPaymentApplicationInsight,
  loadPaymentApplicationDetail,
} from '~/lib/finance/payment-detail'
import { verifiedFinanceSum } from '~/lib/finance/persistent-rows'
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
/** 项目已确认现金合计：与付款汇总同口径，未知值不按零汇总。 */
async function confirmedPaymentTotal(projectId: string) {
  const rows = await mem.select<{ amount: unknown }>('SELECT amount FROM payment_records WHERE project_id=? AND confirmation_status=\'confirmed\' AND deleted_at IS NULL', [projectId])
  return verifiedFinanceSum(rows.map(row => row.amount))
}

async function prepare(settlementStatus = '已确认') {
  mem = await createMigratedMemoryDb()
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
      'detail-supplier', 'detail-contract', 100, '2026-08-01', ?
    )
  `, [settlementStatus])
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
}

beforeEach(() => prepare())

afterEach(() => mem.close())

describe('付款申请智能业务洞察', () => {
  it.each([
    ['先款后票', 60],
    ['先票后款', 0],
    ['无需发票', 0],
    ['旧回票类型待核实', null],
  ] as const)('%s 的待回票义务沿同一派生，原差额与已确认现金保留', async (invoiceState, pending) => {
    // Synthetic damaged legacy data keeps the current schema; reads must not manufacture an obligation or zero.
    if (invoiceState === '旧回票类型待核实')
      await mem.execute('PRAGMA ignore_check_constraints=ON')
    await mem.execute('UPDATE payment_applications SET invoice_state=? WHERE id=\'detail-application\'', [invoiceState])
    await mem.execute('PRAGMA ignore_check_constraints=OFF')
    const summary = await getPaymentApplicationSummary('detail-application')
    const detail = await loadPaymentApplicationDetail('detail-application')
    expect(summary).toMatchObject({ invoiceDifference: 60, invoiceAllocated: 40, pendingInvoiceAmount: pending, paidAmount: 30 })
    expect(detail).toMatchObject({ invoiceState, invoiceDifference: 60, pendingInvoiceAmount: pending, applyAmount: 100, paidAmount: 30, approvedAmount: 100 })
    expect(await mem.select('SELECT amount,confirmation_status FROM payment_records WHERE id=\'detail-payment\'')).toEqual([{ amount: 30, confirmation_status: 'confirmed' }])
  })
  it('先款后票真实零仍可读为零，未知原金额不被无票类型掩盖', async () => {
    await mem.execute(`INSERT INTO payment_applications(id,name,apply_amount,invoice_state,status) VALUES('zero-invoice-obligation','原零申请',0,'先款后票','draft')`)
    expect((await getPaymentApplicationSummary('zero-invoice-obligation')).pendingInvoiceAmount).toBe(0)
    expect((await loadPaymentApplicationDetail('zero-invoice-obligation'))?.pendingInvoiceAmount).toBe(0)
    await mem.execute(`UPDATE payment_applications SET apply_amount='unknown',invoice_state='无需发票' WHERE id='zero-invoice-obligation'`)
    await expect(getPaymentApplicationSummary('zero-invoice-obligation')).rejects.toThrow('不能按零')
    await expect(loadPaymentApplicationDetail('zero-invoice-obligation')).rejects.toThrow('不能读取为零')
    expect(await mem.select('SELECT apply_amount,invoice_state FROM payment_applications WHERE id=\'zero-invoice-obligation\'')).toEqual([{ apply_amount: 'unknown', invoice_state: '无需发票' }])
  })
  it('历史工人清偿详情保冻结姓名、按同一工人跨项目实付读取，不按同名或空分供方归零', async () => {
    await mem.execute(`INSERT INTO workers(id,name) VALUES('detail-worker','现行工人姓名'),('same-name-worker','现行工人姓名')`)
    for (const [id, project, worker] of [['worker-head', 'detail-project', 'detail-worker'], ['worker-other', 'other-project', 'detail-worker'], ['same-name-other', 'other-project', 'same-name-worker']] as const) {
      await mem.execute(`INSERT INTO payment_applications(id,name,project_id,worker_id,payee_name_snapshot,apply_amount,approved_amount,status,invoice_state) VALUES(?,?,?,?,'原采用姓名',100,100,'approved','无需发票')`, [id, id, project, worker])
    }
    for (const [id, app, worker, value] of [['worker-cash', 'worker-other', 'detail-worker', 20], ['same-name-cash', 'same-name-other', 'same-name-worker', 80]] as const) {
      await mem.execute(`INSERT INTO payment_records(id,project_id,worker_id,payee_name,payee_name_snapshot,amount,payment_date,voucher_no,bank_serial_no,confirmation_status,confirmed_by,confirmed_at) VALUES(?,'other-project',?,'原收款姓名','原采用姓名',?,'2026-10-05',?,?,'needs_review','原确认人','2026-10-05T01:00:00.000Z')`, [id, worker, value, id, id])
      await mem.execute(`INSERT INTO payment_record_application_allocations(id,payment_record_id,payment_application_id,allocated_amount) VALUES(?,?,?,?)`, [`${id}-allocation`, id, app, value])
      await mem.execute(`UPDATE payment_records SET confirmation_status='confirmed' WHERE id=?`, [id])
    }
    expect(await loadPaymentApplicationDetail('worker-head')).toMatchObject({ workerId: 'detail-worker', supplierId: null, supplierName: '原采用姓名', paidAmount: 0, supplierOtherProjectCount: 1, supplierOtherProjectPaidAmount: 20 })
    await mem.execute(`INSERT INTO payment_applications(id,name,apply_amount,status) VALUES('unknown-payee','原身份缺失',0,'draft')`)
    expect(await loadPaymentApplicationDetail('unknown-payee')).toMatchObject({ supplierOtherProjectCount: null, supplierOtherProjectPaidAmount: null })
  })
  it.each(['settlement', 'invoice', 'paid', 'other-paid', 'cash'] as const)('native详情的%s原始金额损坏不能经SUM发布零，原行保持', async (source) => {
    if (source === 'settlement') {
      const guard = (await mem.select<{ sql: string }>('SELECT sql FROM sqlite_schema WHERE name=\'other_settlement_confirmed_lock\''))[0]!.sql
      await mem.execute('DROP TRIGGER other_settlement_confirmed_lock')
      await mem.execute('UPDATE expenditure_settlements SET total_amount=\'unknown\' WHERE id=\'detail-settlement\'')
      await mem.execute(guard)
    }
    if (source === 'invoice')
      await mem.execute('UPDATE payment_application_invoice_allocations SET allocated_amount=\'unknown\' WHERE id=\'detail-invoice-allocation\'')
    if (source === 'cash')
      await mem.execute('UPDATE payment_records SET amount=\'unknown\' WHERE id=\'detail-payment\'')
    if (source === 'paid' || source === 'other-paid') {
      if (source === 'other-paid') {
        await mem.execute(`INSERT INTO payment_records(id,project_id,supplier_id,payee_name,payment_date,amount,voucher_no,bank_serial_no,confirmed_by,confirmed_at,confirmation_status)
          VALUES('other-payment','other-project','detail-supplier','实际其他项目收款方','2026-10-05',10,'OTHER-PAYMENT','OTHER-PAYMENT','实际财务','2026-10-05T01:00:00.000Z','needs_review')`)
        await mem.execute(`INSERT INTO payment_record_application_allocations(id,payment_record_id,payment_application_id,allocated_amount) VALUES('other-payment-allocation','other-payment','other-application',10)`)
        await mem.execute('UPDATE payment_records SET confirmation_status=\'confirmed\' WHERE id=\'other-payment\'')
        expect((await loadPaymentApplicationDetail('detail-application'))?.supplierOtherProjectPaidAmount).toBe(10)
      }
      const guard = (await mem.select<{ sql: string }>('SELECT sql FROM sqlite_schema WHERE name=\'trg_confirmed_payment_allocation_update\''))[0]!.sql
      await mem.execute('DROP TRIGGER trg_confirmed_payment_allocation_update')
      await mem.execute('UPDATE payment_record_application_allocations SET allocated_amount=\'unknown\' WHERE id=?', [source === 'paid' ? 'detail-payment-allocation' : 'other-payment-allocation'])
      await mem.execute(guard)
    }
    const originals = await mem.select('SELECT * FROM payment_record_application_allocations ORDER BY id')
    await expect(loadPaymentApplicationDetail('detail-application')).rejects.toThrow('未知值按零汇总')
    if (source === 'paid' || source === 'cash')
      await expect(getPaymentApplicationSummary('detail-application')).rejects.toThrow('未知值按零汇总')
    if (source === 'cash') {
      await expect(confirmedPaymentTotal('detail-project')).rejects.toThrow('未知值按零汇总')
      expect(await confirmedPaymentTotal('other-project')).toBe(0)
    }
    expect(await mem.select('SELECT * FROM payment_record_application_allocations ORDER BY id')).toEqual(originals)
  })
  it.each([[10, null], [110, null], [0, 'actual-worker']])('公司付款挂真实结算或工人身份必须准确匹配，分摊%s不伪造已匹配', (allocated, workerId) => {
    const insight = buildPaymentApplicationInsight({ status: 'draft', bizType: '公司付款', workerId, invoiceState: '无需发票', applyAmount: 100, approvedAmount: null, settlementAllocated: allocated, invoiceAllocated: 0, paidAmount: 0 })
    expect(insight.checks.find(check => check.key === 'settlement')).toMatchObject({ level: 'danger' })
    expect(insight.checks.find(check => check.key === 'settlement')!.summary).not.toBe('已完全匹配')
  })

  it.each([
    [null, 'user-entry', 'not-entered', null, 70],
    [0, 'user-entry', 'known', 0, 0],
    [80, 'user-entry', 'known', 80, 50],
    [0, 'legacy', 'legacy-unknown', null, null],
  ] as const)('详情区分未填、明确零和历史未知；已付始终来自确认支付：输入案例 %#', async (value, origin, state, approved, unpaid) => {
    await mem.execute('UPDATE payment_applications SET approved_amount = ?, approved_amount_origin = ? WHERE id = ?', [value, origin, 'detail-application'])
    const detail = await loadPaymentApplicationDetail('detail-application')
    expect(detail).toMatchObject({ approvedAmount: approved, approvedAmountState: state, unpaidAmount: unpaid, paidAmount: 30 })
    if (state === 'legacy-unknown') {
      expect(detail?.insight.checks.find(check => check.key === 'payment')?.summary).toBe('历史批复待核验')
      expect(detail?.registrationAmount).toBe(70)
    }
  })
  it.each(['pending', '待确认', 'approved', '已审批'])('往期结算不计入 %s 状态，确认后再纳入', async (status) => {
    mem.close()
    await prepare(status)
    expect((await loadPaymentApplicationDetail('detail-application'))?.contractSettledAmount).toBe(0)
    await mem.execute('UPDATE expenditure_settlements SET status = ? WHERE id = ?', ['confirmed', 'detail-settlement'])
    expect((await loadPaymentApplicationDetail('detail-application'))?.contractSettledAmount).toBe(100)
  })

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
