import type { AuxiliaryContractFact, AuxiliaryImportResult } from '../../app/lib/auxiliary-contract/contract'
import type { ContractFormAttachment } from '../../app/lib/contract/forms'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { AuxiliaryStoredContract } from './auxiliary-contract-test-instance'
import type { BusinessSession } from './business-session'
import { isDeepStrictEqual } from 'node:util'
import { auxiliaryKind, auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { decodeAuxiliaryCommand, decodeAuxiliaryDraft } from '../../app/lib/auxiliary-contract/validation'
import { decodeOurSignatorySnapshot } from '../../app/lib/our-signatory/contract'
import { commandFingerprint } from './command-journal'
import { contractOriginalDigest } from './contract-original'

type Row = Record<string, unknown>
type ReadTx = Pick<TransactionDb, 'select'>
type Actor = Pick<BusinessSession, 'workspaceId' | 'actorId'>
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
function fail(code: Parameters<typeof auxiliaryProblem>[0], message: string): never {
  throw auxiliaryProblem(code, message)
}
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const identity = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function parseJson<T>(value: unknown): T {
  try {
    return JSON.parse(String(value)) as T
  }
  catch { return fail('unavailable', '辅助合同原 JSON 证据损坏，停止读取或覆盖') }
}
function parseCommand(input: unknown) {
  if (!object(input) || Object.keys(input).some(key => !['id', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'action', 'draft', 'attachments', 'constructionMain'].includes(key)))
    return fail('validation-failed', '辅助合同原命令含未知字段')
  const command = decodeAuxiliaryCommand(input)
  if (!identity(command.commandId) || command.requiredCapability !== 'auxiliary-contract:write')
    return fail('validation-failed', '辅助合同原编号或职责无效')
  const selected = command.constructionMain
  if (selected && (!object(selected) || Object.keys(selected).sort().join(',') !== 'basis,id,projectId' || !identity(selected.id) || !identity(selected.projectId) || !hash(selected.basis)))
    return fail('validation-failed', '工程选择缺少真实主合同、项目或资格依据')
  if (command.draft.kind === 'company_expense' && selected)
    return fail('validation-failed', '公司合同头独立，工程归属由其真实业务费用明细保存')
  return command
}
export function parseProductionAuxiliaryEnvelope(input: unknown): Row & { commandId: string, workspaceId: string, actorId: string, id?: string, draft: Row & { kind: 'other_expense' | 'company_expense' } } {
  if (!object(input) || Object.keys(input).some(key => !['id', 'workspaceId', 'actorId', 'requiredCapability', 'commandId', 'baseVersion', 'action', 'draft', 'attachments', 'constructionMain'].includes(key)) || !identity(input.commandId) || !identity(input.workspaceId) || !identity(input.actorId) || input.requiredCapability !== 'auxiliary-contract:write' || !['draft', 'save', 'submit'].includes(String(input.action)) || !(input.baseVersion === null || typeof input.baseVersion === 'string') || (input.id !== undefined && !identity(input.id)) || !object(input.draft) || !object(input.attachments))
    return fail('validation-failed', '辅助合同原命令身份、目标或封套无效')
  return { ...input, commandId: input.commandId, workspaceId: input.workspaceId, actorId: input.actorId, ...(typeof input.id === 'string' ? { id: input.id } : {}), draft: { ...input.draft, kind: auxiliaryKind(input.draft.kind) } }
}
function validateRecord(record: AuxiliaryStoredContract, actor: Actor, id: string) {
  const d = decodeAuxiliaryDraft(record.draft)
  if (d.id !== id || record.workspaceId !== actor.workspaceId || !Number.isSafeInteger(record.version) || record.version < 1 || !Array.isArray(record.attachments) || !Array.isArray(record.facts) || !object(record.audit)
    || !(['createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'responsible', 'department'] as const).every(key => record.audit[key] === null || typeof record.audit[key] === 'string')) {
    return fail('unavailable', '辅助合同原身份、版本、审计或目录损坏')
  }
  if (d.ourSignatorySnapshot && (d.ourSignatoryId !== d.ourSignatorySnapshot.id || d.ourSignatoryVersion !== d.ourSignatorySnapshot.version || d.partyA !== d.ourSignatorySnapshot.name))
    return fail('unavailable', '辅助合同采用主体稳定ID与当时文书快照不一致')
  for (const file of record.attachments) {
    if (!file.id || file.ownerId !== id || file.ownerType !== (d.kind === 'company_expense' ? 'company_expense_contract' : 'contract') || !Number.isSafeInteger(file.fileSize) || file.fileSize < 0 || file.filePath !== '')
      return fail('unavailable', '辅助合同签约原件目录串归属或大小无效')
  }
  return record
}
async function validateAdoptedSignatory(tx: ReadTx, value: unknown) {
  if (value === null || value === undefined)
    return
  const snapshot = decodeOurSignatorySnapshot(value)
  const original = (await tx.select<Row>('SELECT draft_json FROM our_signatory_history WHERE signatory_id=? AND version=?', [snapshot.id, Number(snapshot.version)]))[0]
  const { status: _status, ...facts } = parseJson<Row>(original?.draft_json ?? 'null') ?? {}
  if (!original || !isDeepStrictEqual(snapshot, { id: snapshot.id, version: snapshot.version, ...facts }))
    return fail('unavailable', '辅助合同原主体快照缺当时正式核实版本')
}
async function legacyCommandExists(tx: ReadTx, commandId: string) {
  for (const row of await tx.select<Row>('SELECT evidence_json FROM auxiliary_contract_imports')) {
    const evidence = parseJson<Row>(row.evidence_json)
    const raw = evidence.rawDomain as Record<string, Array<{ columns: Record<string, { exactValue: unknown }> }>>
    for (const table of Object.keys(raw ?? {}).filter(name => /intent|receipt|resolution/.test(name))) {
      if ((raw[table] ?? []).some(record => record.columns.command_id?.exactValue === commandId))
        return true
    }
  }
  return false
}

/** Pure validation. It never installs tables, loads a service, enters a queue or repairs a source. */
export async function validateProductionAuxiliaryState(tx: ReadTx, actor: Actor, options: { creating?: boolean } = {}) {
  const metadata = (await tx.select<Row>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1'))[0]
  const participant = (await tx.select<Row>('SELECT schema_version FROM production_participants WHERE domain=\'auxiliary-contract\''))[0]
  if (metadata?.workspace_id !== actor.workspaceId || metadata.owner_id !== actor.actorId)
    return fail('forbidden', '辅助合同与可信工作区身份不同')
  if (participant?.schema_version !== 1)
    return fail('unavailable', '辅助合同正式owner尚未登记，不借开发事实补源')
  const rows = await tx.select<Row>('SELECT * FROM auxiliary_contract_records ORDER BY id')
  const versions = await tx.select<Row>('SELECT * FROM auxiliary_contract_versions ORDER BY id,version')
  const contracts = rows.map(row => validateRecord(parseJson<AuxiliaryStoredContract>(row.record_json), actor, String(row.id)))
  const imports = await tx.select<Row>('SELECT * FROM auxiliary_contract_imports')
  const supplements = (await tx.select<Row>('SELECT * FROM auxiliary_contract_supplements ORDER BY id')).map((row) => {
    const fact = parseJson<AuxiliaryContractFact & { deletedAt: string | null, attachments: ContractFormAttachment[], ourSignatorySnapshot?: unknown }>(row.record_json)
    if (fact.id !== row.id || fact.contractId !== row.contract_id || fact.kind !== 'supplement' || fact.contractKind !== 'other_expense' || fact.dataOrigin !== 'real' || !contracts.some(head => head.draft.id === fact.contractId && head.draft.kind === 'other_expense') || !Array.isArray(fact.attachments))
      return fail('unavailable', '辅助合同原补充协议身份、稳定归属或目录损坏')
    return fact
  })
  const bindings = await tx.select<Row>('SELECT b.*,f.owner_type,f.owner_id,f.file_name,f.file_path,f.file_size,f.mime_type,f.category,f.uploader,f.uploaded_at,f.deleted_at,p.content,p.sha256 AS payload_sha256 FROM auxiliary_contract_files b JOIN file_refs f ON f.id=b.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=b.file_ref_id ORDER BY b.file_ref_id')
  const metadataOnlyFileIds = new Set<string>()
  for (const row of rows) {
    const head = contracts.find(record => record.draft.id === row.id)!
    if ((head.draft.projectId ?? null) !== row.project_id || (head.draft.supplierId ?? null) !== row.supplier_id || (head.draft.kind === 'company_expense' && (row.project_id !== null || row.supplier_id !== null)))
      return fail('unavailable', '辅助合同原关系与持久化稳定ID不同')
    const history = versions.filter(item => item.id === row.id)
    if (history.length !== head.version || history.some((item, index) => item.version !== index + 1) || !isDeepStrictEqual(parseJson(history.at(-1)?.snapshot_json), head))
      return fail('unavailable', '辅助合同不可变完整版本与当前原资料不同')
    for (const entry of history) {
      const historical = validateRecord(parseJson(entry.snapshot_json), actor, String(row.id))
      await validateAdoptedSignatory(tx, historical.draft.ourSignatorySnapshot)
    }
  }
  if (versions.some(row => !contracts.some(head => head.draft.id === row.id)))
    return fail('unavailable', '辅助合同版本历史缺真实owner')
  for (const supplement of supplements)
    await validateAdoptedSignatory(tx, supplement.ourSignatorySnapshot)
  for (const binding of bindings) {
    const head = contracts.find(record => record.draft.id === binding.contract_id)
    const supplement = supplements.find(record => record.id === binding.supplement_id)
    const owner = binding.owner_kind === 'head' ? head : supplement
    const file = owner?.attachments.find(item => item.id === binding.file_ref_id)
    const metadata = parseJson<Row>(binding.original_metadata_json)
    const expectedOwnerId = binding.owner_kind === 'head' ? binding.contract_id : binding.supplement_id
    const expectedOwnerType = binding.owner_kind === 'head' ? head?.draft.kind === 'company_expense' ? 'company_expense_contract' : 'contract' : 'contract_supplement'
    const imported = head?.migrationBatchId ? imports.find(row => row.id === head.migrationBatchId) : null
    const evidence = imported ? parseJson<{ identityMappings: Array<{ legacyId: string, id: string }>, rawDomain: Record<string, Array<{ legacyId: string, columns: Record<string, { sqliteType: string, exactValue: string | null }> }>> }>(imported.evidence_json) : null
    const legacyOwner = evidence?.identityMappings.find(row => row.id === expectedOwnerId && row.legacyId === `${binding.owner_kind === 'head' ? head!.draft.kind : 'contract_supplements'}:${metadata.owner_id}`)
    const ownershipValid = metadata.owner_id === expectedOwnerId || (!!legacyOwner && metadata.adopted_owner_id === expectedOwnerId && metadata.adopted_contract_id === binding.contract_id)
    const legacyFile = evidence?.identityMappings.find(row => row.id === binding.file_ref_id && row.legacyId === `file_refs:${metadata.id}`)
    const rawFile = evidence?.rawDomain.file_refs?.find(row => row.legacyId === metadata.id)
    const uploadedValid = file?.uploadedAt === null ? binding.uploaded_at === '' && metadata.uploaded_at === null && rawFile?.columns.uploaded_at?.sqliteType === 'null' && rawFile.columns.uploaded_at.exactValue === null : file?.uploadedAt === binding.uploaded_at
    const fileIdentityValid = metadata.id === binding.file_ref_id || (!!legacyFile && metadata.adopted_file_ref_id === binding.file_ref_id)
    if (!owner || !file || (binding.owner_kind === 'supplement' && supplement?.contractId !== binding.contract_id) || binding.owner_id !== expectedOwnerId || binding.owner_type !== expectedOwnerType || file.ownerId !== expectedOwnerId || file.ownerType !== expectedOwnerType || file.fileName !== binding.file_name || file.fileSize !== binding.file_size || file.mimeType !== binding.mime_type || file.category !== binding.category || file.uploader !== binding.uploader || !uploadedValid || file.deletedAt !== binding.deleted_at || !fileIdentityValid || !ownershipValid || metadata.owner_type !== expectedOwnerType || metadata.file_path !== binding.file_path)
      return fail('unavailable', '辅助合同或原协议原件目录、原路径、元数据串归属')
    if (binding.body_state === 'metadata-only') {
      if (binding.content !== null || binding.sha256 !== null || binding.payload_sha256 !== null || binding.file_path)
        return fail('unavailable', '辅助合同缺件证据与实际正文矛盾')
      metadataOnlyFileIds.add(String(binding.file_ref_id))
    }
    else if (binding.body_state !== 'embedded' || !(binding.content instanceof Uint8Array) || binding.content.length !== file.fileSize || contractOriginalDigest(binding.content) !== binding.sha256 || binding.payload_sha256 !== binding.sha256 || file.sha256 !== binding.sha256) {
      return fail('unavailable', '辅助合同原件正文、摘要或实际大小损坏')
    }
  }
  for (const owner of [...contracts, ...supplements]) {
    for (const file of owner.attachments) {
      if (!bindings.some(row => row.file_ref_id === file.id))
        return fail('unavailable', '辅助合同完整目录缺持久化原件引用')
    }
  }
  const intents = await tx.select<Row>('SELECT * FROM auxiliary_contract_intents')
  const receipts = await tx.select<Row>('SELECT * FROM auxiliary_contract_receipts')
  const resolutions = await tx.select<Row>('SELECT * FROM auxiliary_contract_resolutions')
  const restores = await tx.select<Row>('SELECT * FROM auxiliary_contract_import_restores')
  for (const row of intents) {
    const request = parseJson<Row>(row.request_json)
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || request.commandId !== row.command_id || request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId || row.fingerprint !== commandFingerprint(request) || !['save', 'adopt', 'restore'].includes(String(row.action)))
      return fail('unavailable', '辅助合同原意图身份、正文或原指纹损坏')
    if (row.action === 'save')
      parseProductionAuxiliaryEnvelope(request)
  }
  for (const row of receipts) {
    const intent = intents.find(item => item.command_id === row.command_id)
    const result = parseJson<Row>(row.result_json)
    if (!intent || row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || row.fingerprint !== intent.fingerprint || row.action !== intent.action || row.scope_id !== intent.scope_id || result.commandId !== row.command_id || resolutions.some(item => item.command_id === row.command_id))
      return fail('unavailable', '辅助合同原回执缺原意图、串范围或与封存冲突')
    if (row.action === 'save') {
      const command = parseCommand(parseJson(intent.request_json))
      const version = versions.find(item => item.id === row.contract_id && String(item.version) === result.version)
      if (!version || version.command_id !== row.command_id || result.id !== row.contract_id || (command.id && command.id !== result.id) || result.updatedAt !== version.created_at)
        return fail('unavailable', '辅助合同原提交回执与实际不可变版本不同')
      const saved = validateRecord(parseJson(version.snapshot_json), actor, String(row.contract_id))
      if (!Array.isArray(result.attachmentIds) || !isDeepStrictEqual(result.attachmentIds, saved.attachments.filter(file => file.deletedAt === null).map(file => file.id)))
        return fail('unavailable', '辅助合同原回执目录与保存时原件事实不同')
      if (!options.creating && command.constructionMain) {
        const children = await tx.select<Row>('SELECT i.request_json,r.result_json FROM construction_scope_intents i JOIN construction_scope_receipts r ON r.command_id=i.command_id WHERE json_extract(i.request_json,\'$.originalSourceCommand.family\')=\'auxiliary-contract\' AND json_extract(i.request_json,\'$.originalSourceCommand.commandId\')=?', [row.command_id])
        if (children.length !== 1)
          return fail('unavailable', '辅助合同组合保存缺唯一可靠施工归属回执')
        const child = parseJson<Row>(children[0]!.request_json)
        const source = child.source
        if (!object(source) || source.domain !== 'auxiliary-contract' || source.id !== result.id || child.mainId !== command.constructionMain.id || child.mainBasis !== command.constructionMain.basis || child.projectId !== command.constructionMain.projectId || saved.draft.projectId !== child.projectId)
          return fail('unavailable', '辅助合同组合回执与原工程选择、真实Source不同')
      }
    }
    else if (row.action === 'adopt' ? !imports.some(item => item.command_id === row.command_id && item.result_json === row.result_json) : !restores.some(item => item.command_id === row.command_id && item.result_json === row.result_json)) {
      return fail('unavailable', '辅助合同迁入或恢复回执缺真实采用证据')
    }
  }
  if (!options.creating) {
    for (const version of versions) {
      const contract = contracts.find(row => row.draft.id === version.id)!
      const migration = contract.migrationBatchId && imports.find(row => row.id === contract.migrationBatchId)
      const result = receipts.find(row => row.command_id === version.command_id)
      if (migration && version.version === 1) {
        if (migration.command_id !== version.command_id || result?.action !== 'adopt')
          return fail('unavailable', '辅助合同原采用版本缺真实采用回执')
      }
      else if (!result || result.action !== 'save' || result.contract_id !== version.id || String(version.version) !== parseJson<Row>(result.result_json).version) {
        return fail('unavailable', '辅助合同成功版本缺可靠原提交回执')
      }
    }
  }
  for (const row of resolutions) {
    const intent = intents.find(item => item.command_id === row.command_id)
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || !time(row.resolved_at) || (intent && (intent.action !== row.action || intent.scope_id !== row.scope_id)))
      return fail('unavailable', '辅助合同原号封存与原范围不同')
  }
  for (const row of imports) {
    const evidence = parseJson<Row>(row.evidence_json)
    const result = parseJson<AuxiliaryImportResult>(row.result_json)
    if (!hash(row.source_sha256) || evidence.sourceSha256 !== row.source_sha256 || commandFingerprint(evidence) !== row.evidence_sha256 || evidence.domainDigest !== commandFingerprint(evidence.rawDomain) || result.importId !== row.id || result.commandId !== row.command_id || !Array.isArray(result.ids) || !Array.isArray(result.supplementIds) || !receipts.some(item => item.command_id === row.command_id && item.action === 'adopt') || result.ids.some(id => !contracts.some(head => head.draft.id === id && head.migrationBatchId === row.id)))
      return fail('unavailable', '辅助合同完整Native字节、原图、采用身份或原回执不一致')
    const originalSupplements = evidence.supplements
    const adoptedHeads = new Set(contracts.filter(head => head.migrationBatchId === row.id).map(head => head.draft.id))
    const actualSupplements = supplements.filter(supplement => adoptedHeads.has(supplement.contractId))
    if (!Array.isArray(originalSupplements) || originalSupplements.some(item => !object(item) || typeof item.id !== 'string') || new Set(result.supplementIds).size !== result.supplementIds.length || originalSupplements.length !== result.supplementIds.length || actualSupplements.length !== result.supplementIds.length || result.supplementIds.some((id) => {
      const original = originalSupplements.filter(item => object(item) && item.id === id)
      const actual = actualSupplements.filter(item => item.id === id)
      return original.length !== 1 || actual.length !== 1 || !isDeepStrictEqual(original[0], actual[0])
    })) {
      return fail('unavailable', '辅助合同原增补固定采用图、完整目录或主体与不可变证据不同')
    }
  }
  for (const row of restores) {
    if (!imports.some(item => item.id === row.import_id) || !receipts.some(item => item.command_id === row.command_id && item.action === 'restore') || !time(row.restored_at))
      return fail('unavailable', '辅助合同整批恢复证据或原回执不完整')
  }
  const revision = (await tx.select<Row>('SELECT revision FROM auxiliary_contract_revision WHERE singleton=1'))[0]?.revision
  if (!Number.isSafeInteger(revision) || Number(revision) < 0)
    return fail('unavailable', '辅助合同正式来源修订缺失')
  await validateProductionAuxiliaryIdentities(tx, contracts, versions)
  return { state: { schemaVersion: 1 as const, sourceVersion: Number(revision), contracts }, supplements, metadataOnlyFileIds, imports, restores }
}

export async function validateProductionAuxiliaryIdentities(tx: ReadTx, contracts: readonly AuxiliaryStoredContract[], suppliedVersions?: Row[]) {
  const versions = suppliedVersions ?? await tx.select<Row>('SELECT * FROM auxiliary_contract_versions ORDER BY id,version')
  const claims = await tx.select<Row>('SELECT * FROM contract_number_claims WHERE owner_domain=\'auxiliary-contract\'')
  const history = await tx.select<Row>('SELECT * FROM contract_number_history WHERE owner_domain=\'auxiliary-contract\'')
  for (const contract of contracts) {
    const originalVersions = versions.filter(row => row.id === contract.draft.id)
    const formal = [...originalVersions].reverse().find(row => !['草稿', 'draft'].includes(parseJson<AuxiliaryStoredContract>(row.snapshot_json).draft.status ?? '草稿'))
    const number = formal ? parseJson<AuxiliaryStoredContract>(formal.snapshot_json).draft.no?.trim() ?? '' : ''
    const claim = claims.find(row => row.contract_id === contract.draft.id)
    if (number ? !claim || claim.number !== number || claim.version !== String(formal!.version) || claim.claimed_at !== formal!.created_at : !!claim)
      return fail('unavailable', '辅助合同正式原编号占用与真实不可变版本不同')
    for (const version of originalVersions) {
      const number = parseJson<AuxiliaryStoredContract>(version.snapshot_json).draft.no?.trim() ?? ''
      const entries = history.filter(row => row.contract_id === contract.draft.id && row.version === String(version.version))
      if (number ? entries.length !== 1 || entries[0]!.number !== number || entries[0]!.occurred_at !== version.created_at || entries[0]!.id !== `auxiliary-${contract.draft.id}-v${version.version}` || !['formal-fact', 'draft-evidence', 'migration-evidence'].includes(String(entries[0]!.reason)) : entries.length !== 0)
        return fail('unavailable', '辅助合同所有版本的原编号历史缺失、冒用或串前缀')
    }
  }
  if (claims.some(row => !contracts.some(head => head.draft.id === row.contract_id)) || history.some(row => !versions.some(version => version.id === row.contract_id && String(version.version) === row.version)))
    return fail('unavailable', '辅助合同原编号证据缺真实owner或实际版本')
}

/** Only the actual owner facts. Cash, invoices and project wages are never guessed here. */
export async function readAuxiliaryContractScopeFacts(tx: ReadTx, actor: BusinessSession, creating = false) {
  if (!actor.capabilities.includes('auxiliary-contract:read'))
    return fail('forbidden', '没有真实辅助合同读取权限')
  const { state, supplements, restores } = await validateProductionAuxiliaryState(tx, actor, { creating })
  const parents = await tx.select<Row>('SELECT c.id,c.deleted_at,p.deleted_at AS project_deleted_at FROM auxiliary_contract_records c LEFT JOIN projects p ON p.id=c.project_id')
  return state.contracts.filter(record => record.draft.kind === 'other_expense').map((record) => {
    const parent = parents.find(row => row.id === record.draft.id)!
    const values = supplements.filter(row => row.contractId === record.draft.id && row.effective && row.deletedAt === null).map(row => row.amount === null ? null : Number(row.amount))
    const retired = restores.some(row => row.import_id === record.migrationBatchId)
    return { id: record.draft.id, projectId: record.draft.projectId ?? null, supplierId: record.draft.supplierId ?? null, name: record.draft.name ?? '', no: record.draft.no ?? '', status: record.draft.status ?? '草稿', deletedAt: parent.deleted_at as string | null, retired, amount: record.draft.amount ?? null, supplementAmount: values.includes(null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0), eligible: parent.deleted_at === null && parent.project_deleted_at === null && !retired && !!record.draft.projectId && !!record.draft.supplierId }
  })
}

export { fail as auxiliaryFailure, hash as auxiliaryHash, identity as auxiliaryIdentity, parseJson as auxiliaryJson, time as auxiliaryTime, parseCommand as parseProductionAuxiliaryCommand, legacyCommandExists as productionAuxiliaryLegacyCommandExists }
