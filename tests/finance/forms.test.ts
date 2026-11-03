import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withTransaction } from '~/lib/db/connection'
import { financeFileHash, verifyFinanceAttachments } from '~/lib/finance/attachment-proof'
import { deleteFinanceFormInTransaction } from '~/lib/finance/domain'
import { readVerifiedOriginalExpense } from '~/lib/finance/expense-reference'
import {
  getPaymentApplicationSummary,
  listFinanceFormAttachments,
  loadFinanceForm,
  unconfirmPaymentRecord,
} from '~/lib/finance/forms'
import { verifiedFinanceSum } from '~/lib/finance/persistent-rows'
import { fileRefDraftFromFile, loadFileRefContent } from '~/lib/forms/file-refs'
import { useFinanceStore } from '~/stores/finance'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb
let failFileInsert = false
let failReadOnce = false

vi.mock('~/lib/db/connection', () => ({
  execute: (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: <T>(sql: string, params?: unknown[]) => {
    if (failReadOnce && /SELECT \* FROM expense_reimbursements/i.test(sql)) {
      failReadOnce = false
      throw new Error('同一记录回读中断')
    }
    return mem.select<T>(sql, params)
  },
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

/** 项目已确认现金合计：与付款汇总同口径，未知值不按零汇总。 */
async function confirmedPaymentTotal(projectId: string) {
  const rows = await mem.select<{ amount: unknown }>('SELECT amount FROM payment_records WHERE project_id=? AND confirmation_status=\'confirmed\' AND deleted_at IS NULL', [projectId])
  return verifiedFinanceSum(rows.map(row => row.amount))
}

function deleteFinanceForm(kind: Parameters<typeof deleteFinanceFormInTransaction>[0], id: string) {
  return withTransaction(tx => deleteFinanceFormInTransaction(kind, id, tx))
}

beforeEach(async () => {
  failFileInsert = false
  failReadOnce = false
  mem = await createMigratedMemoryDb()
  setActivePinia(createPinia())
  await mem.execute(`
    INSERT INTO customers (id, name, tax_no, status)
    VALUES ('customer-finance', '资金客户', '91440100F3', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id, approval_status)
    VALUES ('project-finance', '资金项目', 'customer-finance', 'submitted')
  `)
  await mem.execute(`INSERT INTO workers(id,name) VALUES('worker-finance','资金工人'),('worker-other','同名工人')`)
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
      'supplier-finance', 'contract-expense', 100, '2026-07-01', '已确认'
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
  it('native费用与开票申请列表核原行，空费用草稿和真实零合法，损坏新读撤旧表而不发布合计零', async () => {
    const store = useFinanceStore()
    await mem.execute(`INSERT INTO expense_reimbursements(id,applicant,status) VALUES('native-list-expense','实际费用人','draft')`)
    expect(await store.loadList('reimbursement')).toMatchObject([{ id: 'native-list-expense', amount: 0 }])
    await mem.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount) VALUES('native-list-line','native-list-expense','实际费用',10.000001)`)
    expect(await store.loadList('reimbursement')).toMatchObject([{ id: 'native-list-expense', amount: 10.000001 }])
    await mem.execute('UPDATE expense_reimbursement_lines SET amount=\'unknown\' WHERE id=\'native-list-line\'')
    await expect(store.loadList('reimbursement')).rejects.toThrow('未知值按零汇总')
    expect(store.listRows.reimbursement).toBeUndefined()
    expect(await mem.select('SELECT amount FROM expense_reimbursement_lines WHERE id=\'native-list-line\'')).toEqual([{ amount: 'unknown' }])
    await mem.execute(`INSERT INTO invoice_applications(id,name,amount,tax_amount,status) VALUES('native-list-billing','原开票申请',0,0,'draft')`)
    expect(await store.loadList('invoice_application')).toMatchObject([{ id: 'native-list-billing', amount: 0 }])
    await mem.execute('UPDATE invoice_applications SET amount=10.000001,tax_amount=1.000002 WHERE id=\'native-list-billing\'')
    expect(await store.loadList('invoice_application')).toMatchObject([{ id: 'native-list-billing', amount: 11.000003 }])
    await mem.execute('UPDATE invoice_applications SET tax_amount=\'unknown\' WHERE id=\'native-list-billing\'')
    await expect(store.loadList('invoice_application')).rejects.toThrow('未知值按零汇总')
    expect(store.listRows.invoice_application).toBeUndefined()
    expect(await mem.select('SELECT amount,tax_amount FROM invoice_applications WHERE id=\'native-list-billing\'')).toEqual([{ amount: 10.000001, tax_amount: 'unknown' }])
  })

  it('native票款候选核真实分摊，未知不能显示可用全额或已付零，排除当前源与公司归属保持准确', async () => {
    const store = useFinanceStore()
    await mem.execute(`INSERT INTO payment_applications(id,name,biz_type,supplier_id,apply_amount,status) VALUES('native-candidate-app','实际公司付款申请','公司付款','supplier-finance',100,'submitted')`)
    const invoiceScope = { projectId: 'project-finance', supplierId: 'supplier-finance' }
    expect((await store.searchInvoices(invoiceScope, 'INV-F3-A'))[0]!.hint).toContain('剩余 ¥100.00')
    await mem.execute(`INSERT INTO payment_application_invoice_allocations(id,payment_application_id,invoice_id,allocated_amount) VALUES('native-candidate-invoice','native-candidate-app','invoice-finance-a',10)`)
    expect((await store.searchInvoices(invoiceScope, 'INV-F3-A'))[0]!.hint).toContain('剩余 ¥90.00')
    await mem.execute('UPDATE payment_application_invoice_allocations SET allocated_amount=\'unknown\' WHERE id=\'native-candidate-invoice\'')
    await expect(store.searchInvoices(invoiceScope, 'INV-F3-A')).rejects.toThrow('未知值按零汇总')
    expect((await store.searchInvoices({ ...invoiceScope, excludePaymentApplicationId: 'native-candidate-app' }, 'INV-F3-A'))[0]!.hint).toContain('剩余 ¥100.00')
    const scope = { projectId: null, supplierId: 'supplier-finance' }
    expect((await store.searchPaymentApplications(scope, '实际公司'))[0]!.hint).toContain('已付 ¥0.00')
    expect(await store.searchPaymentApplications({ ...scope, projectId: 'project-finance' }, '实际公司')).toEqual([])
    await mem.execute(`INSERT INTO payment_records(id,supplier_id,payee_name,payment_date,amount,voucher_no,bank_serial_no,confirmed_by,confirmed_at,confirmation_status) VALUES('native-candidate-paid','supplier-finance','实际收款人','2026-10-05',30,'CANDIDATE-PAID','CANDIDATE-PAID','财务','2026-10-05T01:00:00.000Z','needs_review')`)
    await mem.execute(`INSERT INTO payment_record_application_allocations(id,payment_record_id,payment_application_id,allocated_amount) VALUES('native-candidate-paid-line','native-candidate-paid','native-candidate-app',30)`)
    await mem.execute('UPDATE payment_records SET confirmation_status=\'confirmed\' WHERE id=\'native-candidate-paid\'')
    expect((await store.searchPaymentApplications(scope, '实际公司'))[0]!.hint).toContain('已付 ¥30.00')
    const guard = (await mem.select<{ sql: string }>('SELECT sql FROM sqlite_schema WHERE name=\'trg_confirmed_payment_allocation_update\''))[0]!.sql
    await mem.execute('DROP TRIGGER trg_confirmed_payment_allocation_update')
    await mem.execute('UPDATE payment_record_application_allocations SET allocated_amount=\'unknown\' WHERE id=\'native-candidate-paid-line\'')
    await mem.execute(guard)
    await expect(store.searchPaymentApplications(scope, '实际公司')).rejects.toThrow('未知值按零汇总')
    expect(await mem.select('SELECT allocated_amount FROM payment_record_application_allocations WHERE id=\'native-candidate-paid-line\'')).toEqual([{ allocated_amount: 'unknown' }])
    expect(await mem.select('SELECT amount,confirmation_status FROM payment_records WHERE id=\'native-candidate-paid\'')).toEqual([{ amount: 30, confirmation_status: 'confirmed' }])
  })
  it('已有原清偿和票款分摊的损坏金额不能由SQLite SUM转成零，空集合与真实零保持可证', async () => {
    const store = useFinanceStore()
    expect(verifiedFinanceSum([])).toBe(0)
    expect(verifiedFinanceSum([0, 0.1000001])).toBe(0.1000001)
    expect(() => verifiedFinanceSum([null])).toThrow('未知值按零汇总')
    const original = await store.saveForm('reimbursement', { applicantSupplierId: 'supplier-finance', reimbursementDate: '2026-10-05', status: 'confirmed', lines: [{ expenseItem: '真实原费用', counterpartySupplierId: 'supplier-finance', amount: 40 }] }, 'save')
    const sourceId = (await loadFinanceForm('reimbursement', original.id))!.lines[0]!.id!
    expect(await readVerifiedOriginalExpense(mem, sourceId)).toMatchObject({ amount: 40, clearedAmount: 0 })
    const clearance = await store.saveForm('reimbursement', { applicantSupplierId: 'supplier-finance', reimbursementDate: '2026-10-05', status: 'confirmed', lines: [{ expenseItem: '真实清偿', amount: 10, originalExpenseLineId: sourceId }] }, 'save')
    const clearanceId = (await loadFinanceForm('reimbursement', clearance.id))!.lines[0]!.id!
    await mem.execute(`UPDATE expense_reimbursement_lines SET amount='unknown' WHERE id=?`, [clearanceId])
    await expect(readVerifiedOriginalExpense(mem, sourceId)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(store.saveForm('reimbursement', { applicantSupplierId: 'supplier-finance', reimbursementDate: '2026-10-05', lines: [{ expenseItem: '不得超未知余额', amount: 40, originalExpenseLineId: sourceId }] }, 'submit')).rejects.toThrow('未知值按零汇总')
    expect(await mem.select('SELECT amount FROM expense_reimbursement_lines WHERE id=?', [clearanceId])).toEqual([{ amount: 'unknown' }])
    await expect(mem.execute('UPDATE expense_reimbursement_lines SET amount=0 WHERE id=?', [clearanceId])).rejects.toThrow('CHECK')
    await mem.execute('UPDATE expense_reimbursement_lines SET amount=10 WHERE id=?', [clearanceId])
    expect(await readVerifiedOriginalExpense(mem, sourceId)).toMatchObject({ clearedAmount: 10 })
    const allocated = await store.saveForm('payment_application', { name: '真实旧结算分摊', bizType: '有合同-材料', projectId: 'project-finance', supplierId: 'supplier-finance', contractId: 'contract-expense', applyAmount: 10, settlementAllocations: [{ settlementId: 'settlement-finance', allocatedAmount: 10 }], invoiceAllocations: [{ invoiceId: 'invoice-finance-a', allocatedAmount: 10 }] }, 'draft')
    await mem.execute(`UPDATE payment_application_settlement_allocations SET allocated_amount='unknown' WHERE payment_application_id=?`, [allocated.id])
    await expect(store.saveForm('payment_application', { name: '不按零重占结算', bizType: '有合同-材料', projectId: 'project-finance', supplierId: 'supplier-finance', contractId: 'contract-expense', applyAmount: 100, settlementAllocations: [{ settlementId: 'settlement-finance', allocatedAmount: 100 }] }, 'draft')).rejects.toThrow('未知值按零汇总')
    await mem.execute('UPDATE payment_application_settlement_allocations SET allocated_amount=10 WHERE payment_application_id=?', [allocated.id])
    await mem.execute(`UPDATE payment_application_invoice_allocations SET allocated_amount='unknown' WHERE payment_application_id=?`, [allocated.id])
    await expect(store.saveForm('payment_application', { name: '不按零重占发票', bizType: '预付款', projectId: 'project-finance', supplierId: 'supplier-finance', contractId: 'contract-expense', applyAmount: 100, invoiceAllocations: [{ invoiceId: 'invoice-finance-a', allocatedAmount: 100 }] }, 'draft')).rejects.toThrow('未知值按零汇总')
  })

  it('native读取真实零不变，损坏金额、税率、数量和分摊不得兜底为零', async () => {
    await mem.execute(`INSERT INTO current_transactions(id,direction,amount,status) VALUES('native-known-zero','payment',0,'draft')`)
    expect((await loadFinanceForm('current', 'native-known-zero'))!.amount).toBe(0)
    await mem.execute(`UPDATE current_transactions SET amount='unknown' WHERE id='native-known-zero'`)
    await expect(loadFinanceForm('current', 'native-known-zero')).rejects.toThrow('不能按零采用')
    expect(await mem.select(`SELECT amount FROM current_transactions WHERE id='native-known-zero'`)).toEqual([{ amount: 'unknown' }])
    await mem.execute(`INSERT INTO invoice_applications(id,name,tax_rate,status) VALUES('native-bad-tax','原税率','unknown','draft')`)
    await expect(loadFinanceForm('invoice_application', 'native-bad-tax')).rejects.toThrow('不能按零采用')
    await mem.execute(`INSERT INTO expense_reimbursements(id,applicant,invoice_count,status) VALUES('native-bad-count','原报销人','unknown','draft')`)
    await expect(loadFinanceForm('reimbursement', 'native-bad-count')).rejects.toThrow('不能按零采用')
    await mem.execute(`INSERT INTO payment_applications(id,name,apply_amount,status) VALUES('native-bad-allocation','原分摊申请',100,'draft')`)
    await mem.execute(`INSERT INTO payment_application_invoice_allocations(id,payment_application_id,invoice_id,allocated_amount) VALUES('native-unknown-line','native-bad-allocation','invoice-finance-a','unknown')`)
    await expect(loadFinanceForm('payment_application', 'native-bad-allocation')).rejects.toThrow('不能按零采用')
  })
  it('历史姓名原文逐字保全，编辑备注和明示稳定身份不覆盖原文、原件或原审计', async () => {
    const store = useFinanceStore()
    const currentRaw = '\t 原往来姓名 \n'
    const applicantRaw = '\n 原垫付姓名　\t'
    await mem.execute(`INSERT INTO current_transactions(id,direction,project_id,counterparty,amount,transaction_date,status) VALUES('legacy-raw-current','receipt','project-finance',?,20,'2026-07-01','submitted')`, [currentRaw])
    await mem.execute(`INSERT INTO expense_reimbursements(id,applicant,reimbursement_date,status) VALUES('legacy-raw-expense',?,'2026-07-01','confirmed')`, [applicantRaw])
    await mem.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount) VALUES('legacy-raw-line','legacy-raw-expense','历史费用',40)`)
    await mem.execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size) VALUES('legacy-raw-file','expense_reimbursement','legacy-raw-expense','原姓名依据.bin',4)`)
    await mem.execute(`INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES('legacy-raw-file','base64','AAqA/w==')`)
    await mem.execute(`INSERT INTO operation_logs(id,table_name,record_id,action,after_data) VALUES('legacy-raw-audit','expense_reimbursements','legacy-raw-expense','legacy-import',?)`, [JSON.stringify({ applicant: applicantRaw })])
    const originalAudit = await mem.select(`SELECT * FROM operation_logs WHERE id='legacy-raw-audit'`)
    const originalFiles = await mem.select(`SELECT * FROM file_refs WHERE id='legacy-raw-file'`)
    const originalPayload = await mem.select(`SELECT * FROM file_payloads WHERE file_ref_id='legacy-raw-file'`)
    await store.saveForm('current', { ...(await loadFinanceForm('current', 'legacy-raw-current'))!, purpose: '只补充说明' }, 'save')
    await store.saveForm('reimbursement', { ...(await loadFinanceForm('reimbursement', 'legacy-raw-expense'))!, note: '只补充说明' }, 'save')
    expect(await mem.select(`SELECT counterparty,supplier_id FROM current_transactions WHERE id='legacy-raw-current'`)).toEqual([{ counterparty: currentRaw, supplier_id: null }])
    expect(await mem.select(`SELECT applicant,applicant_worker_id,applicant_supplier_id FROM expense_reimbursements WHERE id='legacy-raw-expense'`)).toEqual([{ applicant: applicantRaw, applicant_worker_id: null, applicant_supplier_id: null }])
    await store.saveForm('current', { ...(await loadFinanceForm('current', 'legacy-raw-current'))!, supplierId: 'supplier-finance', counterparty: '不能覆盖旧原文' }, 'save')
    await store.saveForm('reimbursement', { ...(await loadFinanceForm('reimbursement', 'legacy-raw-expense'))!, applicantWorkerId: 'worker-finance', applicant: '不能覆盖旧原文' }, 'save')
    expect(await loadFinanceForm('current', 'legacy-raw-current')).toMatchObject({ counterparty: currentRaw, supplierId: 'supplier-finance' })
    expect(await loadFinanceForm('reimbursement', 'legacy-raw-expense')).toMatchObject({ applicant: applicantRaw, applicantWorkerId: 'worker-finance' })
    expect(await mem.select(`SELECT * FROM operation_logs WHERE id='legacy-raw-audit'`)).toEqual(originalAudit)
    expect(await mem.select(`SELECT * FROM file_refs WHERE id='legacy-raw-file'`)).toEqual(originalFiles)
    expect(await mem.select(`SELECT * FROM file_payloads WHERE file_ref_id='legacy-raw-file'`)).toEqual(originalPayload)
    const [original] = await listFinanceFormAttachments('reimbursement', 'legacy-raw-expense')
    expect((await loadFileRefContent(original!))?.bytes).toEqual(new Uint8Array([0, 10, 128, 255]))
    const edits = await mem.select<{ before_data: string, after_data: string }>(`SELECT before_data,after_data FROM operation_logs WHERE table_name='expense_reimbursements' AND action='update' ORDER BY id`)
    expect(edits).toHaveLength(2)
    for (const edit of edits) {
      expect(JSON.parse(edit.before_data).applicant).toBe(applicantRaw)
      expect(JSON.parse(edit.after_data).applicant).toBe(applicantRaw)
    }
    const created = await store.saveForm('current', { direction: 'receipt', supplierId: 'supplier-finance', counterparty: ' 新输入规范 ', amount: 0 }, 'draft')
    expect(await loadFinanceForm('current', created.id)).toMatchObject({ counterparty: '新输入规范' })
  })

  it('冻结姓名完整文本读写及原费用清偿不trim，主档改名后原快照/原件仍冻结', async () => {
    const store = useFinanceStore()
    const workerName = '\t 工人原名 \n'
    const supplierName = '\n 分供方原名　\t'
    await mem.execute(`UPDATE workers SET name=? WHERE id='worker-finance'`, [workerName])
    await mem.execute(`UPDATE suppliers SET name=? WHERE id='supplier-finance'`, [supplierName])
    const current = await store.saveForm('current', { direction: 'receipt', projectId: 'project-finance', supplierId: 'supplier-finance', amount: 20, transactionDate: '2026-10-05' }, 'submit')
    const expense = await store.saveForm('reimbursement', { applicantWorkerId: 'worker-finance', reimbursementDate: '2026-10-05', status: 'confirmed', lines: [{ expenseItem: '原费用', amount: 40, counterpartySupplierId: 'supplier-finance' }] }, 'save', { add: [await fileRefDraftFromFile(new File([new Uint8Array([0, 10, 128, 255])], '冻结原件.bin'))] })
    const source = (await loadFinanceForm('reimbursement', expense.id))!
    expect(await loadFinanceForm('current', current.id)).toMatchObject({ counterpartyNameSnapshot: supplierName })
    expect(source).toMatchObject({ applicantNameSnapshot: workerName, lines: [{ counterpartyNameSnapshot: supplierName }] })
    const files = await mem.select('SELECT * FROM file_refs ORDER BY id')
    const payloads = await mem.select('SELECT * FROM file_payloads ORDER BY file_ref_id')
    const oldLogs = await mem.select<{ id: string }>('SELECT * FROM operation_logs ORDER BY id')
    const clearance = await store.saveForm('reimbursement', { applicantWorkerId: 'worker-finance', reimbursementDate: '2026-10-05', lines: [{ expenseItem: '清偿原费用', amount: 10, originalExpenseLineId: source.lines[0]!.id }] }, 'submit')
    expect(await loadFinanceForm('reimbursement', clearance.id)).toMatchObject({ applicantNameSnapshot: workerName, lines: [{ counterpartyNameSnapshot: supplierName, originalExpenseLineId: source.lines[0]!.id }] })
    await mem.execute(`UPDATE workers SET name='后来姓名' WHERE id='worker-finance'`)
    await mem.execute(`UPDATE suppliers SET name='后来名称' WHERE id='supplier-finance'`)
    await store.saveForm('current', { ...(await loadFinanceForm('current', current.id))!, note: '只改说明' }, 'save')
    await store.saveForm('reimbursement', { ...source, note: '已采用原费用只改说明' }, 'save')
    expect(await loadFinanceForm('current', current.id)).toMatchObject({ counterpartyNameSnapshot: supplierName })
    expect(await loadFinanceForm('reimbursement', expense.id)).toMatchObject({ applicantNameSnapshot: workerName, lines: [{ counterpartyNameSnapshot: supplierName, amount: 40 }] })
    expect(await mem.select('SELECT * FROM file_refs ORDER BY id')).toEqual(files)
    expect(await mem.select('SELECT * FROM file_payloads ORDER BY file_ref_id')).toEqual(payloads)
    for (const log of oldLogs)
      expect((await mem.select('SELECT * FROM operation_logs WHERE id=?', [log.id]))[0]).toEqual(log)
    expect(await mem.select('SELECT * FROM payment_records')).toEqual([])
  })

  it('草稿转正式重新核实当前身份，已采用历史编辑及同原费用清偿保留冻结身份', async () => {
    const store = useFinanceStore()
    const current = await store.saveForm('current', { direction: 'payment', projectId: 'project-finance', supplierId: 'supplier-finance', amount: 20, transactionDate: '2026-10-05' }, 'draft')
    const cost = await store.saveForm('reimbursement', { applicantWorkerId: 'worker-finance', reimbursementDate: '2026-10-05', lines: [{ expenseItem: '新费用', amount: 40, counterpartySupplierId: 'supplier-finance' }] }, 'draft')
    const currentDraft = (await loadFinanceForm('current', current.id))!
    const costDraft = (await loadFinanceForm('reimbursement', cost.id))!
    await mem.execute(`UPDATE suppliers SET deleted_at='2026-10-05' WHERE id='supplier-finance'`)
    const before = await mem.select('SELECT * FROM operation_logs ORDER BY id')
    await expect(store.saveForm('current', currentDraft, 'submit')).rejects.toThrow('不存在或已删除')
    await expect(store.saveForm('reimbursement', costDraft, 'submit')).rejects.toThrow('不存在或已删除')
    expect(await mem.select('SELECT * FROM operation_logs ORDER BY id')).toEqual(before)
    expect(await loadFinanceForm('current', current.id)).toEqual(currentDraft)
    expect(await loadFinanceForm('reimbursement', cost.id)).toEqual(costDraft)
    await mem.execute(`UPDATE suppliers SET deleted_at=NULL,name='后来名称' WHERE id='supplier-finance'`)
    await mem.execute(`UPDATE workers SET deleted_at='2026-10-05' WHERE id='worker-finance'`)
    await expect(store.saveForm('reimbursement', costDraft, 'submit')).rejects.toThrow('不存在或已删除')
    await mem.execute(`UPDATE workers SET deleted_at=NULL,name='后来姓名' WHERE id='worker-finance'`)
    await store.saveForm('current', currentDraft, 'submit')
    await store.saveForm('reimbursement', { ...costDraft, status: 'confirmed' }, 'save')
    expect(await loadFinanceForm('current', current.id)).toMatchObject({ counterpartyNameSnapshot: '资金分供方' })
    const source = (await loadFinanceForm('reimbursement', cost.id))!
    expect(source).toMatchObject({ applicantNameSnapshot: '资金工人', lines: [{ counterpartyNameSnapshot: '资金分供方' }] })
    const cleared = await store.saveForm('reimbursement', { applicantWorkerId: 'worker-finance', reimbursementDate: '2026-10-05', lines: [{ expenseItem: '清偿原费用', amount: 10, originalExpenseLineId: source.lines[0]!.id }] }, 'draft')
    const clearanceDraft = (await loadFinanceForm('reimbursement', cleared.id))!
    await mem.execute(`UPDATE workers SET deleted_at='2026-10-05' WHERE id='worker-finance'`)
    await mem.execute(`UPDATE suppliers SET deleted_at='2026-10-05' WHERE id='supplier-finance'`)
    await store.saveForm('current', { ...(await loadFinanceForm('current', current.id))!, note: '只编辑历史说明' }, 'save')
    await store.saveForm('reimbursement', clearanceDraft, 'submit')
    expect(await loadFinanceForm('reimbursement', cleared.id)).toMatchObject({ applicantWorkerId: 'worker-finance', lines: [{ originalExpenseLineId: source.lines[0]!.id, counterpartySupplierId: 'supplier-finance', counterpartyNameSnapshot: '资金分供方' }] })
    expect(await mem.select('SELECT * FROM payment_records')).toEqual([])
  })

  it('全局工人跨项目可检索；往来及垫付人采用稳定 ID 并冻结名，改名不改写历史或猜同名', async () => {
    const store = useFinanceStore()
    await mem.execute(`UPDATE workers SET current_project_id='project-finance' WHERE id='worker-finance'`)
    expect(await store.searchWorkers('资金')).toEqual([{ id: 'worker-finance', label: '资金工人' }])
    const current = await store.saveForm('current', { direction: 'receipt', projectId: 'project-finance', supplierId: 'supplier-finance', counterparty: '个人原文', amount: 20, transactionDate: '2026-10-04' }, 'submit')
    const expense = await store.saveForm('reimbursement', { applicantWorkerId: 'worker-finance', applicant: '历史姓名原文', reimbursementDate: '2026-10-04', lines: [{ expenseItem: '真实运输', amount: 40, counterpartySupplierId: 'supplier-finance' }] }, 'submit')
    await mem.execute(`UPDATE workers SET name='后来工人姓名' WHERE id='worker-finance'`)
    await mem.execute(`UPDATE suppliers SET name='后来分供方名称' WHERE id='supplier-finance'`)
    const read = (await loadFinanceForm('reimbursement', expense.id))!
    expect(read).toMatchObject({ applicantWorkerId: 'worker-finance', applicantSupplierId: null, applicant: '历史姓名原文', applicantNameSnapshot: '资金工人', lines: [{ counterpartySupplierId: 'supplier-finance', counterpartyNameSnapshot: '资金分供方' }] })
    await store.saveForm('reimbursement', { ...read, note: '只改备注' }, 'save')
    expect((await loadFinanceForm('reimbursement', expense.id))!.applicantNameSnapshot).toBe('资金工人')
    expect(await loadFinanceForm('current', current.id)).toMatchObject({ supplierId: 'supplier-finance', counterparty: '个人原文', counterpartyNameSnapshot: '资金分供方' })
    const before = await mem.select('SELECT * FROM operation_logs ORDER BY id')
    await expect(store.saveForm('reimbursement', { applicantWorkerId: 'worker-finance', applicantSupplierId: 'supplier-finance', lines: [{ amount: 1 }] }, 'draft')).rejects.toThrow('不能同时选择')
    await expect(store.saveForm('reimbursement', { applicantWorkerId: 'missing', lines: [{ amount: 1 }] }, 'draft')).rejects.toThrow('不存在或已删除')
    expect(await mem.select('SELECT * FROM operation_logs ORDER BY id')).toEqual(before)
    expect(await mem.select('SELECT * FROM payment_records')).toEqual([])
  })

  it('稳定垫付原费用允许同身份清偿，重复清偿拒绝且源头姓名/交易方/金额和原件均冻结', async () => {
    const store = useFinanceStore()
    const source = await store.saveForm('reimbursement', { projectId: 'project-finance', applicantWorkerId: 'worker-finance', reimbursementDate: '2026-10-04', status: 'confirmed', lines: [{ expenseItem: '独立运费', amount: 40, counterpartySupplierId: 'supplier-finance' }] }, 'save', { add: [await fileRefDraftFromFile(new File(['source'], '原依据.txt'))] })
    const original = (await loadFinanceForm('reimbursement', source.id))!
    const sourceId = original.lines[0]!.id!
    const repayment = { projectId: 'project-finance', applicantWorkerId: 'worker-finance', reimbursementDate: '2026-10-04', lines: [{ expenseItem: '原运费清偿', amount: 40, originalExpenseLineId: sourceId }] }
    await expect(store.saveForm('reimbursement', { ...repayment, applicantWorkerId: 'worker-other' }, 'submit')).rejects.toThrow('同一垫付')
    const cleared = await store.saveForm('reimbursement', repayment, 'submit')
    expect(await loadFinanceForm('reimbursement', cleared.id)).toMatchObject({ applicantWorkerId: 'worker-finance', lines: [{ originalExpenseLineId: sourceId, counterpartySupplierId: 'supplier-finance', counterpartyNameSnapshot: '资金分供方', amount: 40 }] })
    const rows = await mem.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')
    const logs = await mem.select('SELECT * FROM operation_logs ORDER BY id')
    await expect(store.saveForm('reimbursement', repayment, 'submit')).rejects.toThrow('不能超过原垫付金额')
    expect(await mem.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')).toEqual(rows)
    expect(await mem.select('SELECT * FROM operation_logs ORDER BY id')).toEqual(logs)
    await expect(mem.execute(`UPDATE expense_reimbursements SET applicant_worker_id='worker-other' WHERE id=?`, [source.id])).rejects.toThrow('垫付身份不可改写')
    await expect(mem.execute(`UPDATE expense_reimbursement_lines SET counterparty_name_snapshot='伪造' WHERE id=?`, [sourceId])).rejects.toThrow('交易方不可改写')
    expect(await loadFinanceForm('reimbursement', source.id)).toEqual(original)
    const [cost] = await mem.select<{ amount: number }>('SELECT SUM(amount) AS amount FROM expense_reimbursement_lines WHERE deleted_at IS NULL AND original_expense_line_id IS NULL')
    expect(cost!.amount).toBe(40)
    expect(await mem.select('SELECT * FROM payment_records')).toEqual([])
    const sourceFiles = await listFinanceFormAttachments('reimbursement', source.id)
    expect(new TextDecoder().decode((await loadFileRefContent(sourceFiles[0]!))!.bytes)).toBe('source')
  })

  it('同一报销批次多行清偿也守原额；晚失败完整回滚身份、原引用、原件与审计', async () => {
    const store = useFinanceStore()
    const source = await store.saveForm('reimbursement', { applicantSupplierId: 'supplier-finance', reimbursementDate: '2026-10-04', status: 'confirmed', lines: [{ expenseItem: '公司原费用', amount: 40 }] }, 'save')
    const sourceId = (await loadFinanceForm('reimbursement', source.id))!.lines[0]!.id!
    const input = { applicantSupplierId: 'supplier-finance', reimbursementDate: '2026-10-04', lines: [{ expenseItem: '清偿一', amount: 30, originalExpenseLineId: sourceId }, { expenseItem: '清偿二', amount: 20, originalExpenseLineId: sourceId }] }
    const graph = await mem.select('SELECT * FROM expense_reimbursements ORDER BY id')
    await expect(store.saveForm('reimbursement', input, 'submit')).rejects.toThrow('不能超过原垫付金额')
    failFileInsert = true
    await expect(store.saveForm('reimbursement', { ...input, lines: [input.lines[0]!] }, 'submit', { add: [{ fileName: '清偿证明' }] })).rejects.toThrow('模拟附件写入失败')
    expect(await mem.select('SELECT * FROM expense_reimbursements ORDER BY id')).toEqual(graph)
    expect(await mem.select('SELECT * FROM expense_reimbursement_lines WHERE original_expense_line_id IS NOT NULL')).toEqual([])
    expect(await mem.select('SELECT * FROM file_refs')).toEqual([])
  })

  it('原件正文同库保存、摘要匹配，真实空件可读取；历史路径 metadata-only 不补造正文', async () => {
    const store = useFinanceStore()
    const original = new Uint8Array([0, 128, 255, 13, 10])
    const add = await Promise.all([fileRefDraftFromFile(new File([original], '原字节.bin')), fileRefDraftFromFile(new File([], '真实空件'))])
    const result = await store.saveForm('reimbursement', { applicant: '原申请人', reimbursementDate: '2026-10-04', lines: [{ expenseItem: '原费用', amount: 40 }] }, 'draft', { add: [...add, { fileName: '历史.pdf', filePath: 'C:\\原文\\历史.pdf', fileSize: 100 }] })
    const files = await listFinanceFormAttachments('reimbursement', result.id, true)
    await verifyFinanceAttachments({ ...result, attachmentIds: result.attachmentIds.slice(0, 2) }, { add }, files, () => true)
    const bytes = (await loadFileRefContent(files.find(file => file.id === result.attachmentIds[0])!))!.bytes
    expect(Array.from(bytes)).toEqual([0, 128, 255, 13, 10])
    expect(await financeFileHash(bytes)).toBe(await financeFileHash(original))
    expect((await loadFileRefContent(files.find(file => file.id === result.attachmentIds[1])!))!.bytes).toHaveLength(0)
    expect(await loadFileRefContent(files.find(file => file.id === result.attachmentIds[2])!)).toBeNull()
    const evidence = await mem.select('SELECT * FROM file_refs ORDER BY id')
    await mem.execute('UPDATE file_payloads SET content = ? WHERE file_ref_id = ?', [btoa('wrong'), result.attachmentIds[0]])
    await expect(verifyFinanceAttachments({ ...result, attachmentIds: result.attachmentIds.slice(0, 2) }, { add }, files, () => true)).rejects.toThrow('摘要')
    expect(await mem.select('SELECT * FROM file_refs ORDER BY id')).toEqual(evidence)
  })

  it('已提交事务的回读失败返回已保存事实；只读恢复不重复写原费用或审计', async () => {
    const store = useFinanceStore()
    failReadOnce = true
    const result = await store.saveForm('reimbursement', { applicant: '申请人原文', reimbursementDate: '2026-10-04', lines: [{ expenseItem: '一次费用', amount: 40 }] }, 'draft')
    expect(result).toMatchObject({ readbackConfirmed: false, readbackProblem: '同一记录回读中断' })
    expect(result.id).toBeTruthy()
    const logs = await mem.select('SELECT * FROM operation_logs ORDER BY id')
    const saved = await store.loadOne('reimbursement', result.id)
    expect(saved?.applicant).toBe('申请人原文')
    expect(await mem.select('SELECT * FROM expense_reimbursements')).toHaveLength(1)
    expect(await mem.select('SELECT * FROM expense_reimbursement_lines')).toHaveLength(1)
    expect(await mem.select('SELECT * FROM operation_logs ORDER BY id')).toEqual(logs)
  })
  it('明示原费用草稿可可靠读取，历史垫付身份仍未知时拒绝确认且保全原申请人、金额和审计', async () => {
    const store = useFinanceStore()
    await mem.execute(`INSERT INTO expense_reimbursements(id,project_id,applicant,reimbursement_date,status) VALUES('legacy-original','project-finance','历史申请人原文','2026-07-01','confirmed')`)
    await mem.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount) VALUES('legacy-line','legacy-original','真实原运费',40)`)
    const original = { id: 'legacy-original' }
    const originalForm = await loadFinanceForm('reimbursement', original.id)
    const originalId = originalForm.lines![0]!.id!
    const draft = await store.saveForm('reimbursement', { projectId: 'project-finance', applicant: '新申请文本', applicantWorkerId: 'worker-finance', reimbursementDate: '2026-10-04', lines: [{ expenseItem: '清偿已记录费用', amount: 40, originalExpenseLineId: originalId }] }, 'draft')
    const read = await loadFinanceForm('reimbursement', draft.id)
    expect(read.lines).toEqual([expect.objectContaining({ expenseItem: '清偿已记录费用', amount: 40, originalExpenseLineId: originalId })])
    const rows = await mem.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')
    const audits = await mem.select('SELECT * FROM operation_logs ORDER BY id')
    await expect(store.saveForm('reimbursement', read, 'submit')).rejects.toThrow('只能保留草稿')
    expect(await mem.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')).toEqual(rows)
    expect(await mem.select('SELECT * FROM operation_logs ORDER BY id')).toEqual(audits)
    expect(await loadFinanceForm('reimbursement', original.id)).toEqual(originalForm)
    expect((await loadFinanceForm('reimbursement', draft.id)).status).toBe('draft')
  })

  it.each(['draft', '待确认', 'pending', 'approved', '已审批'])('拒绝引用 %s 结算且不留下付款头或分摊', async (status) => {
    await mem.execute(`INSERT INTO expenditure_settlements(id,name,biz_type,project_id,contract_id,supplier_id,total_amount,status)
      VALUES('unconfirmed-settlement-fixture','独立未确认结算','材料','project-finance','contract-expense','supplier-finance',200,?)`, [status])
    await expect(useFinanceStore().saveForm('payment_application', {
      name: '无效结算关联',
      bizType: '有合同-材料',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
      applyAmount: 100,
      invoiceState: '先款后票',
      settlementAllocations: [{ settlementId: 'unconfirmed-settlement-fixture', allocatedAmount: 100 }],
    }, 'draft')).rejects.toThrow('关联结算尚未确认')
    expect(await mem.select('SELECT id FROM payment_applications')).toEqual([])
    expect(await mem.select('SELECT id FROM payment_application_settlement_allocations')).toEqual([])
  })

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
      supplierId: 'supplier-finance',
      purpose: '临时往来',
      amount: 20,
      transactionDate: '2026-07-12',
    }, 'submit')
    const reimbursement = await store.saveForm('reimbursement', {
      applicantWorkerId: 'worker-finance',
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
      applicantWorkerId: 'worker-finance',
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

  it('重读编辑、重排与复制保留原费用身份和创建证据，只为真实新增生成 ID', async () => {
    const store = useFinanceStore()
    const saved = await store.saveForm('reimbursement', {
      applicantWorkerId: 'worker-finance',
      applicant: '历史报销申请人文本',
      reimbursementDate: '2026-10-04',
      lines: [{ expenseItem: '原运费', amount: 80 }, { expenseItem: '原仓储费', amount: 20 }],
    }, 'submit')
    const first = (await loadFinanceForm('reimbursement', saved.id))!
    const [originalFreight, originalStorage] = first.lines!
    const before = await mem.select('SELECT id, created_at FROM expense_reimbursement_lines ORDER BY id')
    await store.saveForm('reimbursement', {
      applicantWorkerId: 'worker-finance',
      ...first,
      lines: [
        { ...originalStorage, note: '只改备注' },
        originalFreight,
        { ...originalFreight, id: undefined, expenseItem: '另外一笔真实运费' },
      ],
    }, 'save')
    const after = (await loadFinanceForm('reimbursement', saved.id))!
    expect(after.applicant).toBe('历史报销申请人文本')
    expect(after.lines?.map(line => line.id).slice(0, 2)).toEqual([originalStorage.id, originalFreight.id])
    expect(after.lines?.[2].id).not.toBe(originalFreight.id)
    expect(await mem.select('SELECT id, created_at FROM expense_reimbursement_lines WHERE id IN (?,?) ORDER BY id', [originalFreight.id, originalStorage.id])).toEqual(before)
    expect(await mem.select('SELECT id FROM expense_reimbursement_lines WHERE deleted_at IS NOT NULL')).toEqual([])
    expect(await mem.select('SELECT action FROM operation_logs WHERE table_name=? AND record_id=? ORDER BY rowid', ['expense_reimbursement_lines', originalStorage.id])).toEqual([{ action: 'create' }, { action: 'update' }])
  })

  it('真实移除软删原行保全审计，重复身份与他单身份原子拒绝', async () => {
    const store = useFinanceStore()
    const saved = await store.saveForm('reimbursement', {
      applicantWorkerId: 'worker-finance',
      applicant: '原申请人',
      reimbursementDate: '2026-10-04',
      lines: [{ expenseItem: '交通', amount: 15 }, { expenseItem: '仓储', amount: 25 }],
    }, 'submit')
    const first = (await loadFinanceForm('reimbursement', saved.id))!
    const [retained, removed] = first.lines!
    await expect(store.saveForm('reimbursement', { ...first, lines: [retained, retained] }, 'save')).rejects.toThrow('同一费用明细不能重复采用')
    expect((await loadFinanceForm('reimbursement', saved.id))?.lines).toEqual(first.lines)
    await expect(store.saveForm('reimbursement', {
      applicantWorkerId: 'worker-finance',
      applicant: '另一申请人',
      reimbursementDate: '2026-10-04',
      lines: [retained],
    }, 'submit')).rejects.toThrow('费用明细身份不属于当前报销单')
    expect(await mem.select('SELECT id FROM expense_reimbursements')).toEqual([{ id: saved.id }])
    await store.saveForm('reimbursement', { ...first, lines: [retained] }, 'save')
    expect((await loadFinanceForm('reimbursement', saved.id))?.lines?.map(line => line.id)).toEqual([retained.id])
    expect(await mem.select('SELECT expense_item,amount,deleted_at FROM expense_reimbursement_lines WHERE id=?', [removed.id])).toEqual([{ expense_item: '仓储', amount: 25, deleted_at: expect.any(String) }])
    expect(await mem.select('SELECT before_data FROM operation_logs WHERE table_name=? AND record_id=? AND action=?', ['expense_reimbursement_lines', removed.id, 'delete'])).toEqual([{ before_data: expect.stringContaining('仓储') }])
  })

  it('附件失败回滚编辑原行，既有费用 ID、原申请人及审计均不漂移', async () => {
    const store = useFinanceStore()
    const saved = await store.saveForm('reimbursement', {
      applicantWorkerId: 'worker-finance',
      applicant: '迁入原姓名',
      reimbursementDate: '2026-10-04',
      lines: [{ expenseItem: '原件运输', amount: 60 }],
    }, 'submit')
    const first = (await loadFinanceForm('reimbursement', saved.id))!
    const logs = await mem.select('SELECT * FROM operation_logs')
    failFileInsert = true
    await expect(store.saveForm('reimbursement', {
      applicantWorkerId: 'worker-finance',
      ...first,
      applicant: '失败操作新姓名',
      lines: [{ ...first.lines![0], amount: 90 }],
    }, 'save', { add: [{ fileName: '真实依据.pdf' }] })).rejects.toThrow('模拟附件写入失败')
    expect(await loadFinanceForm('reimbursement', saved.id)).toEqual(first)
    expect(await mem.select('SELECT * FROM operation_logs')).toEqual(logs)
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
  it.each([
    { name: '结算', allocations: { settlementAllocations: [{ settlementId: 'settlement-finance', allocatedAmount: 40 }, { settlementId: 'settlement-finance', allocatedAmount: 40 }] }, error: '同一付款申请不能重复关联结算' },
    { name: '发票', allocations: { invoiceAllocations: [{ invoiceId: 'invoice-finance-a', allocatedAmount: 40 }, { invoiceId: 'invoice-finance-a', allocatedAmount: 40 }] }, error: '同一付款申请不能重复关联发票' },
  ])('重复关联同一$name时整笔拒绝', async ({ allocations, error }) => {
    const store = useFinanceStore()
    const input = { name: '重复关联测试', bizType: '有合同-材料', projectId: 'project-finance', supplierId: 'supplier-finance', contractId: 'contract-expense', applyAmount: 100, invoiceState: '先款后票' as const, ...allocations }
    await expect(store.saveForm('payment_application', input, 'draft')).rejects.toThrow(error)
    expect(await mem.select('SELECT id FROM payment_applications')).toEqual([])
  })
  it('公司付款采用结算10不能提交申请100，草稿保留不完整输入、正常公司支付和实际零各自有效', async () => {
    const store = useFinanceStore()
    await mem.execute(`INSERT INTO expenditure_settlements(id,no,name,biz_type,project_id,supplier_id,total_amount,settlement_date,status) VALUES('company-source-ten','JS-COMPANY','实际公司结算','其他',NULL,'supplier-finance',10,'2026-10-05','已确认')`)
    const input = { name: '公司结算清偿', bizType: '公司付款', supplierId: 'supplier-finance', applyAmount: 100, applyDate: '2026-10-05', applicant: '财务', invoiceState: '无需发票' as const, settlementAllocations: [{ settlementId: 'company-source-ten', allocatedAmount: 10 }] }
    await expect(store.saveForm('payment_application', input, 'submit')).rejects.toThrow('关联结算金额必须等于申请金额')
    expect(await mem.select(`SELECT id FROM payment_applications WHERE name='公司结算清偿'`)).toEqual([])
    const draft = await store.saveForm('payment_application', input, 'draft')
    await expect(store.saveForm('payment_application', { ...input, id: draft.id }, 'submit')).rejects.toThrow('关联结算金额必须等于申请金额')
    expect(await loadFinanceForm('payment_application', draft.id)).toMatchObject({ applyAmount: 100, status: 'draft', settlementAllocations: [{ allocatedAmount: 10 }] })
    const matched = await store.saveForm('payment_application', { ...input, id: draft.id, applyAmount: 10 }, 'submit')
    expect((await getPaymentApplicationSummary(matched.id)).settlementAllocated).toBe(10)
    const paid = await store.saveForm('payment_record', { supplierId: 'supplier-finance', payeeName: '实际垫付收款方', amount: 10, paymentDate: '2026-10-05', voucherNo: 'COMPANY-SOURCE-TEN', bankSerialNo: 'COMPANY-SOURCE-TEN', confirmedBy: '财务', applicationAllocations: [{ paymentApplicationId: matched.id, allocatedAmount: 10 }] }, 'confirm')
    await expect(store.saveForm('payment_record', (await loadFinanceForm('payment_record', paid.id))!, 'confirm')).rejects.toThrow('已确认支付需先撤回再修改')
    expect((await getPaymentApplicationSummary(matched.id)).paidAmount).toBe(10)
    expect(await mem.select(`SELECT COUNT(*) AS n FROM payment_records WHERE confirmation_status='confirmed'`)).toEqual([{ n: 1 }])
    await expect(store.saveForm('payment_record', { supplierId: 'supplier-finance', payeeName: '实际垫付收款方', amount: 1, paymentDate: '2026-10-05', voucherNo: 'OVER-TEN', bankSerialNo: 'OVER-TEN', confirmedBy: '财务', applicationAllocations: [{ paymentApplicationId: matched.id, allocatedAmount: 1 }] }, 'confirm')).rejects.toThrow('超过')
    const normal = await store.saveForm('payment_application', { ...input, name: '普通公司付款', settlementAllocations: [], applyAmount: 100 }, 'submit')
    expect(await loadFinanceForm('payment_application', normal.id)).toMatchObject({ applyAmount: 100, settlementAllocations: [], status: 'submitted' })
    const zero = await store.saveForm('payment_application', { ...input, settlementAllocations: [], applyAmount: 0, approvedAmount: 0 }, 'draft')
    expect(await loadFinanceForm('payment_application', zero.id)).toMatchObject({ applyAmount: 0, approvedAmount: 0, approvedAmountOrigin: 'user-entry' })
    const unknownApproval = await store.saveForm('payment_application', { ...input, settlementAllocations: [], applyAmount: 0, approvedAmount: null }, 'draft')
    expect(await loadFinanceForm('payment_application', unknownApproval.id)).toMatchObject({ applyAmount: 0, approvedAmount: null })
    await expect(store.saveForm('payment_application', { ...input, settlementAllocations: [], applyAmount: 0 }, 'submit')).rejects.toThrow('必须大于 0')
    await expect(store.saveForm('payment_application', { ...input, settlementAllocations: [{ settlementId: 'company-source-ten', allocatedAmount: 0 }] }, 'draft')).rejects.toThrow('必须大于 0')
  })

  it('工人无原费用清偿来源只允许不完整草稿，不能正式申请或制造第二工资付款', async () => {
    const store = useFinanceStore()
    const application = { name: '待核实工人垫付', bizType: '公司付款', workerId: 'worker-finance', applyAmount: 0, applyDate: '2026-10-05', applicant: '财务', invoiceState: '无需发票' as const }
    const draft = await store.saveForm('payment_application', application, 'draft')
    expect(await loadFinanceForm('payment_application', draft.id)).toMatchObject({ workerId: 'worker-finance', applyAmount: 0, settlementAllocations: [] })
    await expect(store.saveForm('payment_application', { ...application, id: draft.id, applyAmount: 10 }, 'submit')).rejects.toThrow('工人工资实际收付流程')
    const payment = await store.saveForm('payment_record', { workerId: 'worker-finance', amount: 0 }, 'draft')
    expect(await loadFinanceForm('payment_record', payment.id)).toMatchObject({ workerId: 'worker-finance', amount: 0, applicationAllocations: [] })
    await expect(store.saveForm('payment_record', { workerId: 'worker-finance', payeeName: '实际工人', amount: 10, paymentDate: '2026-10-05', voucherNo: 'NO-SOURCE', bankSerialNo: 'NO-SOURCE' }, 'submit')).rejects.toThrow('工人工资')
    await expect(store.saveForm('payment_record', { workerId: 'worker-finance', amount: 0, purpose: '工资' }, 'draft')).rejects.toThrow('工人工资')
  })

  it('分别执行先票后款、先款后票、无需发票三种提交规则', async () => {
    const store = useFinanceStore()
    await expect(store.saveForm('payment_application', {
      name: '先票后款不平',
      bizType: '预付款',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
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
      bizType: '预付款',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
      applyAmount: 60,
      applyDate: '2026-07-16',
      applicant: '赵工',
      invoiceState: '先款后票',
      invoiceAllocations: [],
    }, 'submit')
    expect((await getPaymentApplicationSummary(laterInvoice.id)).pendingInvoiceAmount).toBe(60)

    await expect(store.saveForm('payment_application', {
      name: '无需发票误挂票',
      bizType: '预付款',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
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
      bizType: '预付款',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
      applyAmount: 10,
      invoiceState: '先款后票',
      invoiceAllocations: [{
        invoiceId: 'invoice-finance-b',
        allocatedAmount: -1,
      }],
    }, 'draft')).rejects.toThrow('分摊金额必须大于 0')

    await store.saveForm('payment_application', {
      name: '占用发票额度',
      bizType: '预付款',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
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
      bizType: '预付款',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
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
  it('已确认现金采用的申请不能删除，旧删除图的真实现金仍保留但不可释放结算或发票额度', async () => {
    const store = useFinanceStore()
    const input = { name: '真实已付款原申请', bizType: '有合同-材料', projectId: 'project-finance', supplierId: 'supplier-finance', contractId: 'contract-expense', applyAmount: 100, applyDate: '2026-10-05', applicant: '实际财务', invoiceState: '先票后款' as const, settlementAllocations: [{ settlementId: 'settlement-finance', allocatedAmount: 100 }], invoiceAllocations: [{ invoiceId: 'invoice-finance-a', allocatedAmount: 100 }] }
    const application = await store.saveForm('payment_application', input, 'submit')
    const payment = await store.saveForm('payment_record', { projectId: 'project-finance', supplierId: 'supplier-finance', payeeName: '实际收款人', amount: 30, paymentDate: '2026-10-05', voucherNo: 'FROZEN-SOURCE', bankSerialNo: 'FROZEN-SOURCE', confirmedBy: '财务', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 30 }] }, 'confirm')
    const frozen = await mem.select('SELECT * FROM payment_record_application_allocations')
    const sourceRows = await mem.select('SELECT * FROM payment_application_settlement_allocations')
    const audits = await mem.select('SELECT * FROM operation_logs ORDER BY id')
    await expect(deleteFinanceForm('payment_application', application.id)).rejects.toThrow('不能删除冻结申请')
    await expect(deleteFinanceForm('payment_record', payment.id)).rejects.toThrow('不能删除实际现金事实')
    expect((await getPaymentApplicationSummary(application.id)).paidAmount).toBe(30)
    expect(await mem.select('SELECT * FROM operation_logs ORDER BY id')).toEqual(audits)
    await mem.execute('UPDATE payment_applications SET deleted_at=\'2026-10-05T01:00:00.000Z\' WHERE id=?', [application.id])
    await expect(store.saveForm('payment_application', { ...input, name: '不能重占旧结算', applyAmount: 70, settlementAllocations: [{ settlementId: 'settlement-finance', allocatedAmount: 70 }], invoiceAllocations: [] }, 'draft')).rejects.toThrow('余款资格尚未核实')
    await expect(store.saveForm('payment_application', { ...input, name: '不能重占旧发票', bizType: '预付款', applyAmount: 70, settlementAllocations: [], invoiceAllocations: [{ invoiceId: 'invoice-finance-a', allocatedAmount: 70 }] }, 'draft')).rejects.toThrow('余款资格尚未核实')
    expect(await confirmedPaymentTotal('project-finance')).toBe(30)
    expect(await mem.select('SELECT * FROM payment_record_application_allocations')).toEqual(frozen)
    expect(await mem.select('SELECT * FROM payment_application_settlement_allocations')).toEqual(sourceRows)
    expect(await mem.select('SELECT * FROM operation_logs ORDER BY id')).toEqual(audits)
    expect(await mem.select('SELECT COUNT(*) AS n FROM payment_applications')).toEqual([{ n: 1 }])
  })

  it('未确认不计已付，确认要求守恒，撤回重算；重复流水整笔回滚', async () => {
    const store = useFinanceStore()
    const application = await store.saveForm('payment_application', {
      name: '公司付款',
      bizType: '公司付款',
      projectId: null,
      supplierId: 'supplier-finance',
      applyAmount: 100,
      applyDate: '2026-07-18',
      applicant: '财务',
      invoiceState: '无需发票',
    }, 'submit')
    const draftPayment = await store.saveForm('payment_record', {
      no: 'ZF-DRAFT',
      projectId: null,
      supplierId: 'supplier-finance',
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
    expect(await confirmedPaymentTotal('project-finance')).toBe(0)
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
      bizType: '预付款',
      projectId: 'project-finance',
      supplierId: 'supplier-finance',
      contractId: 'contract-expense',
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
