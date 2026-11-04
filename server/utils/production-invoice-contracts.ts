import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { InvoiceContractReference } from '../../app/lib/invoice/central-contract'
import type { BusinessSession } from './business-session'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { validateProductionAuxiliaryState } from './production-auxiliary-contract-record'
import { readProductionConstructionState } from './production-construction-contract-record'
import { readProductionConstructionContractReference } from './production-construction-contract-sources'
import { loadProductionMaterialContractState } from './production-material-contract-record'
import { validateProductionSubcontractState } from './production-subcontract-contract-record'

const domains = {
  construction: { participant: 'construction-contracts', capability: 'construction-contract:read' },
  subcontract: { participant: 'subcontract-contracts', capability: 'subcontract-contract:read' },
  material: { participant: 'material-contracts', capability: 'material-contract:read' },
  auxiliary: { participant: 'auxiliary-contract', capability: 'auxiliary-contract:read' },
  company: { participant: 'auxiliary-contract', capability: 'auxiliary-contract:read' },
} as const
export const invoiceContractCapability = (domain: InvoiceContractReference['domain']) => domains[domain].capability

/** 在调用方事务内读取真实合同 owner；名称从不作为身份。 */
export async function verifyInvoiceContractReference(tx: TransactionDb, actor: BusinessSession, reference: InvoiceContractReference, projectId: string | null, supplierId: string | null) {
  const config = domains[reference.domain]
  if (!config || !actor.capabilities.includes(config.capability))
    throw new CentralInvoiceProblem('forbidden', '当前身份无所选合同来源读取权限。')
  const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=?', [config.participant])
  if (participant?.schema_version !== 1)
    throw new CentralInvoiceProblem('unavailable', '所选合同正式来源尚未接通。')
  let actual: { id: string, version: string, projectId: string | null, supplierId: string | null, ourSignatoryId?: string | null } | null = null
  if (reference.domain === 'construction') {
    const row = await readProductionConstructionContractReference(tx, actor, reference.id)
    const state = await readProductionConstructionState(tx, actor)
    const head = state.contracts.find(item => item.id === reference.id)
    if (!head)
      throw new CentralInvoiceProblem('unavailable', '施工合同主体来源无法核实。')
    const snapshot = head.draft.ourSignatorySnapshot
    actual = { id: row.id, version: row.version, projectId: row.projectId, supplierId: null, ourSignatoryId: snapshot && snapshot.id === head.draft.ourSignatoryId ? snapshot.id : null }
  }
  else if (reference.domain === 'material') {
    const state = await loadProductionMaterialContractState(tx, actor)
    const row = state.contracts.find(item => item.id === reference.id && !item.draft.isSupplement && !item.migrationRetired && !item.migrationEvidence?.deletedAt)
    if (row)
      actual = { id: row.id, version: String(row.version), projectId: row.draft.projectId ?? null, supplierId: row.draft.supplierId ?? null, ourSignatoryId: row.draft.ourSignatorySnapshot && row.draft.ourSignatorySnapshot.id === row.draft.ourSignatoryId ? row.draft.ourSignatorySnapshot.id : null }
  }
  else if (reference.domain === 'subcontract') {
    const verified = await validateProductionSubcontractState(tx, actor)
    const row = verified.state.contracts.find(item => item.draft.id === reference.id)
    const [head] = await tx.select<{ deleted_at: string | null }>('SELECT deleted_at FROM subcontract_contract_records WHERE id=?', [reference.id])
    if (row && head?.deleted_at === null)
      actual = { id: row.draft.id, version: String(row.version), projectId: row.draft.projectId ?? null, supplierId: row.draft.supplierId ?? null, ourSignatoryId: row.draft.ourSignatorySnapshot && row.draft.ourSignatorySnapshot.id === row.draft.ourSignatoryId ? row.draft.ourSignatorySnapshot.id : null }
  }
  else {
    const verified = await validateProductionAuxiliaryState(tx, actor)
    const row = verified.state.contracts.find(item => item.draft.id === reference.id)
    const [head] = await tx.select<{ deleted_at: string | null }>('SELECT deleted_at FROM auxiliary_contract_records WHERE id=?', [reference.id])
    const restored = row?.migrationBatchId && verified.restores.some(item => item.import_id === row.migrationBatchId)
    if (row && row.draft.kind === (reference.domain === 'company' ? 'company_expense' : 'other_expense') && !restored && head?.deleted_at === null) {
      const subject = row.draft.ourSignatorySnapshot
      actual = { id: row.draft.id, version: String(row.version), projectId: row.draft.projectId ?? null, supplierId: row.draft.supplierId ?? null, ourSignatoryId: subject && subject.id === row.draft.ourSignatoryId ? subject.id : null }
    }
  }
  if (!actual || actual.id !== reference.id)
    throw new CentralInvoiceProblem('validation-failed', '所选合同不存在、已删除或无法核验。')
  if (actual.version !== reference.version)
    throw new CentralInvoiceProblem('conflict', '合同版本已变化，请重新核对后选择。')
  if (reference.domain === 'company' && (projectId !== null || actual.projectId !== null || !actual.supplierId || actual.supplierId !== supplierId))
    throw new CentralInvoiceProblem('validation-failed', '公司合同缺少可核实的分供方稳定关联，或与发票不一致。')
  if ((actual.projectId !== null && actual.projectId !== projectId) || (actual.supplierId !== null && actual.supplierId !== supplierId))
    throw new CentralInvoiceProblem('validation-failed', '发票归属与所选合同项目或分供方不一致。')
  return actual
}

/** 比较稳定身份而非合同名称或可能已更新的主体资料；历史快照只证明当时签约身份。 */
export function assertInvoiceContractBuyer(actor: BusinessSession, actual: { ourSignatoryId?: string | null }, buyerId: string) {
  if (!actor.capabilities.includes('our-signatory:read'))
    throw new CentralInvoiceProblem('forbidden', '当前身份无我方主体读取权限。')
  if (!actual.ourSignatoryId)
    throw new CentralInvoiceProblem('unavailable', '合同缺少已核实的我方签约主体依据，不能按名称猜测。')
  if (actual.ourSignatoryId !== buyerId)
    throw new CentralInvoiceProblem('validation-failed', '合同我方签约主体与发票所选主体不一致。')
}

/** 归档时还须将真实合同中留存的我方身份与本次明确选择的主体核对。 */
export async function verifyInvoiceCompanyArchiveReference(tx: TransactionDb, actor: BusinessSession, reference: InvoiceContractReference, supplierId: string, buyerId: string) {
  if (reference.domain !== 'company')
    throw new CentralInvoiceProblem('validation-failed', '公司开销须选择已有公司支出合同。')
  const actual = await verifyInvoiceContractReference(tx, actor, reference, null, supplierId)
  assertInvoiceContractBuyer(actor, actual, buyerId)
  return actual
}

/** 历史公司合同映射还须证明来自同一旧快照、同一张旧合同表及原 ID。 */
export async function verifyLegacyInvoiceCompanyReference(tx: TransactionDb, actor: BusinessSession, reference: InvoiceContractReference, supplierId: string, buyerId: string, sourceSha256: string, legacyId: string) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || !/^[a-z0-9][\w-]{2,79}$/i.test(legacyId))
    throw new CentralInvoiceProblem('validation-failed', '旧公司合同来源摘要或身份无效。')
  const actual = await verifyInvoiceCompanyArchiveReference(tx, actor, reference, supplierId, buyerId)
  const verified = await validateProductionAuxiliaryState(tx, actor)
  const contract = verified.state.contracts.find(item => item.draft.id === reference.id && item.draft.kind === 'company_expense')
  if (!contract?.migrationBatchId || verified.restores.some(item => item.import_id === contract.migrationBatchId))
    throw new CentralInvoiceProblem('validation-failed', '所选公司合同没有有效旧库采用依据。')
  const [imported] = await tx.select<{ source_sha256: string, evidence_json: string }>('SELECT source_sha256,evidence_json FROM auxiliary_contract_imports WHERE id=?', [contract.migrationBatchId])
  let evidence: unknown
  try {
    evidence = imported ? JSON.parse(imported.evidence_json) : null
  }
  catch { throw new CentralInvoiceProblem('unavailable', '公司合同旧库采用依据损坏。') }
  if (!imported || imported.source_sha256 !== sourceSha256 || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || !('sourceSha256' in evidence) || evidence.sourceSha256 !== sourceSha256 || !('identityMappings' in evidence) || !Array.isArray(evidence.identityMappings)
    || !evidence.identityMappings.some((mapping: unknown) => mapping && typeof mapping === 'object' && !Array.isArray(mapping)
      && 'legacyId' in mapping && mapping.legacyId === `company_expense:${legacyId}` && 'id' in mapping && mapping.id === reference.id)) {
    throw new CentralInvoiceProblem('validation-failed', '公司合同与同一旧库的原表及原身份不一致，不能按名称或同号推断。')
  }
  return actual
}
