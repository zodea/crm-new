import type { CustomerContractSourceRow } from '../../app/lib/customer/read-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { createHash } from 'node:crypto'
import { constructionContractSupplementAmount } from '../../app/lib/construction-contract/read-page'
import { projectConstructionManagementFees, unavailableProjectConstructionManagementFees } from '../../app/lib/project/construction-management-fee'
import { createConstructionContractCommandTestInstance } from './construction-contract-command-test-instance'
import { constructionFailure, readProductionConstructionState, validateProductionConstructionState } from './production-construction-contract-record'

type ReadTx = Pick<TransactionDb, 'select'>

/** The caller owns the existing transaction; no coordinator re-entry and no copied directory. */
export async function readProductionConstructionContractReference(tx: ReadTx, actor: BusinessSession, id: string, options: { includeDeleted?: boolean } = {}) {
  if (!actor.capabilities.includes('construction-contract:read'))
    return constructionFailure('forbidden', '无正式施工主合同上游读取权限')
  await validateProductionConstructionState(tx, actor)
  const state = await readProductionConstructionState(tx, actor)
  const head = state.contracts.find(row => row.id === id)
  const row = (await tx.select<{ deleted_at: string | null, project_deleted_at: string | null, customer_deleted_at: string | null }>('SELECT c.deleted_at,p.deleted_at AS project_deleted_at,u.deleted_at AS customer_deleted_at FROM construction_contract_records c LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN customers u ON u.id=c.customer_id WHERE c.id=?', [id]))[0]
  if (!head || !row || (!options.includeDeleted && (row.deleted_at !== null || row.project_deleted_at !== null || row.customer_deleted_at !== null)))
    return constructionFailure('not-found', '原施工主合同不存在、已归档或所属项目不可用')
  return { id, projectId: head.draft.projectId ?? null, customerId: head.draft.customerId ?? null, no: head.draft.no ?? '', name: head.draft.name ?? '', status: head.draft.status ?? '草稿', version: String(head.version), deletedAt: row.deleted_at, projectDeletedAt: row.project_deleted_at, customerDeletedAt: row.customer_deleted_at, kind: '施工' as const }
}
export async function readProductionConstructionContractFacts(tx: ReadTx, actor: BusinessSession, options: { projectId?: string, includeDeleted?: boolean } = {}) {
  if (!actor.capabilities.includes('construction-contract:read'))
    return constructionFailure('forbidden', '无正式施工主合同事实读取权限')
  await validateProductionConstructionState(tx, actor)
  const state = await readProductionConstructionState(tx, actor)
  const projects = await tx.select<{ id: string, name: string, customer_id: string | null }>('SELECT id,name,customer_id FROM projects ORDER BY id')
  const customers = await tx.select<{ id: string, name: string }>('SELECT id,name FROM customers ORDER BY id')
  const owner = createConstructionContractCommandTestInstance({ projects: projects.map(row => ({ ...row, customerId: row.customer_id })), customers })
  owner.importState({ ...state, supplements: options.includeDeleted ? state.supplements : state.supplements.filter(row => !('deletedAt' in row) || row.deletedAt === null) })
  const contracts = []
  for (const record of owner.rows()) {
    if (options.projectId && record.projectId !== options.projectId)
      continue
    try {
      await readProductionConstructionContractReference(tx, actor, record.id, options)
      contracts.push({ ...record, settledAmount: null, invoicedAmount: null, receivedAmount: null })
    }
    catch (cause) {
      if (cause && typeof cause === 'object' && 'problem' in cause && (cause.problem as { code: string }).code === 'not-found')
        continue
      throw cause
    }
  }
  return { sourceVersion: owner.sourceVersion(), contracts, supplements: owner.facts().supplements }
}
/** Confirmed source mapping is evidence, not a guessed same-ID shortcut. Restored sources are never eligible for new adoption. */
export async function readProductionConstructionSourceIdentities(tx: ReadTx, actor: BusinessSession, sourceSha256: string, options: { includeDeleted?: boolean } = {}) {
  if (!actor.capabilities.includes('construction-contract:read') || !/^[a-f0-9]{64}$/.test(sourceSha256))
    return constructionFailure('forbidden', '真实施工来源映射读取无权或摘要无效')
  await validateProductionConstructionState(tx, actor)
  const imported = (await tx.select<{ id: string, evidence_json: string, evidence_sha256: string, result_json: string, restored_at: string | null }>('SELECT i.*,r.restored_at FROM construction_contract_imports i LEFT JOIN construction_contract_import_restores r ON r.import_id=i.id WHERE i.source_sha256=?', [sourceSha256]))[0]
  if (!imported || imported.restored_at !== null)
    return constructionFailure('unavailable', '同一完整原库的施工身份尚未确认或已经恢复归档，不能按本地同ID猜采用')
  const evidence = JSON.parse(imported.evidence_json)
  const result = JSON.parse(imported.result_json)
  const contracts = []
  for (const id of result.ids as string[]) {
    const current = await readProductionConstructionContractReference(tx, actor, id, options)
    if (!evidence.rawDomain.contracts.some((row: { legacyId: string }) => row.legacyId === id))
      return constructionFailure('unavailable', '施工确认映射缺完整原身份证据')
    contracts.push({ legacyId: id, id, projectId: current.projectId, version: current.version, deletedAt: current.deletedAt, kind: '施工' as const })
  }
  const supplements = []
  for (const id of result.supplementIds as string[]) {
    const row = (await tx.select<{ contract_id: string }>('SELECT contract_id FROM construction_contract_supplements WHERE id=?', [id]))[0]
    const parent = row && contracts.find(head => head.id === row.contract_id)
    if (!parent || !evidence.rawDomain.contract_supplements.some((row: { legacyId: string }) => row.legacyId === id))
      return constructionFailure('unavailable', '原补充协议确认映射缺真实父合同')
    supplements.push({ legacyId: id, id, contractId: parent.id, projectId: parent.projectId })
  }
  return { sourceSha256, importId: imported.id, contracts, supplements }
}

/** Directory consumers read this owner's verified facts in their existing transaction. */
export async function readProductionConstructionDirectoryProjection(tx: ReadTx, actor: BusinessSession, asOf: string, projectId?: string) {
  const inaccessible = (state: 'forbidden' | 'unavailable') => ({
    contracts: null,
    source: { key: 'construction-contracts', state, sourceVersion: null, asOf: null } satisfies SourceEvidenceDTO,
    configuration: projectId ? unavailableProjectConstructionManagementFees(projectId, 'real', state) : null,
  })
  if (!actor.capabilities.includes('construction-contract:read'))
    return inaccessible('forbidden')
  const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'construction-contracts\'')
  if (participant?.schema_version !== 1)
    return inaccessible('unavailable')
  const facts = await readProductionConstructionContractFacts(tx, actor, { projectId })
  const contracts: CustomerContractSourceRow[] = facts.contracts.map(row => ({
    dataOrigin: 'real',
    id: row.id,
    no: row.no,
    name: row.name,
    projectId: row.projectId,
    customerId: row.customerId,
    projectPermission: actor.capabilities.includes('project:list:read') ? row.projectPermission : 'forbidden',
    amount: row.amount,
    supplementAmount: constructionContractSupplementAmount(row, facts),
    receiptAmount: null,
    signDate: row.signDate,
    status: row.status,
  }))
  const sourceVersion = `construction-contracts:${facts.sourceVersion}:${createHash('sha256').update(JSON.stringify({ contracts: facts.contracts, supplements: facts.supplements })).digest('hex')}`
  return {
    contracts,
    source: { key: 'construction-contracts', state: 'readable', sourceVersion, asOf } satisfies SourceEvidenceDTO,
    configuration: projectId ? projectConstructionManagementFees({ projectId, dataOrigin: 'real', sourceVersion, asOf, contracts: facts.contracts }) : null,
  }
}
