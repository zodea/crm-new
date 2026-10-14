import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { StoredMaterialContract } from './material-contract-command-test-instance'
import { isDeepStrictEqual } from 'node:util'
import { decodeOurSignatorySnapshot, signatoryProblem } from '../../app/lib/our-signatory/contract'
import { validateProductionAuxiliaryState } from './production-auxiliary-contract-record'
import { readProductionConstructionState } from './production-construction-contract-record'
import { readProductionSubcontractState } from './production-subcontract-contract-record'

/** All persisted records and immutable versions participate, independently of page visibility. */
export async function validateMaterialContractIdentities(tx: TransactionDb, records: readonly StoredMaterialContract[]) {
  const claims = await tx.select<{ owner_domain: string, contract_id: string, number: string, version: string, claimed_at: string }>('SELECT * FROM contract_number_claims')
  const numberHistory = await tx.select<{ id: string, owner_domain: string, contract_id: string, number: string, version: string, occurred_at: string, reason: string }>('SELECT * FROM contract_number_history')
  const registered = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'construction-contracts\''))[0]
  if (registered) {
    if (registered.schema_version !== 1)
      return signatoryProblem('unavailable', '施工合同编号来源版本不兼容')
    const [identity] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
    if (!identity)
      return signatoryProblem('unavailable', '跨合同编号核验缺可信工作区')
    // The foreign owner proves every current claim and historical version in this same transaction.
    await readProductionConstructionState(tx, { workspaceId: identity.workspace_id, actorId: identity.owner_id })
  }
  const subcontractRegistered = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'subcontract-contracts\''))[0]
  if (subcontractRegistered) {
    if (subcontractRegistered.schema_version !== 1)
      return signatoryProblem('unavailable', '分包合同编号来源版本不兼容')
    const [identity] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
    if (!identity)
      return signatoryProblem('unavailable', '分包合同编号核验缺可信工作区')
    await readProductionSubcontractState(tx, { workspaceId: identity.workspace_id, actorId: identity.owner_id })
  }
  const main = records.filter(record => !record.draft.isSupplement)
  const auxiliaryRegistered = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'auxiliary-contract\''))[0]
  if (auxiliaryRegistered) {
    if (auxiliaryRegistered.schema_version !== 1)
      return signatoryProblem('unavailable', '辅助合同编号来源版本不兼容')
    const [identity] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
    if (!identity)
      return signatoryProblem('unavailable', '辅助合同编号核验缺可信工作区')
    await validateProductionAuxiliaryState(tx, { workspaceId: identity.workspace_id, actorId: identity.owner_id })
  }
  const versions = (record: StoredMaterialContract) => [...record.history, record].sort((a, b) => b.version - a.version)
  for (const record of records) {
    for (const version of versions(record)) {
      const draft = version.draft
      const snapshot = draft.ourSignatorySnapshot ? decodeOurSignatorySnapshot(draft.ourSignatorySnapshot) : null
      if ((draft.ourSignatoryId ?? null) !== (snapshot?.id ?? null) || (draft.ourSignatoryVersion ?? null) !== (snapshot?.version ?? null))
        return signatoryProblem('unavailable', '合同主体稳定身份、核实版本与签约快照不一致')
      if (!snapshot)
        continue
      const adopted = await tx.select<{ draft_json: string }>('SELECT draft_json FROM our_signatory_history WHERE signatory_id=? AND version=?', [snapshot.id, Number(snapshot.version)])
      if (adopted.length !== 1)
        return signatoryProblem('unavailable', '合同采用的主体核实历史缺失')
      const { status: _status, ...facts } = JSON.parse(adopted[0]!.draft_json)
      if (!isDeepStrictEqual(snapshot, { id: snapshot.id, version: snapshot.version, ...facts }))
        return signatoryProblem('unavailable', '合同签约主体快照与当时核实事实不一致')
    }
  }
  for (const record of main) {
    const established = versions(record).find(version => !['draft', '草稿'].includes(version.draft.status ?? ''))
    const number = established?.draft.no?.trim() ?? ''
    const claim = claims.find(row => row.owner_domain === 'material-contracts' && row.contract_id === record.id)
    if (number ? !claim || claim.number !== number || claim.version !== String(established!.version) || claim.claimed_at !== established!.updatedAt : Boolean(claim))
      return signatoryProblem('unavailable', '合同当前正式编号占用与原事实不一致')
    for (const version of versions(record)) {
      const oldNumber = version.draft.no?.trim() ?? ''
      const evidence = numberHistory.filter(row => row.owner_domain === 'material-contracts' && row.contract_id === record.id && row.version === String(version.version))
      if (oldNumber ? evidence.length !== 1 || evidence[0]!.number !== oldNumber || evidence[0]!.occurred_at !== version.updatedAt : evidence.length !== 0)
        return signatoryProblem('unavailable', '合同原编号历史证据不完整或被改写')
    }
  }
  for (const claim of claims) {
    if (claim.owner_domain === 'construction-contracts' && registered)
      continue
    if (claim.owner_domain === 'subcontract-contracts' && subcontractRegistered)
      continue
    if (claim.owner_domain === 'auxiliary-contract' && auxiliaryRegistered)
      continue
    if (claim.owner_domain !== 'material-contracts' || !main.some(row => row.id === claim.contract_id))
      return signatoryProblem('unavailable', '编号登记存在尚未接管的领域或孤立身份')
  }
  for (const history of numberHistory) {
    if (history.owner_domain === 'construction-contracts' && registered)
      continue
    if (history.owner_domain === 'subcontract-contracts' && subcontractRegistered)
      continue
    if (history.owner_domain === 'auxiliary-contract' && auxiliaryRegistered)
      continue
    const record = main.find(row => row.id === history.contract_id)
    if (history.owner_domain !== 'material-contracts' || !record || !versions(record).some(version => String(version.version) === history.version)
      || history.id !== `material-${history.contract_id}-v${history.version}` || !['upgrade-evidence', 'upgrade-history', 'formal-fact', 'draft-evidence'].includes(history.reason)) {
      return signatoryProblem('unavailable', '编号历史存在未知领域、版本或伪造依据')
    }
  }
}
