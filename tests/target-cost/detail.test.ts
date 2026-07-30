import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadTargetCostDetail } from '~/lib/target-cost/detail'
import { createMemoryDb } from '../helpers/memory-db'

describe('target cost detail read model', () => {
  it('uses the selected version items while comparing formal project cost facts', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO customers (id, name) VALUES ('customer-target', '预算客户')`)
    await db.execute(`
      INSERT INTO projects (id, code, name, customer_id)
      VALUES ('project-target', 'YS-01', '预算项目', 'customer-target')
    `)
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('supplier-target', '预算分供方')`)
    await db.execute(`
      INSERT INTO target_costs (
        id, project_id, name, is_baseline, contract_revenue, planned_profit,
        signed_contract_sum, tax_inclusive_total, tax_exclusive_total, tax_amount,
        status, note, created_at, updated_at
      )
      VALUES
        (
          'target-current', 'project-target', '开工基线', 1, 5000, 1000,
          200, 4000, 3600, 400, 'submitted', '当前基线', '2026-01-01', '2026-01-02'
        ),
        (
          'target-history', 'project-target', '投标预算', 0, 4800, 800,
          200, 3800, 3400, 400, 'submitted', '历史版本', '2025-12-01', '2025-12-02'
        )
    `)
    await db.execute(`
      INSERT INTO target_cost_items (
        id, target_cost_id, cost_category, item_name, unit, qty, unit_price,
        amount, note, sort_order
      )
      VALUES
        (
          'target-current-material', 'target-current', '材料', '当前材料',
          '项', 1, 900, 900, '', 10
        ),
        (
          'target-history-material', 'target-history', '材料', '历史材料',
          '项', 2, 500, 1000, '版本明细', 10
        ),
        (
          'target-history-wage', 'target-history', '工人工资', '计件工资',
          '项', 1, 300, 300, '', 20
        )
    `)
    await db.execute(`
      INSERT INTO contracts (
        id, no, name, kind, cost_category, project_id, supplier_id, amount, status
      )
      VALUES (
        'contract-target', 'CG-YS-01', '项目材料合同', '材采', '材料',
        'project-target', 'supplier-target', 200, '履约中'
      )
    `)
    await db.execute(`
      INSERT INTO expenditure_settlements (
        id, no, name, biz_type, project_id, supplier_id, contract_id,
        total_amount, settlement_date, status
      )
      VALUES (
        'settlement-target', 'JS-YS-01', '材料结算', '材料采购',
        'project-target', 'supplier-target', 'contract-target',
        120, '2026-06-01', 'confirmed'
      )
    `)

    const detail = await loadTargetCostDetail(db, 'target-history')

    expect(detail?.header).toMatchObject({
      id: 'target-history',
      projectId: 'project-target',
      projectCode: 'YS-01',
      projectName: '预算项目',
      name: '投标预算',
      status: 'submitted',
      isBaseline: false,
      taxInclusiveTotal: 3800,
      note: '历史版本',
    })
    expect(detail?.items.map(item => item.itemName)).toEqual(['历史材料', '计件工资'])
    expect(detail?.summary).toMatchObject({
      itemTotal: 1300,
      signedAmount: 200,
      settledAmount: 120,
      paidAmount: 0,
      remainingAmount: 1180,
    })
    expect(detail?.categories.find(row => row.category === '材料')).toMatchObject({
      targetAmount: 1000,
      signedAmount: 200,
      settledAmount: 120,
      remainingAmount: 880,
      targetLineCount: 1,
    })
    expect(detail?.categories.find(row => row.category === '工人工资')).toMatchObject({
      targetAmount: 300,
      signedAmount: 0,
      settledAmount: 0,
      targetLineCount: 1,
    })
    expect(detail?.categories.find(row => row.category === '专业分包')).toMatchObject({
      targetAmount: 0,
      signedAmount: 0,
      settledAmount: 0,
      targetLineCount: 0,
    })
  })

  it('returns null for missing or soft-deleted versions', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`
      INSERT INTO target_costs (id, name, status, deleted_at)
      VALUES ('target-deleted', '已删除版本', 'draft', '2026-07-29')
    `)

    await expect(loadTargetCostDetail(db, 'missing')).resolves.toBeNull()
    await expect(loadTargetCostDetail(db, 'target-deleted')).resolves.toBeNull()
  })
})
