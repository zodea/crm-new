import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { ScheduleEngineAdapters } from '../../app/lib/schedule/engine'
import type { ScheduleProcessLibraryOption, ScheduleProcessLibraryTask } from '../../app/lib/schedule/process-library'
import type { BusinessSession } from './business-session'
import type { ProjectRow } from './production-project-record'
import { createHash } from 'node:crypto'
import { undoOperationIfUnchanged } from '../../app/lib/db/soft-delete'
import { parseWbsMigrationGraph, WBS_MIGRATION_COLUMNS, WBS_MIGRATION_TABLES } from '../../app/lib/migration/wbs-source'
import { scheduleProblem } from '../../app/lib/schedule/central-contract'
import { assertScheduleDependencyGraph } from '../../app/lib/schedule/central-invariants'
import { readProductionProcessLibraryState } from './production-process-library-record'
import { projectDraft } from './production-project-record'
import { validateProductionQuantityState } from './production-quantity-validation'
import { productionScheduleVisibility as productionWbsVisibility } from './production-schedule-visibility'
import { productionWbsBuildingCoverage, productionWbsContract, productionWbsContracts, productionWbsLinesByItem, productionWbsProjectRead } from './production-wbs-boq-sources'
import { productionWbsFiles } from './production-wbs-files'
import { parseScheduleCommand } from './schedule-request'

export { productionScheduleVisibility as productionWbsVisibility } from './production-schedule-visibility'
export const WBS_INSTANCE_TABLES = ['schedule_groups', 'schedule_group_buildings', 'schedule_tasks', 'task_item_map', 'task_dependencies', 'schedule_task_floor_plans'] as const
export const wbsCanonical = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry)
export const wbsDigest = (value: unknown) => createHash('sha256').update(wbsCanonical(value)).digest('hex')
type Row = Record<string, unknown>

export async function productionWbsProject(tx: TransactionDb, id: string, archived = false) {
  const row = (await tx.select<ProjectRow>('SELECT * FROM projects WHERE id=?', [id]))[0]
  if (!row || (!archived && row.deleted_at !== null))
    throw scheduleProblem('not-found', '原排程项目不存在或已经删除')
  projectDraft(row)
  return row
}
export async function productionWbsGraph(tx: TransactionDb, projectId: string) {
  const graph: Record<string, Row[]> = {}
  graph.schedule_groups = await tx.select<Row>('SELECT * FROM schedule_groups WHERE project_id=? ORDER BY id', [projectId])
  graph.schedule_tasks = await tx.select<Row>('SELECT * FROM schedule_tasks WHERE project_id=? ORDER BY id', [projectId])
  graph.schedule_group_buildings = await tx.select<Row>('SELECT b.* FROM schedule_group_buildings b JOIN schedule_groups g ON g.id=b.group_id WHERE g.project_id=? ORDER BY b.id', [projectId])
  graph.task_item_map = await tx.select<Row>('SELECT m.* FROM task_item_map m JOIN schedule_tasks t ON t.id=m.task_id WHERE t.project_id=? ORDER BY m.id', [projectId])
  graph.task_dependencies = await tx.select<Row>('SELECT d.* FROM task_dependencies d JOIN schedule_tasks t ON t.id=d.succ_id WHERE t.project_id=? ORDER BY d.id', [projectId])
  graph.schedule_task_floor_plans = await tx.select<Row>('SELECT f.* FROM schedule_task_floor_plans f JOIN schedule_tasks t ON t.id=f.task_id WHERE t.project_id=? ORDER BY f.id', [projectId])
  graph.schedule_floor_quantity_snapshots = await tx.select<Row>('SELECT * FROM schedule_floor_quantity_snapshots WHERE project_id=? ORDER BY id', [projectId])
  return graph
}
export async function advanceProductionWbsRevision(tx: TransactionDb, projectId: string) {
  await tx.execute('INSERT INTO schedule_revisions(project_id,revision,fingerprint) VALUES (?,1,?) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1,fingerprint=excluded.fingerprint', [projectId, wbsDigest(await productionWbsGraph(tx, projectId))])
}
/** A legacy receipt without a trusted complete intent remains evidence of an unknown outcome, never proof of absence. */
export async function productionWbsLegacyCommandExists(tx: TransactionDb, commandId: string) {
  for (const row of await tx.select<{ evidence_json: string }>('SELECT evidence_json FROM schedule_source_imports')) {
    const evidence = JSON.parse(row.evidence_json)
    if (['schedule_command_receipts', 'schedule_command_intents'].some(table => evidence.rawDomain[table]?.some((row: { legacyId: string, columns: { command_id?: { exactValue: string | null } } }) => row.legacyId === commandId || row.columns.command_id?.exactValue === commandId)))
      return true
  }
  return false
}
export async function verifyProductionWbsState(tx: TransactionDb, actor: Pick<BusinessSession, 'workspaceId' | 'actorId'>) {
  const domain = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'wbs\''))[0]
  if (domain?.schema_version !== 1)
    throw scheduleProblem('unavailable', '正式WBS参与者尚未登记，不能使用开发排程替代')
  await validateProductionQuantityState(tx)
  await readProductionProcessLibraryState(tx, actor)
  const projects = new Set((await tx.select<{ project_id: string }>('SELECT project_id FROM schedule_groups UNION SELECT project_id FROM schedule_tasks')).map(row => row.project_id))
  const revisions = await tx.select<{ project_id: string, revision: number, fingerprint: string }>('SELECT * FROM schedule_revisions')
  for (const projectId of projects) {
    const revision = revisions.find(row => row.project_id === projectId)
    if (!revision || !Number.isSafeInteger(revision.revision) || revision.revision < 1 || revision.fingerprint !== wbsDigest(await productionWbsGraph(tx, projectId)))
      throw scheduleProblem('unavailable', 'WBS完整事实图与持久版本证据不一致')
    await productionWbsProject(tx, projectId, true)
    const graph = await productionWbsGraph(tx, projectId)
    parseWbsMigrationGraph({ version: 1, projectId, tables: Object.fromEntries(WBS_MIGRATION_TABLES.map(table => [table, table === 'operation_logs' ? [] : graph[table]!.map(row => Object.fromEntries(WBS_MIGRATION_COLUMNS[table].map(column => [column, row[column]])))])) })
    await assertScheduleDependencyGraph(tx, projectId, productionWbsVisibility)
  }
  for (const row of revisions) {
    if (!projects.has(row.project_id) && row.fingerprint !== wbsDigest(await productionWbsGraph(tx, row.project_id)))
      throw scheduleProblem('unavailable', '空排程的原持久版本证据不一致')
  }
  for (const receipt of await tx.select<{ command_id: string, project_id: string, actor_id: string, fingerprint: string, result_json: string }>('SELECT * FROM schedule_command_receipts')) {
    const original = (await tx.select<{ request_json: string, fingerprint: string }>('SELECT * FROM schedule_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, receipt.command_id]))[0]
    if (!original || receipt.actor_id !== actor.actorId)
      throw scheduleProblem('unavailable', 'WBS原回执缺少相同可信身份的原意图')
    let command, result
    try {
      command = parseScheduleCommand(JSON.parse(original.request_json))
      result = JSON.parse(receipt.result_json)
    }
    catch { throw scheduleProblem('unavailable', 'WBS原请求或回执损坏') }
    if (command.commandId !== receipt.command_id || command.projectId !== receipt.project_id || command.workspaceId !== actor.workspaceId || command.actorId !== actor.actorId || original.fingerprint !== receipt.fingerprint || wbsDigest(command) !== receipt.fingerprint || result.commandId !== command.commandId || result.projectId !== command.projectId || typeof result.sourceVersion !== 'string')
      throw scheduleProblem('unavailable', 'WBS原编号、正文、身份或结果无法互证')
  }
  const storedImports = await tx.select<Row>('SELECT * FROM schedule_source_imports')
  for (const imported of storedImports) {
    let evidence
    try {
      evidence = JSON.parse(String(imported.evidence_json))
    }
    catch { throw scheduleProblem('unavailable', 'WBS来源领域图损坏') }
    if (wbsDigest(evidence) !== imported.evidence_sha256 || evidence.domainDigest !== wbsDigest(evidence.rawDomain))
      throw scheduleProblem('unavailable', 'WBS不可变来源图与摘要不一致')
  }
  const intents = await tx.select<Row>('SELECT * FROM schedule_command_intents')
  for (const intent of intents) {
    const command = parseScheduleCommand(JSON.parse(String(intent.request_json)))
    if (intent.workspace_id !== actor.workspaceId || intent.actor_id !== actor.actorId || intent.command_id !== command.commandId || intent.project_id !== command.projectId || intent.fingerprint !== wbsDigest(command))
      throw scheduleProblem('unavailable', 'WBS持久原意图身份或完整指纹损坏')
  }
  const resolved = await tx.select<Row>('SELECT * FROM schedule_command_resolutions')
  for (const row of resolved) {
    const descriptor = JSON.parse(String(row.descriptor_json))
    const original = intents.find(intent => intent.command_id === row.command_id)
    const command = original && parseScheduleCommand(JSON.parse(String(original.request_json)))
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || descriptor.commandId !== row.command_id || descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId || descriptor.family !== 'schedule' || (command && (descriptor.targetId !== command.projectId || descriptor.action !== command.action.kind)) || (await tx.select('SELECT command_id FROM schedule_command_receipts WHERE command_id=?', [row.command_id]))[0])
      throw scheduleProblem('unavailable', 'WBS原封存定位、身份或回执相互矛盾')
  }
  const importIntents = await tx.select<Row>('SELECT * FROM schedule_import_intents')
  for (const row of importIntents) {
    const proof = JSON.parse(String(row.request_proof_json))
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || proof.commandId !== row.command_id || proof.workspaceId !== actor.workspaceId || proof.actorId !== actor.actorId || proof.action !== row.action || wbsDigest(proof) !== row.fingerprint || Object.hasOwn(proof, 'source') || Object.hasOwn(proof, 'payloadBase64'))
      throw scheduleProblem('unavailable', 'WBS迁入原意图证明缺失、串身份或误含整库正文')
  }
  for (const receipt of await tx.select<Row>('SELECT * FROM schedule_import_commands')) {
    const original = importIntents.find(row => row.command_id === receipt.command_id)
    const result = JSON.parse(String(receipt.result_json))
    if (!original || receipt.workspace_id !== actor.workspaceId || receipt.actor_id !== actor.actorId || receipt.action !== original.action || receipt.fingerprint !== original.fingerprint || result.commandId !== receipt.command_id || !Array.isArray(result.projectIds) || !Array.isArray(result.groupIds) || !Array.isArray(result.taskIds) || (await tx.select('SELECT command_id FROM schedule_import_resolutions WHERE command_id=?', [receipt.command_id]))[0])
      throw scheduleProblem('unavailable', 'WBS迁入原回执与原意图或封存矛盾')
    const batch = storedImports.find(row => row.id === result.importId)
    const evidence = batch && JSON.parse(String(batch.evidence_json))
    const proof = JSON.parse(String(original.request_proof_json))
    const groups = evidence?.originalGraphs.flatMap((row: { graph: { tables: { schedule_groups: { id: string }[] } } }) => row.graph.tables.schedule_groups.map(group => group.id))
    const tasks = evidence?.originalGraphs.flatMap((row: { graph: { tables: { schedule_tasks: { id: string }[] } } }) => row.graph.tables.schedule_tasks.map(task => task.id))
    if (!batch || batch.workspace_id !== actor.workspaceId || batch.actor_id !== actor.actorId || result.sourceSha256 !== batch.source_sha256 || evidence.sourceSha256 !== batch.source_sha256 || wbsDigest(result.projectIds) !== wbsDigest(evidence.projectIds) || wbsDigest(result.groupIds) !== wbsDigest(groups) || wbsDigest(result.taskIds) !== wbsDigest(tasks) || (receipt.action === 'adopt' ? proof.sourceSha256 !== result.sourceSha256 || batch.command_id !== receipt.command_id || batch.result_json !== receipt.result_json || Boolean(result.restored) : proof.importId !== result.importId || result.restored !== true))
      throw scheduleProblem('unavailable', 'WBS接管批次身份、原图范围与原回执不能互证')
  }
  for (const batch of storedImports) {
    if (!(await tx.select('SELECT command_id FROM schedule_import_commands WHERE command_id=? AND action=\'adopt\' AND result_json=?', [batch.command_id, batch.result_json]))[0])
      throw scheduleProblem('unavailable', 'WBS来源批次缺少完全相同的原接管回执')
  }
  for (const restored of await tx.select<Row>('SELECT * FROM schedule_import_restores')) {
    const receipt = (await tx.select<Row>('SELECT * FROM schedule_import_commands WHERE command_id=?', [restored.command_id]))[0]
    const result = JSON.parse(String(restored.result_json))
    const batch = storedImports.find(row => row.id === restored.import_id)
    if (!receipt || !batch || receipt.action !== 'restore' || receipt.result_json !== restored.result_json || result.importId !== restored.import_id || result.commandId !== restored.command_id || result.restored !== true || restored.workspace_id !== actor.workspaceId || restored.actor_id !== actor.actorId)
      throw scheduleProblem('unavailable', 'WBS整批恢复标记缺少相同范围与身份的原回执')
  }
  for (const row of await tx.select<Row>('SELECT * FROM schedule_import_resolutions')) {
    const descriptor = JSON.parse(String(row.descriptor_json))
    const original = importIntents.find(intent => intent.command_id === row.command_id)
    const proof = original && JSON.parse(String(original.request_proof_json))
    if (row.workspace_id !== actor.workspaceId || row.actor_id !== actor.actorId || descriptor.commandId !== row.command_id || descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId || descriptor.family !== 'schedule-import' || descriptor.targetId !== null || typeof descriptor.scopeId !== 'string' || (proof && (descriptor.action !== original!.action || descriptor.scopeId !== (proof.action === 'adopt' ? proof.sourceSha256 : proof.importId))))
      throw scheduleProblem('unavailable', 'WBS迁入原封存定位或身份不完整')
  }
  return { metadataOnlyFileIds: (await productionWbsFiles(tx)).metadataOnlyFileIds }
}
export function productionWbsEngineAdapters(actor: BusinessSession): ScheduleEngineAdapters {
  const libraryState = (tx: TransactionDb) => readProductionProcessLibraryState(tx, actor)
  return {
    actorId: actor.actorId,
    undo: (tx, id) => undoOperationIfUnchanged(tx, id, actor.actorId),
    visibility: productionWbsVisibility,
    async libraries(tx): Promise<ScheduleProcessLibraryOption[]> {
      const state = await libraryState(tx)
      return Promise.all(state.versions.map(async library => ({ id: library.id, code: library.code, name: library.name, version: library.version, description: library.description, isDefault: false, taskCount: library.tasks.length, sourceVersion: library.sourceVersion, usageCount: (await tx.select<{ n: number }>('SELECT COUNT(*) AS n FROM schedule_groups WHERE process_library_id=? AND deleted_at IS NULL', [library.id]))[0]!.n })))
    },
    async libraryTasks(tx, id): Promise<ScheduleProcessLibraryTask[]> {
      const state = await libraryState(tx)
      const version = state.versions.find(row => row.id === id)
      if (!version)
        throw scheduleProblem('not-found', '所选正式不可变工序库版本不存在')
      return version.tasks.map(task => ({ id: task.id, libraryId: version.id, libraryVersion: version.version, sortOrder: task.sortOrder, key: task.key, name: task.name, durationDays: task.durationDays, trade: task.trade, color: task.color, stageCode: task.stageCode ?? '', itemCodes: task.itemCodes, predecessorKey: task.predecessorKey, predecessorDisabled: task.predecessorDisabled }))
    },
    async catalog(tx) {
      const rows = await tx.select<ProjectRow>('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at DESC,id')
      return Promise.all(rows.map(async row => ({ id: row.id, name: row.name, code: row.code, status: projectDraft(row).status ?? '', groupCount: (await tx.select<{ n: number }>(`${productionWbsVisibility.hiddenCtesFor('schedule_groups')} SELECT COUNT(*) AS n FROM schedule_groups WHERE project_id=? AND ${productionWbsVisibility.visibleCond('schedule_groups')}`, [row.id]))[0]!.n })))
    },
    async buildings(tx, projectId, contractId = '') {
      if (contractId)
        return (await productionWbsBuildingCoverage(tx, actor, projectId, contractId)).filter(row => row.inContract && !row.scheduled).map(({ id, projectId, code, name }) => ({ id, projectId, code, name }))
      return tx.select(`${productionWbsVisibility.hiddenCtesFor('buildings', 'schedule_group_buildings')}
        SELECT b.id,b.project_id AS projectId,b.code,b.name FROM buildings b WHERE b.project_id=? AND ${productionWbsVisibility.visibleCond('buildings', 'b')}
        AND NOT EXISTS(SELECT 1 FROM schedule_group_buildings s WHERE s.building_id=b.id AND ${productionWbsVisibility.visibleCond('schedule_group_buildings', 's')}) ORDER BY b.sort_order,b.code,b.id`, [projectId])
    },
    contracts: (tx, projectId) => productionWbsContracts(tx, actor, projectId),
    buildingCoverage: (tx, projectId, id) => productionWbsBuildingCoverage(tx, actor, projectId, id),
    contractReference: (tx, projectId, id) => productionWbsContract(tx, actor, projectId, id),
    boqLinesByItem: (tx, projectId, id, items, buildings) => productionWbsLinesByItem(tx, actor, projectId, id, items, buildings),
    project: (tx, projectId, today) => productionWbsProjectRead(tx, actor, projectId, today),
  }
}
