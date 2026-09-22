import { expect, it } from 'vitest'
import { parseBudgetVersionGraph } from '../../app/lib/migration/target-cost-source'
import { createMemoryDb } from '../helpers/memory-db'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'
import { seedTargetCostMigrationSource } from '../helpers/target-cost-migration-source'

it('受控来源按预算版本保存完整图，项目无工程量、无项目草稿、旧空分项名及缺原件均保真', async () => {
  const db = await createMemoryDb()
  try {
    const source = await seedTargetCostMigrationSource(db)
    const versions = source.entities.target_cost_versions
    expect(versions).toHaveLength(2)
    const a = JSON.parse(String(versions!.find(row => row.legacyId === 'budget-a')!.attributes!.budgetGraphJson))
    const b = JSON.parse(String(versions!.find(row => row.legacyId === 'budget-b')!.attributes!.budgetGraphJson))
    expect(a.head).toMatchObject({ project_id: 'budget-project', contract_revenue: null, planned_profit: 0 })
    expect(b.head).toMatchObject({ project_id: null, name: '', status: 'draft' })
    expect(a.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'budget-item-null', item_name: null, qty: null, unit_price: null, amount: 0, sort_order: 4 }),
      expect.objectContaining({ id: 'budget-item-deleted', qty: 0, deleted_at: '2026-09-12T12:00:00.000Z' }),
    ]))
    expect(a.files).toHaveLength(2)
    expect(a.payloads).toEqual([{ file_ref_id: 'budget-original', encoding: 'base64', content: btoa('%PDF-1.7') }])
    expect(a.logs[0]).toMatchObject({ record_id: 'budget-item-null', operator: '历史经办人' })
    expect(source.entities.quantity_projects).toEqual([])
  }
  finally { db.close() }
})

it.each(['is_baseline', 'created_at', 'note'])('完整来源不能以空 %s 绕过原表非空约束', async (field) => {
  const db = await createMemoryDb()
  try {
    const source = await seedTargetCostMigrationSource(db)
    const graph = JSON.parse(String(source.entities.target_cost_versions![0]!.attributes!.budgetGraphJson))
    graph.head[field] = null
    expect(() => parseBudgetVersionGraph(graph)).toThrow()
  }
  finally { db.close() }
})

it('合法旧附件空元数据和可识别但已缺实体的文件日志保持原样', async () => {
  const db = await createMemoryDb()
  try {
    await seedTargetCostMigrationSource(db)
    await db.execute('UPDATE file_refs SET file_size = NULL, uploaded_at = NULL, file_name = NULL WHERE id = ?', ['budget-original'])
    await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,operator,created_at) VALUES (?,\'file_refs\',?,\'delete\',?,NULL,NULL)', ['old-file-log', 'already-missing-file', JSON.stringify({ id: 'already-missing-file', owner_type: 'target_cost', owner_id: 'budget-a', file_path: 'C:/已缺历史原件' })])
    const source = await readQuantityCoreSource(db)
    const graph = JSON.parse(String(source.entities.target_cost_versions!.find(row => row.legacyId === 'budget-a')!.attributes!.budgetGraphJson))
    expect(graph.files).toContainEqual(expect.objectContaining({ id: 'budget-original', file_size: null, uploaded_at: null, file_name: null }))
    expect(graph.logs).toContainEqual(expect.objectContaining({ id: 'old-file-log', operator: null, created_at: null }))
  }
  finally { db.close() }
})
