import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadProjectCostControl } from '~/lib/project/cost-control'
import { createMemoryDb } from '../helpers/memory-db'

describe('project cost control read model', () => {
  it('uses the submitted baseline and formal source facts without mixing drafts or categories', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO customers (id, name) VALUES ('customer-cost', '成本客户')`)
    await db.execute(`
      INSERT INTO projects (id, name, customer_id)
      VALUES ('project-cost', '成本项目', 'customer-cost')
    `)
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('supplier-cost', '成本分供方')`)
    await db.execute(`
      INSERT INTO crews (id, name, trade)
      VALUES ('crew-cost', '成本班组', '泥水工')
    `)
    await db.execute(`
      INSERT INTO workers (id, crew_id, name, trade, current_project_id)
      VALUES ('worker-cost', 'crew-cost', '成本工人', '泥水工', 'project-cost')
    `)
    await db.execute(`
      INSERT INTO target_costs (
        id, project_id, name, is_baseline, tax_inclusive_total, status
      )
      VALUES
        ('target-baseline', 'project-cost', '开工基线', 1, 2600, 'submitted'),
        ('target-draft', 'project-cost', '调整草稿', 0, 9999, 'draft')
    `)
    await db.execute(`
      INSERT INTO target_cost_items (
        id, target_cost_id, cost_category, amount, sort_order
      )
      VALUES
        ('target-professional', 'target-baseline', '专业分包', 1000, 10),
        ('target-labour', 'target-baseline', '合同劳务', 500, 20),
        ('target-material', 'target-baseline', '材料', 600, 30),
        ('target-wage', 'target-baseline', '工人工资', 300, 40),
        ('target-reimbursement', 'target-baseline', '费用报销', 200, 50),
        ('target-draft-material', 'target-draft', '材料', 9000, 10)
    `)
    await db.execute(`
      INSERT INTO contracts (
        id, no, name, kind, sub_kind, cost_category, project_id, supplier_id,
        amount, status
      )
      VALUES
        (
          'contract-professional', 'FB-001', '专业分包合同', '分包', '专业',
          '专业分包', 'project-cost', 'supplier-cost', 100, '履约中'
        ),
        (
          'contract-labour', 'LW-001', '劳务合同', '分包', '劳务',
          '合同劳务', 'project-cost', 'supplier-cost', 50, '已签订'
        ),
        (
          'contract-material-legacy', 'CG-001', '旧数据材料合同', '材采', '',
          '', 'project-cost', 'supplier-cost', 200, '履约中'
        ),
        (
          'contract-draft', 'CG-DRAFT', '材料草稿', '材采', '',
          '材料', 'project-cost', 'supplier-cost', 900, 'draft'
        )
    `)
    await db.execute(`
      INSERT INTO contract_supplements (
        id, contract_id, no, name, amount, status
      )
      VALUES
        ('supplement-active', 'contract-professional', 'BC-001', '有效补充', 10, '有效'),
        ('supplement-draft', 'contract-professional', 'BC-DRAFT', '草稿补充', 900, 'draft')
    `)
    await db.execute(`
      INSERT INTO expenditure_settlements (
        id, no, name, biz_type, project_id, supplier_id, contract_id,
        total_amount, settlement_date, status
      )
      VALUES
        (
          'settlement-confirmed', 'JS-001', '专业结算', '专业分包',
          'project-cost', 'supplier-cost', 'contract-professional',
          80, '2026-07-01', 'confirmed'
        ),
        (
          'settlement-draft', 'JS-DRAFT', '结算草稿', '专业分包',
          'project-cost', 'supplier-cost', 'contract-professional',
          900, '2026-07-02', 'draft'
        )
    `)
    await db.execute(`
      INSERT INTO payment_applications (
        id, no, name, biz_type, project_id, supplier_id, contract_id,
        apply_amount, approved_amount, status
      )
      VALUES (
        'payment-application-cost', 'FK-001', '专业分包付款',
        '有合同-专业分包', 'project-cost', 'supplier-cost',
        'contract-professional', 60, 60, 'approved'
      )
    `)
    await db.execute(`
      INSERT INTO payment_records (
        id, no, project_id, supplier_id, payee_name, purpose, payment_date,
        amount, payment_method, voucher_no, bank_serial_no,
        confirmation_status, confirmed_by
      )
      VALUES (
        'payment-cost', 'ZF-001', 'project-cost', 'supplier-cost', '成本分供方',
        '专业分包支付', '2026-07-03', 60, '银行转账', 'V-001', 'BANK-001',
        'needs_review', '财务'
      )
    `)
    await db.execute(`
      INSERT INTO payment_record_application_allocations (
        id, payment_record_id, payment_application_id, allocated_amount
      )
      VALUES (
        'payment-allocation-cost', 'payment-cost',
        'payment-application-cost', 60
      )
    `)
    await db.execute(`
      UPDATE payment_records
      SET confirmation_status = 'confirmed',
          confirmed_at = '2026-07-03T09:00:00.000Z'
      WHERE id = 'payment-cost'
    `)
    await db.execute(`
      INSERT INTO expense_reimbursements (
        id, project_id, no, applicant, status
      )
      VALUES
        ('reimbursement-confirmed', 'project-cost', 'BX-001', '项目经理', 'confirmed'),
        ('reimbursement-draft', 'project-cost', 'BX-DRAFT', '项目经理', 'draft')
    `)
    await db.execute(`
      INSERT INTO expense_reimbursement_lines (
        id, reimbursement_id, expense_item, amount
      )
      VALUES
        ('reimbursement-line-confirmed', 'reimbursement-confirmed', '差旅', 40),
        ('reimbursement-line-draft', 'reimbursement-draft', '草稿费用', 900)
    `)
    await db.execute(`
      INSERT INTO wage_statements (
        id, project_id, crew_id, leader_worker_id, month,
        format_family, quantity_source, status, pay_ratio, actual_amount
      )
      VALUES
        (
          'wage-released', 'project-cost', 'crew-cost', 'worker-cost', '2026-07',
          'A', 'field', 'released', 1, 70
        ),
        (
          'wage-draft', 'project-cost', 'crew-cost', 'worker-cost', '2026-08',
          'A', 'field', 'draft', 1, 900
        )
    `)

    const result = await loadProjectCostControl(db)
    const baseline = result.versions.find(row => row.id === 'target-baseline')
    expect(baseline).toMatchObject({
      status: '当前基线',
      targetAmount: 2600,
      signedAmount: 360,
      settledAmount: 190,
      paidAmount: 130,
      remainingAmount: 2410,
      sourcePath: '/project/target-cost/target-baseline',
    })
    expect(result.versions.find(row => row.id === 'target-draft')?.status).toBe('草稿（不入控制）')

    const rows = result.categories.filter(row => row.projectId === 'project-cost')
    expect(rows.map(row => row.category)).toEqual([
      '专业分包',
      '合同劳务',
      '材料',
      '机械',
      '工人工资',
      '费用报销',
      '其他',
    ])
    expect(rows.find(row => row.category === '专业分包')).toMatchObject({
      targetAmount: 1000,
      signedAmount: 110,
      settledAmount: 80,
      paidAmount: 60,
      remainingAmount: 920,
      contractCount: 1,
      settlementCount: 1,
      paymentCount: 1,
    })
    expect(rows.find(row => row.category === '合同劳务')).toMatchObject({
      targetAmount: 500,
      signedAmount: 50,
      settledAmount: 0,
      paidAmount: 0,
    })
    expect(rows.find(row => row.category === '材料')).toMatchObject({
      targetAmount: 600,
      signedAmount: 200,
      targetPath: '/project/target-cost/target-baseline',
    })
    expect(rows.find(row => row.category === '工人工资')).toMatchObject({
      targetAmount: 300,
      signedAmount: 0,
      settledAmount: 70,
      paidAmount: 70,
      remainingAmount: 230,
      paymentCount: 1,
      settlementPath: '/subcontract/payroll',
      paymentPath: '/subcontract/payroll',
    })
    expect(rows.find(row => row.category === '费用报销')).toMatchObject({
      targetAmount: 200,
      settledAmount: 40,
      reimbursementCount: 1,
    })
  })
})
