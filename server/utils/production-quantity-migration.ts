import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityMigrationGraph, QuantityMigrationTable } from '../../app/lib/quantity/migration-graph'
import type { QuantityMigrationIdentity } from '../../app/lib/quantity/migration-mapping'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { quantityProblem } from '../../app/lib/quantity/central-contract'
import { QUANTITY_HOLLOW_TABLES } from '../../app/lib/quantity/central-hollow-schema'
import { QUANTITY_MIGRATION_COLUMNS, QUANTITY_MIGRATION_PROJECT_PARENTS, QUANTITY_MIGRATION_TABLES, quantityMigrationRowId } from '../../app/lib/quantity/migration-graph'
import { mapQuantityMigrationGraph } from '../../app/lib/quantity/migration-mapping'
import { readQuantityMigrationGraphs } from '../../app/lib/quantity/migration-source'
import { captureMigrationDomainRows } from './migration-domain-evidence'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { loadProductionCrewWorkers } from './production-crew-worker-record'
import { listMigrationReferences, readMigrationReference } from './production-migration-references'
import { assertProductionQuantitySchema, quantityCanonical, quantityDigest, writeProductionQuantityOriginal } from './production-quantity-record'
import { assertQuantityHollowMigrationReferences, insertQuantityHollowMigration } from './quantity-hollow-migration'

type Session = () => BusinessSession
interface ProjectMapping { legacyId: string, projectId: string, version: string }
interface PersonMapping { kind: 'crew' | 'worker', legacyId: string, id: string, version: string }
export interface ProductionQuantityImportCommand {
  commandId: string
  workspaceId: string
  actorId: string
  action: 'inspect' | 'preflight' | 'adopt'
  source: { sha256: string, payloadBase64: string }
  projects: ProjectMapping[]
  people: PersonMapping[]
}
interface ProjectEvidence {
  legacyProjectId: string
  projectId: string
  namespace: string
  previousArchive: string | null
  sourceGraph: QuantityMigrationGraph
  graph: QuantityMigrationGraph
  identities: QuantityMigrationIdentity[]
}
interface Evidence {
  sourceSha256: string
  schemaVersion: number
  workspaceId: string
  actorId: string
  commandId: string
  fingerprint: string
  projectMappings: ProjectMapping[]
  peopleMappings: PersonMapping[]
  projects: ProjectEvidence[]
  upstream: 'historical-reference-only'
  rawDomain: Record<string, Record<string, unknown>[]>
  domainEvidenceDigest: string
  payloadRefs: Array<{ legacyId: string, id: string, sha256: string }>
  sourceSchemas: Awaited<ReturnType<typeof captureMigrationDomainRows>>['schemas']
}
interface StoredImport { id: string, source_sha256: string, evidence_json: string, workspace_id: string, actor_id: string, command_id: string, result_json: string }
function fail(message: string): never {
  throw quantityProblem('validation-failed', `工程量完整迁入：${message}`)
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const rowKey = (table: string, id: string) => quantityCanonical([table, id])

function parseCommand(value: unknown): ProductionQuantityImportCommand {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'action,actorId,commandId,people,projects,source,workspaceId'
    || !['inspect', 'preflight', 'adopt'].includes(String(value.action)) || !Array.isArray(value.projects) || !Array.isArray(value.people)
    || !['workspaceId', 'actorId', 'commandId'].every(key => typeof value[key] === 'string' && String(value[key]).trim()) || !object(value.source)) {
    return fail('必须使用完整字节来源、稳定原编号和明确主档映射')
  }
  for (const mapping of value.projects) {
    if (!object(mapping) || Object.keys(mapping).sort().join(',') !== 'legacyId,projectId,version' || !['legacyId', 'projectId', 'version'].every(key => typeof mapping[key] === 'string' && String(mapping[key]).trim()))
      return fail('项目映射必须包含真实稳定 ID 与版本')
  }
  for (const mapping of value.people) {
    if (!object(mapping) || Object.keys(mapping).sort().join(',') !== 'id,kind,legacyId,version' || !['crew', 'worker'].includes(String(mapping.kind)) || !['legacyId', 'id', 'version'].every(key => typeof mapping[key] === 'string' && String(mapping[key]).trim()))
      return fail('责任身份映射必须包含正式稳定 ID 与版本')
  }
  const command = structuredClone(value) as unknown as ProductionQuantityImportCommand
  if (!/^[a-z0-9][\w-]{2,79}$/i.test(command.commandId))
    return fail('原提交编号必须是有效稳定身份')
  if (Object.keys(command.source).sort().join(',') !== 'payloadBase64,sha256' || !/^[a-f0-9]{64}$/.test(command.source.sha256) || typeof command.source.payloadBase64 !== 'string')
    return fail('必须提交完整来源字节与真实 SHA-256，不能加其他来源字段')
  if (new Set(command.projects.map(row => row.legacyId)).size !== command.projects.length || new Set(command.projects.map(row => row.projectId)).size !== command.projects.length || new Set(command.people.map(row => `${row.kind}:${row.legacyId}`)).size !== command.people.length)
    return fail('映射重复或将两个原项目合并')
  return command
}

export function parseProductionQuantityImportIntent(input: unknown) {
  if (object(input) && input.family === 'quantity-import' && input.action === 'restore') {
    if (Object.keys(input).sort().join(',') !== 'action,actorId,commandId,family,importId,projectId,sourceSha256,workspaceId' || !['actorId', 'commandId', 'importId', 'projectId', 'workspaceId'].every(key => typeof input[key] === 'string' && String(input[key]).trim()) || typeof input.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceSha256))
      return fail('原恢复摘要封套不完整')
    return input as unknown as { family: 'quantity-import', action: 'restore', workspaceId: string, actorId: string, commandId: string, importId: string, projectId: string, sourceSha256: string }
  }
  if (!object(input) || input.family !== 'quantity-import' || !object(input.source) || Object.keys(input.source).join(',') !== 'sha256' || Object.keys(input).sort().join(',') !== 'action,actorId,commandId,family,people,projects,source,workspaceId')
    return fail('迁入原摘要封套不完整')
  const { family, ...body } = input
  const command = parseCommand({ ...body, source: { ...body.source as object, payloadBase64: '' } })
  if (command.action !== 'adopt' || !command.projects.length)
    return fail('原采用摘要必须保留目标项目和明确映射')
  return { ...command, action: 'adopt' as const, family, source: { sha256: command.source.sha256 } }
}

async function readSource(source: TransactionDb, evidence: { sha256: string, schemaVersion: number }) {
  const normalized: TransactionDb = {
    execute: source.execute,
    async select<T>(sql: string, params?: unknown[]) {
      const rows = await source.select<Record<string, unknown>>(sql, params)
      if (/\bFROM\s+operation_logs\b/i.test(sql)) {
        for (const row of rows) {
          const columns = QUANTITY_MIGRATION_COLUMNS[row.table_name as QuantityMigrationTable] as readonly string[] | undefined
          if (!columns)
            continue
          for (const key of ['before_data', 'after_data']) {
            if (typeof row[key] !== 'string')
              continue
            const snapshot = JSON.parse(row[key] as string)
            if (object(snapshot))
              row[key] = JSON.stringify(Object.fromEntries(Object.entries(snapshot).filter(([field]) => columns.includes(field))))
          }
        }
      }
      return rows as T[]
    },
  }
  const projects = (await readQuantityMigrationGraphs(normalized, { captureUnknownColumns: true })).filter(row => row.graph.archivedAt || row.graph.version === 2 || QUANTITY_MIGRATION_TABLES.some(table => row.graph.tables[table].length))
  const selections = QUANTITY_MIGRATION_TABLES.map(table => ({ table: String(table), key: table === 'file_payloads' ? 'file_ref_id' : 'id', ids: projects.flatMap(project => project.graph.tables[table].map(row => quantityMigrationRowId(table, row))) }))
  if (projects.some(project => project.graph.version === 2)) {
    selections.push(...QUANTITY_HOLLOW_TABLES.map(table => ({ table, key: 'id', ids: projects.flatMap(project => project.graph.version === 2 ? project.graph.hollow.tables[table].map(row => String(row.id)) : []) })))
  }
  const captured = await captureMigrationDomainRows(source, selections)
  return { ...evidence, projects, rawDomain: captured.rows, sourceSchemas: captured.schemas }
}
const digestBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** This is the one confirmed mapping owner consumed by payroll and other historical domains. */
async function readImportedIdentities(tx: TransactionDb, sourceSha256: string, actor: Pick<BusinessSession, 'workspaceId' | 'actorId'> | undefined, preserved: boolean): Promise<Array<{ table: string, legacyId: string, id: string, projectId: string }>> {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256))
    return fail('来源摘要无效')
  const [row] = await tx.select<StoredImport>('SELECT * FROM quantity_source_imports WHERE source_sha256=?', [sourceSha256])
  if (!row)
    throw quantityProblem('unavailable', '该完整来源尚无已确认工程量映射，相关工资完整图不能迁入')
  const [identity] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
  if (!identity || row.workspace_id !== identity.workspace_id || row.actor_id !== identity.owner_id || (actor && (actor.workspaceId !== row.workspace_id || actor.actorId !== row.actor_id)))
    return fail('本域确认来源与当前 owner 无法互证')
  if (!preserved && (await tx.select('SELECT import_id FROM quantity_import_restores WHERE import_id=?', [row.id])).length)
    throw quantityProblem('unavailable', '该工程量采用批次已经受控恢复，不能借旧映射重挂工资')
  let evidence: Evidence
  try {
    evidence = JSON.parse(row.evidence_json)
  }
  catch { return fail('原映射证据不是合法 JSON') }
  if (evidence.sourceSha256 !== row.source_sha256 || evidence.workspaceId !== row.workspace_id || evidence.actorId !== row.actor_id || evidence.commandId !== row.command_id || evidence.upstream !== 'historical-reference-only' || !Array.isArray(evidence.projects)
    || evidence.domainEvidenceDigest !== quantityDigest({ rawDomain: evidence.rawDomain, sourceSchemas: evidence.sourceSchemas, payloadRefs: evidence.payloadRefs, projects: evidence.projects, projectMappings: evidence.projectMappings, peopleMappings: evidence.peopleMappings })) {
    return fail('原本域完整证据、摘要或确认身份损坏')
  }
  const output: Array<{ table: string, legacyId: string, id: string, projectId: string }> = []
  const duplicate = new Set<string>()
  for (const project of evidence.projects) {
    if (project.namespace !== `qty-${row.source_sha256}-${encodeURIComponent(project.legacyProjectId)}` || project.sourceGraph.projectId !== project.legacyProjectId || project.graph.projectId !== project.projectId)
      return fail('确认项目及稳定映射命名空间不一致')
    for (const mapping of project.identities) {
      if (!QUANTITY_MIGRATION_TABLES.includes(mapping.table) || duplicate.has(rowKey(mapping.table, mapping.id)))
        return fail('来源身份重复或超出本域')
      duplicate.add(rowKey(mapping.table, mapping.id))
      const expected = mapping.table === 'file_payloads' ? `${project.namespace}:file_refs:${encodeURIComponent(mapping.legacyId)}` : `${project.namespace}:${mapping.table}:${encodeURIComponent(mapping.legacyId)}`
      if (mapping.id !== expected || !project.sourceGraph.tables[mapping.table].some(row => quantityMigrationRowId(mapping.table, row) === mapping.legacyId))
        return fail('原稳定身份与确认映射不一致')
      const primary = mapping.table === 'file_payloads' ? 'file_ref_id' : 'id'
      const [current] = await tx.select<Record<string, unknown>>(`SELECT * FROM ${mapping.table} WHERE ${primary}=?`, [mapping.id])
      if (!current)
        return fail('已采用工程量身份不再存在，不能猜替代节点')
      const parent = QUANTITY_MIGRATION_PROJECT_PARENTS[mapping.table as keyof typeof QUANTITY_MIGRATION_PROJECT_PARENTS]
      const mapped = project.graph.tables[mapping.table].find(row => quantityMigrationRowId(mapping.table, row) === mapping.id)
      if (parent && mapped && current[parent[1]] !== mapped[parent[1]])
        return fail('已确认工程量祖先与当前 owner 关系不一致')
      output.push({ ...mapping, projectId: project.projectId })
    }
    if (project.graph.version === 2 && project.sourceGraph.version === 2) {
      for (const table of QUANTITY_HOLLOW_TABLES) {
        for (const sourceRow of project.sourceGraph.hollow.tables[table]) {
          const legacyId = String(sourceRow.id)
          const id = `${project.namespace}:${table}:${encodeURIComponent(legacyId)}`
          if (!project.graph.hollow.tables[table].some(row => row.id === id) || !(await tx.select(`SELECT id FROM ${table} WHERE id=?`, [id])).length)
            return fail('原空鼓完整身份与实际采用不能互证')
          output.push({ table, legacyId, id, projectId: project.projectId })
        }
      }
    }
  }
  return output
}

export const readProductionQuantityImportedIdentities = (tx: TransactionDb, sourceSha256: string, actor?: Pick<BusinessSession, 'workspaceId' | 'actorId'>) => readImportedIdentities(tx, sourceSha256, actor, false)

/** Existing confirmed proof only; used transiently by a dependent domain's historical planner. */
export async function readProductionQuantityImportedProjects(tx: TransactionDb, sourceSha256: string, actor?: Pick<BusinessSession, 'workspaceId' | 'actorId'>) {
  await readProductionQuantityImportedIdentities(tx, sourceSha256, actor)
  const [record] = await tx.select<StoredImport>('SELECT * FROM quantity_source_imports WHERE source_sha256=?', [sourceSha256])
  const evidence = JSON.parse(record!.evidence_json) as Evidence
  return evidence.projects.map(project => ({ namespace: project.namespace, legacyProjectId: project.legacyProjectId, projectId: project.projectId, sourceGraph: structuredClone(project.sourceGraph) }))
}

/** Backup may verify preserved inactive evidence, but consumers never receive inactive mappings. */
export async function verifyProductionQuantityImportState(tx: TransactionDb) {
  const metadataOnlyFileIds = new Set<string>()
  for (const row of await tx.select<StoredImport>('SELECT * FROM quantity_source_imports')) {
    await readImportedIdentities(tx, row.source_sha256, undefined, true)
    const evidence = JSON.parse(row.evidence_json) as Evidence
    const ownTables = [...QUANTITY_MIGRATION_TABLES, ...(evidence.projects.some(project => project.sourceGraph.version === 2) ? QUANTITY_HOLLOW_TABLES : [])].sort().join(',')
    if (Object.keys(evidence.rawDomain).sort().join(',') !== ownTables || Object.keys(evidence.sourceSchemas).sort().join(',') !== ownTables)
      return fail('本域 raw 行与原表结构集合不完整')
    for (const original of evidence.payloadRefs) {
      const [body] = await tx.select<{ content: Uint8Array, sha256: string }>('SELECT content,sha256 FROM file_payloads WHERE file_ref_id=?', [original.id])
      if (!body || !(body.content instanceof Uint8Array) || body.sha256 !== original.sha256 || digestBytes(body.content) !== original.sha256)
        return fail('原验收照片共享 BLOB 与确认来源摘要不同')
    }
    for (const project of evidence.projects) {
      for (const file of project.graph.tables.file_refs) {
        if (!evidence.payloadRefs.some(body => body.id === file.id)) {
          if ((await tx.select('SELECT file_ref_id FROM file_payloads WHERE file_ref_id=?', [file.id])).length)
            return fail('历史缺正文原件被无证补造')
          metadataOnlyFileIds.add(String(file.id))
        }
      }
    }
  }
  for (const row of await tx.select<{ import_id: string, workspace_id: string, actor_id: string }>('SELECT * FROM quantity_import_restores')) {
    const [source] = await tx.select<StoredImport>('SELECT * FROM quantity_source_imports WHERE id=?', [row.import_id])
    if (!source || source.workspace_id !== row.workspace_id || source.actor_id !== row.actor_id)
      return fail('整批恢复与原确认来源不能互证')
  }
  return { metadataOnlyFileIds }
}

async function insertGraph(tx: TransactionDb, project: ProjectEvidence, importId: string) {
  for (const reference of project.graph.boqReferences) {
    const [old] = await tx.select<{ project_id: string, contract_id: string }>('SELECT project_id,contract_id FROM quantity_boq_references WHERE id=?', [reference.id])
    if (old && (old.project_id !== project.projectId || old.contract_id !== reference.contractId))
      return fail('旧清单引用已属于另一个确认来源')
    if (!old)
      await tx.execute('INSERT INTO quantity_boq_references VALUES (?,?,?)', [reference.id, project.projectId, reference.contractId])
  }
  for (const table of QUANTITY_MIGRATION_TABLES) {
    if (table === 'file_payloads') {
      for (const body of project.graph.tables.file_payloads) {
        const file = project.graph.tables.file_refs.find(file => file.id === body.file_ref_id)!
        await writeProductionQuantityOriginal(tx, String(body.file_ref_id), { fileName: String(file.file_name), mimeType: String(file.mime_type), fileSize: Number(file.file_size), contentBase64: String(body.content) })
      }
      continue
    }
    const columns = QUANTITY_MIGRATION_COLUMNS[table]
    for (const row of project.graph.tables[table])
      await tx.execute(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(column => row[column]))
  }
  await tx.execute('UPDATE projects SET matrix_archived_at=? WHERE id=?', [project.graph.archivedAt, project.projectId])
  await insertQuantityHollowMigration(tx, { entityId: project.namespace, projectId: project.projectId, batchId: importId, source: project.sourceGraph, mapped: project.graph })
}

/** Any later fact or reference blocks the entire batch; histories and soft-deleted references count. */
export async function assertProductionQuantityImportRestoreAllowed(tx: TransactionDb, importId: string) {
  const [source] = await tx.select<StoredImport>('SELECT * FROM quantity_source_imports WHERE id=?', [importId])
  if (!source)
    throw quantityProblem('not-found', '原工程量采用批次不存在')
  await readProductionQuantityImportedIdentities(tx, source.source_sha256)
  const evidence = JSON.parse(source.evidence_json) as Evidence
  const owned = new Map<string, Set<string>>()
  for (const project of evidence.projects) {
    const [currentProject] = await tx.select<{ matrix_archived_at: string | null }>('SELECT matrix_archived_at FROM projects WHERE id=?', [project.projectId])
    if (currentProject?.matrix_archived_at !== project.graph.archivedAt)
      throw quantityProblem('conflict', '采用后矩阵归档已有独立变更，整批恢复已拒绝')
    for (const table of QUANTITY_MIGRATION_TABLES) {
      const ids = owned.get(table) ?? new Set<string>()
      owned.set(table, ids)
      for (const expected of project.graph.tables[table]) {
        const id = quantityMigrationRowId(table, expected)
        ids.add(id)
        if (table === 'file_payloads')
          continue
        const [current] = await tx.select<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=?`, [id])
        if (!current || QUANTITY_MIGRATION_COLUMNS[table].some(column => current[column] !== expected[column]))
          throw quantityProblem('conflict', '采用后的工程量、审计或原件已独立变化，整批恢复已拒绝')
      }
    }
  }
  await assertQuantityHollowMigrationReferences(tx, { entityIds: evidence.projects.map(project => project.namespace), quantity: [...owned].flatMap(([table, ids]) => [...ids].map(id => ({ table, id }))) })
  for (const [table, [parent, field]] of Object.entries(QUANTITY_MIGRATION_PROJECT_PARENTS)) {
    const targets = parent === 'projects' ? new Set(evidence.projects.map(project => project.projectId)) : owned.get(parent)
    if (!targets?.size)
      continue
    const key = table === 'file_payloads' ? 'file_ref_id' : 'id'
    for (const row of await tx.select<Record<string, unknown>>(`SELECT ${key},${field} FROM ${table}`)) {
      if (targets.has(String(row[field])) && !owned.get(table)?.has(String(row[key])))
        throw quantityProblem('conflict', '采用后已有独立工程量引用原祖先，整批恢复已拒绝')
    }
  }
  const all = new Set([...owned.values()].flatMap(ids => [...ids]))
  for (const project of evidence.projects) {
    for (const reference of project.graph.boqReferences) all.add(reference.id)
  }
  const hasReference = (value: unknown): boolean => typeof value === 'string'
    ? all.has(value)
    : Array.isArray(value) ? value.some(hasReference) : object(value) ? Object.values(value).some(hasReference) : false
  const participants = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')
  for (const { name } of participants.filter(row => /^(?:payroll_|wage_|schedule_|owner_document_|monthly_statements$|task_item_map$|task_dependencies$)/.test(row.name))) {
    for (const row of await tx.select<Record<string, unknown>>(`SELECT * FROM "${name.replaceAll('"', '""')}"`)) {
      for (const value of Object.values(row)) {
        if (hasReference(value))
          throw quantityProblem('conflict', '商务月报、工资、WBS或其历史仍引用原工程量，整批恢复已拒绝')
        if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
          let parsed: unknown
          try {
            parsed = JSON.parse(value)
          }
          catch { throw quantityProblem('unavailable', '相关事实 JSON 无法核对，不能恢复工程量批次') }
          if (hasReference(parsed))
            throw quantityProblem('conflict', '商务月报、工资、WBS或其冻结目录仍引用原工程量，整批恢复已拒绝')
        }
      }
    }
  }
  const proof = await verifyProductionQuantityImportState(tx)
  void proof
  return evidence
}

export function createProductionQuantityImport(storage: ProductionStorage) {
  function authorize(session: Session) {
    const actor = structuredClone(session())
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !['core:migration:write', 'quantity:write', 'quantity:read', 'project:list:read', 'crew:list:read', 'worker:list:read', 'worker:sensitive:read'].every(capability => actor.capabilities.includes(capability)))
      throw quantityProblem('forbidden', '当前身份无完整工程量来源及原件采用权限')
    return actor
  }
  return {
    async catalog(session: Session) {
      const actor = authorize(session)
      return storage.withTransaction(async (tx) => {
        const directory = await loadProductionCrewWorkers(tx, actor)
        return { context: actor, projects: await listMigrationReferences(tx, actor, 'projects'), people: [
          ...[...directory.crews.values()].map(row => ({ kind: 'crew', id: row.id, name: row.draft.name ?? '', version: String(row.version), deleted: !!row.deletedAt })),
          ...[...directory.workers.values()].map(row => ({ kind: 'worker', id: row.id, name: row.draft.name ?? '', version: String(row.version), deleted: !!row.deletedAt })),
        ], imports: await tx.select<{ id: string, source_sha256: string, created_at: string, restored: number }>('SELECT source.id,source.source_sha256,source.created_at,EXISTS(SELECT 1 FROM quantity_import_restores restored WHERE restored.import_id=source.id) AS restored FROM quantity_source_imports source ORDER BY source.created_at,source.id') }
      })
    },
    async resolve(descriptor: { commandId: string, workspaceId: string, actorId: string, family: string, targetId: string | null, action: string, scopeId: string }, session: Session) {
      const actor = authorize(session)
      if (descriptor.family !== 'quantity-import' || descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId || !/^[a-z0-9][\w-]{2,79}$/i.test(descriptor.commandId) || !((descriptor.action === 'adopt' && descriptor.targetId === null) || (descriptor.action === 'restore' && typeof descriptor.targetId === 'string')) || !/^[a-f0-9]{64}$/.test(descriptor.scopeId))
        return fail('原迁入定位描述无效')
      storage.assertBusinessWrite()
      return storage.withTransaction(async (tx) => {
        if (descriptor.action === 'restore') {
          const [restored] = await tx.select<{ import_id: string, command_id: string, workspace_id: string, actor_id: string, result_json: string }>('SELECT * FROM quantity_import_restores WHERE command_id=?', [descriptor.commandId])
          if (restored) {
            const [source] = await tx.select<StoredImport>('SELECT * FROM quantity_source_imports WHERE id=?', [restored.import_id])
            if (!source || source.source_sha256 !== descriptor.scopeId || restored.import_id !== descriptor.targetId || restored.workspace_id !== actor.workspaceId || restored.actor_id !== actor.actorId)
              throw quantityProblem('conflict', '原恢复结果不属于原范围')
            await verifyProductionQuantityImportState(tx)
            return { outcome: 'applied' as const, result: JSON.parse(restored.result_json) }
          }
        }
        const [record] = await tx.select<StoredImport>('SELECT * FROM quantity_source_imports WHERE command_id=?', [descriptor.commandId])
        if (record && descriptor.action === 'adopt') {
          if (record.source_sha256 !== descriptor.scopeId || record.workspace_id !== actor.workspaceId || record.actor_id !== actor.actorId)
            throw quantityProblem('conflict', '原完整迁入编号属于另一来源或身份')
          await verifyProductionQuantityImportState(tx)
          return { outcome: 'applied' as const, result: JSON.parse(record.result_json) }
        }
        const key = [actor.workspaceId, actor.actorId, descriptor.commandId]
        const [intent] = await tx.select<{ request_json: string }>('SELECT request_json FROM quantity_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
        if (intent) {
          const original = parseProductionQuantityImportIntent(JSON.parse(intent.request_json))
          if (original.action !== descriptor.action || (original.action === 'adopt' ? original.source.sha256 !== descriptor.scopeId || descriptor.targetId !== null : original.sourceSha256 !== descriptor.scopeId || original.importId !== descriptor.targetId))
            throw quantityProblem('conflict', '此原编号属于另一来源')
        }
        const [sealed] = await tx.select<{ descriptor_json: string | null }>('SELECT descriptor_json FROM quantity_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
        if (sealed && sealed.descriptor_json !== quantityCanonical(descriptor))
          throw quantityProblem('conflict', '原编号已被另一作用域封存')
        if (!sealed)
          await tx.execute('INSERT INTO quantity_resolutions(workspace_id,actor_id,command_id,resolved_at,descriptor_json) VALUES (?,?,?,?,?)', [...key, new Date().toISOString(), quantityCanonical(descriptor)])
        if (quantityCanonical(authorize(session)) !== quantityCanonical(actor))
          throw quantityProblem('forbidden', '核对期间身份变化，封存已撤回')
        return { outcome: 'not-applied' as const, commandId: descriptor.commandId }
      })
    },
    async restore(input: { commandId: string, workspaceId: string, actorId: string, importId: string }, session: Session) {
      const actor = authorize(session)
      if (!object(input) || Object.keys(input).sort().join(',') !== 'actorId,commandId,importId,workspaceId' || input.workspaceId !== actor.workspaceId || input.actorId !== actor.actorId || !input.commandId || !input.importId)
        return fail('整批恢复必须指定原采用和稳定身份')
      if (!/^[a-z0-9][\w-]{2,79}$/i.test(input.commandId) || !/^[a-z0-9][\w-]{2,79}$/i.test(input.importId))
        return fail('恢复原编号或采用批次身份无效')
      storage.assertBusinessWrite()
      await storage.withTransaction(async (tx) => {
        const key = [actor.workspaceId, actor.actorId, input.commandId]
        const [source] = await tx.select<StoredImport>('SELECT * FROM quantity_source_imports WHERE id=?', [input.importId])
        if (!source)
          throw quantityProblem('not-found', '原采用不存在')
        const evidence = JSON.parse(source.evidence_json) as Evidence
        const original = parseProductionQuantityImportIntent({ ...input, family: 'quantity-import', action: 'restore', projectId: evidence.projects[0]!.projectId, sourceSha256: source.source_sha256 })
        if ((await tx.select('SELECT command_id FROM quantity_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', key)).length)
          throw quantityProblem('conflict', '原恢复已明确未应用，不能迟到重建')
        const [intent] = await tx.select<{ request_json: string }>('SELECT request_json FROM quantity_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
        if (intent && intent.request_json !== quantityCanonical(original))
          throw quantityProblem('conflict', '原编号属于另一份恢复请求')
        if (!intent)
          await tx.execute('INSERT INTO quantity_command_intents VALUES (?,?,?,?,?,?,?)', [...key, evidence.projects[0]!.projectId, quantityDigest(original), quantityCanonical(original), new Date().toISOString()])
      })
      return storage.withTransaction(async (tx) => {
        if ((await tx.select('SELECT command_id FROM quantity_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, input.commandId])).length)
          throw quantityProblem('conflict', '原恢复已封存，不能迟到重建')
        const [previous] = await tx.select<{ command_id: string, workspace_id: string, actor_id: string, result_json: string }>('SELECT * FROM quantity_import_restores WHERE import_id=? OR command_id=?', [input.importId, input.commandId])
        if (previous) {
          if (previous.command_id !== input.commandId || previous.workspace_id !== actor.workspaceId || previous.actor_id !== actor.actorId)
            throw quantityProblem('conflict', '原恢复编号或身份不同')
          return JSON.parse(previous.result_json)
        }
        const evidence = await assertProductionQuantityImportRestoreAllowed(tx, input.importId)
        const restoredAt = new Date().toISOString()
        // Keep originals, descendants, audit and receipts. Hidden roots deactivate this whole adoption.
        for (const project of evidence.projects) {
          for (const table of ['buildings', 'house_type_templates', 'items', 'construction_stages'] as const) {
            for (const row of project.graph.tables[table])
              await tx.execute(`UPDATE ${table} SET deleted_at=COALESCE(deleted_at,?) WHERE id=?`, [restoredAt, row.id])
          }
          await tx.execute('UPDATE projects SET matrix_archived_at=? WHERE id=?', [project.previousArchive, project.projectId])
        }
        const result = { commandId: input.commandId, importId: input.importId, outcome: 'restored', preservedOriginals: true }
        await tx.execute('INSERT INTO quantity_import_restores VALUES (?,?,?,?,?,?)', [input.importId, input.commandId, actor.workspaceId, actor.actorId, quantityCanonical(result), restoredAt])
        if (quantityCanonical(authorize(session)) !== quantityCanonical(actor))
          throw quantityProblem('forbidden', '恢复期间身份变化，整批已撤回')
        return result
      })
    },
    async execute(input: unknown, session: Session) {
      const command = parseCommand(input)
      const actor = authorize(session)
      if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
        throw quantityProblem('forbidden', '迁入原命令身份不同')
      if (command.action === 'adopt')
        storage.assertBusinessWrite()
      if (command.action === 'adopt') {
        if (!command.projects.length)
          return fail('来源实际量域不能为空，必须指定目标项目')
        const original = parseProductionQuantityImportIntent({ ...command, family: 'quantity-import', source: { sha256: command.source.sha256 } })
        await storage.withTransaction(async (tx) => {
          const key = [actor.workspaceId, actor.actorId, command.commandId]
          if ((await tx.select('SELECT command_id FROM quantity_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', key)).length)
            throw quantityProblem('conflict', '原迁入编号已封存，不能迟到重建')
          const [intent] = await tx.select<{ fingerprint: string, request_json: string }>('SELECT fingerprint,request_json FROM quantity_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', key)
          if (intent && (intent.fingerprint !== quantityDigest(original) || intent.request_json !== quantityCanonical(original)))
            throw quantityProblem('conflict', '原迁入编号已经保留另一份来源或映射，不能用新输入改写')
          if (!intent)
            await tx.execute('INSERT INTO quantity_command_intents VALUES (?,?,?,?,?,?,?)', [...key, command.projects[0]!.projectId, quantityDigest(original), quantityCanonical(original), new Date().toISOString()])
          if (quantityCanonical(authorize(session)) !== quantityCanonical(actor))
            throw quantityProblem('forbidden', '原意图保存期间身份变化，已撤回')
        })
      }
      return withVerifiedMigrationSnapshot(command.source, (sourceDb, metadata) => storage.withTransaction(async (tx) => {
        await assertProductionQuantitySchema(tx)
        if ((await tx.select('SELECT command_id FROM quantity_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, command.commandId])).length)
          throw quantityProblem('conflict', '原迁入编号已明确未应用，不能迟到重建')
        const fingerprint = quantityDigest({ ...command, action: 'adopt', source: { sha256: metadata.sha256 } })
        const [previous] = await tx.select<StoredImport>('SELECT * FROM quantity_source_imports WHERE source_sha256=? OR command_id=?', [metadata.sha256, command.commandId])
        if (previous && command.action !== 'inspect') {
          const old = JSON.parse(previous.evidence_json) as Evidence
          if (previous.source_sha256 !== metadata.sha256 || old.fingerprint !== fingerprint || previous.workspace_id !== actor.workspaceId || previous.actor_id !== actor.actorId)
            throw quantityProblem('conflict', '来源或原编号已绑定另一份确认映射')
          await readProductionQuantityImportedIdentities(tx, metadata.sha256, actor)
          return JSON.parse(previous.result_json)
        }
        const source = await readSource(sourceDb, metadata)
        if (command.action === 'inspect') {
          if (command.projects.length || command.people.length)
            return fail('只读来源检查不能预设主档映射')
          return { sourceSha256: source.sha256, schemaVersion: source.schemaVersion, projects: source.projects.map(row => ({ id: row.project.id, name: row.project.name })), people: source.projects.flatMap(row => row.graph.tables.unit_assignments.flatMap(assignment => [
            ...(typeof assignment.crew_id === 'string' ? [{ kind: 'crew' as const, id: assignment.crew_id }] : []),
            ...(typeof assignment.worker_id === 'string' ? [{ kind: 'worker' as const, id: assignment.worker_id }] : []),
          ])).filter((row, index, all) => all.findIndex(other => other.kind === row.kind && other.id === row.id) === index), upstream: 'historical-reference-only' as const }
        }
        if (command.projects.length !== source.projects.length || source.projects.some(project => !command.projects.some(mapping => mapping.legacyId === project.project.id)))
          return fail('每个实际量域项目必须有且仅有一个正式项目映射')
        const people = await loadProductionCrewWorkers(tx, actor)
        const crewMap = new Map<string, string>()
        const workerMap = new Map<string, string>()
        for (const mapping of command.people) {
          const current = mapping.kind === 'crew' ? people.crews.get(mapping.id) : people.workers.get(mapping.id)
          if (!current || String(current.version) !== mapping.version) {
            return fail('原责任的正式身份不存在或真实版本已变化')
          }
          const map = mapping.kind === 'crew' ? crewMap : workerMap
          map.set(mapping.legacyId, mapping.id)
        }
        const projects: ProjectEvidence[] = []
        for (const item of source.projects) {
          const mapping = command.projects.find(mapping => mapping.legacyId === item.project.id)!
          const target = await readMigrationReference(tx, actor, 'projects', mapping.projectId)
          if (!target || target.version !== mapping.version)
            return fail('目标正式项目不可读或真实版本已变化')
          const [existing] = await tx.select<{ matrix_archived_at: string | null }>('SELECT matrix_archived_at FROM projects WHERE id=?', [mapping.projectId])
          for (const table of ['buildings', 'house_type_templates', 'items', 'construction_stages'] as const) {
            if ((await tx.select(`SELECT id FROM ${table} WHERE project_id=?`, [mapping.projectId])).length)
              throw quantityProblem('conflict', '目标已有工程量或历史，不能覆盖日常修改或建立第二份量域事实')
          }
          const namespace = `qty-${source.sha256}-${encodeURIComponent(item.project.id)}`
          const mapped = mapQuantityMigrationGraph(item.graph, { namespace, projectId: mapping.projectId, crews: crewMap, workers: workerMap, boqLineIds: new Set(item.graph.boqReferences.map(row => row.id)), contracts: new Map(item.graph.boqReferences.map(row => [row.contractId, row.contractId])) })
          projects.push({ legacyProjectId: item.project.id, projectId: mapping.projectId, namespace, previousArchive: existing?.matrix_archived_at ?? null, sourceGraph: item.graph, ...mapped })
        }
        if (quantityCanonical(authorize(session)) !== quantityCanonical(actor))
          throw quantityProblem('forbidden', '核对期间会话或权限变化')
        const preview = { sourceSha256: source.sha256, schemaVersion: source.schemaVersion, eligible: true, projects: projects.map(project => ({ legacyProjectId: project.legacyProjectId, projectId: project.projectId, identities: project.identities })), upstream: 'historical-reference-only' as const }
        if (command.action === 'preflight')
          return preview
        const [trigger] = await tx.select<{ sql: string }>('SELECT sql FROM sqlite_master WHERE type=\'trigger\' AND name=\'trg_house_type_templates_whole_unit\'')
        if (!trigger?.sql)
          return fail('整户规则来源缺失，不能导入完整原房间图')
        const importId = `quantity-import-${randomUUID()}`
        await tx.execute('DROP TRIGGER trg_house_type_templates_whole_unit')
        for (const project of projects)
          await insertGraph(tx, project, importId)
        await tx.execute(trigger.sql)
        const payloadRefs = projects.flatMap(project => project.graph.tables.file_payloads.map(body => ({ legacyId: project.identities.find(row => row.table === 'file_payloads' && row.id === body.file_ref_id)!.legacyId, id: String(body.file_ref_id), sha256: digestBytes(Buffer.from(String(body.content), 'base64')) })))
        const persistedProjects = projects.map(project => ({ ...project, sourceGraph: { ...project.sourceGraph, tables: { ...project.sourceGraph.tables, file_payloads: project.sourceGraph.tables.file_payloads.map(body => ({ ...body, content: null })) } }, graph: { ...project.graph, tables: { ...project.graph.tables, file_payloads: project.graph.tables.file_payloads.map(body => ({ ...body, content: null })) } } })) as ProjectEvidence[]
        const rawPayloadRows = source.rawDomain.file_payloads
        if (!Array.isArray(rawPayloadRows))
          return fail('原照片正文表尚未成功核对')
        const rawDomain = { ...source.rawDomain, file_payloads: rawPayloadRows.map((row) => {
          const reference = payloadRefs.find(body => body.legacyId === row.legacyId)!
          const columns = row.columns as Record<string, unknown>
          return { ...row, columns: { ...columns, content: { sharedOriginal: reference.id, sha256: reference.sha256, originalSQLiteType: (columns.content as { sqliteType: string }).sqliteType } } }
        }) }
        const domainEvidenceDigest = quantityDigest({ rawDomain, sourceSchemas: source.sourceSchemas, payloadRefs, projects: persistedProjects, projectMappings: command.projects, peopleMappings: command.people })
        const evidence: Evidence = { sourceSha256: source.sha256, schemaVersion: source.schemaVersion, workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: command.commandId, fingerprint, projectMappings: command.projects, peopleMappings: command.people, projects: persistedProjects, upstream: 'historical-reference-only', rawDomain, sourceSchemas: source.sourceSchemas, payloadRefs, domainEvidenceDigest }
        const result = { ...preview, importId, commandId: command.commandId }
        await tx.execute('INSERT INTO quantity_source_imports VALUES (?,?,?,?,?,?,?,?)', [importId, source.sha256, quantityCanonical(evidence), actor.workspaceId, actor.actorId, command.commandId, quantityCanonical(result), new Date().toISOString()])
        await readProductionQuantityImportedIdentities(tx, source.sha256, actor)
        if (quantityCanonical(authorize(session)) !== quantityCanonical(actor))
          throw quantityProblem('forbidden', '提交期间权限或身份变化，整批已撤回')
        return result
      }))
    },
  }
}
