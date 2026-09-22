import { expect, it } from 'vitest'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'
import { aggregateTargetCostActual } from '../../server/utils/target-cost-actual'
import { createTargetCostService } from '../../server/utils/target-cost-service'

it('预算详情保留实体已缺失但归属明确的历史，不串入其他版本或其他领域', async () => {
  const session = { workspaceId: 'budget-history', actorId: 'reader', capabilities: ['target-cost:read'] }
  const instance = createQuantityTestInstance({ session: () => session, projects: () => [] })
  const service = createTargetCostService({ session: () => session, projects: () => ({ projects: [], version: 'empty', status: 'available' }), actual: async projectId => aggregateTargetCostActual(projectId, []), transaction: instance.withWorkspaceTransaction })
  try {
    await instance.withWorkspaceTransaction(async (db) => {
      await db.execute('INSERT INTO target_costs(id,name) VALUES (?,?),(?,?)', ['a', '历史版本 A', 'b', '历史版本 B'])
      for (const [id, table, recordId, before, after] of [
        ['missing-item-a', 'target_cost_items', 'gone-item-a', { id: 'gone-item-a', target_cost_id: 'a', amount: 8 }, null],
        ['missing-file-a', 'file_refs', 'gone-file-a', null, { id: 'gone-file-a', owner_type: 'target_cost', owner_id: 'a', file_name: '历史预算.xlsx' }],
        ['missing-item-b', 'target_cost_items', 'gone-item-b', { id: 'gone-item-b', target_cost_id: 'b', amount: 9 }, null],
        ['other-owner', 'file_refs', 'other-file', { id: 'other-file', owner_type: 'contract', owner_id: 'a' }, null],
      ] as const) {
        await db.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,after_data,operator,created_at) VALUES (?,?,?,\'delete\',?,?,NULL,NULL)', [id, table, recordId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)])
      }
    })
    const detail = await service.detail({ origin: 'real' }, 'a')
    expect(detail.history.map(row => row.id)).toEqual(['missing-item-a', 'missing-file-a'])
    expect(detail.history.every(row => row.operator === null && row.operatedAt === null)).toBe(true)
    expect(detail.history[0]?.beforeData).toEqual({ id: 'gone-item-a', target_cost_id: 'a', amount: 8 })
    expect(detail.history[1]?.afterData).toMatchObject({ owner_type: 'target_cost', owner_id: 'a', file_name: '历史预算.xlsx' })
  }
  finally { await instance.close() }
})
