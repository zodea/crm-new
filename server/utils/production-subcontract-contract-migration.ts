import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { SubcontractImportCommand, SubcontractImportPreview, SubcontractImportResult } from '../../app/lib/subcontract-contract/import-contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import type { StoredSubcontractContract } from './subcontract-contract-command-test-instance'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { mapProjectContractRow } from '../../app/lib/contract/forms'
import { decodeOurSignatorySnapshot } from '../../app/lib/our-signatory/contract'
import { readOurSignatories } from '../../app/lib/our-signatory/storage'
import { isISODateTimeDTO } from '../../app/types/read-model'
import { commandFingerprint } from './command-journal'
import { contractOriginalDigest } from './contract-original'
import { captureMigrationDomainRows } from './migration-domain-evidence'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { subcontractFailure as fail, validateProductionSubcontractState } from './production-subcontract-contract-record'
import { productionSubcontractContractConsumed } from './production-subcontract-contract-reference-guard'
import { loadProductionSuppliers } from './production-supplier-record'

type Row = Record<string, unknown>
type Session = () => BusinessSession
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
function parse(input: unknown): SubcontractImportCommand {
  if (!object(input) || Object.keys(input).sort().join(',') !== 'actorId,commandId,originals,projects,signatories,source,suppliers,workspaceId' || !['commandId', 'workspaceId', 'actorId'].every(key => typeof input[key] === 'string' && String(input[key]).trim()) || !/^[a-z0-9][\w-]{2,79}$/i.test(String(input.commandId)) || !object(input.source) || Object.keys(input.source).sort().join(',') !== 'payloadBase64,sha256')
    return fail('validation-failed', '分包完整来源封套或原编号无效')
  for (const part of ['projects', 'suppliers', 'signatories']) {
    const rows = input[part]
    if (!Array.isArray(rows) || rows.some(row => !object(row) || Object.keys(row).sort().join(',') !== 'id,legacyId,version' || !['id', 'legacyId', 'version'].every(key => typeof row[key] === 'string' && String(row[key]).trim())) || new Set(rows.map(row => row.legacyId)).size !== rows.length)
      return fail('validation-failed', '分包采用必须逐项明确已有正式主档ID和版本')
  }
  if (typeof input.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.source.sha256) || typeof input.source.payloadBase64 !== 'string')
    return fail('validation-failed', '分包完整来源摘要和字节无效')
  if (!Array.isArray(input.originals) || input.originals.some(row => !object(row) || Object.keys(row).sort().join(',') !== 'fileId,payloadBase64' || typeof row.fileId !== 'string' || !row.fileId.trim() || typeof row.payloadBase64 !== 'string' || Buffer.from(row.payloadBase64, 'base64').toString('base64') !== row.payloadBase64) || new Set(input.originals.map(row => row.fileId)).size !== input.originals.length)
    return fail('validation-failed', '分包补传原件格式或身份无效')
  return input as unknown as SubcontractImportCommand
}
function sourceTime(value: unknown) {
  if (typeof value !== 'string')
    return fail('validation-failed', '原分包时间证据缺失，不能造时间替代')
  const sqlite = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(value)
  const normalized = sqlite ? `${value.replace(' ', 'T')}Z` : value
  if (!isISODateTimeDTO(normalized))
    return fail('validation-failed', '原分包时间证据缺失或非法，不能造时间替代')
  const timestamp = new Date(normalized).toISOString()
  if (sqlite && timestamp.slice(0, 19) !== normalized.slice(0, 19))
    return fail('validation-failed', '原分包时间不是有效SQLite UTC日期')
  return timestamp
}
async function sourceGraph(native: TransactionDb, proof: { sha256: string, schemaVersion: number }) {
  if (proof.schemaVersion < 47 || proof.schemaVersion > 60)
    return fail('validation-failed', '此分包来源版本未核验，保留原库，不迁移原源')
  const heads = await native.select<Row>('SELECT * FROM contracts WHERE kind=\'分包\' ORDER BY id')
  if (!heads.length)
    return fail('validation-failed', '完整原库没有分包主合同原图，无需采用空领域')
  const supplements = (await native.select<Row>('SELECT * FROM contract_supplements ORDER BY id')).filter(row => heads.some(head => head.id === row.contract_id))
  const files = (await native.select<Row>('SELECT * FROM file_refs WHERE owner_type IN(\'contract\',\'contract_supplement\') ORDER BY id')).filter(row => (row.owner_type === 'contract' ? heads : supplements).some(owner => owner.id === row.owner_id))
  const bodies = []
  for (const file of files) {
    const body = (await native.select<Row>('SELECT * FROM file_payloads WHERE file_ref_id=?', [file.id]))[0]
    if (body && (body.encoding !== 'base64' || typeof body.content !== 'string' || Buffer.from(body.content, 'base64').toString('base64') !== body.content))
      return fail('validation-failed', '原分包文件编码无法完整证明')
    bodies.push({ id: String(file.id), body: body ? String(body.content) : null })
  }
  const projects = (await native.select<Row>('SELECT id,name,deleted_at FROM projects ORDER BY id')).filter(row => heads.some(head => head.project_id === row.id))
  const suppliers = (await native.select<Row>('SELECT id,name,deleted_at FROM suppliers ORDER BY id')).filter(row => heads.some(head => head.supplier_id === row.id))
  if (heads.some(head => (head.project_id != null && !projects.some(project => project.id === head.project_id)) || (head.supplier_id != null && !suppliers.some(customer => customer.id === head.supplier_id))))
    return fail('validation-failed', '分包原图的项目或分供方祖先缺失')
  const logs = (await native.select<Row>('SELECT * FROM operation_logs WHERE table_name IN(\'contracts\',\'contract_supplements\',\'file_refs\') ORDER BY id')).filter(row => (row.table_name === 'contracts' ? heads : row.table_name === 'contract_supplements' ? supplements : files).some(owner => owner.id === row.record_id))
  const originalCommands = []
  for (const table of ['subcontract_contract_intents', 'subcontract_contract_receipts', 'subcontract_contract_resolutions']) {
    if (!(await native.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?', [table]))[0])
      continue
    const rows = (await native.select<Row>(`SELECT * FROM ${table}`)).filter(row => row.contract_id ? heads.some(head => head.id === row.contract_id) : row.target_id ? heads.some(head => head.id === row.target_id) : true)
    if (rows.some(row => typeof row.command_id !== 'string' || !row.command_id))
      return fail('validation-failed', '原分包命令表缺实际原编号，保留原库核对')
    originalCommands.push({ table, key: 'command_id', ids: rows.map(row => String(row.command_id)) })
  }
  const raw = await captureMigrationDomainRows(native, [{ table: 'contracts', key: 'id', ids: heads.map(row => String(row.id)) }, { table: 'contract_supplements', key: 'id', ids: supplements.map(row => String(row.id)) }, { table: 'file_refs', key: 'id', ids: files.map(row => String(row.id)) }, { table: 'file_payloads', key: 'file_ref_id', ids: bodies.filter(row => row.body !== null).map(row => row.id) }, { table: 'operation_logs', key: 'id', ids: logs.map(row => String(row.id)) }, ...originalCommands])
  return { ...proof, heads, supplements, files, bodies, projects, suppliers, logs, raw }
}
type Source = Awaited<ReturnType<typeof sourceGraph>>
async function references(tx: TransactionDb, actor: BusinessSession) {
  const projects = await tx.select<{ id: string, name: string, version: number, deleted_at: string | null }>('SELECT id,name,version,deleted_at FROM projects ORDER BY id')
  const suppliers = [...(await loadProductionSuppliers(tx, actor)).suppliers.values()].map(row => ({ id: row.id, name: row.draft.name ?? '', version: row.version, deleted_at: null }))
  const signatories = (await readOurSignatories(tx)).records
  return { projects, suppliers, signatories }
}
function originalSnapshot(row: Row) {
  if (row.our_signatory_snapshot == null || row.our_signatory_snapshot === '')
    return null
  const snapshot = decodeOurSignatorySnapshot(JSON.parse(String(row.our_signatory_snapshot)))
  if (snapshot.id !== row.our_signatory_id)
    return fail('validation-failed', '原分包主体采用快照与原ID不一致')
  return snapshot
}
export function createProductionSubcontractMigration(storage: ProductionStorage) {
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const actor = structuredClone(session())
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('subcontract-contract:read') || !actor.capabilities.includes('subcontract-contract:import'))
      return fail('forbidden', '当前可信身份不能采用或恢复分包原图')
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      await validateProductionSubcontractState(tx, actor)
      const result = await work(tx, actor)
      if (!isDeepStrictEqual(actor, session()))
        return fail('forbidden', '分包迁入期间身份或权限变化，保留原编号')
      return result
    })
  }
  async function withSource<T>(input: unknown, session: Session, write: boolean, work: (source: Source, command: SubcontractImportCommand, tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const command = parse(input)
    const actor = session()
    if (actor.workspaceId !== command.workspaceId || actor.actorId !== command.actorId || !actor.capabilities.includes('subcontract-contract:import'))
      return fail('forbidden', '分包采用命令身份与可信来源不同')
    return withVerifiedMigrationSnapshot(command.source, async (native, proof) => {
      const source = await sourceGraph(native, proof)
      if ((source.projects.length && !actor.capabilities.includes('project:list:read')) || (source.suppliers.length && !actor.capabilities.includes('supplier:list:read')) || ([...source.heads, ...source.supplements].some(row => originalSnapshot(row)) && !actor.capabilities.includes('our-signatory:read')))
        return fail('forbidden', '采用时必须有权核对原图所消费的正式项目、分供方及我方版本')
      return run(session, write, (tx, actor) => work(source, command, tx, actor))
    })
  }
  const proofFor = (command: SubcontractImportCommand) => ({ sourceSha256: command.source.sha256, projects: command.projects, suppliers: command.suppliers, signatories: command.signatories, originals: command.originals.map(row => ({ fileId: row.fileId, sha256: contractOriginalDigest(Buffer.from(row.payloadBase64, 'base64')) })) })
  async function remember(commandId: string, action: 'adopt' | 'restore', scopeId: string, proof: Row, session: Session) {
    return run(session, true, async (tx, actor) => {
      const old = (await tx.select<Row>('SELECT * FROM subcontract_contract_import_intents WHERE command_id=?', [commandId]))[0]
      if (old && (old.fingerprint !== commandFingerprint(proof) || old.action !== action || old.scope_id !== scopeId))
        return fail('conflict', '原分包采用编号已对应另一份原意图或scope')
      if (!old)
        await tx.execute('INSERT INTO subcontract_contract_import_intents VALUES (?,?,?,?,?,?,?,?)', [commandId, actor.workspaceId, actor.actorId, action, scopeId, commandFingerprint(proof), JSON.stringify(proof), new Date().toISOString()])
    })
  }
  async function previous(tx: TransactionDb, commandId: string, action: string, scopeId: string, fingerprint: string) {
    const row = (await tx.select<Row>('SELECT * FROM subcontract_contract_import_receipts WHERE command_id=?', [commandId]))[0]
    if (row) {
      if (row.action !== action || row.scope_id !== scopeId || row.fingerprint !== fingerprint)
        return fail('conflict', '原分包采用回执与本次原意图不同')
      return JSON.parse(String(row.result_json)) as SubcontractImportResult
    }
    if ((await tx.select('SELECT command_id FROM subcontract_contract_import_resolutions WHERE command_id=?', [commandId]))[0])
      return fail('conflict', '原分包采用编号已核实为未应用，迟到请求不能再写入')
    return null
  }
  async function saveReceipt(tx: TransactionDb, actor: BusinessSession, action: string, scopeId: string, proof: Row, result: SubcontractImportResult) {
    await tx.execute('INSERT INTO subcontract_contract_import_receipts VALUES (?,?,?,?,?,?,?)', [result.commandId, actor.workspaceId, actor.actorId, action, scopeId, commandFingerprint(proof), JSON.stringify(result)])
    return result
  }
  return {
    state(session: Session) {
      return run(session, false, async (tx, actor) => ({ context: actor, sources: (await tx.select<Row>('SELECT i.*,r.restored_at FROM subcontract_contract_imports i LEFT JOIN subcontract_contract_import_restores r ON r.import_id=i.id ORDER BY i.created_at,i.id')).map(row => ({ importId: row.id, sourceSha256: row.source_sha256, ids: (JSON.parse(String(row.result_json)) as SubcontractImportResult).ids, supplementIds: (JSON.parse(String(row.result_json)) as SubcontractImportResult).supplementIds, importedAt: row.created_at, restored: row.restored_at != null })) }))
    },
    preflight(input: unknown, session: Session): Promise<SubcontractImportPreview> {
      return withSource(input, session, false, async (source, _command, tx, actor) => {
        const current = await references(tx, actor)
        const signatories = [...new Map([...source.heads, ...source.supplements].flatMap(row => originalSnapshot(row) ? [[originalSnapshot(row)!.id, originalSnapshot(row)!] as const] : [])).values()]
        return { sourceSha256: source.sha256, schemaVersion: source.schemaVersion, contracts: source.heads.map(row => ({ id: String(row.id), name: String(row.name), no: String(row.no), deletedAt: row.deleted_at == null ? null : String(row.deleted_at) })), references: [
          ...source.projects.map(row => ({ kind: 'project' as const, id: String(row.id), label: String(row.name), candidates: current.projects.map(candidate => ({ id: candidate.id, label: candidate.name, version: String(candidate.version), deletedAt: candidate.deleted_at })) })),
          ...source.suppliers.map(row => ({ kind: 'supplier' as const, id: String(row.id), label: String(row.name), candidates: current.suppliers.map(candidate => ({ id: candidate.id, label: candidate.name, version: String(candidate.version), deletedAt: candidate.deleted_at })) })),
          ...signatories.map(row => ({ kind: 'signatory' as const, id: row.id, label: row.name, candidates: current.signatories.flatMap(candidate => candidate.history.filter((history) => {
            const { status: _status, ...facts } = history.draft
            const { id: _id, version: _version, ...original } = row
            return isDeepStrictEqual(facts, original)
          }).map(history => ({ id: candidate.id, label: history.draft.name, version: history.version, deletedAt: null }))) })),
        ], requiredOriginals: source.files.filter(file => file.file_path && !source.bodies.find(body => body.id === file.id)?.body).map(file => ({ id: String(file.id), name: String(file.file_name ?? '') })) }
      })
    },
    async adopt(input: unknown, session: Session): Promise<SubcontractImportResult> {
      const parsed = parse(input)
      if (parsed.workspaceId !== session().workspaceId || parsed.actorId !== session().actorId)
        return fail('forbidden', '原分包采用身份不一致')
      await remember(parsed.commandId, 'adopt', parsed.source.sha256, proofFor(parsed), session)
      return withSource(input, session, true, async (source, command, tx, actor) => {
        const stored = await previous(tx, command.commandId, 'adopt', source.sha256, commandFingerprint(proofFor(command)))
        if (stored)
          return stored
        const old = (await tx.select<Row>('SELECT * FROM subcontract_contract_imports WHERE command_id=?', [command.commandId]))[0]
        const proof = { sourceSha256: source.sha256, projects: command.projects, suppliers: command.suppliers, signatories: command.signatories, originals: command.originals.map(row => ({ fileId: row.fileId, sha256: contractOriginalDigest(Buffer.from(row.payloadBase64, 'base64')) })) }
        if (old) {
          if (JSON.parse(String(old.evidence_json)).requestFingerprint !== commandFingerprint(proof))
            return fail('conflict', '原分包采用编号不能改变来源、映射或原件')
          return JSON.parse(String(old.result_json))
        }
        if ((await tx.select('SELECT id FROM subcontract_contract_imports WHERE source_sha256=?', [source.sha256]))[0])
          return fail('conflict', '同一分包原库已经采用，不复制第二套正式图')
        const current = await references(tx, actor)
        const map = (kind: 'projects' | 'suppliers', legacy: unknown) => {
          if (legacy === null)
            return null
          const mapping = command[kind].find(row => row.legacyId === legacy)
          const actual = mapping && current[kind].find(row => row.id === mapping.id)
          if (!mapping || !actual || String(actual.version) !== mapping.version)
            return fail('validation-failed', '实际项目或分供方版本缺少明确映射或已经变化')
          return mapping.id
        }
        if (command.projects.length !== source.projects.length || command.suppliers.length !== source.suppliers.length)
          return fail('validation-failed', '全部当前与历史项目/分供方祖先必须明确映射')
        const sourceSignatoryIds = new Set([...source.heads, ...source.supplements].flatMap(row => originalSnapshot(row) ? [originalSnapshot(row)!.id] : []))
        if (command.signatories.length !== sourceSignatoryIds.size || command.signatories.some(row => !sourceSignatoryIds.has(row.legacyId)) || command.originals.some(row => !source.files.some(file => file.id === row.fileId)))
          return fail('validation-failed', '分包采用的主体及原件必须恰好属于完整本领域原图')
        const importedId = `subcontract-import-${randomUUID()}`
        const installed: Record<string, string> = {}
        const sourceHeads = new Map<string, string>()
        const adoptedRecords: Array<{ record: StoredSubcontractContract, deletedAt: string | null }> = []
        const adoptSignatory = (row: Row) => {
          const original = originalSnapshot(row)
          if (!original)
            return { ourSignatoryId: null, ourSignatoryVersion: null, ourSignatorySnapshot: null, legacyPartyA: typeof row.party_a === 'string' ? row.party_a : null }
          const mapping = command.signatories.find(entry => entry.legacyId === original.id)
          const actual = mapping && current.signatories.find(entry => entry.id === mapping.id)?.history.find(history => history.version === mapping.version)
          if (!mapping || !actual)
            return fail('validation-failed', '原采用主体版本缺少正式历史的明确映射')
          const { status: _status, ...facts } = actual.draft
          const { id: _id, version: _version, ...originalFacts } = original
          if (!isDeepStrictEqual(facts, originalFacts))
            return fail('validation-failed', '主体历史事实不同，不能补用当前资料替代原签约')
          return { ourSignatoryId: mapping.id, ourSignatoryVersion: mapping.version, ourSignatorySnapshot: { id: mapping.id, version: mapping.version, ...facts }, legacyPartyA: typeof row.party_a === 'string' ? row.party_a : null }
        }
        for (const head of source.heads) {
          if ((await tx.select('SELECT id FROM subcontract_contract_records WHERE id=?', [head.id]))[0] || (await tx.select('SELECT id FROM material_contract_records WHERE id=?', [head.id]))[0])
            return fail('conflict', '原分包稳定ID已存在或与别领域原件归属冲突，不能覆盖')
          const projectId = map('projects', head.project_id)
          const supplierId = map('suppliers', head.supplier_id)
          const project = current.projects.find(row => row.id === projectId)
          if (projectId && !project)
            return fail('validation-failed', '原分包项目缺明确正式身份映射')
          const draft = { ...mapProjectContractRow(head), ...adoptSignatory(head), id: String(head.id), projectId, supplierId, customerId: null, isSupplement: false, originalContractId: null }
          const record: StoredSubcontractContract = { draft, version: 1, createdAt: sourceTime(head.created_at), updatedAt: sourceTime(head.updated_at), attachments: [], originals: new Map(), migrationBatchId: importedId, settlementStatus: head.settlement_status == null ? null : String(head.settlement_status), clearanceStatus: head.clearance_status == null ? null : String(head.clearance_status) }
          adoptedRecords.push({ record, deletedAt: head.deleted_at == null ? null : String(head.deleted_at) })
          sourceHeads.set(String(head.id), String(head.id))
          await tx.execute('INSERT INTO subcontract_contract_records(id,project_id,supplier_id,deleted_at,record_json) VALUES (?,?,?,?,?)', [record.draft.id, projectId, supplierId, head.deleted_at, JSON.stringify({ ...record, originals: undefined })])
        }
        for (const original of source.supplements) {
          const fact = { id: String(original.id), contractId: String(original.contract_id), dataOrigin: 'real', no: String(original.no ?? ''), name: String(original.name ?? ''), amount: original.amount ?? null, date: String(original.sign_date ?? '') || null, status: String(original.status ?? ''), deletedAt: original.deleted_at ?? null, attachments: [], ourSignatory: adoptSignatory(original) }
          await tx.execute('INSERT INTO subcontract_contract_supplements VALUES (?,?,?)', [fact.id, fact.contractId, JSON.stringify(fact)])
        }
        for (const original of command.originals) {
          if (!source.files.some(file => file.id === original.fileId))
            return fail('validation-failed', '补传原件不属于这份分包原图')
        }
        for (const file of source.files) {
          const data = source.bodies.find(row => row.id === file.id)!.body ?? command.originals.find(row => row.fileId === file.id)?.payloadBase64 ?? null
          if (data === null && file.file_path)
            return fail('validation-failed', '路径签约原件须按原ID补齐，不能当缺件')
          const bytes = data === null ? null : Buffer.from(data, 'base64')
          if (data !== null && (bytes!.toString('base64') !== data || (file.file_size !== null && file.file_size !== bytes!.length)))
            return fail('validation-failed', '分包原件字节、编码或原大小不一致')
          const headId = file.owner_type === 'contract' ? String(file.owner_id) : String(source.supplements.find(row => row.id === file.owner_id)!.contract_id)
          const sha256 = bytes ? contractOriginalDigest(bytes) : null
          const attachment = { id: String(file.id), ownerType: String(file.owner_type), ownerId: String(file.owner_id), fileName: String(file.file_name ?? ''), filePath: String(file.file_path ?? ''), fileSize: bytes?.length ?? Number(file.file_size ?? 0), mimeType: String(file.mime_type ?? ''), category: String(file.category ?? ''), uploader: String(file.uploader ?? ''), uploadedAt: file.uploaded_at == null ? null : String(file.uploaded_at), deletedAt: file.deleted_at == null ? null : String(file.deleted_at), ...(sha256 ? { sha256 } : {}) }
          await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [file.id, file.owner_type, file.owner_id, attachment.fileName, attachment.filePath, attachment.fileSize, attachment.mimeType, attachment.category, attachment.uploader, attachment.uploadedAt ?? '', attachment.deletedAt])
          if (bytes)
            await tx.execute('INSERT INTO file_payloads VALUES (?,?,?)', [file.id, bytes, sha256])
          await tx.execute('INSERT INTO subcontract_contract_files VALUES (?,?,?,?,?,?,?)', [file.id, headId, file.owner_type === 'contract' ? 'head' : 'supplement', file.owner_type === 'contract' ? null : file.owner_id, JSON.stringify(file), bytes ? 'embedded' : 'metadata-only', sha256])
          if (file.owner_type === 'contract') {
            const owned = adoptedRecords.find(row => row.record.draft.id === headId)!.record
            owned.attachments.push(attachment as StoredSubcontractContract['attachments'][number])
          }
          else {
            const row = (await tx.select<{ record_json: string }>('SELECT record_json FROM subcontract_contract_supplements WHERE id=?', [file.owner_id]))[0]!
            const fact = JSON.parse(row.record_json)
            fact.attachments.push(attachment)
            await tx.execute('UPDATE subcontract_contract_supplements SET record_json=? WHERE id=?', [JSON.stringify(fact), file.owner_id])
          }
        }
        for (const { record } of adoptedRecords) {
          const body = JSON.stringify({ ...record, originals: undefined })
          await tx.execute('UPDATE subcontract_contract_records SET record_json=? WHERE id=?', [body, record.draft.id])
          await tx.execute('INSERT INTO subcontract_contract_versions VALUES (?,?,?,?,?,?)', [record.draft.id, 1, actor.actorId, command.commandId, body, record.updatedAt])
          const number = record.draft.no?.trim() ?? ''
          if (number) {
            await tx.execute('INSERT INTO contract_number_history VALUES (?,?,?,?,?,?,?)', [`subcontract-${record.draft.id}-v1`, 'subcontract-contracts', record.draft.id, number, '1', record.updatedAt, 'migration-evidence'])
            if (!['draft', '草稿'].includes(record.draft.status ?? ''))
              await tx.execute('INSERT INTO contract_number_claims VALUES (?,?,?,?,?)', ['subcontract-contracts', record.draft.id, number, '1', record.updatedAt])
          }
          installed[record.draft.id] = commandFingerprint((await tx.select('SELECT id,project_id,supplier_id,deleted_at,record_json FROM subcontract_contract_records WHERE id=?', [record.draft.id]))[0])
        }
        await tx.execute('UPDATE subcontract_contract_revision SET revision=revision+? WHERE singleton=1', [adoptedRecords.length])
        const raw = { ...source.raw.rows, file_payloads: source.raw.rows.file_payloads!.map(row => ({ ...row, columns: { ...row.columns, content: { sqliteType: row.columns.content!.sqliteType, sharedOriginal: row.legacyId, sha256: contractOriginalDigest(Buffer.from(source.bodies.find(body => body.id === row.legacyId)!.body!, 'base64')) } } })) }
        const evidence = { sourceSha256: source.sha256, schemaVersion: source.schemaVersion, requestFingerprint: commandFingerprint(proof), references: { projects: command.projects, suppliers: command.suppliers, signatories: command.signatories }, rawDomain: raw, sourceSchemas: source.raw.schemas, domainDigest: commandFingerprint(raw), installed, supplementFingerprints: await tx.select<Row>('SELECT * FROM subcontract_contract_supplements WHERE contract_id IN (SELECT id FROM subcontract_contract_records WHERE json_extract(record_json,\'$.migrationBatchId\')=?) ORDER BY id', [importedId]) }
        const result: SubcontractImportResult = { commandId: command.commandId, importId: importedId, sourceSha256: source.sha256, ids: adoptedRecords.map(row => row.record.draft.id), supplementIds: source.supplements.map(row => String(row.id)) }
        await tx.execute('INSERT INTO subcontract_contract_imports VALUES (?,?,?,?,?,?,?,?,?)', [importedId, actor.workspaceId, actor.actorId, command.commandId, source.sha256, JSON.stringify(evidence), commandFingerprint(evidence), JSON.stringify(result), new Date().toISOString()])
        return saveReceipt(tx, actor, 'adopt', source.sha256, proofFor(command), result)
      })
    },
    async restore(input: unknown, session: Session): Promise<SubcontractImportResult> {
      if (!object(input) || Object.keys(input).sort().join(',') !== 'actorId,commandId,importId,workspaceId' || !['commandId', 'importId', 'workspaceId', 'actorId'].every(key => typeof input[key] === 'string' && String(input[key]).trim()))
        return fail('validation-failed', '分包恢复仅接受原批次和独立原编号')
      if (input.workspaceId !== session().workspaceId || input.actorId !== session().actorId)
        return fail('forbidden', '分包恢复可信身份不同')
      await remember(String(input.commandId), 'restore', String(input.importId), input, session)
      return run(session, true, async (tx, actor) => {
        const stored = await previous(tx, String(input.commandId), 'restore', String(input.importId), commandFingerprint(input))
        if (stored)
          return stored
        if (input.workspaceId !== actor.workspaceId || input.actorId !== actor.actorId)
          return fail('forbidden', '原分包恢复身份不一致')
        const old = (await tx.select<Row>('SELECT * FROM subcontract_contract_import_restores WHERE command_id=?', [input.commandId]))[0]
        if (old) {
          if (old.import_id !== input.importId)
            return fail('conflict', '原恢复编号已经对应其他批次')
          return JSON.parse(String(old.result_json))
        }
        const row = (await tx.select<Row>('SELECT * FROM subcontract_contract_imports WHERE id=?', [input.importId]))[0]
        if (!row || (await tx.select('SELECT import_id FROM subcontract_contract_import_restores WHERE import_id=?', [input.importId]))[0])
          return fail('conflict', '原分包批次不存在或已经恢复')
        const proof = JSON.parse(String(row.evidence_json))
        const result = JSON.parse(String(row.result_json)) as SubcontractImportResult
        for (const id of result.ids) {
          const current = (await tx.select<Row>('SELECT id,project_id,supplier_id,deleted_at,record_json FROM subcontract_contract_records WHERE id=?', [id]))[0]
          if (!current || commandFingerprint(current) !== proof.installed[id] || (await tx.select('SELECT command_id FROM subcontract_contract_intents WHERE target_id=?', [id]))[0])
            return fail('conflict', '分包整批危险恢复拒绝：已有后来修改、原意图或原身份变化')
          if (await productionSubcontractContractConsumed(tx, id))
            return fail('conflict', '分包整批危险恢复拒绝：真实下游、原采用意图或历史已消费该主合同')
        }
        const supplements = await tx.select<Row>('SELECT * FROM subcontract_contract_supplements WHERE contract_id IN (SELECT id FROM subcontract_contract_records WHERE json_extract(record_json,\'$.migrationBatchId\')=?) ORDER BY id', [input.importId])
        if (commandFingerprint(supplements) !== commandFingerprint(proof.supplementFingerprints))
          return fail('conflict', '分包整批危险恢复拒绝：协议或其后来引用已有变化')
        await tx.execute('UPDATE subcontract_contract_records SET deleted_at=? WHERE json_extract(record_json,\'$.migrationBatchId\')=?', [new Date().toISOString(), input.importId])
        const restored = { ...result, commandId: String(input.commandId), restored: true }
        await tx.execute('INSERT INTO subcontract_contract_import_restores VALUES (?,?,?,?,?,?)', [input.importId, actor.workspaceId, actor.actorId, input.commandId, JSON.stringify(restored), new Date().toISOString()])
        await tx.execute('UPDATE subcontract_contract_revision SET revision=revision+1 WHERE singleton=1')
        return saveReceipt(tx, actor, 'restore', String(input.importId), input, restored)
      })
    },
    resolve(input: unknown, session: Session) {
      if (!object(input) || Object.keys(input).sort().join(',') !== 'action,actorId,commandId,family,scopeId,targetId,workspaceId' || input.family !== 'subcontract-contract-import' || input.targetId !== null || !['adopt', 'restore'].includes(String(input.action)) || typeof input.scopeId !== 'string' || typeof input.commandId !== 'string' || !/^[a-z0-9][\w-]{2,79}$/i.test(input.commandId) || (input.action === 'adopt' ? !/^[a-f0-9]{64}$/.test(input.scopeId) : !/^subcontract-import-[a-f0-9-]{36}$/.test(input.scopeId)))
        return fail('validation-failed', '分包迁入原号恢复仅接受最小原定位')
      return run(session, true, async (tx, actor) => {
        if (input.workspaceId !== actor.workspaceId || input.actorId !== actor.actorId)
          return fail('forbidden', '分包原号与可信身份不一致')
        const original = (await tx.select<Row>('SELECT * FROM subcontract_contract_import_intents WHERE command_id=?', [input.commandId]))[0]
        const sealed = (await tx.select<Row>('SELECT * FROM subcontract_contract_import_resolutions WHERE command_id=?', [input.commandId]))[0]
        for (const row of [original, sealed]) {
          if (row && (row.action !== input.action || row.scope_id !== input.scopeId || row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId))
            return fail('conflict', '分包原恢复scope或动作与原意图/封存不同')
        }
        const row = (await tx.select<Row>('SELECT * FROM subcontract_contract_import_receipts WHERE command_id=?', [input.commandId]))[0]
        if (row) {
          if (row.action !== input.action || row.scope_id !== input.scopeId)
            return fail('conflict', '分包原号恢复范围与原来源不同')
          return { outcome: 'applied' as const, result: JSON.parse(String(row.result_json)) as SubcontractImportResult }
        }
        await tx.execute('INSERT OR IGNORE INTO subcontract_contract_import_resolutions VALUES (?,?,?,?,?,?)', [input.commandId, actor.workspaceId, actor.actorId, input.action, input.scopeId, new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId: String(input.commandId) }
      })
    },
  }
}
