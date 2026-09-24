import type { TransactionDb } from '../db/coordinator'
import type { TargetCostHistoryEntry } from './central-contract'

function decode(value: unknown): unknown {
  if (value == null)
    return null
  try {
    return JSON.parse(String(value))
  }
  catch { return String(value) }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
/** 迁入日志可能比业务实体保留得更完整，仅根据稳定原关系归属，不猜名称。 */
export async function loadTargetCostHistory(db: TransactionDb, targetCostId: string): Promise<TargetCostHistoryEntry[]> {
  const logs = await db.select<Record<string, unknown>>('SELECT * FROM operation_logs WHERE table_name IN (\'target_costs\', \'target_cost_items\', \'file_refs\') ORDER BY rowid')
  const items = new Map((await db.select<{ id: string, target_cost_id: string }>('SELECT id, target_cost_id FROM target_cost_items')).map(row => [row.id, row.target_cost_id]))
  const files = new Map((await db.select<{ id: string, owner_id: string, owner_type: string }>('SELECT id, owner_id, owner_type FROM file_refs')).map(row => [row.id, row]))
  const result: TargetCostHistoryEntry[] = []
  for (const log of logs) {
    const beforeData = decode(log.before_data)
    const afterData = decode(log.after_data)
    const snapshots = [beforeData, afterData].filter(record)
    const id = String(log.record_id)
    let belongs = false
    if (log.table_name === 'target_costs') {
      belongs = id === targetCostId
    }
    else if (log.table_name === 'target_cost_items') {
      const owners = new Set(snapshots.map(row => row.target_cost_id).filter((value): value is string => typeof value === 'string'))
      belongs = items.has(id) ? items.get(id) === targetCostId : owners.size === 1 && owners.has(targetCostId)
    }
    else if (log.table_name === 'file_refs') {
      const current = files.get(id)
      const owners = new Set(snapshots.filter(row => row.owner_type === 'target_cost').map(row => row.owner_id).filter((value): value is string => typeof value === 'string'))
      belongs = current ? current.owner_type === 'target_cost' && current.owner_id === targetCostId : owners.size === 1 && owners.has(targetCostId) && snapshots.every(row => row.owner_type == null || row.owner_type === 'target_cost')
    }
    if (belongs)
      result.push({ id: String(log.id), tableName: String(log.table_name), recordId: id, operation: String(log.action), operatedAt: log.created_at == null ? null : String(log.created_at), operator: log.operator == null || log.operator === '' ? null : String(log.operator), beforeData, afterData })
  }
  return result
}
