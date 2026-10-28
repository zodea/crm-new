import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { ScheduleBindingAdapters } from '../../app/lib/schedule/central-binding'
import type { BoqLineRow } from '../../app/lib/schedule/engine'
import type { ScheduleBuildingCoverage, ScheduleContractOption } from '../../app/lib/schedule/read-model'
import type { BusinessSession } from './business-session'
import type { BoqLineRecord } from './production-boq-record'
import { resolveScheduleBoqBuildingReference } from '../../app/lib/schedule/building-reference'
import { scheduleProblem } from '../../app/lib/schedule/central-contract'
import { loadScheduleProject } from '../../app/lib/schedule/read-model'
import { readProductionBoqQuantityFacts, readProductionBoqRows } from './production-boq-record'
import { validateProductionBoqState } from './production-boq-validation'
import { readProductionConstructionContractFacts, readProductionConstructionContractReference } from './production-construction-contract-sources'
import { productionScheduleVisibility } from './production-schedule-visibility'

type ReadTx = Pick<TransactionDb, 'select'>

export const productionWbsBoqReadable = (actor: BusinessSession) => ['boq:read', 'construction-contract:read', 'owner-document:read', 'project:list:read'].every(capability => actor.capabilities.includes(capability))
export async function productionWbsContract(tx: ReadTx, actor: BusinessSession, projectId: string, id: string) {
  const head = await readProductionConstructionContractReference(tx, actor, id)
  if (head.projectId !== projectId || ['draft', '草稿', '作废', '失效', 'cancelled'].includes(head.status))
    throw scheduleProblem('relationship-mismatch', '所选施工主合同不属于当前有效项目或不是实际可用上游')
  return head
}
/** Actual accepted quantities and explicit stable item mappings; E prices are never scheduling inputs. */
export async function productionWbsBoqLines(tx: ReadTx, actor: BusinessSession, projectId: string, contractId: string) {
  await productionWbsContract(tx, actor, projectId, contractId)
  await validateProductionBoqState(tx)
  const facts = await readProductionBoqQuantityFacts(tx, projectId, actor, { contractIds: [contractId] })
  const originals = await readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines', projectId, contractId)
  return facts.lines.filter(line => line.eligible).map(line => ({ ...line, itemId: originals.find(row => row.value.id === line.id)?.value.itemId ?? null }))
}
export async function productionWbsContracts(tx: ReadTx, actor: BusinessSession, projectId: string): Promise<ScheduleContractOption[]> {
  await validateProductionBoqState(tx)
  const heads = await readProductionConstructionContractFacts(tx, actor, { projectId })
  const facts = await readProductionBoqQuantityFacts(tx, projectId, actor)
  return heads.contracts.filter(row => row.projectId === projectId && !['draft', '草稿', '作废', '失效', 'cancelled'].includes(row.status)).map(row => ({ id: row.id, projectId, no: row.no, name: row.name, lineCount: facts.lines.filter(line => line.contractId === row.id && line.eligible).length }))
}
export async function productionWbsBuildingCoverage(tx: ReadTx, actor: BusinessSession, projectId: string, contractId: string): Promise<ScheduleBuildingCoverage[]> {
  const rows = await tx.select<{ id: string, code: string, name: string }>(productionScheduleVisibility.selectVisibleSql('buildings', 'AND project_id=? ORDER BY sort_order,code,id'), [projectId])
  const lines = await productionWbsBoqLines(tx, actor, projectId, contractId)
  const covered = new Set(lines.map(line => resolveScheduleBoqBuildingReference(rows, line)?.id).filter((id): id is string => !!id))
  const scheduled = new Set((await tx.select<{ building_id: string }>(`${productionScheduleVisibility.hiddenCtesFor('schedule_group_buildings')} SELECT b.building_id FROM schedule_group_buildings b JOIN schedule_groups g ON g.id=b.group_id WHERE ${productionScheduleVisibility.visibleCond('schedule_group_buildings', 'b')} AND g.project_id=? AND g.contract_id=?`, [projectId, contractId])).map(row => row.building_id))
  return rows.map(row => ({ ...row, projectId, inContract: covered.has(row.id), scheduled: scheduled.has(row.id) }))
}
export async function productionWbsLinesByItem(tx: ReadTx, actor: BusinessSession, projectId: string, contractId: string, itemIds: readonly string[], buildingIds?: readonly string[]): Promise<Map<string, BoqLineRow[]>> {
  if (!contractId || !itemIds.length)
    return new Map()
  const actual = new Set((await tx.select<{ id: string }>(productionScheduleVisibility.selectVisibleSql('items', 'AND project_id=?'), [projectId])).map(row => row.id))
  const lines = await productionWbsBoqLines(tx, actor, projectId, contractId)
  const buildings = buildingIds ? await tx.select<{ id: string, code: string, name: string }>(productionScheduleVisibility.selectVisibleSql('buildings', 'AND project_id=?'), [projectId]) : []
  const mapped = new Map<string, BoqLineRow[]>()
  for (const line of lines) {
    if (!line.itemId || !actual.has(line.itemId) || !itemIds.includes(line.itemId) || (!line.declaredBuildingId && !line.building?.trim()))
      continue
    if (buildingIds && !buildingIds.includes(resolveScheduleBoqBuildingReference(buildings, line)?.id ?? ''))
      continue
    const row = { id: line.id, item_id: line.itemId, building: line.building ?? '', unit_type: line.unitType ?? '', floor_zone: line.floorZone ?? '', declaredBuildingId: line.declaredBuildingId }
    mapped.set(line.itemId, [...(mapped.get(line.itemId) ?? []), row])
  }
  return mapped
}
export function productionWbsBindingAdapters(actor: BusinessSession): ScheduleBindingAdapters {
  return { visibility: productionScheduleVisibility, contract: (tx, projectId, id) => productionWbsContract(tx, actor, projectId, id), contracts: (tx, projectId) => productionWbsContracts(tx, actor, projectId), boqLinesByItem: (tx, projectId, contractId, itemIds, buildingIds) => productionWbsLinesByItem(tx, actor, projectId, contractId, itemIds, buildingIds) }
}
export async function productionWbsProjectRead(tx: ReadTx, actor: BusinessSession, projectId: string, today: string) {
  const names = new Map<string, string>()
  if (productionWbsBoqReadable(actor)) {
    await validateProductionBoqState(tx)
    const facts = await readProductionBoqQuantityFacts(tx, projectId, actor)
    for (const line of facts.lines)
      names.set(line.id, line.itemName)
  }
  return loadScheduleProject(tx, projectId, today, { visibility: productionScheduleVisibility, boqAvailable: false, boqLineNames: names })
}
