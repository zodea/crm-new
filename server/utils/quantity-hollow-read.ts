import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityContext, QuantityUnitReadQuery } from '../../app/lib/quantity/central-contract'
import type { QuantityHollowRead, QuantityHollowSource } from '../../app/lib/quantity/central-hollow-contract'
import type { QuantityHollowProofOptions } from '../../app/lib/quantity/central-hollow-proof-contract'
import { hollowCanonical, hollowHash } from '../../app/lib/quantity/central-hollow-primitives'
import { loadQuantityHollowHistories, quantityHollowTablesFingerprint, readQuantityHollowTables } from './quantity-hollow-facts'
import { loadQuantityHollowTargets } from './quantity-hollow-targets'

export function quantityHollowSource(context: QuantityContext, projectId: string, unitId: string, label: string, visible: boolean, recordId?: string, revisionId?: string): QuantityHollowSource {
  if (!visible || !context.capabilities.includes('quantity:read'))
    return { navigation: null, reasons: ['当前原户不可见或没有工程量来源读取权限'] }
  return { navigation: { kind: recordId ? 'entity-subview' : 'entity-detail', subject: { state: 'resolved', entity: 'quantity-unit', id: unitId, label, no: null }, variant: recordId ? 'hollow-record' : 'detail', view: null, filters: { projectId, dataOrigin: 'real', ...(recordId ? { recordId, ...(revisionId ? { revisionId } : {}) } : {}) } }, reasons: [] }
}
export async function readQuantityHollowVersion(tx: TransactionDb, query: QuantityUnitReadQuery): Promise<string> {
  const current = await loadQuantityHollowTargets(tx, query.projectId, query.unitId)
  const fingerprint = await quantityHollowTablesFingerprint(await readQuantityHollowTables(tx), query.projectId)
  return `quantity-hollow:v1:${await hollowHash(hollowCanonical([query.projectId, query.unitId, fingerprint, current.fingerprintSource]))}`
}
export async function loadQuantityHollowWorkspace(tx: TransactionDb, query: QuantityUnitReadQuery, context: QuantityContext, options: QuantityHollowProofOptions = {}): Promise<QuantityHollowRead> {
  const current = await loadQuantityHollowTargets(tx, query.projectId, query.unitId)
  const loaded = await loadQuantityHollowHistories(tx, query.projectId, options)
  const writable = context.capabilities.includes('quantity:write')
  const permission = { allowed: writable, reasons: writable ? [] : ['当前身份没有空鼓来源写入权限'] }
  const targets = current.proofs.map(proof => ({ target: proof.target, originalParty: proof.originalParty, originalPartyName: String(proof.rows[proof.originalParty.kind === 'worker' ? 'workers' : 'crews'][0]!.name), location: proof.location, create: permission, source: quantityHollowSource(context, query.projectId, query.unitId, proof.location.locationLabel, current.visible) }))
  const records = [...loaded.histories.values()].filter(row => row.fact.target.unitId === query.unitId).map(({ fact }) => ({ ...fact, source: quantityHollowSource(context, query.projectId, query.unitId, fact.location.locationLabel, current.visible, fact.recordId, fact.inspection.revisionId), eligibility: { revise: permission, rectify: fact.remainingCount > 0 ? permission : { allowed: false, reasons: ['本次检查已全部整改，无可继续销记处数'] } } }))
  const unavailable = [...current.unavailable, ...loaded.unavailable.filter(row => row.target === null || row.target.unitId === query.unitId)]
  return { data: { projectId: query.projectId, unitId: query.unitId, targets, records, unavailable }, dataOrigin: 'real', sourceVersion: `quantity-hollow:v1:${await hollowHash(hollowCanonical([query.projectId, query.unitId, loaded.fingerprint, current.fingerprintSource]))}`, asOf: new Date().toISOString(), capabilities: [...context.capabilities], context: structuredClone(context) }
}
