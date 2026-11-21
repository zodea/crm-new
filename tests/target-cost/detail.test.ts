import { describe, expect, it, onTestFinished } from 'vitest'
import { loadTargetCostDetail } from '~/lib/target-cost/detail'
import { loadTargetCostList } from '~/lib/target-cost/list'
import { presentTargetCostHistory } from '../../app/lib/target-cost/history-presentation'
import { createMigratedMemoryDb } from '../helpers/memory-db'

describe('target cost detail read model', () => {
  it('uses the selected version items while comparing formal project cost facts', async () => {
    const db = await createMigratedMemoryDb()
    onTestFinished(() => db.close())
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
      settledAmount: null,
      paidAmount: null,
      remainingAmount: null,
      metrics: { settledAmount: { knownValue: 120, status: 'partial' }, paidAmount: { knownValue: 0, status: 'partial' }, remainingAmount: { knownValue: null } },
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
      settledAmount: null,
      paidAmount: null,
      metrics: { settledAmount: { knownValue: null, missingSources: ['P4实际工资源:unavailable'] } },
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
    const db = await createMigratedMemoryDb()
    onTestFinished(() => db.close())
    await db.execute(`
      INSERT INTO target_costs (id, name, status, deleted_at)
      VALUES ('target-deleted', '已删除版本', 'draft', '2026-07-29')
    `)

    await expect(loadTargetCostDetail(db, 'missing')).resolves.toBeNull()
    await expect(loadTargetCostDetail(db, 'target-deleted')).resolves.toBeNull()
  })
})

describe('预算空值与真实零', () => {
  it('无项目草稿保留空金额，明细空数量/单价与真实零不混淆', async () => {
    const db = await createMigratedMemoryDb()
    try {
      await db.execute(`INSERT INTO target_costs(id,name,contract_revenue,planned_profit,signed_contract_sum,tax_inclusive_total,tax_exclusive_total,tax_amount)
        VALUES('draft','未关联',NULL,0,NULL,NULL,NULL,NULL)`)
      await db.execute(`INSERT INTO target_cost_items(id,target_cost_id,cost_category,item_name,qty,unit_price,amount)
        VALUES('item','draft','材料',NULL,NULL,0,0)`)
      expect((await loadTargetCostList(db))[0]).toMatchObject({ contractRevenue: null, plannedProfit: 0, profitRate: null })
      expect((await loadTargetCostDetail(db, 'draft'))?.items[0]).toMatchObject({ qty: null, unitPrice: 0, amount: 0 })
    }
    finally { db.close() }
  })

  it('损坏的目标明细和空预算基准不变成零，实际已知金额仍不能证明剩余预算', async () => {
    const db = await createMigratedMemoryDb()
    try {
      await db.execute(`INSERT INTO projects(id,name) VALUES ('project','空预算')`)
      await db.execute(`INSERT INTO target_costs(id,project_id,name,is_baseline,status,tax_inclusive_total) VALUES ('budget','project','预算',1,'submitted',NULL)`)
      await db.execute(`INSERT INTO target_cost_items(id,target_cost_id,cost_category,amount) VALUES ('known','budget','材料',10),('broken','budget','材料','invalid')`)
      const detail = (await loadTargetCostDetail(db, 'budget'))!
      expect(detail.items.find(item => item.id === 'broken')?.amount).toBeNull()
      expect(detail.categories.find(row => row.category === '材料')).toMatchObject({ targetAmount: null, settledAmount: 0, remainingAmount: null, metrics: { targetAmount: { knownValue: 10, status: 'partial' } } })
      expect(detail.summary).toMatchObject({ itemTotal: null, remainingAmount: null, metrics: { targetAmount: { knownValue: 10, status: 'partial' }, remainingAmount: { knownValue: null } } })
    }
    finally { db.close() }
  })
})

describe('预算操作历史展示', () => {
  it('保留未知与真零差异，用预算字段标签和真实经办身份呈现', () => {
    const view = presentTargetCostHistory({ id: 'log', tableName: 'target_cost_items', recordId: 'item', operation: 'update', operatedAt: null, operator: null, beforeData: { item_name: null, qty: null, amount: 0 }, afterData: { item_name: '砌筑', qty: 0, amount: 0 } })
    expect(view).toMatchObject({ subject: '科目明细', action: '保存', time: '操作时间未提供', operator: '经办身份未提供' })
    expect(view.changes).toEqual([{ label: '分项名称', before: '未填写', after: '砌筑' }, { label: '数量', before: '未填写', after: '0' }])
  })
  it('软删恢复与缺失旧详情可读，未知字段不泄漏原始表结构', () => {
    const view = presentTargetCostHistory({ id: 'log', tableName: 'file_refs', recordId: 'file', operation: 'update', operatedAt: '2026-09-13', operator: '经办甲', beforeData: { deleted_at: '2026-09-12', internal_path: 'private' }, afterData: { deleted_at: null, internal_path: 'new' } })
    expect(view).toMatchObject({ subject: '预算附件', action: '恢复', operator: '经办甲', changes: [], missingDetail: '这条历史未保留可识别的业务字段变化。' })
    expect(JSON.stringify(view)).not.toContain('internal_path')
    expect(JSON.stringify(view)).not.toContain('private')
  })
})
