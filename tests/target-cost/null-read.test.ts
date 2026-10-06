import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadTargetCostDetail } from '~/lib/target-cost/detail'
import { loadTargetCostList } from '~/lib/target-cost/list'
import { createMemoryDb } from '../helpers/memory-db'

describe('预算空值与真实零', () => {
  it('无项目草稿保留空金额，明细空数量/单价与真实零不混淆', async () => {
    const db = await createMemoryDb()
    try {
      await runMigrations(db)
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
    const db = await createMemoryDb()
    try {
      await runMigrations(db)
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
