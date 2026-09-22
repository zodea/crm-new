import type { TransactionDb } from '../db/coordinator'
import type { QuantityContext } from './central-contract'
import type { QuantityAssigneeKind } from './read-model'
import { quantityProblem } from './central-contract'

export interface QuantityPersonSource {
  id: string
  kind: QuantityAssigneeKind
  name: string
  trade: string
  trades: readonly string[]
  itemNames: readonly string[]
  dataOrigin: 'real' | 'demo'
}

export type QuantityPeopleSource = (context: QuantityContext) => Promise<readonly QuantityPersonSource[]>

/** 仅投影当前可读正式主数据；移除的实体保留物理审计身份，不再作为新责任候选。 */
export async function synchronizeQuantityPeople(db: TransactionDb, context: QuantityContext, source?: QuantityPeopleSource) {
  if (!context.capabilities.includes('crew:list:read') || !context.capabilities.includes('worker:list:read'))
    throw quantityProblem('forbidden', '当前无权读取工程量所需的班组和工人资料')
  if (!source)
    throw quantityProblem('unavailable', '工程量责任主数据暂时不可用，请重试')
  const rows = (await source(context)).filter(row => row.dataOrigin === 'real')
  const ids = new Set<string>()
  for (const row of rows) {
    const key = `${row.kind}:${row.id}`
    if (!row.id || !row.name || !['crew', 'worker'].includes(row.kind) || ids.has(key))
      throw quantityProblem('internal-error', '工程量责任主数据身份无效或重复')
    ids.add(key)
  }
  const now = new Date().toISOString()
  for (const table of ['crews', 'workers'] as const) {
    await db.execute(`UPDATE ${table} SET deleted_at = COALESCE(deleted_at, ?)`, [now])
    for (const row of rows.filter(row => row.kind === (table === 'crews' ? 'crew' : 'worker'))) {
      await db.execute(
        `INSERT INTO ${table} (id, name, trade, trade_capabilities, item_capabilities, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, trade = excluded.trade,
           trade_capabilities = excluded.trade_capabilities, item_capabilities = excluded.item_capabilities, deleted_at = NULL`,
        [row.id, row.name, row.trade, JSON.stringify(row.trades), JSON.stringify(row.itemNames)],
      )
    }
  }
}
