import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import { productionWbsVisibility, verifyProductionWbsState } from './production-wbs-record'

/** A read projection over the real WBS owner; immutable library bodies always retain usageCount:null. */
export async function productionWbsLibraryUsage(tx: TransactionDb, actor: BusinessSession): Promise<ReadonlyMap<string, { id: string, name: string, groupCount: number }[]> | null> {
  if (!['schedule:read', 'quantity:read', 'project:list:read', 'process-library:read'].every(capability => actor.capabilities.includes(capability)))
    return null
  const participant = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'wbs\''))[0]
  if (participant?.schema_version !== 1)
    return null
  await verifyProductionWbsState(tx, actor)
  const rows = await tx.select<{ process_library_id: string, id: string, name: string, groupCount: number }>(`${productionWbsVisibility.hiddenCtesFor('schedule_groups')} SELECT g.process_library_id,p.id,p.name,COUNT(*) AS groupCount FROM schedule_groups g JOIN projects p ON p.id=g.project_id WHERE g.process_library_id IS NOT NULL AND ${productionWbsVisibility.visibleCond('schedule_groups', 'g')} GROUP BY g.process_library_id,p.id,p.name ORDER BY p.name,p.id`)
  const groups = new Map<string, { id: string, name: string, groupCount: number }[]>()
  for (const row of rows)
    groups.set(row.process_library_id, [...groups.get(row.process_library_id) ?? [], { id: row.id, name: row.name, groupCount: row.groupCount }])
  return groups
}
