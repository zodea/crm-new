import type { TransactionDb } from '../db/coordinator'
import type { QuotationMigrationReference, QuotationMigrationSource } from './import-evidence'
import type { QuotationActor, QuotationReferences, QuotationStorage } from './sqlite-owner'
import { isISODateTimeDTO } from '../../types/read-model'
import { contractOriginalPayloadDigest } from '../forms/original-content'
import { isObject, quotationFingerprint, quotationProblem, validId } from './contract'
import { decodeQuotationImportBindings, decodeQuotationImportManifest, projectQuotationImportRelations, quotationSourceReferences } from './import-evidence'
import { readQuotationRecords, validateQuotationJournal } from './sqlite-owner'

type Row = Record<string, string | number | null>
const columns = {
  material_quotations: ['id', 'party_name', 'supplier_id', 'project_id', 'scope', 'quotation_date', 'draft_json', 'version', 'created_at', 'updated_at'],
  material_quotation_lines: ['id', 'quotation_id', 'name', 'unit', 'unit_price', 'tax_rate', 'line_json', 'deleted_at'],
  material_quotation_history: ['quotation_id', 'version', 'snapshot_json', 'actor_id', 'command_id', 'occurred_at'],
  material_quotation_commands: ['scoped_id', 'command_id', 'workspace_id', 'actor_id', 'fingerprint', 'request_json', 'result_json', 'quotation_id'],
  material_quotation_resolutions: ['scoped_id', 'command_id', 'workspace_id', 'actor_id', 'resolved_at'],
  file_refs: ['id', 'owner_type', 'owner_id', 'file_name', 'file_path', 'file_size', 'mime_type', 'category', 'uploader', 'uploaded_at', 'deleted_at'],
  material_quotation_files: ['file_ref_id', 'quotation_id', 'sha256'],
  quotation_imports: ['scoped_id', 'command_id', 'workspace_id', 'actor_id', 'batch_id', 'fingerprint', 'graph_hash', 'graph_json', 'result_json', 'sealed_at'],
} as const
export interface QuotationGraph {
  schemaVersion: 'material-quotation-graph-v1'
  revision: number
  tables: {
    -readonly [K in keyof typeof columns]: Row[];
  }
  originals: {
    fileId: string
    sha256: string
    payloadBase64: string
  }[]
}
const graphError = () => quotationProblem('validation-failed', '报价迁入图、原件或冻结证据无效；保留原库')
export async function quotationGraphHash(graph: unknown) {
  const bytes = new TextEncoder().encode(quotationFingerprint(graph))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function exportQuotationGraph(tx: TransactionDb, payloadMode: 'central' | 'native'): Promise<QuotationGraph> {
  await validateQuotationJournal(tx)
  const { revision } = await readQuotationRecords(tx)
  const tables = {} as QuotationGraph['tables']
  for (const table of Object.keys(columns) as (keyof typeof columns)[]) {
    const where = table === 'file_refs' ? ' WHERE owner_type=\'material_quotation\'' : ''
    const rows = await tx.select<Row>(`SELECT ${columns[table].join(',')} FROM ${table}${where}`)
    tables[table] = rows.sort((a, b) => quotationFingerprint(a).localeCompare(quotationFingerprint(b)))
  }
  const originals: QuotationGraph['originals'] = []
  for (const file of tables.file_refs) {
    const ownership = tables.material_quotation_files.find(row => row.file_ref_id === file.id)
    const row = (await tx.select<{
      content: string | Uint8Array
      encoding?: string
      sha256?: string
    }>('SELECT * FROM file_payloads WHERE file_ref_id=?', [file.id]))[0]
    if (!ownership || !row)
      return graphError()
    let payloadBase64: string
    if (payloadMode === 'native') {
      if (row.encoding !== 'base64' || typeof row.content !== 'string')
        return graphError()
      payloadBase64 = row.content
    }
    else {
      if (!(row.content instanceof Uint8Array))
        return graphError()
      let binary = ''
      for (let index = 0; index < row.content.length; index += 0x8000)
        binary += String.fromCharCode(...row.content.subarray(index, index + 0x8000))
      payloadBase64 = btoa(binary)
    }
    const digest = await contractOriginalPayloadDigest(payloadBase64, Number(file.file_size), graphError)
    if (digest !== ownership.sha256 || (payloadMode === 'central' && row.sha256 !== digest))
      return graphError()
    originals.push({ fileId: String(file.id), sha256: digest, payloadBase64 })
  }
  return { schemaVersion: 'material-quotation-graph-v1', revision, tables, originals: originals.sort((a, b) => a.fileId.localeCompare(b.fileId)) }
}
export function decodeQuotationGraph(value: unknown): QuotationGraph {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'originals,revision,schemaVersion,tables' || value.schemaVersion !== 'material-quotation-graph-v1' || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !isObject(value.tables) || Object.keys(value.tables).sort().join(',') !== Object.keys(columns).sort().join(',') || !Array.isArray(value.originals))
    return graphError()
  for (const table of Object.keys(columns) as (keyof typeof columns)[]) {
    const rows = value.tables[table]
    if (!Array.isArray(rows) || rows.length > 100000 || rows.some(row => !isObject(row) || Object.keys(row).sort().join(',') !== [...columns[table]].sort().join(',') || Object.values(row).some(field => field !== null && typeof field !== 'string' && !(typeof field === 'number' && Number.isFinite(field)))))
      return graphError()
  }
  if (value.originals.some(row => !isObject(row) || Object.keys(row).sort().join(',') !== 'fileId,payloadBase64,sha256' || !validId(row.fileId) || typeof row.payloadBase64 !== 'string' || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) || new Set(value.originals.map(row => row.fileId)).size !== value.originals.length)
    return graphError()
  return value as unknown as QuotationGraph
}
/** Called only inside the actual quote owner's authenticated migration transaction. Failure rolls back every row and byte. */
export async function importQuotationGraph(tx: TransactionDb, value: unknown, references: {
  projectIds: Set<string>
  supplierIds: Set<string>
}) {
  const graph = decodeQuotationGraph(value)
  if ((await tx.select<{
    n: number
  }>('SELECT COUNT(*) AS n FROM material_quotations'))[0]?.n || (await tx.select<{
    n: number
  }>('SELECT COUNT(*) AS n FROM material_quotation_commands'))[0]?.n || (await tx.select<{
    n: number
  }>('SELECT COUNT(*) AS n FROM material_quotation_resolutions'))[0]?.n) {
    return quotationProblem('conflict', '中央报价已有事实或恢复编号，不能覆盖或合并另一来源')
  }
  if (graph.tables.material_quotations.some(head => (head.project_id !== null && !references.projectIds.has(String(head.project_id))) || (head.supplier_id !== null && !references.supplierIds.has(String(head.supplier_id)))))
    return quotationProblem('relationship-mismatch', '报价当前关联身份未在中央真实目录核验；请保留源图并先核对对应身份')
  const originalIds = graph.originals.map(row => row.fileId)
  if (graph.tables.file_refs.length !== originalIds.length || graph.tables.material_quotation_files.length !== originalIds.length || graph.tables.file_refs.some(file => !originalIds.includes(String(file.id)) || file.owner_type !== 'material_quotation' || !graph.tables.material_quotations.some(head => head.id === file.owner_id)))
    return graphError()
  for (const table of Object.keys(columns) as (keyof typeof columns)[]) {
    if (table === 'material_quotation_files')
      continue
    for (const row of graph.tables[table])
      await tx.execute(`INSERT INTO ${table}(${columns[table].join(',')}) VALUES(${columns[table].map(() => '?').join(',')})`, columns[table].map(column => row[column]))
  }
  for (const original of graph.originals) {
    const file = graph.tables.file_refs.find(file => file.id === original.fileId)!
    const digest = await contractOriginalPayloadDigest(original.payloadBase64, Number(file.file_size), graphError)
    if (digest !== original.sha256 || graph.tables.material_quotation_files.find(row => row.file_ref_id === original.fileId)?.sha256 !== digest)
      return graphError()
    await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)', [original.fileId, Uint8Array.from(atob(original.payloadBase64), character => character.charCodeAt(0)), digest])
  }
  for (const row of graph.tables.material_quotation_files)
    await tx.execute('INSERT INTO material_quotation_files VALUES(?,?,?)', [row.file_ref_id, row.quotation_id, row.sha256])
  await tx.execute('UPDATE quotation_revision SET revision=? WHERE singleton=1', [graph.revision])
  await validateQuotationJournal(tx)
  return graph
}
/** Import manifests freeze structure and reference shared originals; they never store a second body library. */
export function quotationImportManifest(graph: QuotationGraph) {
  return { ...graph, originals: graph.originals.map(({ payloadBase64: _body, ...original }) => original) }
}
export function quotationImportKey(commandId: string, actor: {
  workspaceId: string
  actorId: string
}) {
  return JSON.stringify([actor.workspaceId, actor.actorId, 'material-quotation-import', commandId])
}
export async function validateQuotationImportEvidence(tx: TransactionDb, currentIdentity: {
  workspaceId: string
  actorId: string
}): Promise<Set<string>> {
  const allowed = new Set<string>()
  const records = await tx.select<Row>('SELECT * FROM quotation_imports')
  for (const record of records) {
    if (!validId(record.command_id) || record.scoped_id !== quotationImportKey(String(record.command_id), { workspaceId: String(record.workspace_id), actorId: String(record.actor_id) }))
      return graphError()
    if (record.workspace_id !== currentIdentity.workspaceId || record.actor_id !== currentIdentity.actorId) {
      // A prior import owner must itself occur in a verified enclosing manifest; no free identity whitelist.
      if (!records.some(parent => parent.workspace_id === currentIdentity.workspaceId && parent.actor_id === currentIdentity.actorId && parent.graph_json && (decodeQuotationImportManifest(JSON.parse(String(parent.graph_json))).graph.tables as QuotationGraph['tables']).quotation_imports.some((source: Row) => quotationFingerprint(source) === quotationFingerprint(record))))
        return graphError()
    }
    if (record.sealed_at !== null) {
      if (!isISODateTimeDTO(record.sealed_at))
        return graphError()
      continue
    }
    const evidence = decodeQuotationImportManifest(JSON.parse(String(record.graph_json)))
    const manifest = evidence.graph
    if (!isObject(manifest) || !Array.isArray(manifest.originals))
      return graphError()
    const originals = []
    for (const original of manifest.originals) {
      if (!isObject(original) || !validId(original.fileId))
        return graphError()
      const payload = (await tx.select<{
        content: Uint8Array
        sha256: string
      }>('SELECT * FROM file_payloads WHERE file_ref_id=?', [original.fileId]))[0]
      if (!payload || !(payload.content instanceof Uint8Array) || payload.sha256 !== original.sha256)
        return graphError()
      let binary = ''
      for (let index = 0; index < payload.content.length; index += 0x8000)
        binary += String.fromCharCode(...payload.content.subarray(index, index + 0x8000))
      originals.push({ ...original, payloadBase64: btoa(binary) })
    }
    const graph = decodeQuotationGraph({ ...manifest, originals })
    if (await quotationGraphHash(graph) !== record.graph_hash)
      return graphError()
    const result = JSON.parse(String(record.result_json))
    if (!validId(record.batch_id) || !isObject(result) || Object.keys(result).sort().join(',') !== 'batchId,commandId,graphHash,importedIds,updatedAt' || result.batchId !== record.batch_id || result.commandId !== record.command_id || result.graphHash !== record.graph_hash || !isISODateTimeDTO(result.updatedAt)
      || quotationFingerprint(result.importedIds) !== quotationFingerprint(graph.tables.material_quotations.map(head => String(head.id)))
      || evidence.bindings.some(binding => binding.confirmedBy !== record.actor_id)
      || record.fingerprint !== quotationFingerprint({ workspaceId: record.workspace_id, actorId: record.actor_id, commandId: record.command_id, batchId: record.batch_id, graphHash: record.graph_hash, ...(evidence.sourceSnapshotSha256 ? { sourceSnapshotSha256: evidence.sourceSnapshotSha256, bindings: evidence.bindings } : {}) })) {
      return graphError()
    }
    for (const source of graph.tables.material_quotation_history) {
      const actual = (await tx.select<Row>('SELECT * FROM material_quotation_history WHERE quotation_id=? AND version=?', [source.quotation_id, source.version]))[0]
      if (!actual || quotationFingerprint(actual) !== quotationFingerprint(source))
        return graphError()
    }
    for (const table of ['material_quotation_commands', 'material_quotation_resolutions'] as const) {
      for (const source of graph.tables[table]) {
        const actual = (await tx.select<Row>(`SELECT * FROM ${table} WHERE scoped_id=?`, [source.scoped_id]))[0]
        if (!actual || quotationFingerprint(actual) !== quotationFingerprint(source))
          return graphError()
        allowed.add(String(source.scoped_id))
      }
    }
  }
  return allowed
}
export interface QuotationImportResult {
  batchId: string
  commandId: string
  graphHash: string
  importedIds: string[]
  updatedAt: string
}
export function createQuotationGraphActions(storage: QuotationStorage, options: {
  references: (tx: TransactionDb, actor: QuotationActor) => Promise<QuotationReferences>
  migrationReferences?: (tx: TransactionDb, actor: QuotationActor) => Promise<QuotationMigrationReference[]>
  verifySource?: (source: QuotationMigrationSource) => Promise<QuotationGraph>
}) {
  const authorize = (session: () => QuotationActor, write: boolean) => {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('material-quotation:read') || !actor.capabilities.includes('core:migration:write') || (write && !actor.capabilities.includes('material-quotation:write')))
      return quotationProblem('forbidden', '当前身份无报价图迁入与核验权限')
    return { ...actor, capabilities: [...actor.capabilities] }
  }
  async function run<T>(session: () => QuotationActor, write: boolean, operation: (tx: TransactionDb, actor: QuotationActor) => Promise<T>) {
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      if (quotationFingerprint(authorize(session, write)) !== quotationFingerprint(actor))
        return quotationProblem('forbidden', '报价迁入期间身份变化')
      await validateQuotationJournal(tx)
      await validateQuotationImportEvidence(tx, storage.identity)
      const result = await operation(tx, actor)
      if (quotationFingerprint(authorize(session, write)) !== quotationFingerprint(actor))
        return quotationProblem('forbidden', '报价迁入期间权限变化，事务已撤回')
      return result
    })
  }
  return {
    importContext: (session: () => QuotationActor) => run(session, false, async (tx, actor) => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities], references: options.migrationReferences ? await options.migrationReferences(tx, actor) : quotationProblem('unavailable', '当前来源没有真实正式迁入关联目录') })),
    imports: (session: () => QuotationActor) => run(session, false, async (tx, actor) => {
      const records = await tx.select<Row>('SELECT * FROM quotation_imports WHERE result_json IS NOT NULL AND workspace_id=? AND actor_id=? ORDER BY batch_id', [actor.workspaceId, actor.actorId])
      return records.map(row => JSON.parse(String(row.result_json)) as QuotationImportResult)
    }),
    importGraph(body: unknown, session: () => QuotationActor): Promise<QuotationImportResult> {
      if (!isObject(body) || !['actorId,batchId,commandId,graph,graphHash,requiredCapability,workspaceId', 'actorId,batchId,bindings,commandId,graph,graphHash,requiredCapability,source,workspaceId'].includes(Object.keys(body).sort().join(',')) || !validId(body.workspaceId) || !validId(body.actorId) || !validId(body.commandId) || !validId(body.batchId) || body.requiredCapability !== 'core:migration:write' || typeof body.graphHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.graphHash))
        return graphError()
      const request = body
      return run(session, true, async (tx, actor) => {
        if (request.workspaceId !== actor.workspaceId || request.actorId !== actor.actorId)
          return quotationProblem('forbidden', '迁入身份与当前会话不一致')
        const graph = decodeQuotationGraph(request.graph)
        if (await quotationGraphHash(graph) !== request.graphHash)
          return graphError()
        const key = quotationImportKey(String(request.commandId), actor)
        if ((await readQuotationImportedKeys(tx, storage.identity)).imports.has(key))
          return quotationProblem('conflict', '该迁入编号属于原来源历史，不能作为当前中央迁入或恢复授权')
        const existing = (await tx.select<Row>('SELECT * FROM quotation_imports WHERE scoped_id=?', [key]))[0]
        // Legacy graph-only receipts remain readable/replayable; every new import proves actual complete SQLite bytes.
        const hasSource = request.source !== undefined
        if (!hasSource && !existing)
          return quotationProblem('validation-failed', '新迁入必须提供完整 SQLite 来源及明确关联确认，不能仅凭客户端图或摘要')
        const bindings = hasSource ? decodeQuotationImportBindings(request.bindings) : []
        let sourceSnapshotSha256: string | null = null
        if (hasSource) {
          if (!isObject(request.source) || Object.keys(request.source).sort().join(',') !== 'payloadBase64,sha256' || typeof request.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.source.sha256) || typeof request.source.payloadBase64 !== 'string' || !options.verifySource)
            return graphError()
          const actual = await options.verifySource(request.source as unknown as QuotationMigrationSource)
          if (quotationFingerprint(actual) !== quotationFingerprint(graph))
            return quotationProblem('validation-failed', '请求报价图与实际 SQLite 原库逐字段核验不一致；请保留原库')
          sourceSnapshotSha256 = request.source.sha256
          const required = quotationSourceReferences(graph)
          if (required.length !== bindings.length || required.some(row => !bindings.some(binding => binding.entityType === row.entityType && binding.legacyId === row.legacyId)) || bindings.some(binding => binding.confirmedBy !== actor.actorId))
            return quotationProblem('relationship-mismatch', '每个来源项目和分供方都必须由当前操作者明确确认对应的实际目标身份')
        }
        const fingerprint = quotationFingerprint({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: request.commandId, batchId: request.batchId, graphHash: request.graphHash, ...(sourceSnapshotSha256 ? { sourceSnapshotSha256, bindings } : {}) })
        if (existing) {
          if (existing.sealed_at !== null)
            return quotationProblem('conflict', '报价图原迁入编号已封存，不能迟到迁入')
          if (existing.fingerprint !== fingerprint)
            return quotationProblem('validation-failed', '同一迁入编号不能复用不同完整图或批次')
          return JSON.parse(String(existing.result_json)) as QuotationImportResult
        }
        if ((await tx.select('SELECT scoped_id FROM quotation_imports WHERE batch_id=?', [request.batchId])).length)
          return quotationProblem('conflict', '报价迁入批次已占用')
        const targets = bindings.length && options.migrationReferences ? await options.migrationReferences(tx, actor) : []
        if (bindings.some(binding => !targets.some(target => target.entityType === binding.entityType && target.serverId === binding.serverId && target.label === binding.label && target.version === binding.version && target.sourceVersion === binding.sourceVersion)))
          return quotationProblem('conflict', '所确认目标记录或目录版本已变化，请重新读取实际目录后确认；原来源保持不变')
        const references = await options.references(tx, actor)
        await importQuotationGraph(tx, graph, { projectIds: new Set([...references.projects.map(row => row.id), ...bindings.filter(row => row.entityType === 'projects').map(row => row.legacyId)]), supplierIds: new Set([...references.suppliers.map(row => row.id), ...bindings.filter(row => row.entityType === 'suppliers').map(row => row.legacyId)]) })
        const result: QuotationImportResult = { batchId: String(request.batchId), commandId: String(request.commandId), graphHash: String(request.graphHash), importedIds: graph.tables.material_quotations.map(head => String(head.id)), updatedAt: new Date().toISOString() }
        const manifest = sourceSnapshotSha256 ? { schemaVersion: 'material-quotation-import-evidence-v1', graph: quotationImportManifest(graph), sourceSnapshotSha256, bindings } : quotationImportManifest(graph)
        await tx.execute('INSERT INTO quotation_imports VALUES(?,?,?,?,?,?,?,?,?,NULL)', [key, request.commandId, actor.workspaceId, actor.actorId, request.batchId, fingerprint, request.graphHash, JSON.stringify(manifest), JSON.stringify(result)])
        await validateQuotationImportEvidence(tx, storage.identity)
        return result
      })
    },
    resolveImport(commandId: string, session: () => QuotationActor) {
      if (!validId(commandId))
        return graphError()
      return run(session, true, async (tx, actor) => {
        const key = quotationImportKey(commandId, actor)
        if ((await readQuotationImportedKeys(tx, storage.identity)).imports.has(key))
          return quotationProblem('conflict', '该迁入编号属于原来源历史，不能作为当前中央恢复授权')
        const row = (await tx.select<Row>('SELECT * FROM quotation_imports WHERE scoped_id=?', [key]))[0]
        if (row?.result_json !== null && row?.result_json !== undefined)
          return { outcome: 'applied' as const, result: JSON.parse(String(row.result_json)) as QuotationImportResult }
        if (!row)
          await tx.execute('INSERT INTO quotation_imports VALUES(?,?,?,?,NULL,NULL,NULL,NULL,NULL,?)', [key, commandId, actor.workspaceId, actor.actorId, new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId }
      })
    },
  }
}
export async function readQuotationImportRelations(tx: TransactionDb, records: Awaited<ReturnType<typeof readQuotationRecords>>['records'], identity: QuotationStorage['identity']) {
  await validateQuotationImportEvidence(tx, identity)
  const imports = await tx.select<{
    batch_id: string
    graph_json: string | null
  }>('SELECT batch_id,graph_json FROM quotation_imports WHERE result_json IS NOT NULL ORDER BY rowid')
  return projectQuotationImportRelations(records, imports)
}
/** Source provenance is independent of coincidentally equal actor/workspace strings. */
export async function readQuotationImportedKeys(tx: TransactionDb, identity: QuotationStorage['identity']) {
  const business = await validateQuotationImportEvidence(tx, identity)
  const records = await tx.select<{
    graph_json: string
  }>('SELECT graph_json FROM quotation_imports WHERE result_json IS NOT NULL')
  const imports = new Set(records.flatMap(row => (decodeQuotationImportManifest(JSON.parse(row.graph_json)).graph.tables as QuotationGraph['tables']).quotation_imports.map(source => String(source.scoped_id))))
  return { business, imports }
}
