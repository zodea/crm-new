import type { TestDb } from './memory-db'
import { runMigrations } from '../../app/lib/db/migrations'
import { readQuantityCoreSource } from './quantity-migration-source'

/** 预算完整旧库：项目无工程量图，另有无项目草稿；附件只从真实 payload 表取正文。 */
export async function seedTargetCostMigrationSource(db: TestDb) {
  await runMigrations(db)
  await db.execute('INSERT INTO projects (id,name) VALUES (?,?)', ['budget-project', '预算迁入工程'])
  for (const [id, project, name, baseline, status] of [
    ['budget-a', 'budget-project', '原当前预算', 1, 'submitted'],
    ['budget-b', null, '', 0, 'draft'],
  ] as const) {
    await db.execute('INSERT INTO target_costs (id,project_id,name,is_baseline,status,contract_revenue,planned_profit,signed_contract_sum,tax_inclusive_total,tax_exclusive_total,tax_amount) VALUES (?,?,?,?,?,NULL,0,NULL,NULL,0,NULL)', [id, project, name, baseline, status])
  }
  await db.execute('INSERT INTO target_cost_items (id,target_cost_id,cost_category,item_name,qty,unit_price,amount,sort_order) VALUES (?,?,?,NULL,NULL,NULL,0,4)', ['budget-item-null', 'budget-a', '材料'])
  await db.execute('INSERT INTO target_cost_items (id,target_cost_id,cost_category,item_name,qty,unit_price,amount,sort_order,deleted_at) VALUES (?,?,?,?,0,0,0,7,?)', ['budget-item-deleted', 'budget-a', '机械', '历史已移除行', '2026-09-12 12:00:00'])
  for (const [id, name, size] of [['budget-missing', '旧预算原件.xlsx', 32], ['budget-original', '原预算.pdf', 8]] as const)
    await db.execute('INSERT INTO file_refs (id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES (?,\'target_cost\',\'budget-a\',?,?,?,?)', [id, name, `C:/旧预算/${name}`, size, id === 'budget-original' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
  await db.execute('INSERT INTO file_payloads (file_ref_id,encoding,content) VALUES (?,\'base64\',?)', ['budget-original', btoa('%PDF-1.7')])
  await db.execute('INSERT INTO operation_logs (id,table_name,record_id,action,before_data,after_data,operator) VALUES (?,\'target_cost_items\',?,\'update\',?,?,?)', ['budget-old-log', 'budget-item-null', JSON.stringify({ id: 'budget-item-null', target_cost_id: 'budget-a', item_name: null, amount: 3 }), JSON.stringify({ id: 'budget-item-null', target_cost_id: 'budget-a', item_name: null, amount: 0 }), '历史经办人'])
  return readQuantityCoreSource(db)
}
