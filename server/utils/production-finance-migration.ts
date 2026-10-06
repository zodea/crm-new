import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { FinanceMigrationEntity, FinanceMigrationMapping, FinanceMigrationResult } from '../../app/lib/finance/migration-contract'
import type { BusinessSession } from './business-session'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { CENTRAL_FINANCE_KINDS, FINANCE_FAMILIES, FINANCE_IMPORT_CAPABILITY, financeFailure } from '../../app/lib/finance/central-contract'
import { FINANCE_OWNER_TYPE, FINANCE_TABLE_BY_KIND } from '../../app/lib/finance/domain'
import { validateFinanceExpenseReferenceGuards } from '../../app/lib/finance/expense-references'
import { isFinanceNativeSourceVersion } from '../../app/lib/finance/migration-contract'
import { validateFinanceExpensePartyGuards } from '../../app/lib/finance/party-references'
import { validateFinancePaymentAllocationGuards } from '../../app/lib/finance/payment-allocation-guards'
import { validateFinancePaymentPartyGuards } from '../../app/lib/finance/payment-party-upgrade'
import { hasVerifiedFinanceNumbers } from '../../app/lib/finance/persistent-rows'
import { listWorkerReferences, readWorkerReference } from './production-crew-worker-references'
import { isMissingClearanceOriginal } from './production-finance-clearance-originals'
import { FINANCE_RELATIONS, financeRecordSnapshot, validateFinanceJournal } from './production-finance-journal'
import { financeCommandFingerprint, financeId } from './production-finance-request'
import { listMigrationReferences, readMigrationReference } from './production-migration-references'

type Row = Record<string, string | number | null>
export type FinanceMigrationReferenceType = FinanceMigrationEntity
export interface FinanceMigrationSource { schemaVersion: number, sha256: string, tables: Record<string, Row[]>, journals: Record<string, Row[]>, files: Array<{ row: Row, payloadBase64: string | null, bodyState: 'embedded' | 'metadata-only' | 'external-required' }>, references: Array<{ entityType: FinanceMigrationReferenceType, id: string, label: string }>, retained: Array<{ entityType: string, id: string, row: Row | null }> }
const masterFields: Record<string, FinanceMigrationReferenceType> = { project_id: 'projects', supplier_id: 'suppliers', applicant_supplier_id: 'suppliers', counterparty_supplier_id: 'suppliers', applicant_worker_id: 'workers', worker_id: 'workers', customer_id: 'customers' }
const externalFields: Record<string, string> = { contract_id: 'contracts', company_expense_contract_id: 'company_expense_contracts', settlement_id: 'expenditure_settlements', invoice_id: 'invoices' }
const ownTables = [...new Set([...CENTRAL_FINANCE_KINDS.map(kind => FINANCE_TABLE_BY_KIND[kind]), ...Object.values(FINANCE_RELATIONS).flatMap(rows => rows.map(([table]) => table))])]
const failure = (message: string): never => financeFailure('validation-failed', `${message}；保留完整原库，不覆盖既有事实。`)
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const bytesDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function payload(value: unknown, size: unknown): Uint8Array {
  if (typeof value !== 'string' || !Number.isSafeInteger(size) || Number(size) < 0 || value.length % 4 !== 0 || !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(value))
    return failure('财务原件编码或真实大小无效')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length !== size || bytes.toString('base64') !== value)
    return failure('财务原件真实字节与原记录大小不一致')
  return bytes
}

/** Only called on the complete, verified and protected Native SQLite snapshot. */
export async function readNativeFinanceSource(tx: TransactionDb, evidence: { sha256: string, schemaVersion: number }): Promise<FinanceMigrationSource> {
  if (!isFinanceNativeSourceVersion(evidence.schemaVersion))
    return failure('财务来源版本未完成本域全字段与身份核验，仅支持已核验的 Native 59–60')
  await validateFinancePaymentPartyGuards(tx)
  await validateFinanceExpensePartyGuards(tx)
  await validateFinancePaymentAllocationGuards(tx)
  await validateFinanceExpenseReferenceGuards(tx)
  const tables: Record<string, Row[]> = {}
  for (const table of ownTables) {
    const rows = await tx.select<Row>(`SELECT * FROM ${table} ORDER BY id`)
    if (rows.some(row => !hasVerifiedFinanceNumbers(table, row) || Object.values(row).some(value => value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))))
      return failure('财务原始行含无法核实的值')
    tables[table] = rows
  }
  const fileRows = await tx.select<Row>(`SELECT * FROM file_refs WHERE owner_type IN (${CENTRAL_FINANCE_KINDS.map(() => '?').join(',')}) ORDER BY id`, CENTRAL_FINANCE_KINDS.map(kind => FINANCE_OWNER_TYPE[kind]))
  const files: FinanceMigrationSource['files'] = []
  for (const row of fileRows) {
    const kind = CENTRAL_FINANCE_KINDS.find(kind => FINANCE_OWNER_TYPE[kind] === row.owner_type)
    if (!kind || !tables[FINANCE_TABLE_BY_KIND[kind]]!.some(head => head.id === row.owner_id))
      return failure('财务原件归属不完整')
    const content = (await tx.select<{ encoding: string, content: string }>('SELECT * FROM file_payloads WHERE file_ref_id=?', [row.id]))[0]
    if (content && content.encoding !== 'base64')
      return failure('财务原件持久编码尚未核实')
    if (content)
      payload(content.content, row.file_size)
    files.push({ row, payloadBase64: content?.content ?? null, bodyState: content ? 'embedded' : row.file_path ? 'external-required' : 'metadata-only' })
  }
  const refs = new Map<string, { entityType: FinanceMigrationReferenceType, id: string, label: string }>()
  const retained = new Map<string, FinanceMigrationSource['retained'][number]>()
  for (const row of Object.values(tables).flat()) {
    for (const [field, entityType] of Object.entries(masterFields)) {
      if (row[field] !== null && row[field] !== undefined) {
        const id = String(row[field])
        const source = (await tx.select<Row>(`SELECT * FROM ${entityType} WHERE id=?`, [id]))[0]
        if (!source)
          return failure('原财务关联主档不存在')
        refs.set(`${entityType}:${id}`, { entityType, id, label: String(source.name ?? '') })
      }
    }
    for (const [field, entityType] of Object.entries(externalFields)) {
      if (row[field] !== null && row[field] !== undefined) {
        const id = String(row[field])
        const source = (await tx.select<Row>(`SELECT * FROM ${entityType} WHERE id=?`, [id]))[0] ?? null
        retained.set(`${entityType}:${id}`, { entityType, id, row: source })
      }
    }
  }
  const logs = await tx.select<Row>('SELECT * FROM operation_logs ORDER BY id')
  tables.operation_logs = logs.filter(log => ownTables.includes(String(log.table_name)) ? tables[String(log.table_name)]!.some(row => row.id === log.record_id) : log.table_name === 'file_refs' && fileRows.some(file => file.id === log.record_id))
  const existing = await tx.select<{ name: string }>('SELECT name FROM sqlite_schema WHERE type=\'table\'')
  const journals: Record<string, Row[]> = {}
  for (const table of ['finance_commands', 'finance_resolutions', 'finance_history', 'finance_versions', 'finance_imports', 'finance_revision']) {
    if (existing.some(row => row.name === table))
      journals[table] = await tx.select<Row>(`SELECT * FROM ${table}`)
  }
  return { schemaVersion: evidence.schemaVersion, sha256: evidence.sha256, tables, journals, files, references: [...refs.values()], retained: [...retained.values()] }
}

async function actualReference(tx: TransactionDb, actor: BusinessSession, mapping: FinanceMigrationMapping) {
  if (mapping.entityType === 'projects' || mapping.entityType === 'suppliers')
    return readMigrationReference(tx, actor, mapping.entityType, mapping.targetId)
  if (mapping.entityType === 'workers') {
    const worker = await readWorkerReference(tx, actor, mapping.targetId)
    const row = worker ? (await tx.select<{ record_json: string }>('SELECT record_json FROM workers WHERE id=?', [worker.id]))[0] : null
    const record = row ? JSON.parse(row.record_json) : null
    const revision = (await tx.select<{ revision: number }>('SELECT revision FROM crew_worker_revision WHERE singleton=1'))[0]
    if (!worker || !record || !Number.isSafeInteger(record.version) || record.version < 1 || !revision)
      return null
    return { serverId: worker.id, label: worker.name, version: String(record.version), sourceVersion: `workers:${revision.revision}` }
  }
  if (!actor.capabilities.includes('customer:list:read'))
    financeFailure('forbidden', '当前身份无财务迁入所需客户读取权限。')
  const customer = (await tx.select<{ id: string, name: string, version: number }>('SELECT id,name,version FROM customers WHERE id=? AND deleted_at IS NULL', [mapping.targetId]))[0]
  const revision = (await tx.select<{ revision: number }>('SELECT revision FROM customer_revision WHERE singleton=1'))[0]
  return customer && revision ? { serverId: customer.id, label: customer.name, version: String(customer.version), sourceVersion: `customers:${revision.revision}` } : null
}

export function authorizeFinanceImport(actor: BusinessSession) {
  if (!actor.capabilities.includes(FINANCE_IMPORT_CAPABILITY) || CENTRAL_FINANCE_KINDS.some(kind => !actor.capabilities.includes(`${FINANCE_FAMILIES[kind]}:read`) || !actor.capabilities.includes(`${FINANCE_FAMILIES[kind]}:write`)))
    financeFailure('forbidden', '完整财务迁入需要当前工作区迁入权限与五类财务读写权限。')
}

export async function previewNativeFinance(tx: TransactionDb, actor: BusinessSession, source: FinanceMigrationSource) {
  authorizeFinanceImport(actor)
  const candidates: Array<{ entityType: FinanceMigrationReferenceType, serverId: string, label: string, version: string, sourceVersion: string }> = []
  for (const type of [...new Set(source.references.map(row => row.entityType))]) {
    if (type === 'projects' || type === 'suppliers') {
      candidates.push(...await listMigrationReferences(tx, actor, type))
    }
    else {
      const ids = type === 'workers'
        ? (await listWorkerReferences(tx, actor)).map(row => row.id)
        : (await tx.select<{ id: string }>('SELECT id FROM customers WHERE deleted_at IS NULL ORDER BY id')).map(row => row.id)
      for (const id of ids) {
        const reference = await actualReference(tx, actor, { entityType: type, targetId: id, legacyId: id, version: '1', sourceVersion: '', reason: '' })
        if (!reference)
          return failure('当前真实主档版本无法核实')
        candidates.push({ entityType: type, ...reference })
      }
    }
  }
  const blockingReasons: string[] = []
  for (const table of [...ownTables, 'finance_commands', 'finance_history', 'finance_versions', 'finance_resolutions', 'finance_imports']) {
    if ((await tx.select(`SELECT 1 FROM ${table} LIMIT 1`)).length) {
      blockingReasons.push('中央财务已有事实或原命令，请核对原迁入回执，不能混入或覆盖。')
      break
    }
  }
  if (source.references.some(reference => !candidates.some(candidate => candidate.entityType === reference.entityType)))
    blockingReasons.push('某类关联尚无当前真实主档，须先按原模块迁入或建立真实资料后再逐项核验。')
  return {
    sourceBytesSha256: source.sha256,
    nativeSchemaVersion: source.schemaVersion,
    eligible: blockingReasons.length === 0,
    blockingReasons,
    records: CENTRAL_FINANCE_KINDS.map(kind => ({ kind, count: source.tables[FINANCE_TABLE_BY_KIND[kind]]!.length, deletedCount: source.tables[FINANCE_TABLE_BY_KIND[kind]]!.filter(row => row.deleted_at !== null).length })),
    references: source.references,
    candidates,
    originals: source.files.map(file => ({ fileId: String(file.row.id), fileName: String(file.row.file_name), fileSize: file.row.file_size === null ? null : Number(file.row.file_size), bodyState: file.bodyState, ownerId: String(file.row.owner_id), canDeclareMissingClearance: file.bodyState === 'external-required' && isMissingClearanceOriginal(source.tables, file.row) })),
    retainedReferences: source.retained.map(row => ({ entityType: row.entityType, id: row.id, sourceAvailable: row.row !== null })),
  }
}
/** One existing finance owner, one transaction; native raw rows and audit remain frozen as evidence. */
export async function importNativeFinance(tx: TransactionDb, actor: BusinessSession, source: FinanceMigrationSource, input: { commandId: string, mappings: FinanceMigrationMapping[], originals?: Array<{ fileId: string, payloadBase64: string }>, declaredMissingOriginals?: Array<{ fileId: string, reason: string }> }): Promise<FinanceMigrationResult> {
  authorizeFinanceImport(actor)
  financeId(input.commandId)
  if ((await tx.select('SELECT command_id FROM finance_import_resolutions WHERE command_id=?', [input.commandId])).length)
    financeFailure('conflict', '原财务迁入已核对为未采用并封存，迟到请求不能重新采用。')
  if (!Array.isArray(input.mappings) || input.mappings.some(mapping => !object(mapping) || Object.keys(mapping).sort().join(',') !== 'entityType,legacyId,reason,sourceVersion,targetId,version' || !['projects', 'suppliers', 'workers', 'customers'].includes(mapping.entityType) || typeof mapping.legacyId !== 'string' || typeof mapping.targetId !== 'string' || typeof mapping.reason !== 'string' || !mapping.reason.trim() || typeof mapping.version !== 'string' || !/^[1-9]\d*$/.test(mapping.version) || typeof mapping.sourceVersion !== 'string' || !mapping.sourceVersion))
    return failure('财务关联须逐项提供明确身份映射、实际版本与确认依据')
  if (input.originals !== undefined && (!Array.isArray(input.originals) || input.originals.some(file => !object(file) || Object.keys(file).sort().join(',') !== 'fileId,payloadBase64' || typeof file.fileId !== 'string' || typeof file.payloadBase64 !== 'string')))
    return failure('财务原件补充必须使用原稳定编号与真实原字节')
  const declared = input.declaredMissingOriginals ?? []
  if (!Array.isArray(declared) || declared.some(file => !object(file) || Object.keys(file).sort().join(',') !== 'fileId,reason' || typeof file.fileId !== 'string' || typeof file.reason !== 'string' || !file.reason.trim() || !source.files.some(sourceFile => sourceFile.row.id === file.fileId && sourceFile.bodyState === 'external-required' && isMissingClearanceOriginal(source.tables, sourceFile.row))) || new Set(declared.map(file => file.fileId)).size !== declared.length || declared.some(file => input.originals?.some(original => original.fileId === file.fileId)))
    return failure('只可逐件声明真实旧清偿外部原单缺失；原费用、实际银行凭证和已嵌入正文不适用')
  for (const mapping of input.mappings) {
    financeId(mapping.legacyId)
    financeId(mapping.targetId)
  }
  const sourceGraph = { schemaVersion: source.schemaVersion, tables: source.tables, journals: source.journals, files: source.files.map(file => ({ row: file.row, bodyState: file.bodyState, payloadSha256: file.payloadBase64 === null ? null : bytesDigest(payload(file.payloadBase64, file.row.file_size)) })), references: source.references, retained: source.retained }
  const requestProof = { sourceBytesSha256: source.sha256, mappings: input.mappings, originals: (input.originals ?? []).map(file => ({ fileId: file.fileId, sha256: bytesDigest(payload(file.payloadBase64, source.files.find(row => row.row.id === file.fileId)?.row.file_size)) })), sourceGraphSha256: financeCommandFingerprint(sourceGraph), declaredMissingOriginals: declared }
  const fingerprint = financeCommandFingerprint(requestProof)
  const prior = (await tx.select<{ fingerprint: string, result_json: string }>('SELECT fingerprint,result_json FROM finance_imports WHERE command_id=?', [input.commandId]))[0]
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      financeFailure('conflict', '同一财务迁入原编号不能修改来源、映射或原件。')
    await validateFinanceJournal(tx, actor)
    return JSON.parse(prior.result_json) as FinanceMigrationResult
  }
  if ((await tx.select('SELECT id FROM finance_imports WHERE source_fingerprint=?', [source.sha256])).length)
    financeFailure('conflict', '此完整财务来源已经迁入，请核对原迁入回执。')
  for (const table of [...ownTables, 'finance_commands', 'finance_resolutions', 'finance_versions', 'finance_history']) {
    if ((await tx.select(`SELECT 1 FROM ${table} LIMIT 1`)).length)
      financeFailure('conflict', '中央财务已有事实或原命令，不能覆盖或混入第二套财务。')
  }
  const mappings = new Map<string, { targetId: string, evidence: object }>()
  for (const mapping of input.mappings) {
    const key = `${mapping.entityType}:${mapping.legacyId}`
    if (mappings.has(key) || !source.references.some(reference => reference.entityType === mapping.entityType && reference.id === mapping.legacyId))
      return failure('财务映射重复或不属于此完整来源')
    const actual = await actualReference(tx, actor, mapping)
    if (!actual || actual.version !== mapping.version || actual.sourceVersion !== mapping.sourceVersion)
      financeFailure('conflict', '财务关联当前真实身份或版本已变化；先重新核验，不猜测同名资料。')
    mappings.set(key, { targetId: actual.serverId, evidence: { ...mapping, actual, source: source.references.find(reference => reference.entityType === mapping.entityType && reference.id === mapping.legacyId) } })
  }
  if (source.references.some(reference => !mappings.has(`${reference.entityType}:${reference.id}`)))
    return failure('财务前置真实主档尚未逐项明确映射')
  const now = new Date().toISOString()
  for (const table of ownTables) {
    const columns = (await tx.select<{ name: string }>('SELECT name FROM pragma_table_info(?)', [table])).map(row => row.name)
    const rows = [...source.tables[table] ?? []].sort((left, right) => table === 'expense_reimbursement_lines' ? Number(Boolean(left.original_expense_line_id)) - Number(Boolean(right.original_expense_line_id)) : 0)
    for (const raw of rows) {
      const missing = Object.keys(raw).filter(column => !columns.includes(column))
      if (missing.length)
        return failure(`现行财务结构不能完整接收 ${table} 的原字段 ${missing.join(', ')}`)
      const row = { ...raw }
      if (table === 'payment_records' && row.confirmation_status === 'confirmed')
        row.confirmation_status = 'needs_review'
      for (const [field, entityType] of Object.entries(masterFields)) {
        if (row[field] !== null && row[field] !== undefined)
          row[field] = mappings.get(`${entityType}:${row[field]}`)!.targetId
      }
      const keys = Object.keys(row)
      await tx.execute(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, keys.map(key => row[key]))
    }
  }
  for (const payment of source.tables.payment_records ?? []) {
    if (payment.confirmation_status === 'confirmed')
      await tx.execute('UPDATE payment_records SET confirmation_status=\'confirmed\' WHERE id=?', [payment.id])
  }
  for (const raw of source.tables.operation_logs ?? []) {
    const allowed = (await tx.select<{ name: string }>('SELECT name FROM pragma_table_info(\'operation_logs\')')).map(row => row.name)
    if (Object.keys(raw).some(key => !allowed.includes(key)))
      return failure('财务原审计含现行结构无法保全的字段')
    const keys = Object.keys(raw)
    await tx.execute(`INSERT INTO operation_logs(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, keys.map(key => raw[key]))
  }
  const evidenceFiles = []
  if ((input.originals ?? []).some(file => !source.files.some(row => row.row.id === file.fileId)) || new Set((input.originals ?? []).map(file => file.fileId)).size !== (input.originals ?? []).length)
    return failure('迁入原件重复或不属于此来源')
  for (const file of source.files) {
    const supplied = input.originals?.find(row => row.fileId === file.row.id)
    if (supplied && file.bodyState === 'embedded' && supplied.payloadBase64 !== file.payloadBase64)
      return failure('外部原件不能覆盖来源已嵌入的真实字节')
    const body = file.payloadBase64 ?? supplied?.payloadBase64 ?? null
    const declaredMissing = declared.some(item => item.fileId === file.row.id)
    if (file.bodyState === 'external-required' && body === null && !declaredMissing)
      return failure('旧财务原件在 Native 文件路径，须读出原字节后再迁入，不能伪装成历史缺件')
    const keys = Object.keys(file.row)
    const allowed = (await tx.select<{ name: string }>('SELECT name FROM pragma_table_info(\'file_refs\')')).map(row => row.name)
    if (keys.some(key => !allowed.includes(key)))
      return failure('财务原件元数据含现行结构无法保全的字段')
    if (!(declaredMissing && file.row.file_size === null))
      await tx.execute(`INSERT INTO file_refs(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, keys.map(key => file.row[key]))
    const bytes = body === null ? null : payload(body, file.row.file_size)
    const sha256 = bytes === null ? null : bytesDigest(bytes)
    if (bytes)
      await tx.execute('INSERT INTO file_payloads VALUES(?,?,?)', [file.row.id, bytes, sha256])
    evidenceFiles.push({ id: file.row.id, row: file.row, sha256, bodyState: declaredMissing ? 'declared-missing-clearance' : bytes === null ? 'metadata-only' : file.bodyState === 'external-required' ? 'native-original-adopted' : 'embedded' })
  }
  const records: FinanceMigrationResult['records'] = []
  for (const kind of CENTRAL_FINANCE_KINDS) {
    for (const head of source.tables[FINANCE_TABLE_BY_KIND[kind]] ?? []) {
      const id = String(head.id)
      await tx.execute('INSERT INTO finance_versions VALUES(?,?,1,?)', [kind, id, now])
      await tx.execute('INSERT INTO finance_history VALUES(?,?,1,?,?,?,?)', [kind, id, input.commandId, actor.actorId, now, JSON.stringify(await financeRecordSnapshot(tx, kind, id))])
      records.push({ kind, id, version: '1' })
    }
  }
  const result: FinanceMigrationResult = { commandId: input.commandId, sourceBytesSha256: source.sha256, importedAt: now, records, fileIds: source.files.map(file => String(file.row.id)) }
  const evidence = { schemaVersion: 'finance-import-v1', workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: input.commandId, sourceOrigin: 'native', sourceBytesSha256: source.sha256, nativeSchemaVersion: source.schemaVersion, requestProof, sourceGraph, records, sourceTables: source.tables, sourceJournals: source.journals, files: evidenceFiles, mappings: [...mappings.values()].map(row => row.evidence), retainedReferences: source.retained }
  await tx.execute('INSERT INTO finance_imports(id,command_id,source_fingerprint,fingerprint,evidence_json,result_json,imported_at) VALUES(?,?,?,?,?,?,?)', [input.commandId, input.commandId, source.sha256, fingerprint, JSON.stringify(evidence), JSON.stringify(result), now])
  await tx.execute('UPDATE finance_revision SET revision=revision+1 WHERE singleton=1')
  await validateFinanceJournal(tx, actor)
  return result
}
