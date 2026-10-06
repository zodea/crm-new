import type { H3Event } from 'h3'
import type { SQLInputValue } from 'node:sqlite'
import type { QuotationActor, QuotationStorage } from '../../app/lib/material-quotation/sqlite-owner'
import { DatabaseSync } from 'node:sqlite'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { QuotationProblem } from '../../app/lib/material-quotation/contract'
import { createQuotationGraphActions, exportQuotationGraph, readQuotationImportedKeys, readQuotationImportRelations } from '../../app/lib/material-quotation/graph'
import { MATERIAL_QUOTATION_SCHEMA } from '../../app/lib/material-quotation/schema'
import { validateMaterialQuotationSchema } from '../../app/lib/material-quotation/schema-upgrade'
import { createQuotationOwner } from '../../app/lib/material-quotation/sqlite-owner'
import { resolveBusinessSession } from './business-session'
import { MigrationEvidenceProblem, withVerifiedMigrationSnapshot } from './migration-snapshot'
import { listMigrationReferences } from './production-migration-references'
import { productionRuntime, productionSession, throwProductionStorageError } from './production-runtime'
import { projectCommandTestInstance } from './project-command-test-instance'
import { createReadMeta, readSourceVersion, withReadMeta } from './read-meta'
import { supplierCommandTestInstance } from './supplier-command-test-instance'

const productionOwners = new WeakMap<object, ReturnType<typeof createProductionMaterialQuotationOwner>>()
const developmentOwners = new Map<string, ReturnType<typeof createProductionMaterialQuotationOwner>>()
export function createProductionMaterialQuotationOwner(storage: QuotationStorage) {
  const options = { payloadMode: 'central' as const, relations: (tx: import('../../app/lib/db/coordinator').TransactionDb, records: import('../../app/lib/material-quotation/contract').QuotationRecord[]) => readQuotationImportRelations(tx, records, storage.identity), migrationReferences: async (tx: import('../../app/lib/db/coordinator').TransactionDb, actor: QuotationActor) => [...await listMigrationReferences(tx, { ...actor, capabilities: [...actor.capabilities] }, 'projects'), ...await listMigrationReferences(tx, { ...actor, capabilities: [...actor.capabilities] }, 'suppliers')], verifySource: (source: import('../../app/lib/material-quotation/import-evidence').QuotationMigrationSource) => withVerifiedMigrationSnapshot(source, async (tx, evidence) => {
    if (evidence.schemaVersion < 58 || evidence.schemaVersion > 60)
      throw new MigrationEvidenceProblem('validation-failed', '报价原库版本尚未在当前迁入边界核验，请保留原库')
    await validateMaterialQuotationSchema(tx)
    return exportQuotationGraph(tx, 'native')
  }), references: async (tx: import('../../app/lib/db/coordinator').TransactionDb, actor: QuotationActor) => ({
    projects: actor.capabilities.includes('project:list:read')
      ? await tx.select<{
          id: string
          name: string
        }>('SELECT id,name FROM projects WHERE deleted_at IS NULL ORDER BY name,id')
      : [],
    suppliers: actor.capabilities.includes('supplier:list:read')
      ? await tx.select<{
          id: string
          name: string
        }>('SELECT id,json_extract(draft_json,\'$.name\') AS name FROM suppliers WHERE COALESCE(json_extract(draft_json,\'$.deletedAt\'),\'\')=\'\' ORDER BY name,id')
      : [],
  }) }
  const importedCommandKeys = async (tx: import('../../app/lib/db/coordinator').TransactionDb) => (await readQuotationImportedKeys(tx, storage.identity)).business
  return { ...createQuotationOwner(storage, { ...options, importedCommandKeys }), ...createQuotationGraphActions(storage, options) }
}
export function materialQuotationRuntime(event: H3Event) {
  const runtime = productionRuntime()
  if (runtime) {
    let owner = productionOwners.get(runtime.storage)
    if (!owner) {
      owner = createProductionMaterialQuotationOwner(runtime.storage)
      productionOwners.set(runtime.storage, owner)
    }
    return { owner, session: productionSession(event) }
  }
  const sessionId = getHeader(event, 'x-ruihang-test-session') || 'default'
  let owner = developmentOwners.get(sessionId)
  if (!owner) {
    const actor = resolveBusinessSession()
    const coordinator = createDbCoordinator(async () => {
      const db = new DatabaseSync(':memory:')
      db.exec(`PRAGMA foreign_keys=ON;
        CREATE TABLE file_refs(id TEXT PRIMARY KEY,owner_type TEXT NOT NULL,owner_id TEXT NOT NULL,file_name TEXT NOT NULL,file_path TEXT NOT NULL,file_size INTEGER NOT NULL,mime_type TEXT NOT NULL,category TEXT NOT NULL,uploader TEXT NOT NULL,uploaded_at TEXT NOT NULL,deleted_at TEXT);
        CREATE TABLE file_payloads(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),content BLOB NOT NULL,sha256 TEXT NOT NULL);
        ${MATERIAL_QUOTATION_SCHEMA}`)
      return { async execute(sql, params) {
        if (params)
          db.prepare(sql).run(...params as SQLInputValue[])
        else
          db.exec(sql)
      }, async select<T>(sql: string, params: unknown[] = []) {
        return db.prepare(sql).all(...params as SQLInputValue[]) as T[]
      }, async close() {
        db.close()
      } }
    })
    const storage = { ...coordinator, identity: actor, assertBusinessWrite() {
    } }
    const options = { payloadMode: 'central' as const, references: async (_tx: import('../../app/lib/db/coordinator').TransactionDb, current: QuotationActor) => ({
      projects: current.capabilities.includes('project:list:read') ? projectCommandTestInstance.rows(sessionId).map(row => ({ id: row.id, name: row.name })) : [],
      suppliers: current.capabilities.includes('supplier:list:read') ? supplierCommandTestInstance.rows(sessionId).map(row => ({ id: row.id, name: row.name })) : [],
    }) }
    owner = { ...createQuotationOwner(storage, options), ...createQuotationGraphActions(storage, options) }
    developmentOwners.set(sessionId, owner)
  }
  return { owner, session: () => resolveBusinessSession() }
}
export async function materialQuotationRead(event: H3Event) {
  const { owner, session } = materialQuotationRuntime(event)
  const actor: QuotationActor = session()
  const data = await owner.read(session)
  const asOf = new Date().toISOString()
  const meta = createReadMeta({ session: actor, schemaVersion: 'material-quotation-read-v1', operation: 'material-quotation:list', dataOrigin: 'real', asOf, coverage: data.filtered ? 'permission-filtered' : 'complete', scope: {}, sources: [{ key: 'material-quotations', state: 'readable', sourceVersion: `quotation:${data.revision}`, asOf }] })
  return withReadMeta({ records: data.records }, meta)
}
export async function materialQuotationContextRead(event: H3Event) {
  const { owner, session } = materialQuotationRuntime(event)
  const data = await owner.context(session)
  const asOf = new Date().toISOString()
  const actor = { workspaceId: data.workspaceId, actorId: data.actorId, capabilities: data.capabilities }
  const sources = (['projects', 'suppliers'] as const).map((key) => {
    const allowed = actor.capabilities.includes(key === 'projects' ? 'project:list:read' : 'supplier:list:read')
    return { key, state: allowed ? 'readable' as const : 'forbidden' as const, sourceVersion: allowed ? readSourceVersion(key, data[key]) : null, asOf: allowed ? asOf : null }
  })
  const meta = createReadMeta({ session: actor, schemaVersion: 'material-quotation-context-v1', operation: 'material-quotation:context', dataOrigin: 'real', asOf, coverage: sources.some(source => source.state === 'forbidden') ? 'permission-filtered' : 'complete', scope: {}, sources })
  return withReadMeta(data, meta)
}
export async function materialQuotationImportContextRead(event: H3Event) {
  const { owner, session } = materialQuotationRuntime(event)
  const data = await owner.importContext(session)
  const asOf = new Date().toISOString()
  const sources = (['projects', 'suppliers'] as const).map(key => ({ key, state: 'readable' as const, sourceVersion: readSourceVersion(key, data.references.filter(row => row.entityType === key)), asOf }))
  const meta = createReadMeta({ session: { ...data, capabilities: [...data.capabilities] }, schemaVersion: 'material-quotation-import-context-v1', operation: 'material-quotation:import-context', dataOrigin: 'real', asOf, coverage: 'complete', scope: {}, sources })
  return withReadMeta(data, meta)
}
export function throwQuotationHttpError(cause: unknown): never {
  throwProductionStorageError(cause)
  if (cause instanceof QuotationProblem || cause instanceof MigrationEvidenceProblem) {
    const statusCode = ({ 'forbidden': 403, 'unauthenticated': 401, 'not-found': 404, 'conflict': 409, 'validation-failed': 422, 'relationship-mismatch': 422 } as Record<string, number>)[cause.problem.code] ?? 503
    throw createError({ statusCode, statusMessage: 'Domain request failed', data: cause.problem })
  }
  if (cause && typeof cause === 'object' && 'statusCode' in cause && typeof cause.statusCode === 'number' && cause.statusCode >= 400 && cause.statusCode < 500)
    throw cause
  throw createError({ statusCode: 503, statusMessage: 'Material quotation unavailable', data: { code: 'unavailable', message: '报价来源暂不可用，请保留输入并重试', retryable: true, fieldErrors: {}, traceId: null } })
}
