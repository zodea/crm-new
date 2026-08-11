import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  getPaymentApplicationSummary,
  getProjectConfirmedPaymentTotal,
  listFinanceFormAttachments,
  loadFinanceForm,
  unconfirmPaymentRecord,
} from '~/lib/finance/forms'
import { useFinanceStore } from '~/stores/finance'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb
let failFileInsert = false

vi.mock('~/lib/db/connection', () => ({
  execute: (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
  withTransaction: async <T>(
    work: (tx: Pick<TestDb, 'execute' | 'select'>) => Promise<T>,
  ) => {
    await mem.execute('BEGIN')
    try {
      const result = await work({
        execute: (sql, params) => {
          if (failFileInsert && /INSERT INTO file_refs/i.test(sql))
            throw new Error('模拟附件写入失败')
          return mem.execute(sql, params)
        },
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
  failFileInsert = false
  mem = await createMemoryDb()
  await runMigrations(mem)
  setActivePinia(createPinia())
  await mem.execute(`
    INSERT INTO customers (id, name, tax_no, status)
    VALUES ('customer-finance', '资金客户', '91440100F3', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id, approval_status)
    VALUES ('project-finance', '资金项目', 'customer-finance', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO suppliers (id, name, approval_status)
    VALUES ('supplier-finance', '资金分供方', 'approved')
  `)
  await mem.execute(`
    INSERT INTO contracts (
      id, no, name, kind, project_id, customer_id, amount, changed, status
    )
    VALUES (
      'contract-income', 'CON-F3', '施工合同', '施工', 'project-finance',
      'customer-finance', 1000, 1000, '履约中'
    )
  `)
  await mem.execute(`
    INSERT INTO contracts (
      id, no, name, kind, project_id, supplier_id, amount, changed, status
    )
    VALUES (
      'contract-expense', 'MAT-F3', '材料合同', '材采', 'project-finance',
      'supplier-finance', 500, 500, '履约中'
    )
  `)
  await mem.execute(`
    INSERT INTO expenditure_settlements (
      id, no, name, biz_type, project_id, supplier_id, contract_id,
      total_amount, settlement_date, status
    )
    VALUES (
      'settlement-finance', 'JS-F3', '材料结算', '材采', 'project-finance',
      'supplier-finance', 'contract-expense', 100, '2026-07-01', '已审批'
    )
  `)
  await mem.execute(`
    INSERT INTO invoices (
      id, invoice_number, invoice_date, total_amount, project_id,
      supplier_id, review_status, account_status
    )
    VALUES
      ('invoice-finance-a', 'INV-F3-A', '2026-07-02', 100,
       'project-finance', 'supplier-finance', 'reviewed', 'archived'),
      ('invoice-finance-b', 'INV-F3-B', '2026-07-03', 50,
       'project-finance', 'supplier-finance', 'reviewed', 'archived')
  `)
})

afterEach(() => {
  mem.close()
})

describe('f3 六条资金表单领域 action', () => {
  it('通过同一 Pinia store 保存六种真实实体、明细、分摊和附件', async () => {
    const store = useFinanceStore()
    const receipt = await store.saveForm('receipt', {
      no: 'SK-F3',
      receiptDate: '2026-07-10',
      projectId: 'project-finance',
      contractId: 'contract-income',
      customerId: 'customer-finance',
      amount: 120,
      paymentMethod: '银行转账',
      bankSerialNo: 'RECEIPT-BANK-F3',
      handler: '张工',
    }, 'submit')
    const invoiceApplication = await store.saveForm('invoice_application', {
      no: 'KP-F3',
      name: '工程款开票申请',
      projectId: 'project-finance',
      contractId: 'contract-income',
      customerId: 'customer-finance',
      buyerNameSnapshot: '资金客户',
      buyerTaxNoSnapshot: '91440100F3',
      invoiceType: '增值税专用发票',
      amount: 100,
      taxRate: 9,
      taxAmount: 9,
      applicant: '李工',
      applicationDate: '2026-07-11',
    }, 'submit')
    const current = await store.saveForm('current', {
      no: 'WL-F3',
      direction: 'receipt',
      projectId: 'project-finance',
      counterparty: '关联公司',
      purpose: '临时往来',
      amount: 20,
      transactionDate: '2026-07-12',
    }, 'submit')
    const reimbursement = await store.saveForm('reimbursement', {
      no: 'BX-F3',
      projectId: null,
      applicant: '王工',
      category: '公司费用',
      reimbursementDate: '2026-07-13',
      invoiceCount: 1,
      reason: '办公用品',
      lines: [{
        expenseItem: '打印纸',
        expenseDate: '2026-07-12',
        amount: 35.5,
        note: '',
      }],
    }, 'submit')
    const application = await store.saveForm('payment_application', {
      no: 'FK-F3',
      name: '材料付款申请',
      bizType: '有合同-材料',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
      costName: '材料',
      applyAmount: 100,
      applyDate: '2026-07-14',
      applicant: '赵工',
      invoiceState: '先票后款',
      settlementAllocations: [{
        settlementId: 'settlement-finance',
        allocatedAmount: 100,
        note: '',
      }],
      invoiceAllocations: [{
        invoiceId: 'invoice-finance-a',
        allocatedAmount: 100,
        note: '',
      }],
    }, 'submit', {
      add: [{
        fileName: '付款申请.pdf',
        filePath: 'C:\\finance\\付款申请.pdf',
        fileSize: 1024,
        category: '申请附件',
      }],
    })
    const payment = await store.saveForm('payment_record', {
      no: 'ZF-F3',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      payeeName: '资金分供方',
      purpose: '材料付款',
      paymentDate: '2026-07-15',
      amount: 100,
      paymentMethod: '银行转账',
      voucherNo: 'VOUCHER-F3',
      bankSerialNo: 'PAYMENT-BANK-F3',
      source: 'manual',
      recognitionStatus: 'not_applicable',
      ocrPayload: { bank: '测试银行', confidence: 0.99 },
      fieldConfidence: { amount: 0.99 },
      confirmedBy: '财务甲',
      applicationAllocations: [{
        paymentApplicationId: application.id,
        allocatedAmount: 100,
        note: '',
      }],
    }, 'confirm')

    expect(await loadFinanceForm('receipt', receipt.id)).toMatchObject({
      projectId: 'project-finance',
      contractId: 'contract-income',
      customerId: 'customer-finance',
      amount: 120,
      status: 'submitted',
    })
    expect(await loadFinanceForm('invoice_application', invoiceApplication.id)).toMatchObject({
      buyerTaxNoSnapshot: '91440100F3',
      totalAmount: 109,
    })
    expect(await loadFinanceForm('current', current.id)).toMatchObject({
      direction: 'receipt',
      counterparty: '关联公司',
    })
    expect(await loadFinanceForm('reimbursement', reimbursement.id)).toMatchObject({
      projectId: null,
      totalAmount: 35.5,
      lines: [expect.objectContaining({ amount: 35.5 })],
    })
    expect(await loadFinanceForm('payment_application', application.id)).toMatchObject({
      settlementDifference: 0,
      invoiceDifference: 0,
      pendingInvoiceAmount: 0,
      paidAmount: 100,
    })
    expect(await loadFinanceForm('payment_record', payment.id)).toMatchObject({
      confirmationStatus: 'confirmed',
      confirmedBy: '财务甲',
      ocrPayload: '{"bank":"测试银行","confidence":0.99}',
      fieldConfidence: '{"amount":0.99}',
      applicationAllocations: [
        expect.objectContaining({ paymentApplicationId: application.id }),
      ],
    })
    expect(await listFinanceFormAttachments(
      'payment_application',
      application.id,
    )).toEqual([
      expect.objectContaining({ fileName: '付款申请.pdf' }),
    ])
  })

  it('原子回滚头、明细与附件，不留下半条记录', async () => {
    const store = useFinanceStore()
    failFileInsert = true
    await expect(store.saveForm('reimbursement', {
      no: 'BX-ROLLBACK',
      applicant: '王工',
      reimbursementDate: '2026-07-13',
      lines: [{
        expenseItem: '交通费',
        amount: 18,
      }],
    }, 'submit', {
      add: [{ fileName: '票据.pdf' }],
    })).rejects.toThrow('模拟附件写入失败')

    expect(await mem.select(`
      SELECT id FROM expense_reimbursements WHERE no = 'BX-ROLLBACK'
    `)).toEqual([])
    expect(await mem.select(`
      SELECT id FROM expense_reimbursement_lines
    `)).toEqual([])
  })
})

describe('收款登记业务边界', () => {
  it('付款方必须是真实客户 ID，施工合同可选且金额保持收入正向事实', async () => {
    const store = useFinanceStore()

    await mem.execute(`
      INSERT INTO customers (id, name, tax_no, status)
      VALUES ('customer-other-project', '其他项目客户', '91440100OTHER', 'submitted')
    `)

    await expect(store.saveForm('receipt', {
      receiptDate: '2026-07-21',
      projectId: 'project-finance',
      customerId: 'customer-missing',
      amount: 88,
    }, 'submit')).rejects.toThrow('付款方客户不存在或已删除')

    await expect(store.saveForm('receipt', {
      receiptDate: '2026-07-21',
      projectId: 'project-finance',
      customerId: 'customer-other-project',
      amount: 88,
    }, 'submit')).rejects.toThrow('付款方客户必须是所选项目的主客户')

    const receipt = await store.saveForm('receipt', {
      no: 'SK-OPTIONAL-CONTRACT',
      receiptDate: '2026-07-21',
      projectId: 'project-finance',
      contractId: null,
      customerId: 'customer-finance',
      amount: 88,
    }, 'submit')
    expect(await loadFinanceForm('receipt', receipt.id)).toMatchObject({
      projectId: 'project-finance',
      contractId: null,
      customerId: 'customer-finance',
      amount: 88,
      status: 'submitted',
    })

    await expect(store.saveForm('receipt', {
      receiptDate: '2026-07-21',
      projectId: 'project-finance',
      customerId: 'customer-finance',
      amount: -1,
    }, 'draft')).rejects.toThrow('收款金额不能为负数')
  })
})

describe('付款申请票款勾稽', () => {
  it('分别执行先票后款、先款后票、无需发票三种提交规则', async () => {
    const store = useFinanceStore()
    await expect(store.saveForm('payment_application', {
      name: '先票后款不平',
      bizType: '项目费用',
      projectId: 'project-finance',
      applyAmount: 60,
      applyDate: '2026-07-16',
      applicant: '赵工',
      invoiceState: '先票后款',
      invoiceAllocations: [{
        invoiceId: 'invoice-finance-b',
        allocatedAmount: 50,
      }],
    }, 'submit')).rejects.toThrow('关联发票金额必须等于申请金额')

    const laterInvoice = await store.saveForm('payment_application', {
      name: '先款后票可无票',
      bizType: '项目费用',
      projectId: 'project-finance',
      applyAmount: 60,
      applyDate: '2026-07-16',
      applicant: '赵工',
      invoiceState: '先款后票',
      invoiceAllocations: [],
    }, 'submit')
    expect((await getPaymentApplicationSummary(laterInvoice.id)).pendingInvoiceAmount).toBe(60)

    await expect(store.saveForm('payment_application', {
      name: '无需发票误挂票',
      bizType: '项目费用',
      projectId: 'project-finance',
      applyAmount: 10,
      applyDate: '2026-07-16',
      applicant: '赵工',
      invoiceState: '无需发票',
      invoiceAllocations: [{
        invoiceId: 'invoice-finance-b',
        allocatedAmount: 10,
      }],
    }, 'submit')).rejects.toThrow('无需发票不能关联发票')
  })

  it('草稿允许不平，提交拒绝结算不平、孤儿、负数和跨申请超票额', async () => {
    const store = useFinanceStore()
    const draft = await store.saveForm('payment_application', {
      name: '草稿不平',
      bizType: '有合同-材料',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
      applyAmount: 100,
      applyDate: '2026-07-17',
      applicant: '赵工',
      invoiceState: '先款后票',
      settlementAllocations: [{
        settlementId: 'settlement-finance',
        allocatedAmount: 80,
      }],
    }, 'draft')
    expect((await getPaymentApplicationSummary(draft.id)).settlementDifference).toBe(20)

    await expect(store.saveForm('payment_application', {
      ...await loadFinanceForm('payment_application', draft.id),
      settlementAllocations: [{
        settlementId: 'settlement-finance',
        allocatedAmount: 80,
      }],
    }, 'submit')).rejects.toThrow('关联结算金额必须等于申请金额')

    await expect(store.saveForm('payment_application', {
      name: '孤儿结算',
      bizType: '有合同-材料',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
      applyAmount: 10,
      invoiceState: '先款后票',
      settlementAllocations: [{
        settlementId: 'missing-settlement',
        allocatedAmount: 10,
      }],
    }, 'draft')).rejects.toThrow('关联结算不存在或已删除')
    await expect(store.saveForm('payment_application', {
      name: '负分摊',
      bizType: '项目费用',
      projectId: 'project-finance',
      applyAmount: 10,
      invoiceState: '先款后票',
      invoiceAllocations: [{
        invoiceId: 'invoice-finance-b',
        allocatedAmount: -1,
      }],
    }, 'draft')).rejects.toThrow('分摊金额必须大于 0')

    await store.saveForm('payment_application', {
      name: '占用发票额度',
      bizType: '项目费用',
      projectId: 'project-finance',
      applyAmount: 45,
      applyDate: '2026-07-17',
      applicant: '赵工',
      invoiceState: '先票后款',
      invoiceAllocations: [{
        invoiceId: 'invoice-finance-b',
        allocatedAmount: 45,
      }],
    }, 'submit')
    await expect(store.saveForm('payment_application', {
      name: '突破发票额度',
      bizType: '项目费用',
      projectId: 'project-finance',
      applyAmount: 10,
      invoiceState: '先款后票',
      invoiceAllocations: [{
        invoiceId: 'invoice-finance-b',
        allocatedAmount: 10,
      }],
    }, 'draft')).rejects.toThrow('发票可关联额度不足')
  })
})

describe('支付事实确认与撤回', () => {
  it('未确认不计已付，确认要求守恒，撤回重算；重复流水整笔回滚', async () => {
    const store = useFinanceStore()
    const application = await store.saveForm('payment_application', {
      name: '公司付款',
      bizType: '公司付款',
      projectId: null,
      applyAmount: 100,
      applyDate: '2026-07-18',
      applicant: '财务',
      invoiceState: '无需发票',
    }, 'submit')
    const draftPayment = await store.saveForm('payment_record', {
      no: 'ZF-DRAFT',
      projectId: null,
      payeeName: '软件服务商',
      paymentDate: '2026-07-19',
      amount: 100,
      voucherNo: 'V-DRAFT',
      bankSerialNo: 'BANK-DRAFT',
      source: 'image_ocr',
      recognitionStatus: 'succeeded',
      applicationAllocations: [{
        paymentApplicationId: application.id,
        allocatedAmount: 80,
      }],
    }, 'submit')
    expect((await getPaymentApplicationSummary(application.id)).paidAmount).toBe(0)
    await expect(store.saveForm('payment_record', {
      ...await loadFinanceForm('payment_record', draftPayment.id),
      confirmedBy: '财务乙',
    }, 'confirm')).rejects.toThrow('支付分摊合计必须等于支付金额')

    const confirmed = await store.saveForm('payment_record', {
      ...await loadFinanceForm('payment_record', draftPayment.id),
      confirmedBy: '财务乙',
      applicationAllocations: [{
        paymentApplicationId: application.id,
        allocatedAmount: 100,
      }],
    }, 'confirm')
    expect((await getPaymentApplicationSummary(application.id)).paidAmount).toBe(100)
    expect(await getProjectConfirmedPaymentTotal('project-finance')).toBe(0)
    const [confirmationLog] = await mem.select<{
      before_data: string
      after_data: string
      operator: string
    }>(`
      SELECT before_data, after_data, operator
      FROM operation_logs
      WHERE table_name = 'payment_records'
        AND record_id = ?
        AND action = 'update'
        AND operator = '财务乙'
      ORDER BY created_at DESC
      LIMIT 1
    `, [confirmed.id])
    expect(JSON.parse(confirmationLog!.before_data).confirmation_status).toBe('needs_review')
    expect(JSON.parse(confirmationLog!.after_data)).toMatchObject({
      confirmation_status: 'confirmed',
      confirmed_by: '财务乙',
    })
    expect(confirmationLog!.operator).toBe('财务乙')

    await unconfirmPaymentRecord(confirmed.id)
    expect((await getPaymentApplicationSummary(application.id)).paidAmount).toBe(0)
    expect(await loadFinanceForm('payment_record', confirmed.id)).toMatchObject({
      confirmationStatus: 'needs_review',
      confirmedBy: '',
      confirmedAt: null,
    })

    const projectApplication = await store.saveForm('payment_application', {
      name: '项目付款',
      bizType: '项目费用',
      projectId: 'project-finance',
      applyAmount: 1,
      applyDate: '2026-07-20',
      applicant: '项目财务',
      invoiceState: '无需发票',
    }, 'submit')
    await expect(store.saveForm('payment_record', {
      payeeName: '公司级支付',
      projectId: null,
      paymentDate: '2026-07-20',
      amount: 1,
      voucherNo: 'V-COMPANY',
      bankSerialNo: 'BANK-COMPANY',
      applicationAllocations: [{
        paymentApplicationId: projectApplication.id,
        allocatedAmount: 1,
      }],
    }, 'submit')).rejects.toThrow('项目归属不一致')

    await expect(store.saveForm('payment_record', {
      no: 'ZF-DUP',
      payeeName: '另一个收款方',
      paymentDate: '2026-07-20',
      amount: 1,
      voucherNo: 'V-DUP',
      bankSerialNo: 'BANK-DRAFT',
      applicationAllocations: [],
    }, 'submit')).rejects.toThrow()
    expect(await mem.select(`
      SELECT id FROM payment_records WHERE no = 'ZF-DUP'
    `)).toEqual([])
  })
})
