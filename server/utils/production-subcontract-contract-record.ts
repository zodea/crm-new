import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import type { StoredSubcontractContract, SubcontractContractOwnerSnapshot } from './subcontract-contract-command-test-instance'
import { isDeepStrictEqual } from 'node:util'
import { decodeOurSignatorySnapshot } from '../../app/lib/our-signatory/contract'
import { decodeSubcontractContractDraft } from '../../app/lib/subcontract-contract/command-validation'
import { subcontractContractProblem, SubcontractContractRepositoryProblem } from '../../app/lib/subcontract-contract/repository'
import { commandFingerprint } from './command-journal'
import { contractOriginalDigest } from './contract-original'
import { parseSubcontractContractCommandRequest } from './subcontract-contract-command-request'

type Row = Record<string, unknown>
type ReadTx = Pick<TransactionDb, 'select'>
export function subcontractFailure(code: Parameters<typeof subcontractContractProblem>[0], message: string): never {
  throw new SubcontractContractRepositoryProblem(subcontractContractProblem(code, message))
}
export function subcontractCanonicalRecord(record: StoredSubcontractContract) {
  const { originals: _bodies, ...value } = record
  return value
}
/** Legacy evidence lacks a trusted actor/intent mapping; it cannot prove absence or authorize a new body. */
export async function productionSubcontractLegacyCommandExists(tx: ReadTx, commandId: string) {
  for (const row of await tx.select<{ evidence_json: string }>('SELECT evidence_json FROM subcontract_contract_imports')) {
    const raw = JSON.parse(row.evidence_json).rawDomain
    for (const table of ['subcontract_contract_intents', 'subcontract_contract_receipts', 'subcontract_contract_resolutions']) {
      if ((raw[table] ?? []).some((record: { columns: Record<string, { exactValue: unknown }> }) => record.columns.command_id?.exactValue === commandId))
        return true
    }
  }
  return false
}
export async function readProductionSubcontractState(tx: ReadTx, actor: Pick<BusinessSession, 'workspaceId' | 'actorId'>): Promise<SubcontractContractOwnerSnapshot & { metadataOnlyFileIds: Set<string> }> {
  if ((await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'subcontract-contracts\''))[0]?.schema_version !== 1)
    return subcontractFailure('unavailable', '正式分包主合同尚未登记，不能借开发合同补上游')
  const identity = (await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1'))[0]
  if (!identity || identity.workspace_id !== actor.workspaceId || identity.owner_id !== actor.actorId)
    return subcontractFailure('forbidden', '分包owner与可信持久身份不一致')
  const contracts: StoredSubcontractContract[] = []
  const metadataOnlyFileIds = new Set<string>()
  async function unknownUpload(fileId: string, importId: unknown, metadata: Row, stored: unknown, adopted: unknown) {
    if (stored !== '' && adopted !== null && metadata.uploaded_at !== null)
      return
    const proof = typeof importId === 'string' ? (await tx.select<{ evidence_json: string }>('SELECT evidence_json FROM subcontract_contract_imports WHERE id=?', [importId]))[0] : null
    const original = proof ? JSON.parse(proof.evidence_json).rawDomain.file_refs.find((row: { legacyId: string }) => row.legacyId === fileId) : null
    if (metadata.uploaded_at !== null || !original || original.columns.uploaded_at.sqliteType !== 'null' || original.columns.uploaded_at.exactValue !== null)
      return subcontractFailure('unavailable', '历史未知上传时间缺本领域原SQLite NULL证明，不能虚构或借创建时间补值')
  }
  const rows = await tx.select<{ id: string, project_id: string | null, supplier_id: string | null, deleted_at: string | null, record_json: string }>('SELECT id,project_id,supplier_id,deleted_at,record_json FROM subcontract_contract_records ORDER BY id')
  for (const row of rows) {
    const parsed = JSON.parse(row.record_json)
    const draft = decodeSubcontractContractDraft(parsed.draft)
    if (draft.id !== row.id || (draft.projectId ?? null) !== row.project_id || (draft.supplierId ?? null) !== row.supplier_id || draft.isSupplement || draft.originalContractId !== null || !Number.isSafeInteger(parsed.version) || parsed.version < 1 || !Array.isArray(parsed.attachments) || !Number.isFinite(Date.parse(parsed.createdAt)) || !Number.isFinite(Date.parse(parsed.updatedAt)))
      return subcontractFailure('unavailable', '分包主合同原身份、归属、版本或原目录损坏')
    const originals = new Map<string, { bytes: Uint8Array, sha256: string }>()
    for (const file of parsed.attachments) {
      const binding = (await tx.select<Row>('SELECT b.*,f.owner_type,f.owner_id,f.file_name,f.file_path,f.file_size,f.mime_type,f.uploaded_at,f.deleted_at,p.content,p.sha256 AS payload_sha256 FROM subcontract_contract_files b JOIN file_refs f ON f.id=b.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=b.file_ref_id WHERE b.file_ref_id=?', [file.id]))[0]
      if (!binding || binding.contract_id !== row.id || binding.owner_kind !== 'head' || binding.owner_id !== row.id || binding.owner_type !== 'contract' || file.ownerId !== row.id || file.ownerType !== 'contract' || binding.file_name !== file.fileName || binding.file_size !== file.fileSize || binding.mime_type !== file.mimeType || binding.deleted_at !== file.deletedAt)
        return subcontractFailure('unavailable', '分包签约原件身份或真实归属损坏')
      const metadata = JSON.parse(String(binding.original_metadata_json))
      if (metadata.id !== file.id || metadata.owner_id !== row.id || metadata.owner_type !== 'contract' || metadata.file_path !== binding.file_path || (metadata.file_name ?? '') !== binding.file_name || (metadata.mime_type ?? '') !== binding.mime_type || (metadata.file_size != null && metadata.file_size !== binding.file_size))
        return subcontractFailure('unavailable', '分包原件来源路径或原目录证据不一致')
      await unknownUpload(file.id, parsed.migrationBatchId, metadata, binding.uploaded_at, file.uploadedAt)
      if (binding.body_state === 'metadata-only') {
        if (binding.content !== null || binding.sha256 !== null || binding.payload_sha256 !== null || binding.file_path)
          return subcontractFailure('unavailable', '分包缺件证据与现有原正文冲突')
        metadataOnlyFileIds.add(file.id)
      }
      else {
        if (binding.body_state !== 'embedded' || !(binding.content instanceof Uint8Array) || binding.content.length !== file.fileSize || contractOriginalDigest(binding.content) !== binding.sha256 || binding.payload_sha256 !== binding.sha256 || file.sha256 !== binding.sha256)
          return subcontractFailure('unavailable', '分包原件字节、摘要或大小损坏')
        originals.set(file.id, { bytes: binding.content, sha256: String(binding.sha256) })
      }
    }
    contracts.push({ ...parsed, originals } as StoredSubcontractContract)
  }
  const revisions = await tx.select<{ revision: number }>('SELECT revision FROM subcontract_contract_revision WHERE singleton=1')
  if (revisions.length !== 1 || !Number.isSafeInteger(revisions[0]!.revision) || revisions[0]!.revision < 0)
    return subcontractFailure('unavailable', '分包owner持久版本依据缺失')
  const supplements = (await tx.select<Row>('SELECT * FROM subcontract_contract_supplements ORDER BY id')).map((row) => {
    const fact = JSON.parse(String(row.record_json))
    if (fact.id !== row.id || fact.contractId !== row.contract_id || !contracts.some(head => head.draft.id === fact.contractId) || fact.dataOrigin !== 'real')
      return subcontractFailure('unavailable', '原补充协议稳定身份与真实主合同不一致')
    return fact
  })
  const supplementBindings = await tx.select<Row>('SELECT b.*,f.owner_type,f.owner_id,f.file_name,f.file_path,f.file_size,f.mime_type,f.uploaded_at,f.deleted_at,p.content,p.sha256 AS payload_sha256 FROM subcontract_contract_files b JOIN file_refs f ON f.id=b.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=b.file_ref_id WHERE b.owner_kind=\'supplement\' ORDER BY b.file_ref_id')
  for (const binding of supplementBindings) {
    const supplement = supplements.find(row => row.id === binding.supplement_id)
    const metadata = JSON.parse(String(binding.original_metadata_json))
    if (!supplement || supplement.contractId !== binding.contract_id || binding.owner_type !== 'contract_supplement' || binding.owner_id !== binding.supplement_id || metadata.id !== binding.file_ref_id || metadata.owner_type !== binding.owner_type || metadata.owner_id !== binding.owner_id || metadata.file_path !== binding.file_path || (metadata.file_name ?? '') !== binding.file_name || (metadata.mime_type ?? '') !== binding.mime_type)
      return subcontractFailure('unavailable', '原补充协议附件串归属、来源路径或元数据不完整')
    const current = supplement.attachments?.find((file: { id: string }) => file.id === binding.file_ref_id)
    if (!current || current.ownerType !== 'contract_supplement' || current.ownerId !== binding.supplement_id || current.deletedAt !== binding.deleted_at || current.fileName !== binding.file_name || current.mimeType !== binding.mime_type || current.fileSize !== binding.file_size)
      return subcontractFailure('unavailable', '补充协议完整原件目录与现状态不一致')
    await unknownUpload(String(binding.file_ref_id), contracts.find(head => head.draft.id === supplement.contractId)?.migrationBatchId, metadata, binding.uploaded_at, current.uploadedAt)
    if (binding.body_state === 'metadata-only') {
      if (binding.content !== null || binding.sha256 !== null || binding.payload_sha256 !== null || binding.file_path)
        return subcontractFailure('unavailable', '补充协议历史缺件证据与现正文矛盾')
      metadataOnlyFileIds.add(String(binding.file_ref_id))
    }
    else if (binding.body_state !== 'embedded' || !(binding.content instanceof Uint8Array) || binding.content.length !== binding.file_size || (metadata.file_size !== null && metadata.file_size !== binding.content.length) || contractOriginalDigest(binding.content) !== binding.sha256 || binding.payload_sha256 !== binding.sha256 || current.sha256 !== binding.sha256) {
      return subcontractFailure('unavailable', '补充协议原件字节、SHA或完整长度损坏')
    }
  }
  for (const supplement of supplements) {
    if (!Array.isArray(supplement.attachments ?? []))
      return subcontractFailure('unavailable', '补充协议原件目录格式错误')
    for (const file of supplement.attachments ?? []) {
      if (!supplementBindings.some(row => row.file_ref_id === file.id && row.supplement_id === supplement.id))
        return subcontractFailure('unavailable', '补充协议原件目录缺少对应持久化证据')
    }
    const adopted = supplement.ourSignatory?.ourSignatorySnapshot ? decodeOurSignatorySnapshot(supplement.ourSignatory.ourSignatorySnapshot) : null
    if ((supplement.ourSignatory?.ourSignatoryId ?? null) !== (adopted?.id ?? null) || (supplement.ourSignatory?.ourSignatoryVersion ?? null) !== (adopted?.version ?? null))
      return subcontractFailure('unavailable', '原补充协议主体ID与采用版本不一致')
    if (adopted) {
      const original = (await tx.select<{ draft_json: string }>('SELECT draft_json FROM our_signatory_history WHERE signatory_id=? AND version=?', [adopted.id, Number(adopted.version)]))[0]
      const { status: _status, ...facts } = JSON.parse(original?.draft_json ?? 'null') ?? {}
      if (!original || !isDeepStrictEqual(adopted, { id: adopted.id, version: adopted.version, ...facts }))
        return subcontractFailure('unavailable', '原补充协议主体快照与当时正式核实版本不一致')
    }
  }
  for (const binding of await tx.select<{ file_ref_id: string, contract_id: string, owner_kind: string, supplement_id: string | null }>('SELECT file_ref_id,contract_id,owner_kind,supplement_id FROM subcontract_contract_files')) {
    if (binding.owner_kind === 'head' && (binding.supplement_id !== null || !contracts.some(head => head.draft.id === binding.contract_id && head.attachments.some(file => file.id === binding.file_ref_id))))
      return subcontractFailure('unavailable', '分包原件存在脱离正式目录的领域引用')
  }
  const snapshot = { schemaVersion: 1 as const, sourceVersion: revisions[0]!.revision, contracts, supplements, metadataOnlyFileIds }
  await validateProductionSubcontractIdentities(tx, snapshot.contracts)
  return snapshot
}
export async function validateProductionSubcontractIdentities(tx: ReadTx, records: readonly StoredSubcontractContract[]) {
  const all = await tx.select<{ id: string, version: number, snapshot_json: string, actor_id: string, command_id: string, created_at: string }>('SELECT * FROM subcontract_contract_versions ORDER BY id,version')
  const claims = await tx.select<Row>('SELECT * FROM contract_number_claims WHERE owner_domain=\'subcontract-contracts\'')
  const numberHistory = await tx.select<Row>('SELECT * FROM contract_number_history WHERE owner_domain=\'subcontract-contracts\'')
  for (const record of records) {
    const versions = all.filter(row => row.id === record.draft.id)
    if (versions.length !== record.version || versions.some((row, index) => row.version !== index + 1) || !isDeepStrictEqual(JSON.parse(versions.at(-1)?.snapshot_json ?? 'null'), subcontractCanonicalRecord(record)))
      return subcontractFailure('unavailable', '分包主合同完整不可变历史与当前原资料不一致')
    const established = [...versions].reverse().find(row => !['draft', '草稿'].includes(JSON.parse(row.snapshot_json).draft.status))
    const establishedDraft = established && JSON.parse(established.snapshot_json).draft
    const number = establishedDraft?.no?.trim() ?? ''
    const claim = claims.find(row => row.contract_id === record.draft.id)
    if (number ? !claim || claim.number !== number || claim.version !== String(established!.version) || claim.claimed_at !== established!.created_at : Boolean(claim))
      return subcontractFailure('unavailable', '分包主合同原正式编号占用与既有事实不一致')
    for (const row of versions) {
      const historical = JSON.parse(row.snapshot_json)
      const draft = decodeSubcontractContractDraft(historical.draft)
      const history = numberHistory.filter(entry => entry.contract_id === record.draft.id && entry.version === String(row.version))
      const number = draft.no?.trim() ?? ''
      if (number ? history.length !== 1 || history[0]!.number !== number || history[0]!.occurred_at !== row.created_at : history.length !== 0)
        return subcontractFailure('unavailable', '分包主合同原编号历史损坏')
      if (history.some(entry => entry.id !== `subcontract-${record.draft.id}-v${row.version}` || !['formal-fact', 'draft-evidence', 'migration-evidence'].includes(String(entry.reason))))
        return subcontractFailure('unavailable', '分包主合同编号历史存在伪造前缀或依据')
      const adopted = draft.ourSignatorySnapshot ? decodeOurSignatorySnapshot(draft.ourSignatorySnapshot) : null
      if ((draft.ourSignatoryId ?? null) !== (adopted?.id ?? null) || (draft.ourSignatoryVersion ?? null) !== (adopted?.version ?? null))
        return subcontractFailure('unavailable', '分包采用的签约主体身份及核实版本不一致')
      if (adopted) {
        const original = (await tx.select<{ draft_json: string }>('SELECT draft_json FROM our_signatory_history WHERE signatory_id=? AND version=?', [adopted.id, Number(adopted.version)]))[0]
        const { status: _status, ...facts } = JSON.parse(original?.draft_json ?? 'null') ?? {}
        if (!original || !isDeepStrictEqual(adopted, { id: adopted.id, version: adopted.version, ...facts }))
          return subcontractFailure('unavailable', '分包签约快照与当时我方真实核实事实不同')
      }
    }
  }
  if (all.some(row => !records.some(record => record.draft.id === row.id)) || claims.some(row => !records.some(record => record.draft.id === row.contract_id)) || numberHistory.some(row => !all.some(version => version.id === row.contract_id && String(version.version) === row.version)))
    return subcontractFailure('unavailable', '分包历史或原编号记录缺少实际owner')
}
export async function validateProductionSubcontractState(tx: ReadTx, actor: Pick<BusinessSession, 'workspaceId' | 'actorId'>) {
  const state = await readProductionSubcontractState(tx, actor)
  const intents = await tx.select<Row>('SELECT * FROM subcontract_contract_intents')
  const receipts = await tx.select<Row>('SELECT * FROM subcontract_contract_receipts')
  const sealed = await tx.select<Row>('SELECT * FROM subcontract_contract_resolutions')
  const versions = await tx.select<Row>('SELECT * FROM subcontract_contract_versions')
  for (const row of intents) {
    const body = JSON.parse(String(row.request_json))
    const command = parseSubcontractContractCommandRequest(body, body.id ? { kind: 'update', routeId: body.id } : { kind: 'create' })
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId || command.commandId !== row.command_id || (command.id ?? null) !== row.target_id || row.fingerprint !== commandFingerprint(command))
      return subcontractFailure('unavailable', '分包原请求正文、身份或完整指纹损坏')
  }
  for (const row of receipts) {
    const original = intents.find(intent => intent.command_id === row.command_id)
    const result = JSON.parse(String(row.result_json))
    const adoptedVersion = versions.find(version => version.id === result.id && String(version.version) === result.version && version.command_id === result.commandId)
    const snapshot = adoptedVersion ? JSON.parse(String(adoptedVersion.snapshot_json)) : null
    if (!original || !snapshot || adoptedVersion?.actor_id !== actor.actorId || row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || row.fingerprint !== original.fingerprint || result.commandId !== row.command_id || result.id !== row.contract_id || result.updatedAt !== snapshot.updatedAt || !isDeepStrictEqual(result.attachmentIds, snapshot.attachments.filter((file: { deletedAt: string | null }) => file.deletedAt === null).map((file: { id: string }) => file.id)) || !state.contracts.some(record => record.draft.id === result.id) || sealed.some(marker => marker.command_id === row.command_id))
      return subcontractFailure('unavailable', '分包原回执缺原意图或与封存结果矛盾')
    const sourceCommand = JSON.parse(String(original.request_json))
    if (sourceCommand.constructionMain) {
      const witnesses = await tx.select<Row>('SELECT h.main_id,h.project_id,h.main_basis,i.request_json,r.result_json FROM construction_scope_history h JOIN construction_scope_intents i ON i.command_id=h.command_id JOIN construction_scope_receipts r ON r.command_id=h.command_id WHERE h.source_domain=\'subcontract-contract\' AND h.source_id=?', [result.id])
      const witness = witnesses.find((entry) => {
        const intent = JSON.parse(String(entry.request_json))
        return intent.originalSourceCommand?.family === 'subcontract-contract' && intent.originalSourceCommand.commandId === result.commandId
      })
      if (!witness || witness.main_id !== sourceCommand.constructionMain.id || witness.project_id !== sourceCommand.constructionMain.projectId || witness.main_basis !== sourceCommand.constructionMain.basis)
        return subcontractFailure('unavailable', '分包原保存缺少同事务工程关联的真实原号与不可变证据')
    }
  }
  for (const marker of sealed) {
    if (marker.workspace_id !== actor.workspaceId || marker.actor_id !== actor.actorId)
      return subcontractFailure('unavailable', '分包原编号封存身份错误')
  }
  const imported = await tx.select<Row>('SELECT * FROM subcontract_contract_imports')
  for (const row of imported) {
    const evidence = JSON.parse(String(row.evidence_json))
    const result = JSON.parse(String(row.result_json))
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || typeof evidence.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.sourceSha256) || !Number.isSafeInteger(evidence.schemaVersion) || evidence.schemaVersion < 47 || evidence.schemaVersion > 60 || evidence.sourceSha256 !== row.source_sha256 || commandFingerprint(evidence) !== row.evidence_sha256 || evidence.domainDigest !== commandFingerprint(evidence.rawDomain) || result.commandId !== row.command_id || result.importId !== row.id || result.sourceSha256 !== row.source_sha256 || !Array.isArray(result.ids) || !Array.isArray(result.supplementIds) || result.ids.some((id: string) => !state.contracts.some(record => record.draft.id === id)) || result.supplementIds.some((id: string) => !state.supplements.some(record => record.id === id)))
      return subcontractFailure('unavailable', '分包主补完整原图、身份或不可变来源摘要不一致')
    const originalHeads = evidence.rawDomain?.contracts
    const originalSupplements = evidence.rawDomain?.contract_supplements
    if (!Array.isArray(originalHeads) || !Array.isArray(originalSupplements) || !isDeepStrictEqual(originalHeads.map((head: { legacyId: string }) => head.legacyId).sort(), [...result.ids].sort()) || !isDeepStrictEqual(originalSupplements.map((supplement: { legacyId: string }) => supplement.legacyId).sort(), [...result.supplementIds].sort()))
      return subcontractFailure('unavailable', '分包主补原完整图与采用ID目录不一致')
    for (const head of originalHeads) {
      const current = state.contracts.find(record => record.draft.id === head.legacyId)!
      const first = versions.find(version => version.id === head.legacyId && version.version === 1)
      const installed = first ? JSON.parse(String(first.snapshot_json)) : null
      const project = evidence.references.projects.find((mapping: { legacyId: string }) => mapping.legacyId === head.columns.project_id.exactValue)
      const supplier = evidence.references.suppliers.find((mapping: { legacyId: string }) => mapping.legacyId === head.columns.supplier_id.exactValue)
      if (head.columns.id.exactValue !== head.legacyId || head.columns.kind.exactValue !== '分包' || current.migrationBatchId !== row.id || !installed || installed.migrationBatchId !== row.id || installed.draft.projectId !== (project?.id ?? null) || installed.draft.supplierId !== (supplier?.id ?? null) || installed.draft.no !== (head.columns.no.exactValue ?? '') || installed.draft.name !== (head.columns.name.exactValue ?? ''))
        return subcontractFailure('unavailable', '原分包身份、明确祖先映射或首个不可变采用版本不一致')
    }
    for (const original of evidence.rawDomain.file_refs ?? []) {
      const binding = (await tx.select<Row>('SELECT b.*,f.uploaded_at FROM subcontract_contract_files b JOIN file_refs f ON f.id=b.file_ref_id WHERE b.file_ref_id=?', [original.legacyId]))[0]
      const metadata = binding ? JSON.parse(String(binding.original_metadata_json)) : null
      if (!metadata || original.columns.id.exactValue !== original.legacyId || metadata.id !== original.legacyId || metadata.owner_type !== original.columns.owner_type.exactValue || metadata.owner_id !== original.columns.owner_id.exactValue || metadata.file_path !== original.columns.file_path.exactValue || metadata.file_name !== original.columns.file_name.exactValue)
        return subcontractFailure('unavailable', '原分包完整文件目录和共享原件归属证明不一致')
      if ((binding?.uploaded_at === '' || metadata.uploaded_at === null) && (metadata.uploaded_at !== null || original.columns.uploaded_at.sqliteType !== 'null' || original.columns.uploaded_at.exactValue !== null))
        return subcontractFailure('unavailable', '历史未知上传时间与本领域原SQLite NULL列证明不一致')
    }
    for (const original of evidence.rawDomain.file_payloads ?? []) {
      const payload = original.columns.content
      const binding = (await tx.select<Row>('SELECT * FROM subcontract_contract_files WHERE file_ref_id=?', [original.legacyId]))[0]
      if (payload.sharedOriginal !== original.legacyId || binding?.body_state !== 'embedded' || payload.sha256 !== binding.sha256)
        return subcontractFailure('unavailable', '原分包正文证明与真实共享原件不一致')
    }
    const supplements = await tx.select<Row>('SELECT * FROM subcontract_contract_supplements WHERE contract_id IN (SELECT id FROM subcontract_contract_records WHERE json_extract(record_json,\'$.migrationBatchId\')=?) ORDER BY id', [row.id])
    if (commandFingerprint(supplements) !== commandFingerprint(evidence.supplementFingerprints))
      return subcontractFailure('unavailable', '原补充协议只读图与采用时不可变完整证据不同')
  }
  if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'subcontract_contract_import_intents\'')).length) {
    if (imported.length)
      return subcontractFailure('unavailable', '旧分包采用缺原意图恢复证据，保留原库核对')
    return { metadataOnlyFileIds: state.metadataOnlyFileIds, state }
  }
  const importIntents = await tx.select<Row>('SELECT * FROM subcontract_contract_import_intents')
  const importReceipts = await tx.select<Row>('SELECT * FROM subcontract_contract_import_receipts')
  const importSealed = await tx.select<Row>('SELECT * FROM subcontract_contract_import_resolutions')
  for (const row of importIntents) {
    const proof = JSON.parse(String(row.request_proof_json))
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || commandFingerprint(proof) !== row.fingerprint || Object.hasOwn(proof, 'source') || Object.hasOwn(proof, 'payloadBase64') || (row.action === 'adopt' ? proof.sourceSha256 !== row.scope_id : row.action !== 'restore' || proof.importId !== row.scope_id))
      return subcontractFailure('unavailable', '分包采用原意图缺可信scope或误存整库正文')
  }
  for (const row of importReceipts) {
    const original = importIntents.find(entry => entry.command_id === row.command_id)
    const result = JSON.parse(String(row.result_json))
    const batch = imported.find(entry => entry.id === result.importId)
    if (!original || !batch || row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || row.action !== original.action || row.scope_id !== original.scope_id || row.fingerprint !== original.fingerprint || result.commandId !== row.command_id || result.sourceSha256 !== batch.source_sha256 || importSealed.some(entry => entry.command_id === row.command_id) || (row.action === 'adopt' ? result.sourceSha256 !== row.scope_id || batch.result_json !== row.result_json : result.importId !== row.scope_id || !result.restored))
      return subcontractFailure('unavailable', '分包原采用/恢复回执与原意图、批次或封存矛盾')
  }
  for (const batch of imported) {
    if (!importReceipts.some(receipt => receipt.action === 'adopt' && receipt.command_id === batch.command_id && receipt.scope_id === batch.source_sha256 && receipt.result_json === batch.result_json))
      return subcontractFailure('unavailable', '分包采用批次缺可信原编号成功回执')
  }
  for (const row of importSealed) {
    const original = importIntents.find(entry => entry.command_id === row.command_id)
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || (original && (original.action !== row.action || original.scope_id !== row.scope_id)))
      return subcontractFailure('unavailable', '分包采用原封存scope或身份错误')
  }
  for (const row of await tx.select<Row>('SELECT * FROM subcontract_contract_import_restores')) {
    const receipt = importReceipts.find(entry => entry.command_id === row.command_id)
    const result = JSON.parse(String(row.result_json))
    if (!receipt || receipt.action !== 'restore' || receipt.result_json !== row.result_json || result.importId !== row.import_id || row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId)
      return subcontractFailure('unavailable', '分包恢复标记缺相同身份和原回执')
  }
  return { metadataOnlyFileIds: state.metadataOnlyFileIds, state }
}
