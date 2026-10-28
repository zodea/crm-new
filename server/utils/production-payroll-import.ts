import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CoreMigrationServerEntityDTO } from '../../app/lib/migration/core-contract'
import type { PayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import type { PayrollImportInput, PayrollImportMapping, PayrollImportPreview, PayrollImportReference, PayrollImportResult } from '../../app/lib/payroll/production-import'
import type { BusinessSession } from './business-session'
import type { PayrollAdoptedQuantityProject } from './payroll-migration'
import type { ProductionStorage } from './production-storage'
import { createHash } from 'node:crypto'
import { payrollCentralPrimaryKey } from '../../app/lib/migration/payroll-central-source'
import { publicationRowId } from '../../app/lib/migration/payroll-publication-source'
import { parsePayrollProjectGraph, PAYROLL_MIGRATION_PARTS, PAYROLL_MIGRATION_TABLES, readPayrollProjectMigrationGraphs } from '../../app/lib/migration/payroll-source'
import { readWorkerModernGraphs } from '../../app/lib/migration/worker-roster-modern-source'
import { payrollAFeesPrimaryKey } from '../../app/lib/payroll/central-a-fees-schema'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { isStableRouteIdentity } from '../../app/lib/util/stable-route-identity'
import { captureMigrationDomainRows } from './migration-domain-evidence'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { applyPayrollMigration, planPayrollMigration } from './payroll-migration'
import { loadProductionCrewWorkers } from './production-crew-worker-record'
import { validateProductionPayrollState } from './production-payroll-validation'
import { readProductionQuantityImportedIdentities, readProductionQuantityImportedProjects } from './production-quantity-migration'
import { productionWorkerOriginals } from './production-worker-originals'

type Session = () => BusinessSession
const hash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function failure(message: string): never {
  throw payrollProblem('validation-failed', message)
}
function input(raw: unknown): PayrollImportInput {
  if (!object(raw) || Object.keys(raw).sort().join(',') !== 'action,actorId,commandId,referenceMappings,source,workspaceId' || !['workspaceId', 'actorId', 'commandId'].every(field => typeof raw[field] === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(String(raw[field]))) || !['preview', 'adopt'].includes(String(raw.action)) || !Array.isArray(raw.referenceMappings))
    failure('工资完整文件迁入请求身份、动作或结构无效')
  const seen = new Set<string>()
  for (const row of raw.referenceMappings) {
    if (!object(row) || Object.keys(row).sort().join(',') !== 'entityType,evidenceNote,legacyId,serverId,sourceVersion,version' || !['projects', 'crews', 'workers'].includes(String(row.entityType)) || !isStableRouteIdentity(row.legacyId) || !isStableRouteIdentity(row.serverId) || typeof row.version !== 'string' || !/^[1-9]\d*$/.test(row.version) || typeof row.sourceVersion !== 'string' || !row.sourceVersion || typeof row.evidenceNote !== 'string' || !row.evidenceNote.trim())
      failure('每个原项目、班组及工人须有明确真实身份、记录版本和核验依据')
    const key = payrollCanonical([row.entityType, row.legacyId])
    if (seen.has(key))
      failure('同一原身份不能重复选择或匹配到多个目标')
    seen.add(key)
  }
  return raw as unknown as PayrollImportInput
}
async function references(db: TransactionDb, actor: BusinessSession): Promise<PayrollImportReference[]> {
  const masters = await loadProductionCrewWorkers(db, actor)
  const rows: PayrollImportReference[] = (await db.select<{ id: string, name: string, version: number, draft_json: string, deleted_at: string | null }>('SELECT id,name,version,draft_json,deleted_at FROM projects ORDER BY id')).map(row => ({ entityType: 'projects', serverId: row.id, label: row.name, version: String(row.version), sourceVersion: hash(row), deleted: row.deleted_at !== null }))
  for (const [entityType, values] of [['crews', masters.crews], ['workers', masters.workers]] as const) {
    for (const row of values.values())
      rows.push({ entityType, serverId: row.id, label: row.draft.name ?? row.id, version: String(row.version), sourceVersion: hash(row), deleted: !!row.deletedAt })
  }
  return rows
}
/** Known projections serve runtime; these independent raw values retain every owned SQL column. */
async function sourceEvidence(db: TransactionDb, graphs: PayrollProjectGraph[]) {
  const names = new Set((await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  const selections = new Map<string, { table: string, keys: string[], ids: Set<string> }>()
  const add = (table: string, keys: string[], ids: string[]) => {
    if (!names.has(table)) {
      if (ids.length)
        failure(`原工资 ${table} 已有引用但缺少实表，不能裁剪来源`)
      return
    }
    const entry = selections.get(table) ?? { table, keys, ids: new Set<string>() }
    ids.forEach(id => entry.ids.add(id))
    selections.set(table, entry)
  }
  for (const graph of graphs) {
    for (const part of PAYROLL_MIGRATION_PARTS)
      add(PAYROLL_MIGRATION_TABLES[part], ['id'], graph[part].map(row => String(row.id)))
    for (const [table, rows] of Object.entries(graph.central?.tables ?? {}))
      add(table, [payrollCentralPrimaryKey(table as Parameters<typeof payrollCentralPrimaryKey>[0])], rows.map(row => String(row[payrollCentralPrimaryKey(table as Parameters<typeof payrollCentralPrimaryKey>[0])])))
    for (const [table, rows] of Object.entries(graph.fees?.tables ?? {}))
      add(table, [payrollAFeesPrimaryKey(table as Parameters<typeof payrollAFeesPrimaryKey>[0])], rows.map(row => String(row[payrollAFeesPrimaryKey(table as Parameters<typeof payrollAFeesPrimaryKey>[0])])))
    for (const [table, rows] of Object.entries(graph.deductions?.tables ?? {}))
      add(table, ['id'], rows.map(row => String(row.id)))
    for (const [table, rows] of Object.entries(graph.numbering?.tables ?? {}))
      add(table, ['id'], rows.map(row => String(row.id)))
    for (const [table, rows] of Object.entries(graph.coordination?.tables ?? {}))
      add(table, [table === 'payroll_batch_command_receipts' ? 'command_id' : 'id'], rows.map(row => String(row[table === 'payroll_batch_command_receipts' ? 'command_id' : 'id'])))
    for (const [table, rows] of Object.entries(graph.publication?.tables ?? {})) {
      const keys = table.endsWith('_receipts') ? ['workspace_id', 'actor_id', 'command_id'] : table === 'payroll_workbook_references' ? ['archive_id', 'table_name', 'record_id'] : ['id']
      add(table, keys, rows.map(row => publicationRowId(table as Parameters<typeof publicationRowId>[0], row)))
    }
    add('payroll_publication_migration_proofs', ['table_name', 'record_id'], (graph.publication?.origins ?? []).map(row => JSON.stringify([row.tableName, row.recordId])))
  }
  return captureMigrationDomainRows(db, [...selections.values()].map(row => ({ ...row, ids: [...row.ids] })))
}
export function createProductionPayrollImport(storage: ProductionStorage) {
  function authorize(session: Session) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !['payroll:read', 'payroll:write', 'core:migration:write', 'project:list:read', 'worker:list:read', 'crew:list:read'].every(capability => actor.capabilities.includes(capability)))
      throw payrollProblem('forbidden', '当前身份无完整正式工资迁入权限')
    return structuredClone(actor)
  }
  const recheck = (session: Session, actor: BusinessSession) => {
    if (hash(authorize(session)) !== hash(actor))
      throw payrollProblem('forbidden', '工资迁入期间身份或权限已变化，原图保持不变')
  }
  return {
    async state(session: Session) {
      const actor = authorize(session)
      return storage.withTransaction(async (db) => {
        await validateProductionPayrollState(db)
        const refs = await references(db, actor)
        const sources = await db.select<{ source_sha256: string, schema_version: number, created_at: string }>('SELECT source_sha256,schema_version,created_at FROM payroll_source_imports ORDER BY created_at,source_sha256')
        recheck(session, actor)
        return { context: actor, references: refs, sources: sources.map(row => ({ sourceSha256: row.source_sha256, schemaVersion: row.schema_version, adoptedAt: row.created_at })) }
      })
    },
    async execute(raw: unknown, session: Session): Promise<PayrollImportPreview | PayrollImportResult> {
      const actor = authorize(session)
      const command = input(raw)
      if (command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId)
        throw payrollProblem('forbidden', '工资迁入原命令不属于当前工作区及操作者')
      return withVerifiedMigrationSnapshot(command.source, async (sourceDb, source) => {
        if (source.schemaVersion < 47 || source.schemaVersion > 60)
          failure('该来源版本尚无完整工资图适配，请保留原文件并使用匹配发布物')
        const roots = await readPayrollProjectMigrationGraphs(sourceDb, { captureUnknownColumns: true })
        const graphs = roots.map(row => parsePayrollProjectGraph(JSON.parse(String(row.attributes?.payrollGraphJson)), row.legacyId))
        if (graphs.some(graph => graph.publication?.tables.worker_roster_archives.length) && !actor.capabilities.includes('worker:sensitive:read'))
          throw payrollProblem('forbidden', '完整来源包含固定实名名册，须另有工人私密资料权限')
        const modern = await readWorkerModernGraphs(sourceDb)
        const rawDomain = await sourceEvidence(sourceDb, graphs)
        const nativeMasters = { projects: await sourceDb.select<{ id: string, name: string }>('SELECT id,name FROM projects'), crews: await sourceDb.select<{ id: string, name: string }>('SELECT id,name FROM crews'), workers: await sourceDb.select<{ id: string, name: string }>('SELECT id,name FROM workers') }
        const required = new Map<string, { entityType: PayrollImportMapping['entityType'], legacyId: string, label: string }>()
        for (const graph of graphs) {
          required.set(payrollCanonical(['projects', graph.projectId]), { entityType: 'projects', legacyId: graph.projectId, label: nativeMasters.projects.find(row => row.id === graph.projectId)?.name ?? graph.projectId })
          for (const rows of [graph.configs, graph.statements, graph.lines, graph.members, graph.allocations, graph.attendance, graph.daywork, ...Object.values(graph.central?.tables ?? {}), ...Object.values(graph.fees?.tables ?? {})]) {
            for (const row of rows) {
              for (const [field, entityType] of [['worker_id', 'workers'], ['leader_worker_id', 'workers'], ['manager_worker_id', 'workers'], ['crew_id', 'crews']] as const) {
                if (typeof row[field] === 'string' && row[field])
                  required.set(payrollCanonical([entityType, row[field]]), { entityType, legacyId: row[field], label: nativeMasters[entityType].find(master => master.id === row[field])?.name ?? row[field] })
              }
            }
          }
        }
        return storage.withTransaction(async (db) => {
          const proof = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: command.commandId, action: 'adopt', sourceSha256: source.sha256, referenceMappings: command.referenceMappings }
          const fingerprint = hash(proof)
          const [journal] = await db.select<{ family: string, fingerprint: string, outcome: string, result_json: string | null }>('SELECT family,fingerprint,outcome,result_json FROM payroll_command_journal WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, command.commandId])
          if (journal) {
            if (journal.family !== 'payroll-import' || journal.outcome !== 'applied' || journal.fingerprint !== fingerprint)
              throw payrollProblem('conflict', '工资迁入原编号已绑定另一请求或已明确封存')
            return JSON.parse(journal.result_json!) as PayrollImportResult
          }
          const current = await references(db, actor)
          const reasons: string[] = []
          const entities: CoreMigrationServerEntityDTO[] = []
          for (const requiredRef of required.values()) {
            const mapping = command.referenceMappings.find(row => row.entityType === requiredRef.entityType && row.legacyId === requiredRef.legacyId)
            const target = mapping && current.find(row => row.entityType === mapping.entityType && row.serverId === mapping.serverId)
            if (!mapping || !target || target.version !== mapping.version || target.sourceVersion !== mapping.sourceVersion) {
              reasons.push(`${requiredRef.label} 缺少明确映射或实际目标版本已变化`)
              continue
            }
            entities.push({ entityType: requiredRef.entityType, id: target.serverId, legacyId: requiredRef.legacyId, name: target.label, references: {}, quantity: null, amount: null, attributes: requiredRef.entityType === 'workers' && modern.has(requiredRef.legacyId) ? { workerRosterGraphJson: JSON.stringify(modern.get(requiredRef.legacyId)) } : {}, deletedAt: target.deleted ? 'retained-hidden-master' : null, batchId: source.sha256 })
          }
          for (const root of roots) {
            const parent = entities.find(row => row.entityType === 'projects' && row.legacyId === root.legacyId)
            if (parent)
              entities.push({ entityType: 'payroll_projects', id: `payroll-import-${hash([actor.workspaceId, parent.id, root.legacyId]).slice(0, 32)}`, legacyId: root.legacyId, name: root.name, references: { projectId: parent.id }, quantity: null, amount: null, attributes: root.attributes ?? {}, deletedAt: null, batchId: source.sha256 })
          }
          let qty: Awaited<ReturnType<typeof readProductionQuantityImportedIdentities>> = []
          const qtyProjects: PayrollAdoptedQuantityProject[] = []
          if (graphs.some(graph => graph.central?.tables.payroll_a_price_revisions.length || graph.fees?.tables.payroll_a_management_book_revisions.length || graph.deductions)) {
            try {
              qty = await readProductionQuantityImportedIdentities(db, source.sha256, actor)
              for (const project of await readProductionQuantityImportedProjects(db, source.sha256, actor)) {
                qtyProjects.push({ namespace: project.namespace, legacyProjectId: project.legacyProjectId, projectId: project.projectId, hollow: project.sourceGraph.version === 2 ? project.sourceGraph.hollow : null })
              }
            }
            catch { reasons.push('原A施工、管理范围或空鼓须先由同一真实来源的工程量owner完整确认采用；本批工资未修改') }
          }
          const assetMappings: PayrollIdentityMapping[] = []
          for (const entity of entities.filter(row => row.entityType === 'workers')) {
            for (const asset of modern.get(entity.legacyId)?.tables.worker_roster_assets ?? []) {
              const [adopted] = await db.select<{ id: string, file_ref_id: string, sha256: string }>('SELECT id,file_ref_id,sha256 FROM worker_roster_assets WHERE worker_id=? AND id=?', [entity.id, asset.id])
              if (!adopted || adopted.sha256 !== asset.sha256) {
                reasons.push(`工人 ${entity.name} 的原照片身份、摘要尚未由既有工人owner完整接管`)
                continue
              }
              await productionWorkerOriginals.assets(db, entity.id)
              assetMappings.push({ tableName: 'worker_roster_assets', legacyId: String(asset.id), centralId: adopted.id }, { tableName: 'file_refs', legacyId: String(asset.file_ref_id), centralId: adopted.file_ref_id })
            }
          }
          const preview: PayrollImportPreview = { sourceSha256: source.sha256, schemaVersion: source.schemaVersion, eligible: reasons.length === 0 && graphs.length > 0, projects: roots.map(root => ({ legacyId: root.legacyId, label: root.name })), requiredReferences: [...required.values()], blockingReasons: reasons, diagnostics: [] }
          if (!preview.eligible) {
            if (command.action === 'adopt')
              failure(reasons.join('；') || '来源没有可接管的完整工资项目图')
            recheck(session, actor)
            return preview
          }
          const [existing] = await db.select<{ evidence_json: string }>('SELECT evidence_json FROM payroll_source_imports WHERE source_sha256=?', [source.sha256])
          if (existing) {
            const evidence = JSON.parse(existing.evidence_json) as { referenceMappings: PayrollImportMapping[], result: PayrollImportResult }
            if (hash(evidence.referenceMappings.map(row => [row.entityType, row.legacyId, row.serverId]).sort()) !== hash(command.referenceMappings.map(row => [row.entityType, row.legacyId, row.serverId]).sort()))
              throw payrollProblem('conflict', '同一原工资文件已有另一组明确映射，不能重接身份')
            if (command.action === 'preview')
              return preview
            const result = { ...evidence.result, commandId: command.commandId }
            await db.execute('INSERT INTO payroll_command_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [actor.workspaceId, actor.actorId, command.commandId, 'payroll-import', 'adopt', null, source.sha256, fingerprint, payrollCanonical(proof), 'applied', payrollCanonical(result), new Date().toISOString()])
            recheck(session, actor)
            return result
          }
          const reusedStatementIds: string[] = []
          const reusedProjectIds: string[] = []
          const newEntities = [...entities]
          for (const entity of entities.filter(row => row.entityType === 'payroll_projects')) {
            const [previous] = await db.select<{ source_graph_json: string, mapping_json: string, project_id: string }>('SELECT source_graph_json,mapping_json,project_id FROM payroll_migration_evidence WHERE entity_id=?', [entity.id])
            if (!previous)
              continue
            if (previous.project_id !== entity.references.projectId || hash(JSON.parse(previous.source_graph_json)) !== hash(JSON.parse(String(entity.attributes.payrollGraphJson))))
              throw payrollProblem('conflict', '该原项目工资图已接管且来源后来变化，不能复制第二份成本现金或覆盖现行更正；请核对原受保护来源')
            newEntities.splice(newEntities.indexOf(entity), 1)
            reusedProjectIds.push(previous.project_id)
            const mappings = JSON.parse(previous.mapping_json) as PayrollIdentityMapping[]
            reusedStatementIds.push(...mappings.filter(row => row.tableName === 'wage_statements' && row.centralId).map(row => row.centralId!))
          }
          const plan = planPayrollMigration({ authority: 'central', activeBatchId: source.sha256, entities: newEntities }, new Map(), qty, assetMappings, qtyProjects)
          preview.diagnostics = plan.incoming.flatMap(project => project.diagnostics.map(row => row.message))
          await db.execute('SAVEPOINT payroll_import_candidate')
          try {
            await db.execute('PRAGMA defer_foreign_keys=ON')
            await applyPayrollMigration(db, plan, { mastersAlreadyAdopted: true })
            await validateProductionPayrollState(db)
            if (command.action === 'preview') {
              await db.execute('ROLLBACK TO payroll_import_candidate')
              await db.execute('RELEASE payroll_import_candidate')
              recheck(session, actor)
              return preview
            }
            storage.assertBusinessWrite()
            const result: PayrollImportResult = { commandId: command.commandId, sourceSha256: source.sha256, projectIds: [...new Set([...reusedProjectIds, ...plan.incoming.map(project => project.projectId)])], statementIds: [...reusedStatementIds, ...plan.incoming.flatMap(project => project.graph.statements.map(row => String(row.id)))], adoptedAt: new Date().toISOString(), retainedCoordination: graphs.some(graph => !!graph.coordination) }
            const evidence = { sourceSha256: source.sha256, sourceGraphHash: hash(graphs), domainEvidence: rawDomain, domainEvidenceDigest: hash(rawDomain), schemaVersion: source.schemaVersion, actorId: actor.actorId, workspaceId: actor.workspaceId, referenceMappings: command.referenceMappings, importedMappings: plan.incoming.flatMap(project => project.mappings), result }
            await db.execute('INSERT INTO payroll_source_imports VALUES(?,?,?,?,?)', [source.sha256, source.schemaVersion, payrollCanonical(graphs), payrollCanonical(evidence), result.adoptedAt])
            await db.execute('INSERT INTO payroll_command_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [actor.workspaceId, actor.actorId, command.commandId, 'payroll-import', 'adopt', null, source.sha256, fingerprint, payrollCanonical(proof), 'applied', payrollCanonical(result), result.adoptedAt])
            await validateProductionPayrollState(db)
            await db.execute('RELEASE payroll_import_candidate')
            recheck(session, actor)
            return result
          }
          catch (cause) {
            await db.execute('ROLLBACK TO payroll_import_candidate')
            await db.execute('RELEASE payroll_import_candidate')
            throw cause
          }
        })
      })
    },
    async resolve(commandId: string, session: Session) {
      const actor = authorize(session)
      if (!/^[a-z0-9][\w-]{2,79}$/i.test(commandId))
        failure('工资迁入原编号格式无效')
      return storage.withTransaction(async (db) => {
        const parameters = [actor.workspaceId, actor.actorId, commandId]
        const [row] = await db.select<{ family: string, outcome: string, result_json: string | null }>('SELECT family,outcome,result_json FROM payroll_command_journal WHERE workspace_id=? AND actor_id=? AND command_id=?', parameters)
        if (row?.family !== undefined && row.family !== 'payroll-import')
          throw payrollProblem('conflict', '该原编号属于另一工资动作，不能借迁入恢复')
        if (!row)
          await db.execute('INSERT INTO payroll_command_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [...parameters, 'payroll-import', 'adopt', null, '', 'sealed', null, 'not-applied', null, new Date().toISOString()])
        recheck(session, actor)
        return row?.outcome === 'applied' ? { outcome: 'applied' as const, result: JSON.parse(row.result_json!) as PayrollImportResult } : { outcome: 'not-applied' as const, commandId }
      })
    },
  }
}
