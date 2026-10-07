import { describe, expect, it } from 'vitest'
import { loadProjectExpenditureRelations } from '~/lib/project/expenditure-relations'
import { createMigratedMemoryDb } from '../helpers/memory-db'

describe('project expenditure relation read model', () => {
  it('keeps real foreign-key ownership and formal amount boundaries', async () => {
    const db = await createMigratedMemoryDb()
    await db.execute(`INSERT INTO customers (id, name) VALUES ('customer-expense', '支出客户')`)
    await db.execute(`
      INSERT INTO projects (id, name, customer_id)
      VALUES
        ('project-expense', '支出项目', 'customer-expense'),
        ('project-other', '其他项目', 'customer-expense')
    `)
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('supplier-expense', '支出分供方')`)
    await db.execute(`
      INSERT INTO contracts (
        id, no, name, kind, sub_kind, cost_category, classification_state,
        project_id, supplier_id, amount, sign_date, status
      )
      VALUES
        (
          'contract-expense', 'FB-EXPENSE', '支出专业合同', '分包', '专业',
          '专业分包', 'classified', 'project-expense', 'supplier-expense',
          100, '2026-06-01', '履约中'
        ),
        (
          'contract-other', 'FB-OTHER', '其他项目合同', '分包', '劳务',
          '合同劳务', 'classified', 'project-other', 'supplier-expense',
          900, '2026-06-01', '履约中'
        ),
        (
          'contract-draft', 'FB-DRAFT', '合同草稿', '分包', '专业',
          '专业分包', 'classified', 'project-expense', 'supplier-expense',
          800, '2026-06-01', 'draft'
        )
    `)
    await db.execute(`
      INSERT INTO contract_supplements (
        id, contract_id, no, name, amount, sign_date, status
      )
      VALUES
        (
          'supplement-expense', 'contract-expense', 'BC-EXPENSE',
          '有效补充', 20, '2026-06-10', '有效'
        ),
        (
          'supplement-draft', 'contract-expense', 'BC-DRAFT',
          '补充草稿', 50, '2026-06-11', 'draft'
        )
    `)
    await db.execute(`
      INSERT INTO subcontract_change_orders (
        id, no, change_type, project_id, supplier_id, contract_id,
        approved_amount, status
      )
      VALUES
        (
          'change-approved', 'BG-APPROVED', '增项', 'project-expense',
          'supplier-expense', 'contract-expense', 15, 'approved'
        ),
        (
          'change-draft', 'BG-DRAFT', '调价', 'project-expense',
          'supplier-expense', 'contract-expense', 40, 'draft'
        ),
        (
          'change-mismatch', 'BG-MISMATCH', '增项', 'project-other',
          'supplier-expense', 'contract-expense', 700, 'approved'
        )
    `)
    await db.execute(`
      INSERT INTO expenditure_settlements (
        id, no, name, biz_type, project_id, supplier_id, contract_id,
        total_amount, settlement_date, status
      )
      VALUES
        (
          'settlement-confirmed', 'JS-CONFIRMED', '正式结算', '专业分包',
          'project-expense', 'supplier-expense', 'contract-expense',
          80, '2026-07-01', 'confirmed'
        ),
        (
          'settlement-draft', 'JS-DRAFT', '结算草稿', '专业分包',
          'project-expense', 'supplier-expense', 'contract-expense',
          60, '2026-07-02', 'draft'
        ),
        (
          'settlement-mismatch', 'JS-MISMATCH', '错项目结算', '专业分包',
          'project-other', 'supplier-expense', 'contract-expense',
          600, '2026-07-03', 'confirmed'
        )
    `)
    await db.execute(`
      INSERT INTO payment_applications (
        id, no, name, biz_type, project_id, supplier_id, contract_id,
        apply_amount, approved_amount, status
      )
      VALUES (
        'payment-application-expense', 'FK-EXPENSE', '支出合同付款',
        '有合同-专业分包', 'project-expense', 'supplier-expense',
        'contract-expense', 30, 30, 'approved'
      )
    `)
    await db.execute(`
      INSERT INTO payment_records (
        id, no, project_id, supplier_id, payee_name, purpose, payment_date,
        amount, payment_method, voucher_no, bank_serial_no,
        confirmation_status, confirmed_by
      )
      VALUES (
        'payment-expense', 'ZF-EXPENSE', 'project-expense', 'supplier-expense',
        '支出分供方', '合同支付', '2026-07-03', 30, '银行转账',
        'V-EXPENSE', 'BANK-EXPENSE', 'needs_review', '财务'
      )
    `)
    await db.execute(`
      INSERT INTO payment_record_application_allocations (
        id, payment_record_id, payment_application_id, allocated_amount
      )
      VALUES (
        'payment-allocation-expense', 'payment-expense',
        'payment-application-expense', 30
      )
    `)
    await db.execute(`
      UPDATE payment_records
      SET confirmation_status = 'confirmed',
          confirmed_at = '2026-07-03T09:00:00.000Z'
      WHERE id = 'payment-expense'
    `)

    const result = await loadProjectExpenditureRelations(db)
    const contract = result.contracts.find(row => row.id === 'contract-expense')
    expect(contract).toMatchObject({
      projectId: 'project-expense',
      category: '专业分包',
      originalCategory: '专业',
      amount: 100,
      supplementAmount: 20,
      settledAmount: 80,
      paidAmount: 30,
      sourcePath: '/contract/contract-expense',
    })
    expect(result.contracts.some(row => row.id === 'contract-draft')).toBe(false)

    expect(result.supplements.filter(row => row.projectId === 'project-expense')).toEqual([
      expect.objectContaining({
        id: 'supplement-draft',
        amount: 50,
        effectiveAmount: 0,
        status: 'draft',
      }),
      expect.objectContaining({
        id: 'supplement-expense',
        amount: 20,
        effectiveAmount: 20,
      }),
    ])
    expect(result.changes.filter(row => row.projectId === 'project-expense')).toEqual([
      expect.objectContaining({
        id: 'change-approved',
        approvedAmount: 15,
        effectiveApprovedAmount: 15,
      }),
      expect.objectContaining({
        id: 'change-draft',
        approvedAmount: 40,
        effectiveApprovedAmount: 0,
      }),
    ])
    expect(result.changes.some(row => row.id === 'change-mismatch')).toBe(false)
    expect(result.settlements.filter(row => row.projectId === 'project-expense')).toEqual([
      expect.objectContaining({
        id: 'settlement-confirmed',
        amount: 80,
        effectiveAmount: 80,
        sourcePath: '/subcontract/settlement/settlement-confirmed',
      }),
      expect.objectContaining({
        id: 'settlement-draft',
        amount: 60,
        effectiveAmount: 0,
      }),
    ])
    expect(result.settlements.some(row => row.id === 'settlement-mismatch')).toBe(false)
  })
})
