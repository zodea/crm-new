import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { OtherSettlementMigrationMapping, OtherSettlementMigrationRequest, OtherSettlementMigrationResult } from '../../app/lib/other-settlement/migration-contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { OTHER_SETTLEMENT_TABLES } from '../../app/lib/other-settlement/schema'
import { validateExpenditureSettlementSchema } from '../../app/lib/other-settlement/schema-upgrade'
import { otherSettlementFingerprint, otherSettlementOwnerPredicate, validateOtherSettlementJournal } from '../../app/lib/other-settlement/storage'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { listWorkerReferences, readWorkerReference } from './production-crew-worker-references'
import { listMigrationReferences, readMigrationReference } from './production-migration-references'
import { createReadMeta, withReadMeta } from './read-meta'

type Row = Record<string, string | number | null>
function fail(message: string): never {
  throw auxiliaryProblem('validation-failed', `${message}；保留原库和全部历史`)
}
const hash = (value: unknown) => createHash('sha256').update(otherSettlementFingerprint(value)).digest('hex')
const importKey = (commandId: string, identity: { workspaceId: string, actorId: string }) => JSON.stringify([identity.workspaceId, identity.actorId, 'other-settlement-import', commandId])
const headMappings = { project_id: 'projects', supplier_id: 'suppliers', payee_supplier_id: 'suppliers', payee_worker_id: 'workers' } as const
export interface OtherSettlementNativeGraph {
  schemaVersion: number
  tables: Record<string, Row[]>
  retained: Record<string, Row[]>
  references: Array<{
    entityType: OtherSettlementMigrationMapping['entityType']
    legacyId: string
    label: string
  }>
  files: Array<{
    row: Row
    payloadBase64: string | null
    sha256: string | null
  }>
}
/** Reads the complete authenticated snapshot without altering its real old fields, command scopes or source identities. */
export async function readNativeOtherSettlementGraph(tx: TransactionDb, evidence: {
  schemaVersion: number
}): Promise<OtherSettlementNativeGraph> {
  if (evidence.schemaVersion < 47 || evidence.schemaVersion > 60)
    return fail('本域尚未核验此原库版本')
  if (evidence.schemaVersion >= 60) {
    await validateExpenditureSettlementSchema(tx)
    await validateOtherSettlementJournal(tx)
  }
  const existing = await tx.select<{
    name: string
  }>('SELECT name FROM sqlite_schema WHERE type=\'table\'')
  if (!existing.some(row => row.name === 'expenditure_settlements'))
    return fail('原结算表缺失')
  const tables: Record<string, Row[]> = {}
  for (const name of OTHER_SETTLEMENT_TABLES) {
    if (existing.some(row => row.name === name))
      tables[name] = await tx.select<Row>(`SELECT * FROM ${name}`)
  }
  const allHeads = tables.expenditure_settlements!
  const heads = await tx.select<Row>(`SELECT * FROM expenditure_settlements WHERE ${await otherSettlementOwnerPredicate(tx)}`)
  const headIds = new Set(heads.map(head => head.id))
  tables.expenditure_settlements = heads
  for (const name of ['expenditure_settlement_expense_allocations', 'other_settlement_history', 'other_settlement_commands', 'other_settlement_files']) {
    if (tables[name])
      tables[name] = tables[name].filter(row => headIds.has(row.settlement_id))
  }
  if (heads.some(row => typeof row.id !== 'string' || !row.id || [row.total_amount, row.amount, row.tax_rate, row.tax_amount].some(value => value !== null && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))))
    return fail('原结算身份或实际数值损坏')
  const refs = new Map<string, OtherSettlementNativeGraph['references'][number]>()
  for (const row of heads) {
    for (const [column, entityType] of Object.entries(headMappings)) {
      if (row[column]) {
        const legacyId = String(row[column])
        const source = (await tx.select<Row>(`SELECT * FROM ${entityType} WHERE id=?`, [legacyId]))[0]
        if (!source)
          return fail('原结算主档关系缺失')
        refs.set(`${entityType}:${legacyId}`, { entityType: entityType as OtherSettlementMigrationMapping['entityType'], legacyId, label: String(source.name ?? '') })
      }
    }
  }
  for (const allocation of tables.expenditure_settlement_expense_allocations ?? []) {
    const source = JSON.parse(String(allocation.frozen_json))
    for (const [key, entityType] of [['projectId', 'projects'], ['serviceSupplierId', 'suppliers'], ['applicantSupplierId', 'suppliers'], ['applicantWorkerId', 'workers']] as const) {
      if (!source[key])
        continue
      const legacyId = String(source[key])
      const row = (await tx.select<Row>(`SELECT * FROM ${entityType} WHERE id=?`, [legacyId]))[0]
      if (!row)
        return fail('原费用冻结采用关系的真实主档缺失')
      refs.set(`${entityType}:${legacyId}`, { entityType, legacyId, label: String(row.name ?? '') })
    }
  }
  const retained: Record<string, Row[]> = {}
  for (const name of ['penalty_settlement_deductions', 'payment_application_settlement_allocations', 'operation_logs']) {
    if (existing.some(row => row.name === name)) {
      const rows = await tx.select<Row>(`SELECT * FROM ${name}`)
      retained[name] = rows.filter(row => name === 'operation_logs' ? row.table_name === 'expenditure_settlements' && heads.some(head => head.id === row.record_id) : heads.some(head => head.id === row.settlement_id))
    }
  }
  const penaltyIds = new Set(retained.penalty_settlement_deductions?.map(row => row.penalty_id) ?? [])
  if (existing.some(row => row.name === 'penalty_records'))
    retained.penalty_records = (await tx.select<Row>('SELECT * FROM penalty_records')).filter(row => penaltyIds.has(row.id))
  const files: OtherSettlementNativeGraph['files'] = []
  for (const row of await tx.select<Row>('SELECT * FROM file_refs WHERE owner_type=\'expenditure_settlement\' ORDER BY id')) {
    if (!heads.some(head => head.id === row.owner_id)) {
      if (allHeads.some(head => head.id === row.owner_id))
        continue
      return fail('原结算原件归属损坏')
    }
    const body = (await tx.select<Row>('SELECT * FROM file_payloads WHERE file_ref_id=?', [row.id]))[0]
    if (body && body.encoding !== 'base64')
      return fail('原结算原件持久编码未核验')
    const bytes = body ? Buffer.from(String(body.content), 'base64') : null
    if (!bytes && typeof row.file_path === 'string' && row.file_path.trim())
      return fail('原结算引用外部原件但完整源包未含真实字节；须先核验并归档原件，不能当历史仅元数据缺件')
    if (bytes && (bytes.toString('base64') !== body!.content || bytes.length !== row.file_size))
      return fail('原结算正文与真实大小不符')
    files.push({ row, payloadBase64: bytes ? bytes.toString('base64') : null, sha256: bytes ? createHash('sha256').update(bytes).digest('hex') : null })
  }
  return { schemaVersion: evidence.schemaVersion, tables, retained, references: [...refs.values()].sort((a, b) => `${a.entityType}:${a.legacyId}`.localeCompare(`${b.entityType}:${b.legacyId}`)), files }
}
export function otherSettlementGraphManifest(graph: OtherSettlementNativeGraph) {
  return { ...graph, files: graph.files.map(({ payloadBase64: _body, ...row }) => row) }
}
async function actual(tx: TransactionDb, actor: BusinessSession, mapping: Pick<OtherSettlementMigrationMapping, 'entityType' | 'targetId'>) {
  if (mapping.entityType !== 'workers')
    return readMigrationReference(tx, actor, mapping.entityType, mapping.targetId)
  const worker = await readWorkerReference(tx, actor, mapping.targetId)
  const record = worker
    ? (await tx.select<{
        record_json: string
      }>('SELECT record_json FROM workers WHERE id=?', [worker.id]))[0]
    : null
  const parsed = record ? JSON.parse(record.record_json) : null
  const revision = (await tx.select<{
    revision: number
  }>('SELECT revision FROM crew_worker_revision WHERE singleton=1'))[0]
  return worker && parsed && revision ? { entityType: 'workers' as const, serverId: worker.id, label: worker.name, version: String(parsed.version), sourceVersion: `workers:${revision.revision}` } : null
}
export async function validateOtherSettlementImportEvidence(tx: TransactionDb, identity?: {
  workspaceId: string
  actorId: string
}) {
  const verifiedMissingOriginals = new Set<string>()
  const rows = await tx.select<Row>('SELECT * FROM other_settlement_imports')
  for (const row of rows) {
    if (identity && (row.workspace_id !== identity.workspaceId || row.actor_id !== identity.actorId))
      return fail('结算迁入回执不属于实际工作区操作者')
    if (typeof row.command_id !== 'string' || !row.command_id || row.command_id.length > 240 || row.scoped_id !== importKey(row.command_id, { workspaceId: String(row.workspace_id), actorId: String(row.actor_id) }))
      return fail('结算迁入原编号作用域损坏')
    if (row.sealed_at !== null) {
      if (!Number.isFinite(Date.parse(String(row.sealed_at))))
        return fail('结算迁入封存证据损坏')
      continue
    }
    const evidence = JSON.parse(String(row.graph_json))
    const result = JSON.parse(String(row.result_json)) as OtherSettlementMigrationResult
    if (evidence.schemaVersion !== 'other-settlement-import-v1' || evidence.sourceOrigin !== 'native' || evidence.graphHash !== row.graph_hash || hash(evidence.graph) !== row.graph_hash || evidence.requestProof.sourceBytesSha256 !== evidence.sourceBytesSha256 || hash(evidence.requestProof) !== row.fingerprint || result.commandId !== row.command_id || result.sourceBytesSha256 !== evidence.sourceBytesSha256 || result.graphHash !== row.graph_hash
      || !/^[a-f0-9]{64}$/.test(evidence.sourceBytesSha256) || row.batch_id !== evidence.sourceBytesSha256
      || evidence.workspaceId !== row.workspace_id || evidence.actorId !== row.actor_id || evidence.commandId !== row.command_id || evidence.importedAt !== result.importedAt || !Number.isFinite(Date.parse(result.importedAt))
      || otherSettlementFingerprint(evidence.mappings) !== otherSettlementFingerprint(evidence.requestProof.mappings)
      || otherSettlementFingerprint(result.ids) !== otherSettlementFingerprint(evidence.graph.tables.expenditure_settlements.map((head: Row) => head.id))
      || otherSettlementFingerprint(result.fileIds) !== otherSettlementFingerprint(evidence.graph.files.map((file: { row: Row }) => file.row.id))) {
      return fail('结算迁入原图、摘要或回执不一致')
    }
    for (const original of evidence.graph.tables.expenditure_settlements as Row[]) {
      const current = (await tx.select<Row>(`SELECT * FROM expenditure_settlements WHERE id=? AND ${await otherSettlementOwnerPredicate(tx)}`, [original.id]))[0]
      if (!current)
        return fail('迁入历史结算缺失')
      // Source journals stay in immutable evidence, never become current operational authorization.
      if (current.version === 0) {
        for (const [key, value] of Object.entries(original)) {
          if (['version', 'record_json'].includes(key))
            continue
          const type = headMappings[key as keyof typeof headMappings]
          const expected = type && value ? evidence.mappings.find((mapping: OtherSettlementMigrationMapping) => mapping.entityType === type && mapping.legacyId === value)?.targetId : value
          if (Object.hasOwn(current, key) && current[key] !== expected)
            return fail('结算旧原文、审计或明确关系映射被替换')
        }
      }
    }
    for (const original of evidence.graph.tables.expenditure_settlement_expense_allocations ?? []) {
      const current = (await tx.select<Row>('SELECT * FROM expenditure_settlement_expense_allocations WHERE id=?', [original.id]))[0]
      if (!current || Object.entries(original).some(([key, value]) => current[key] !== value))
        return fail('迁入原费用采用行的稳定身份、冻结事实或金额被替换')
    }
    for (const file of evidence.graph.files) {
      const ref = (await tx.select<Row>('SELECT * FROM file_refs WHERE id=?', [file.row.id]))[0]
      if (!ref || Object.entries(file.row).some(([key, value]) => ref[key] !== value))
        return fail('结算历史原件元数据或原归属被替换')
      const payload = (await tx.select<{
        content: Uint8Array
        sha256: string
      }>('SELECT * FROM file_payloads WHERE file_ref_id=?', [file.row.id]))[0]
      if (file.sha256 === null ? Boolean(payload) : !payload || payload.sha256 !== file.sha256 || createHash('sha256').update(payload.content).digest('hex') !== file.sha256)
        return fail('结算历史原件正文被替换或丢失')
      if (file.sha256 === null && !String(file.row.file_path ?? '').trim())
        verifiedMissingOriginals.add(String(file.row.id))
    }
  }
  return verifiedMissingOriginals
}
/** Imported source receipts never authorize a new central command, even when identity strings coincide. */
export async function assertOtherSettlementSourceCommandUnused(tx: TransactionDb, commandId: string, actor: { workspaceId: string, actorId: string }, importing = false) {
  for (const row of await tx.select<{ graph_json: string }>('SELECT graph_json FROM other_settlement_imports WHERE sealed_at IS NULL')) {
    const graph = JSON.parse(row.graph_json).graph as OtherSettlementNativeGraph
    const names = importing ? ['other_settlement_imports'] : ['other_settlement_commands', 'other_settlement_resolutions']
    if (names.some(name => graph.tables[name]?.some(source => source.command_id === commandId && source.workspace_id === actor.workspaceId && source.actor_id === actor.actorId)))
      return fail('该编号属于迁入来源的历史命令，请保留原证据并使用新的明确命令编号')
  }
}
export function createProductionOtherSettlementMigration(storage: ProductionStorage) {
  const authorize = (session: () => BusinessSession, write: boolean) => {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('other-settlement:read') || (write && (!actor.capabilities.includes('other-settlement:write') || !actor.capabilities.includes('core:migration:write'))))
      return fail('当前身份没有结算迁入权限')
    return structuredClone(actor)
  }
  async function run<T>(session: () => BusinessSession, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      if (otherSettlementFingerprint(authorize(session, write)) !== otherSettlementFingerprint(actor))
        return fail('迁入开始前身份改变，未写入')
      await validateOtherSettlementJournal(tx, storage.identity)
      await validateOtherSettlementImportEvidence(tx, storage.identity)
      const result = await work(tx, actor)
      if (otherSettlementFingerprint(authorize(session, write)) !== otherSettlementFingerprint(actor))
        return fail('迁入期间身份改变，已撤回')
      return result
    })
  }
  const envelope = <T extends object>(actor: BusinessSession, value: T) => {
    const asOf = new Date().toISOString()
    return withReadMeta(value, createReadMeta({ session: actor, schemaVersion: 'other-settlement-read-v1', operation: 'other-settlement:imports', dataOrigin: 'real', asOf, coverage: 'complete', scope: {}, sources: [{ key: 'other-settlements', state: 'readable', sourceVersion: `other-settlement-imports:${hash(value)}`, asOf }] }))
  }
  return {
    previewSnapshot: (source: OtherSettlementMigrationRequest['source'], session: () => BusinessSession) => run(session, false, async (tx, actor) => {
      if (!actor.capabilities.includes('core:migration:write'))
        return fail('无权核验迁入源')
      const graph = await withVerifiedMigrationSnapshot(source, readNativeOtherSettlementGraph)
      const workers = actor.capabilities.includes('worker:list:read') ? await listWorkerReferences(tx, actor) : []
      const candidates = [...await listMigrationReferences(tx, actor, 'projects'), ...await listMigrationReferences(tx, actor, 'suppliers')]
      for (const worker of workers) {
        const row = await actual(tx, actor, { entityType: 'workers', targetId: worker.id })
        if (row)
          candidates.push(row as never)
      }
      return envelope(actor, { sourceBytesSha256: source.sha256, graphHash: hash(otherSettlementGraphManifest(graph)), heads: graph.tables.expenditure_settlements, references: graph.references, candidates })
    }),
    imports: (session: () => BusinessSession) => run(session, false, async (tx, actor) => envelope(actor, { records: (await tx.select<Row>('SELECT * FROM other_settlement_imports WHERE sealed_at IS NULL')).map(row => ({ commandId: row.command_id, graphHash: row.graph_hash, sourceBytesSha256: JSON.parse(String(row.graph_json)).sourceBytesSha256, ids: JSON.parse(String(row.result_json)).ids })) })),
    importSnapshot: (request: OtherSettlementMigrationRequest, session: () => BusinessSession) => run(session, true, async (tx, actor) => {
      if (!request || Object.keys(request).sort().join(',') !== 'actorId,commandId,mappings,source,workspaceId' || request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId || typeof request.commandId !== 'string' || !request.commandId || request.commandId.length > 240 || !Array.isArray(request.mappings))
        return fail('结算迁入命令身份或正文无效')
      const mappings = [...request.mappings].sort((a, b) => `${a.entityType}:${a.legacyId}`.localeCompare(`${b.entityType}:${b.legacyId}`))
      if (mappings.some(row => !row || Object.keys(row).sort().join(',') !== 'entityType,legacyId,reason,sourceVersion,targetId,version' || !['projects', 'suppliers', 'workers'].includes(row.entityType) || [row.legacyId, row.targetId, row.version, row.sourceVersion, row.reason].some(value => typeof value !== 'string' || !value.trim())) || new Set(mappings.map(row => `${row.entityType}:${row.legacyId}`)).size !== mappings.length)
        return fail('迁入逐条主档确认无效')
      const graph = await withVerifiedMigrationSnapshot(request.source, readNativeOtherSettlementGraph)
      const manifest = otherSettlementGraphManifest(graph)
      const graphHash = hash(manifest)
      const key = importKey(request.commandId, actor)
      await assertOtherSettlementSourceCommandUnused(tx, request.commandId, actor, true)
      const requestProof = { sourceBytesSha256: request.source.sha256, mappings }
      const fingerprint = hash(requestProof)
      const prior = (await tx.select<Row>('SELECT * FROM other_settlement_imports WHERE scoped_id=?', [key]))[0]
      if (prior) {
        if (prior.sealed_at !== null)
          return fail('原迁入编号已封存，迟到请求不能再写')
        if (prior.fingerprint !== fingerprint)
          return fail('原迁入编号不能更换正文')
        return JSON.parse(String(prior.result_json)) as OtherSettlementMigrationResult
      }
      if ((await tx.select('SELECT scoped_id FROM other_settlement_imports WHERE graph_hash=?', [graphHash])).length)
        return fail('该原结算图已经迁入')
      if (graph.references.length !== mappings.length || graph.references.some(source => !mappings.some(mapping => mapping.entityType === source.entityType && mapping.legacyId === source.legacyId)))
        return fail('原结算每条实际主档关系均须明确确认')
      for (const mapping of mappings) {
        const current = await actual(tx, actor, mapping)
        if (!current || current.version !== mapping.version || current.sourceVersion !== mapping.sourceVersion)
          throw auxiliaryProblem('conflict', '所选实际主档版本变化，迁入未写入；保留当前选择')
      }
      const sourceHeads = graph.tables.expenditure_settlements!
      const targetColumns = (await tx.select<{
        name: string
      }>('PRAGMA table_info(expenditure_settlements)')).map(row => row.name)
      for (const raw of sourceHeads) {
        if ((await tx.select('SELECT id FROM expenditure_settlements WHERE id=?', [raw.id])).length)
          return fail('原结算稳定ID已被占用，不能覆盖')
        const row: Row = { ...raw, version: 0, record_json: null, ...(targetColumns.includes('document_owner') ? { document_owner: 'other' } : {}) }
        for (const [column, type] of Object.entries(headMappings)) {
          if (row[column])
            row[column] = mappings.find(mapping => mapping.entityType === type && mapping.legacyId === row[column])!.targetId
        }
        // Insert as a staging draft so owned identity rows can be installed before freezing the original confirmed status.
        const originalStatus = row.status
        row.status = 'draft'
        const keys = targetColumns.filter(key => Object.hasOwn(row, key))
        await tx.execute(`INSERT INTO expenditure_settlements(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, keys.map(key => row[key]))
        for (const line of graph.tables.expenditure_settlement_expense_allocations?.filter(line => line.settlement_id === raw.id) ?? [])
          await tx.execute(`INSERT INTO expenditure_settlement_expense_allocations(${Object.keys(line).join(',')}) VALUES(${Object.keys(line).map(() => '?').join(',')})`, Object.values(line))
        await tx.execute('UPDATE expenditure_settlements SET status=? WHERE id=?', [originalStatus, raw.id])
      }
      for (const file of graph.files) {
        if ((await tx.select('SELECT id FROM file_refs WHERE id=?', [file.row.id])).length)
          return fail('原件稳定ID已被占用')
        const keys = Object.keys(file.row)
        await tx.execute(`INSERT INTO file_refs(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, Object.values(file.row))
        if (file.payloadBase64 !== null) {
          await tx.execute('INSERT INTO file_payloads VALUES(?,?,?)', [file.row.id, Buffer.from(file.payloadBase64, 'base64'), file.sha256])
          await tx.execute('INSERT INTO other_settlement_files VALUES(?,?,?)', [file.row.id, file.row.owner_id, file.sha256])
        }
      }
      const importedAt = new Date().toISOString()
      const result = { commandId: request.commandId, sourceBytesSha256: request.source.sha256, graphHash, ids: sourceHeads.map(row => String(row.id)), fileIds: graph.files.map(file => String(file.row.id)), importedAt }
      const evidence = { schemaVersion: 'other-settlement-import-v1', sourceOrigin: 'native', sourceBytesSha256: request.source.sha256, graphHash, graph: manifest, mappings, requestProof, workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: request.commandId, importedAt }
      await tx.execute('INSERT INTO other_settlement_imports VALUES(?,?,?,?,?,?,?,?,?,NULL)', [key, request.commandId, actor.workspaceId, actor.actorId, request.source.sha256, fingerprint, graphHash, JSON.stringify(evidence), JSON.stringify(result)])
      await tx.execute('UPDATE other_settlement_revision SET revision=revision+1 WHERE singleton=1')
      await validateOtherSettlementImportEvidence(tx, storage.identity)
      return result
    }),
    resolveImport: (commandId: string, session: () => BusinessSession) => run(session, true, async (tx, actor) => {
      if (typeof commandId !== 'string' || !commandId || commandId.length > 240)
        return fail('原迁入编号无效')
      const key = importKey(commandId, actor)
      await assertOtherSettlementSourceCommandUnused(tx, commandId, actor, true)
      const row = (await tx.select<Row>('SELECT * FROM other_settlement_imports WHERE scoped_id=?', [key]))[0]
      if (row && row.sealed_at === null)
        return { outcome: 'applied' as const, result: JSON.parse(String(row.result_json)) as OtherSettlementMigrationResult }
      if (!row)
        await tx.execute('INSERT INTO other_settlement_imports VALUES(?,?,?,?,NULL,NULL,NULL,NULL,NULL,?)', [key, commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
      return { outcome: 'not-applied' as const, commandId }
    }),
  }
}
