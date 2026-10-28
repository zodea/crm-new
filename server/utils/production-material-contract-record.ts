import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import type { MaterialContractOwnerSnapshot, StoredMaterialContract } from './material-contract-command-test-instance'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { decodeConstructionMainSelection } from '../../app/lib/construction-scope/contract'
import { materialContractProblem, MaterialContractRepositoryProblem } from '../../app/lib/material-contract/repository'
import { commandFingerprint } from './command-journal'
import { validateMaterialContractIdentities } from './contract-identity-evidence'
import { createMaterialContractCommandTestInstance } from './material-contract-command-test-instance'
import { materialOriginalDigest } from './material-contract-original'

function fail(code: 'forbidden' | 'validation-failed' | 'unavailable', message: string): never {
  throw new MaterialContractRepositoryProblem(materialContractProblem(code, message))
}
function scopedKey(key: string, actor: BusinessSession): string {
  const parts: unknown = JSON.parse(key)
  if (!Array.isArray(parts) || parts.length !== 4 || parts[0] !== actor.workspaceId || parts[1] !== actor.actorId || parts[2] !== 'material-contract' || typeof parts[3] !== 'string' || !parts[3])
    return fail('unavailable', '材采持久命令作用域与正式身份不一致。')
  return parts[3]
}

/** Applied original requests must retain their immutable engineering evidence, even after unbinding. */
export async function validateMaterialConstructionBindings(tx: TransactionDb, actor: Pick<BusinessSession, 'workspaceId' | 'actorId'>) {
  const parents = await tx.select<{ request_json: string, result_json: string }>('SELECT request_json,result_json FROM material_contract_commands WHERE result_json IS NOT NULL')
  for (const parent of parents) {
    const input = JSON.parse(parent.request_json)
    if (input.constructionMain === undefined)
      continue
    const main = decodeConstructionMainSelection(input.constructionMain)
    const result = JSON.parse(parent.result_json)
    const sourceId = input.draft?.isSupplement === true ? input.draft.originalContractId : result.id
    const evidence = await tx.select<Record<string, unknown>>('SELECT h.*,i.request_json,i.fingerprint,r.fingerprint AS receipt_fingerprint,r.result_json FROM construction_scope_history h JOIN construction_scope_intents i ON i.command_id=h.command_id JOIN construction_scope_receipts r ON r.command_id=h.command_id WHERE h.source_domain=? AND h.source_id=? AND h.main_id=? AND h.project_id=? AND h.main_basis=?', ['material-contract', sourceId, main.id, main.projectId, main.basis])
    const proved = evidence.some((row) => {
      const child = JSON.parse(String(row.request_json))
      const receipt = JSON.parse(String(row.result_json))
      const digest = createHash('sha256').update(commandFingerprint(child)).digest('hex')
      const originalRequired = !input.id && input.draft?.isSupplement !== true
      return child.workspaceId === actor.workspaceId && child.actorId === actor.actorId
        && child.source?.domain === 'material-contract' && child.source?.id === sourceId && child.action === 'bind'
        && child.commandId === row.command_id && child.projectId === main.projectId && child.mainId === main.id && child.mainBasis === main.basis
        && row.fingerprint === digest && row.receipt_fingerprint === digest
        && receipt.commandId === child.commandId && isDeepStrictEqual(receipt.relation, { domain: 'material-contract', sourceId, id: row.link_id, projectId: row.project_id, mainId: row.main_id, version: String(row.version), sourceBasis: row.source_basis, mainBasis: row.main_basis, updatedAt: row.occurred_at, deletedAt: row.deleted_at })
        && (!originalRequired || (child.originalSourceCommand?.family === 'material-contract' && child.originalSourceCommand.commandId === input.commandId))
    })
    if (!proved)
      fail('unavailable', '材采原保存回执缺少对应工程的不可变关联依据，停止读取和恢复。')
  }
}

export async function loadProductionMaterialContractState(tx: TransactionDb, actor: BusinessSession): Promise<MaterialContractOwnerSnapshot> {
  const records = await tx.select<{ id: string, parent_id: string | null, project_id: string | null, supplier_id: string | null, record_json: string }>('SELECT * FROM material_contract_records')
  const commands = await tx.select<{ scoped_id: string, command_id: string, fingerprint: string, request_json: string, result_json: string | null }>('SELECT * FROM material_contract_commands')
  const sealed = await tx.select<{ scoped_id: string }>('SELECT scoped_id FROM material_contract_resolutions')
  const revisions = await tx.select<{ revision: number }>('SELECT revision FROM material_contract_revision WHERE singleton=1')
  const contracts = records.map((record) => {
    const row = JSON.parse(record.record_json) as StoredMaterialContract
    if (row.id !== record.id || (row.draft.isSupplement ? row.draft.originalContractId : null) !== record.parent_id || (row.draft.projectId ?? null) !== record.project_id || (row.draft.supplierId ?? null) !== record.supplier_id)
      fail('unavailable', '材采持久关系列与记录证据不一致，停止读取。')
    return row
  })
  await validateMaterialContractIdentities(tx, contracts)
  for (const contract of contracts) {
    for (const attachment of contract.attachments) {
      if (!attachment.sha256)
        continue
      const rows = await tx.select<{ owner_type: string, owner_id: string, file_name: string, file_size: number, mime_type: string, deleted_at: string | null, content: Uint8Array, sha256: string }>('SELECT f.*,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=?', [attachment.id])
      const row = rows[0]
      if (!row || row.owner_type !== attachment.ownerType || row.owner_id !== contract.id || row.file_name !== attachment.fileName || row.file_size !== attachment.fileSize || row.mime_type !== attachment.mimeType
        || row.deleted_at !== attachment.deletedAt || !(row.content instanceof Uint8Array) || row.content.length !== attachment.fileSize || row.sha256 !== attachment.sha256 || materialOriginalDigest(row.content) !== attachment.sha256) {
        fail('unavailable', '材采原件正文、归属或摘要损坏；不能把已存原件当作历史缺件。')
      }
    }
  }
  for (const row of commands) {
    if (scopedKey(row.scoped_id, actor) !== row.command_id)
      fail('unavailable', '材采持久回执身份不一致。')
  }
  for (const row of sealed)
    scopedKey(row.scoped_id, actor)
  await validateMaterialConstructionBindings(tx, actor)
  return {
    schemaVersion: 1,
    sourceVersion: revisions[0]?.revision ?? fail('unavailable', '材采持久版本记录缺失。'),
    contracts,
    commands: commands.flatMap(row => row.result_json == null ? [] : [[row.scoped_id, JSON.parse(row.result_json)] as MaterialContractOwnerSnapshot['commands'][number]]),
    commandFingerprints: commands.map(row => [row.scoped_id, row.fingerprint]),
    requestEvidence: commands.map(row => [row.scoped_id, JSON.parse(row.request_json)]),
    sealedCommands: sealed.map(row => row.scoped_id),
  }
}

/** Same validated owner projection, including its effective supplement rules; no copied money store. */
export async function readMaterialContractScopeFacts(tx: TransactionDb, actor: BusinessSession) {
  if (!actor.capabilities.includes('material-contract:read'))
    return fail('forbidden', '当前身份无权读取材采合同来源。')
  const snapshot = await loadProductionMaterialContractState(tx, actor)
  const owner = createMaterialContractCommandTestInstance()
  owner.importState(snapshot)
  const rows = new Map(owner.rows().map(row => [row.id, row]))
  return snapshot.contracts.filter(record => !record.draft.isSupplement).map(record => ({
    id: record.id,
    projectId: record.draft.projectId ?? null,
    name: record.draft.name ?? '',
    no: record.draft.no ?? '',
    status: record.draft.status ?? 'draft',
    version: String(record.version),
    deletedAt: record.migrationEvidence?.deletedAt ?? null,
    retired: record.migrationRetired ?? false,
    amount: rows.get(record.id)?.amount ?? null,
    supplementAmount: rows.get(record.id)?.supplementAmount ?? null,
    eligible: rows.has(record.id),
  }))
}
