import type { BoqBuildingContext, BoqBuildingQuery } from '../../app/lib/boq/central-building-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import { boqDigest, boqFail, productionBoqContractReference, productionBoqHeadVersion, productionBoqOwnerInTransaction, readProductionBoqQuantityFacts } from './production-boq-record'

/** Existing owner rules receive only actual registered quantity buildings and this owner's original rows. */
export async function loadProductionBoqBuilding(tx: Pick<TransactionDb, 'select'>, actor: BusinessSession, input: BoqBuildingQuery) {
  const query: BoqBuildingQuery = { projectId: input.projectId, contractId: input.contractId, origin: input.origin }
  if (query.origin !== 'real' || !actor.capabilities.includes('quantity:read'))
    return boqFail('forbidden', '当前无正式工程量楼栋及清单关联读取权限')
  const parent = await productionBoqContractReference(tx, actor, query.contractId)
  if (parent.projectId !== query.projectId || ['draft', '草稿'].includes(parent.status))
    return boqFail('relationship-mismatch', '实际施工主合同资格或项目不同')
  const actualBuildings = await tx.select<{ id: string, project_id: string, code: string, name: string, deleted_at: string | null }>('SELECT id,project_id,code,name,deleted_at FROM buildings WHERE project_id=? AND deleted_at IS NULL ORDER BY code,id', [query.projectId])
  const evidence = { quantityVersion: boqDigest(actualBuildings), buildings: actualBuildings.map(row => ({ id: row.id, code: row.code, name: row.name })) }
  const core = await productionBoqOwnerInTransaction(tx, actor, query.projectId)
  const original = core.boqBuildingContext(query, actor, evidence)
  const source = await readProductionBoqQuantityFacts(tx, query.projectId, actor, { contractIds: [query.contractId] })
  const context: BoqBuildingContext = { ...original, contractVersion: productionBoqHeadVersion(parent), buildings: original.buildings.map(building => ({ ...building, version: boqDigest(actualBuildings.find(row => row.id === building.id)) })), lines: original.lines.map(line => ({ ...line, version: boqDigest({ id: line.id, building: line.building, qualification: source.lines.find(row => row.id === line.id)?.qualificationVersion }), readOnlyReason: source.lines.find(row => row.id === line.id)?.eligible ? line.readOnlyReason : '原清单还没有当前可用的原导入或签证资格' })) }
  const auditRows = await tx.select<{ after_json: string }>('SELECT after_json FROM boq_history WHERE project_id=? AND contract_id=? AND entity_type=\'boq_building_evidence\' ORDER BY created_at,id', [query.projectId, query.contractId])
  context.audit = auditRows.map(row => JSON.parse(row.after_json))
  return { context, core, evidence }
}
