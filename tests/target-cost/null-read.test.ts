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
})
