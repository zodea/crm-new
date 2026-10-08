import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CommandRecoveryDescriptor } from '../../app/lib/forms/command-recovery'
import type { WbsMigrationGraph, WbsMigrationTable } from '../../app/lib/migration/wbs-source'
import type { WbsImportCommand, WbsImportPreview, WbsImportResult, WbsReferenceMapping } from '../../app/lib/schedule/import-contract'
import type { ProcessLibraryVersion } from '../../app/lib/schedule/process-library-contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { LATEST_VERSION } from '../../app/lib/db/migrations'
import { logOperation, softDelete } from '../../app/lib/db/soft-delete'
import { readWbsMigrationGraphs, WBS_MIGRATION_COLUMNS, WBS_MIGRATION_TABLES } from '../../app/lib/migration/wbs-source'
import { scheduleProblem } from '../../app/lib/schedule/central-contract'
import { normalizeProcessLibraryDraft } from '../../app/lib/schedule/process-library-domain'
import { captureMigrationDomainRows } from './migration-domain-evidence'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { readProductionProcessLibraryState } from './production-process-library-record'
import { projectDraft } from './production-project-record'
import { productionWbsFiles, wbsBytesDigest } from './production-wbs-files'
import { advanceProductionWbsRevision, productionWbsGraph, productionWbsVisibility, verifyProductionWbsState, WBS_INSTANCE_TABLES, wbsDigest } from './production-wbs-record'

type Row = Record<string, unknown>
type Session = () => BusinessSession
const referenceTables = ['projects', 'buildings', 'floors', 'items', 'construction_stages'] as const
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
function fail(message: string): never {
  throw scheduleProblem('validation-failed', `完整WBS迁入：${message}`)
}
function request(value: unknown): WbsImportCommand {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'action,actorId,commandId,libraries,originals,references,source,workspaceId' || !['preflight', 'adopt'].includes(String(value.action)) || !['workspaceId', 'actorId', 'commandId'].every(key => typeof value[key] === 'string' && String(value[key]).trim()) || !/^[a-z0-9][\w-]{2,79}$/i.test(String(value.commandId)) || !object(value.source) || !Array.isArray(value.references) || !Array.isArray(value.libraries) || !Array.isArray(value.originals))
    return fail('封套、动作、完整来源与映射格式无效')
  for (const row of value.references) {
    if (!object(row) || Object.keys(row).sort().join(',') !== 'id,legacyId,table,version' || !referenceTables.includes(row.table as WbsReferenceMapping['table']) || !['id', 'legacyId', 'version'].every(key => typeof row[key] === 'string' && String(row[key]).trim()))
      return fail('每项真实祖先须有显式稳定ID与当前版本映射')
  }
  for (const row of value.libraries) {
    if (!object(row) || Object.keys(row).sort().join(',') !== 'id,legacyId,version' || !['id', 'legacyId', 'version'].every(key => typeof row[key] === 'string' && String(row[key]).trim()))
      return fail('工序库须映射已核验的正式不可变版本')
  }
  for (const row of value.originals) {
    if (!object(row) || Object.keys(row).sort().join(',') !== 'fileId,payloadBase64' || typeof row.fileId !== 'string' || typeof row.payloadBase64 !== 'string')
      return fail('补传原件格式无效')
    if (row.payloadBase64.length % 4 !== 0 || !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(row.payloadBase64))
      return fail('补传原件必须为完整规范字节编码')
  }
  if (Object.keys(value.source).sort().join(',') !== 'payloadBase64,sha256' || typeof value.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.source.sha256) || typeof value.source.payloadBase64 !== 'string')
    return fail('来源封套只能提供完整SQLite字节和SHA-256')
  if (new Set(value.references.map(row => JSON.stringify([row.table, row.legacyId]))).size !== value.references.length || new Set(value.libraries.map(row => row.legacyId)).size !== value.libraries.length || new Set(value.originals.map(row => row.fileId)).size !== value.originals.length)
    return fail('显式映射或原件重复')
  return value as unknown as WbsImportCommand
}
function narrowSnapshot(value: unknown, table: WbsMigrationTable) {
  if (value === null)
    return null
  const row = JSON.parse(String(value))
  return JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => (WBS_MIGRATION_COLUMNS[table] as readonly string[]).includes(key))))
}
async function readSource(native: TransactionDb, proof: { sha256: string, schemaVersion: number }) {
  if (proof.schemaVersion < 47 || proof.schemaVersion > LATEST_VERSION)
    return fail('来源版本尚未核验，保留原库，不升级来源')
  const legacyRead: TransactionDb = { execute: async () => fail('来源只读'), async select<T>(sql: string, params?: unknown[]) {
    const rows = await native.select<Row>(sql, params)
    return (/\bFROM operation_logs\b/.test(sql) ? rows.map(row => ({ ...row, before_data: narrowSnapshot(row.before_data, row.table_name as WbsMigrationTable), after_data: narrowSnapshot(row.after_data, row.table_name as WbsMigrationTable) })) : rows) as T[]
  } }
  const entities = await readWbsMigrationGraphs(legacyRead)
  const graphs = entities.map(entity => ({ legacyId: entity.legacyId, name: entity.name, deletedAt: entity.deletedAt ?? null, graph: JSON.parse(String(entity.attributes?.graphJson)) as WbsMigrationGraph }))
  const rows = Object.fromEntries(WBS_MIGRATION_TABLES.map(table => [table, graphs.flatMap(source => source.graph.tables[table])])) as Record<WbsMigrationTable, Row[]>
  const contractReferences: Row[] = []
  for (const group of rows.schedule_groups) {
    if (group.contract_id === null || contractReferences.some(row => row.id === group.contract_id))
      continue
    const original = (await native.select<Row>('SELECT id,project_id,kind,deleted_at FROM contracts WHERE id=?', [group.contract_id]))[0]
    if (!original || original.project_id !== group.project_id || original.kind !== '施工')
      return fail('历史合同编号缺少同项目施工合同原祖先，不能以空占位冒充上游')
    contractReferences.push(original)
  }
  const refs: Array<{ table: WbsReferenceMapping['table'], id: string, projectId: string, name: string, deletedAt: string | null }> = []
  const add = async (table: WbsReferenceMapping['table'], id: unknown, projectId: string) => {
    if (id === null || refs.some(row => row.table === table && row.id === id))
      return
    const record = (await native.select<Row>(`SELECT * FROM ${table} WHERE id=?`, [id]))[0]
    const actualProject = table === 'projects' ? record?.id : table === 'floors' ? (await native.select<Row>('SELECT project_id FROM buildings WHERE id=?', [record?.building_id]))[0]?.project_id : record?.project_id
    if (!record || actualProject !== projectId)
      return fail('每项外部范围引用必须有同项目真实物理祖先')
    refs.push({ table, id: String(id), projectId, name: String(record.name ?? record.code ?? ''), deletedAt: record.deleted_at === null ? null : String(record.deleted_at) })
  }
  for (const source of graphs) {
    await add('projects', source.legacyId, source.legacyId)
    for (const row of source.graph.tables.schedule_group_buildings)
      await add('buildings', row.building_id, source.legacyId)
    for (const row of source.graph.tables.schedule_tasks)
      await add('construction_stages', row.stage_id, source.legacyId)
    for (const row of [...source.graph.tables.task_item_map, ...source.graph.tables.schedule_task_floor_plans])
      await add('items', row.item_id, source.legacyId)
    for (const row of source.graph.tables.schedule_task_floor_plans)
      await add('floors', row.floor_id, source.legacyId)
  }
  const libraryIds = [...new Set(rows.schedule_groups.map(row => row.process_library_id).filter((id): id is string => typeof id === 'string'))]
  const libraries = []
  for (const id of libraryIds) {
    const library = (await native.select<Row>('SELECT * FROM schedule_process_libraries WHERE id=?', [id]))[0]
    if (!library)
      return fail('原组引用的完整工序库版本缺失')
    const tasks = await native.select<Row>('SELECT * FROM schedule_process_library_tasks WHERE library_id=? ORDER BY sort_order,id', [id])
    libraries.push({ row: library, tasks })
  }
  const files = await native.select<Row>('SELECT * FROM file_refs WHERE owner_type IN(\'schedule_group\',\'schedule_task\') ORDER BY id')
  if (files.some(file => !rows[file.owner_type === 'schedule_group' ? 'schedule_groups' : 'schedule_tasks'].some(owner => owner.id === file.owner_id)))
    return fail('WBS原件目录缺少真实原任务或分组祖先，不能截取有效部分')
  const bodies = []
  for (const file of files) {
    const body = (await native.select<Row>('SELECT * FROM file_payloads WHERE file_ref_id=?', [file.id]))[0]
    if (body && (body.encoding !== 'base64' || typeof body.content !== 'string' || Buffer.from(body.content, 'base64').toString('base64') !== body.content))
      return fail('来源原件编码无法完整证明')
    bodies.push({ fileId: String(file.id), payloadBase64: body ? String(body.content) : null })
  }
  const snapshotRows = (await native.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'schedule_floor_quantity_snapshots\'')).length ? await native.select<Row>('SELECT * FROM schedule_floor_quantity_snapshots ORDER BY id') : []
  const snapshots = snapshotRows.filter(row => rows.schedule_task_floor_plans.some(floor => floor.id === row.id))
  const journals = []
  for (const table of ['schedule_command_receipts', 'schedule_command_intents', 'schedule_revisions']) {
    if (!(await native.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?', [table])).length)
      continue
    const owned = (await native.select<Row>(`SELECT * FROM ${table}`)).filter(row => graphs.some(graph => graph.legacyId === row.project_id))
    const columns = await native.select<{ name: string }>(`PRAGMA table_info(${table})`)
    const keys = table === 'schedule_command_intents' && ['workspace_id', 'actor_id', 'command_id'].every(key => columns.some(column => column.name === key)) ? ['workspace_id', 'actor_id', 'command_id'] : [table === 'schedule_revisions' ? 'project_id' : 'command_id']
    journals.push({ table, keys, ids: owned.map(row => keys.length === 1 ? String(row[keys[0]!]) : JSON.stringify(keys.map(key => String(row[key])))) })
  }
  const selections = [...WBS_MIGRATION_TABLES.map(table => ({ table, key: 'id', ids: rows[table].map(row => String(row.id)) })), { table: 'file_refs', key: 'id', ids: files.map(row => String(row.id)) }, { table: 'file_payloads', key: 'file_ref_id', ids: bodies.filter(row => row.payloadBase64 !== null).map(row => row.fileId) }, { table: 'schedule_process_libraries', key: 'id', ids: libraryIds }, { table: 'schedule_process_library_tasks', key: 'id', ids: libraries.flatMap(library => library.tasks.map(task => String(task.id))) }, ...(snapshotRows.length ? [{ table: 'schedule_floor_quantity_snapshots', key: 'id', ids: snapshots.map(row => String(row.id)) }] : []), ...journals]
  const captured = await captureMigrationDomainRows(native, selections)
  const definitions = (await native.select<Row>('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY tbl_name,type,name')).filter(row => selections.some(selection => selection.table === row.tbl_name))
  return { ...proof, graphs, refs, libraries, files, bodies, snapshots, captured, definitions, contractReferences }
}
type Source = Awaited<ReturnType<typeof readSource>>
async function candidates(tx: TransactionDb, table: WbsReferenceMapping['table']) {
  const rows = await tx.select<Row>(`SELECT * FROM ${table} ORDER BY id`)
  return Promise.all(rows.map(async (row) => {
    if (table === 'projects')
      projectDraft(row as never)
    const projectId = table === 'projects' ? row.id : table === 'floors' ? (await tx.select<Row>('SELECT project_id FROM buildings WHERE id=?', [row.building_id]))[0]?.project_id : row.project_id
    return { id: String(row.id), projectId: String(projectId), name: String(row.name ?? row.code ?? ''), deletedAt: row.deleted_at === null ? null : String(row.deleted_at), version: wbsDigest(row) }
  }))
}
function libraryDraft(library: Source['libraries'][number]) {
  return normalizeProcessLibraryDraft({ sourceLibraryId: null, code: String(library.row.code), name: String(library.row.name), description: String(library.row.description ?? ''), tasks: library.tasks.map(task => ({ key: String(task.task_key), name: String(task.name), durationDays: Number(task.duration_days), trade: String(task.trade), color: String(task.color), stageCode: String(task.stage_code ?? ''), itemCodes: JSON.parse(String(task.item_codes_json)), predecessorKey: task.predecessor_task_key === null ? null : String(task.predecessor_task_key), predecessorDisabled: Boolean(task.predecessor_disabled) })) })
}
function actualLibraryDraft(library: ProcessLibraryVersion) {
  return normalizeProcessLibraryDraft({ sourceLibraryId: null, code: library.code, name: library.name, description: library.description, tasks: library.tasks.map(task => ({ ...task, stageCode: task.stageCode ?? '' })) })
}
export function createProductionWbsMigration(storage: ProductionStorage) {
  async function run<T>(session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession) => Promise<T>) {
    const actor = structuredClone(session())
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !actor.capabilities.includes('schedule:import') || !actor.capabilities.includes('schedule:read'))
      throw scheduleProblem('forbidden', '当前可信身份无正式WBS接管或恢复权限')
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      await verifyProductionWbsState(tx, actor)
      const result = await work(tx, actor)
      if (wbsDigest(session()) !== wbsDigest(actor))
        throw scheduleProblem('forbidden', '迁入期间身份或权限变化，保留原编号')
      return result
    })
  }
  const proofFor = (command: WbsImportCommand) => ({ commandId: command.commandId, workspaceId: command.workspaceId, actorId: command.actorId, action: 'adopt', sourceSha256: command.source.sha256, references: command.references, libraries: command.libraries, originals: command.originals.map(row => ({ fileId: row.fileId, sha256: wbsBytesDigest(Buffer.from(row.payloadBase64, 'base64')) })) })
  async function remember(proof: Row, session: Session) {
    return run(session, true, async (tx, actor) => {
      if (proof.workspaceId !== actor.workspaceId || proof.actorId !== actor.actorId)
        throw scheduleProblem('forbidden', '原接管命令身份不一致')
      const original = (await tx.select<Row>('SELECT * FROM schedule_import_intents WHERE command_id=?', [proof.commandId]))[0]
      if (original && original.fingerprint !== wbsDigest(proof))
        throw scheduleProblem('conflict', '同一迁入原编号不能改变来源、映射或原件')
      if (!original)
        await tx.execute('INSERT INTO schedule_import_intents VALUES (?,?,?,?,?,?,?)', [proof.commandId, actor.workspaceId, actor.actorId, proof.action, wbsDigest(proof), JSON.stringify(proof), new Date().toISOString()])
    })
  }
  async function oldResult(tx: TransactionDb, proof: Row) {
    const receipt = (await tx.select<Row>('SELECT * FROM schedule_import_commands WHERE command_id=?', [proof.commandId]))[0]
    if (receipt) {
      if (receipt.fingerprint !== wbsDigest(proof))
        throw scheduleProblem('conflict', '原迁入编号正文不一致')
      return JSON.parse(String(receipt.result_json)) as WbsImportResult
    }
    if ((await tx.select('SELECT command_id FROM schedule_import_resolutions WHERE command_id=?', [proof.commandId]))[0])
      throw scheduleProblem('conflict', '原接管编号已确认未应用，迟到请求不能再写入')
    return null
  }
  async function receipt(tx: TransactionDb, actor: BusinessSession, proof: Row, result: WbsImportResult) {
    await tx.execute('INSERT INTO schedule_import_commands VALUES (?,?,?,?,?,?)', [proof.commandId, actor.workspaceId, actor.actorId, proof.action, wbsDigest(proof), JSON.stringify(result)])
    return result
  }
  return {
    state(session: Session) {
      return run(session, false, async (tx, actor) => ({ context: actor, sources: (await tx.select<Row>('SELECT i.*,r.restored_at FROM schedule_source_imports i LEFT JOIN schedule_import_restores r ON r.import_id=i.id ORDER BY i.created_at,i.id')).map(row => ({ importId: String(row.id), sourceSha256: String(row.source_sha256), projectIds: (JSON.parse(String(row.result_json)) as WbsImportResult).projectIds, groupIds: (JSON.parse(String(row.result_json)) as WbsImportResult).groupIds, taskIds: (JSON.parse(String(row.result_json)) as WbsImportResult).taskIds, importedAt: String(row.created_at), restored: row.restored_at != null })) }))
    },
    async preflight(input: unknown, session: Session): Promise<WbsImportPreview> {
      const command = request(input)
      if (command.workspaceId !== session().workspaceId || command.actorId !== session().actorId || !session().capabilities.includes('schedule:import'))
        throw scheduleProblem('forbidden', '来源预检身份无效')
      return withVerifiedMigrationSnapshot(command.source, async (native, proof) => {
        const source = await readSource(native, proof)
        return run(session, false, async (tx, actor) => ({ sourceSha256: source.sha256, schemaVersion: source.schemaVersion, projects: source.graphs.map(row => ({ id: row.legacyId, name: row.name, deletedAt: row.deletedAt, groups: row.graph.tables.schedule_groups.length, tasks: row.graph.tables.schedule_tasks.length })), references: await Promise.all(source.refs.map(async row => ({ ...row, candidates: await candidates(tx, row.table) }))), libraries: await Promise.all(source.libraries.map(async library => ({ id: String(library.row.id), code: String(library.row.code), name: String(library.row.name), version: Number(library.row.version), candidates: (await readProductionProcessLibraryState(tx, actor)).versions.filter(current => current.version === library.row.version && wbsDigest(actualLibraryDraft(current)) === wbsDigest(libraryDraft(library))).map(current => ({ id: current.id, name: current.name, version: current.sourceVersion })) }))), requiredOriginals: source.files.filter(file => file.file_path && !source.bodies.find(body => body.fileId === file.id)?.payloadBase64).map(file => ({ id: String(file.id), name: String(file.file_name ?? '') })) }))
      })
    },
    async adopt(input: unknown, session: Session): Promise<WbsImportResult> {
      const command = request(input)
      if (command.action !== 'adopt')
        return fail('只有明确adopt可写入')
      const proof = proofFor(command)
      await remember(proof, session)
      return withVerifiedMigrationSnapshot(command.source, async (native, fileProof) => {
        const source = await readSource(native, fileProof)
        return run(session, true, async (tx, actor) => {
          const old = await oldResult(tx, proof)
          if (old)
            return old
          if ((await tx.select('SELECT id FROM schedule_source_imports WHERE source_sha256=?', [source.sha256]))[0])
            throw scheduleProblem('conflict', '同一完整来源已经接管或归档，请核对原批次，不能复制第二图')
          if (command.references.length !== source.refs.length || command.libraries.length !== source.libraries.length)
            return fail('每项当前及历史祖先和工序库都必须明确映射')
          const mappings = new Map<string, string>()
          for (const ref of source.refs) {
            const mapping = command.references.find(row => row.table === ref.table && row.legacyId === ref.id)
            const current = mapping && (await candidates(tx, ref.table)).find(row => row.id === mapping.id)
            if (!mapping || !current || current.version !== mapping.version)
              return fail('采用的正式祖先版本已变化或缺少映射')
            mappings.set(JSON.stringify([ref.table, ref.id]), current.id)
          }
          const idFor = (table: string, id: unknown) => id === null ? null : mappings.get(JSON.stringify([table, id])) ?? fail(`缺少 ${table}/${String(id)} 的明确映射`)
          for (const ref of source.refs) {
            const current = (await candidates(tx, ref.table)).find(row => row.id === idFor(ref.table, ref.id))!
            if (current.projectId !== idFor('projects', ref.projectId))
              return fail('祖先映射跨了项目，不允许按同名或本地同ID推断')
          }
          const libraryTasks = new Map<string, string>()
          const state = await readProductionProcessLibraryState(tx, actor)
          for (const library of source.libraries) {
            const mapping = command.libraries.find(row => row.legacyId === library.row.id)
            const actual = state.versions.find(row => row.id === mapping?.id)
            if (!mapping || !actual || actual.sourceVersion !== mapping.version || actual.version !== library.row.version || wbsDigest(actualLibraryDraft(actual)) !== wbsDigest(libraryDraft(library)))
              return fail('原完整工序库无法与正式不可变版本逐字段核对；历史证据不能当作新上游')
            mappings.set(JSON.stringify(['schedule_process_libraries', library.row.id]), actual.id)
            for (const task of library.tasks)
              libraryTasks.set(String(task.id), actual.tasks.find(row => row.key === task.task_key)!.id)
          }
          const importId = `wbs-import-${randomUUID()}`
          const projectIds = [...new Set(source.graphs.map(row => String(idFor('projects', row.legacyId))))]
          const installed: Record<string, string> = {}
          const logIds: string[] = []
          const foreign: Record<string, string> = { project_id: 'projects', building_id: 'buildings', floor_id: 'floors', item_id: 'items', stage_id: 'construction_stages', process_library_id: 'schedule_process_libraries' }
          const sources = source.graphs.flatMap(row => WBS_INSTANCE_TABLES.flatMap(table => row.graph.tables[table].map(value => ({ table, value }))))
          for (const { table, value } of sources) {
            if ((await tx.select(`SELECT id FROM ${table} WHERE id=?`, [value.id]))[0])
              return fail('原WBS稳定ID已存在，不能覆盖或另造ID')
          }
          for (const graph of source.graphs) {
            for (const link of graph.graph.tables.schedule_group_buildings) {
              const group = graph.graph.tables.schedule_groups.find(row => row.id === link.group_id)!
              if (group.deleted_at !== null || link.deleted_at !== null)
                continue
              const buildingId = idFor('buildings', link.building_id)
              if ((await tx.select(`${productionWbsVisibility.hiddenCtesFor('schedule_group_buildings')} SELECT id FROM schedule_group_buildings WHERE building_id=? AND ${productionWbsVisibility.visibleCond('schedule_group_buildings')}`, [buildingId]))[0])
                throw scheduleProblem('conflict', '原有效楼栋已经由正式WBS采用，整批拒绝；保留原库，核对既有计划后再接管')
            }
          }
          // DEFERRED FKs retain original group/task/dependency IDs even when a parent follows its child in source order.
          await tx.execute('PRAGMA defer_foreign_keys=ON')
          for (const { table, value } of sources) {
            const row: Row = { ...value }
            for (const [column, parent] of Object.entries(foreign)) {
              if (Object.hasOwn(row, column))
                row[column] = idFor(parent, row[column])
            }
            if (Object.hasOwn(row, 'source_library_task_id') && row.source_library_task_id !== null)
              row.source_library_task_id = libraryTasks.get(String(row.source_library_task_id)) ?? fail('冻结任务原库工序缺少可核验映射')
            const ownerProject = table === 'schedule_groups' || table === 'schedule_tasks' ? String(row.project_id) : source.graphs.find(graph => graph.graph.tables[table].some(original => original.id === row.id))!.legacyId
            const projectId = table === 'schedule_groups' || table === 'schedule_tasks' ? ownerProject : String(idFor('projects', ownerProject))
            if (row.contract_id != null) {
              const prior = (await tx.select<Row>('SELECT * FROM quantity_contract_references WHERE id=?', [row.contract_id]))[0]
              if (prior && prior.project_id !== projectId)
                return fail('原历史合同编号已对应另一项目，整批拒绝串关联')
              await tx.execute('INSERT OR IGNORE INTO quantity_contract_references VALUES (?,?)', [row.contract_id, projectId])
            }
            if (row.boq_line_id != null) {
              const reference = (await native.select<Row>('SELECT project_id,contract_id FROM boq_lines WHERE id=?', [row.boq_line_id]))[0]
              if (!reference || idFor('projects', reference.project_id) !== projectId)
                return fail('历史BOQ引用缺少真实原祖先')
              const prior = (await tx.select<Row>('SELECT * FROM quantity_boq_references WHERE id=?', [row.boq_line_id]))[0]
              if (prior && (prior.project_id !== projectId || prior.contract_id !== reference.contract_id))
                return fail('原历史BOQ编号已对应另一资格或合同，整批拒绝')
              await tx.execute('INSERT OR IGNORE INTO quantity_boq_references VALUES (?,?,?)', [row.boq_line_id, projectId, reference.contract_id])
            }
            const columns = WBS_MIGRATION_COLUMNS[table]
            await tx.execute(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map(column => row[column]))
            installed[JSON.stringify([table, row.id])] = wbsDigest((await tx.select<Row>(`SELECT * FROM ${table} WHERE id=?`, [row.id]))[0])
          }
          for (const graph of source.graphs) {
            const projectId = String(idFor('projects', graph.legacyId))
            for (const log of graph.graph.tables.operation_logs) {
              const original = (await native.select<Row>('SELECT * FROM operation_logs WHERE id=?', [log.id]))[0]!
              const row: Row = { ...log, operator: log.operator ?? '', before_data: narrowSnapshot(original.before_data, original.table_name as WbsMigrationTable), after_data: narrowSnapshot(original.after_data, original.table_name as WbsMigrationTable) }
              for (const key of ['before_data', 'after_data']) {
                if (row[key] !== null) {
                  const snapshot = JSON.parse(String(row[key]))
                  for (const [column, parent] of Object.entries(foreign)) {
                    if (Object.hasOwn(snapshot, column))
                      snapshot[column] = idFor(parent, snapshot[column])
                  }
                  if (snapshot.source_library_task_id != null)
                    snapshot.source_library_task_id = libraryTasks.get(String(snapshot.source_library_task_id)) ?? fail('原审计库工序缺少映射')
                  row[key] = JSON.stringify(snapshot)
                }
              }
              await tx.execute(`INSERT INTO operation_logs(${WBS_MIGRATION_COLUMNS.operation_logs.join(',')}) VALUES(${WBS_MIGRATION_COLUMNS.operation_logs.map(() => '?').join(',')})`, WBS_MIGRATION_COLUMNS.operation_logs.map(column => row[column]))
              logIds.push(String(row.id))
              installed[JSON.stringify(['operation_logs', row.id])] = wbsDigest((await tx.select<Row>('SELECT * FROM operation_logs WHERE id=?', [row.id]))[0])
            }
            for (const floor of graph.graph.tables.schedule_task_floor_plans) {
              const snapshot = source.snapshots.find(row => row.id === floor.id)
              await tx.execute('INSERT INTO schedule_floor_quantity_snapshots VALUES (?,?,?,?)', [floor.id, projectId, snapshot?.snapshot_json ?? '{}', snapshot?.legacy_missing ?? 1])
              installed[JSON.stringify(['schedule_floor_quantity_snapshots', floor.id])] = wbsDigest((await tx.select<Row>('SELECT * FROM schedule_floor_quantity_snapshots WHERE id=?', [floor.id]))[0])
            }
            await tx.execute('INSERT INTO schedule_migration_evidence VALUES (?,?,?,?,?)', [`${importId}:${graph.legacyId}`, projectId, importId, JSON.stringify({ sourceSha256: source.sha256, originalProjectId: graph.legacyId, originalGraph: graph.graph, explicitReferences: command.references, explicitLibraries: command.libraries }), graph.graph.tables.schedule_task_floor_plans.some(floor => !source.snapshots.some(row => row.id === floor.id)) ? 'legacy-detail-unavailable' : 'not-applicable'])
            await advanceProductionWbsRevision(tx, projectId)
          }
          for (const original of command.originals) {
            if (!source.files.some(file => file.id === original.fileId))
              return fail('补传原件不属于这份WBS领域图')
          }
          for (const file of source.files) {
            const body = source.bodies.find(body => body.fileId === file.id)!.payloadBase64 ?? command.originals.find(row => row.fileId === file.id)?.payloadBase64 ?? null
            if (body === null && file.file_path)
              return fail('外部原件须按稳定ID补齐，不能降成缺件')
            const bytes = body === null ? null : Buffer.from(body, 'base64')
            if (body !== null && (bytes!.toString('base64') !== body || (file.file_size !== null && file.file_size !== bytes!.length)))
              return fail('原件完整字节编码或源大小不一致')
            const table = file.owner_type === 'schedule_group' ? 'schedule_groups' : 'schedule_tasks'
            const owner = (await tx.select<Row>(`SELECT project_id FROM ${table} WHERE id=?`, [file.owner_id]))[0]!
            await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [file.id, file.owner_type, file.owner_id, file.file_name ?? '', file.file_path ?? '', bytes?.length ?? file.file_size ?? 0, file.mime_type ?? '', file.category ?? '', file.uploader ?? '', file.uploaded_at ?? new Date().toISOString(), file.deleted_at])
            if (bytes)
              await tx.execute('INSERT INTO file_payloads VALUES (?,?,?)', [file.id, bytes, wbsBytesDigest(bytes)])
            await tx.execute('INSERT INTO schedule_files VALUES(?,?,?,?,?,?,?)', [file.id, owner.project_id, file.owner_type, file.owner_id, JSON.stringify(file), bytes ? 'embedded' : 'metadata-only', bytes ? wbsBytesDigest(bytes) : null])
            installed[JSON.stringify(['file_refs', file.id])] = wbsDigest((await tx.select<Row>('SELECT * FROM file_refs WHERE id=?', [file.id]))[0])
          }
          const rawDomain = { ...source.captured.rows, file_payloads: source.captured.rows.file_payloads!.map(row => ({ ...row, columns: { ...row.columns, content: { sqliteType: row.columns.content!.sqliteType, sharedOriginal: row.legacyId, sha256: wbsBytesDigest(Buffer.from(source.bodies.find(body => body.fileId === row.legacyId)!.payloadBase64!, 'base64')) } } })) }
          const evidence = { sourceSha256: source.sha256, schemaVersion: source.schemaVersion, references: command.references, libraries: command.libraries, contractReferences: source.contractReferences, contractSourceState: 'historical-reference-only', rawDomain, sourceSchemas: source.captured.schemas, sourceDefinitions: source.definitions, domainDigest: wbsDigest(rawDomain), installed, logIds, projectIds, originalGraphs: source.graphs.map(row => ({ legacyId: row.legacyId, graph: row.graph })) }
          const result: WbsImportResult = { commandId: command.commandId, importId, sourceSha256: source.sha256, projectIds, groupIds: sources.filter(row => row.table === 'schedule_groups').map(row => String(row.value.id)), taskIds: sources.filter(row => row.table === 'schedule_tasks').map(row => String(row.value.id)) }
          await tx.execute('INSERT INTO schedule_source_imports VALUES(?,?,?,?,?,?,?,?,?)', [importId, source.sha256, actor.workspaceId, actor.actorId, command.commandId, JSON.stringify(evidence), wbsDigest(evidence), JSON.stringify(result), new Date().toISOString()])
          return receipt(tx, actor, proof, result)
        })
      })
    },
    async restore(input: unknown, session: Session): Promise<WbsImportResult> {
      if (!object(input) || Object.keys(input).sort().join(',') !== 'actorId,commandId,importId,workspaceId' || !['workspaceId', 'actorId', 'commandId', 'importId'].every(key => typeof input[key] === 'string' && String(input[key]).trim()) || !/^[a-z0-9][\w-]{2,79}$/i.test(String(input.commandId)))
        return fail('恢复只接受原批次身份与独立原编号')
      const proof = { ...input, action: 'restore' }
      await remember(proof, session)
      return run(session, true, async (tx, actor) => {
        const old = await oldResult(tx, proof)
        if (old)
          return old
        const imported = (await tx.select<Row>('SELECT * FROM schedule_source_imports WHERE id=?', [input.importId]))[0]
        if (!imported || (await tx.select('SELECT import_id FROM schedule_import_restores WHERE import_id=?', [input.importId]))[0])
          throw scheduleProblem('conflict', '原批次不存在或已经恢复归档')
        const evidence = JSON.parse(String(imported.evidence_json))
        for (const [key, hash] of Object.entries(evidence.installed as Record<string, string>)) {
          const [table, id] = JSON.parse(key)
          const current = (await tx.select<Row>(`SELECT * FROM ${table} WHERE id=?`, [id]))[0]
          if (!current || wbsDigest(current) !== hash)
            throw scheduleProblem('conflict', '整批恢复拒绝：原WBS、冻结计划、原件或审计已经被后续操作改变')
        }
        const groupIds = (JSON.parse(String(imported.result_json)) as WbsImportResult).groupIds
        const taskIds = (JSON.parse(String(imported.result_json)) as WbsImportResult).taskIds
        for (const projectId of evidence.projectIds as string[]) {
          const graph = await productionWbsGraph(tx, projectId)
          if (graph.schedule_tasks!.some(row => ((row.parent_id && taskIds.includes(String(row.parent_id))) || groupIds.includes(String(row.group_id))) && !taskIds.includes(String(row.id))) || graph.schedule_task_floor_plans!.some(row => taskIds.includes(String(row.task_id)) && !Object.hasOwn(evidence.installed, JSON.stringify(['schedule_task_floor_plans', row.id]))) || graph.task_dependencies!.some(row => (taskIds.includes(String(row.pred_id)) || taskIds.includes(String(row.succ_id))) && !Object.hasOwn(evidence.installed, JSON.stringify(['task_dependencies', row.id]))))
            throw scheduleProblem('conflict', '整批恢复拒绝：后来WBS或子级已经引用原批次范围')
        }
        if ((await tx.select<Row>('SELECT * FROM schedule_command_intents')).some((row) => {
          const command = JSON.parse(String(row.request_json))
          return groupIds.includes(command.action.groupId) || taskIds.includes(command.action.taskId) || taskIds.includes(command.action.successorId) || taskIds.includes(command.action.predecessorId) || (command.action.dependencyId && Object.hasOwn(evidence.installed, JSON.stringify(['task_dependencies', command.action.dependencyId]))) || (Array.isArray(command.action.logIds) && command.action.logIds.some((id: string) => evidence.logIds.includes(id))) || (command.action.kind === 'set-baseline' && evidence.projectIds.includes(command.projectId))
        })) {
          throw scheduleProblem('conflict', '整批恢复拒绝：后续原意图或历史动作已经采用本批次')
        }
        for (const id of groupIds)
          await softDelete(tx, 'schedule_groups', id, actor.actorId)
        for (const id of taskIds) {
          const task = (await tx.select<Row>('SELECT * FROM schedule_tasks WHERE id=?', [id]))[0]!
          if (task.group_id === null)
            await softDelete(tx, 'schedule_tasks', id, actor.actorId)
        }
        for (const file of await tx.select<Row>('SELECT * FROM schedule_files')) {
          if (!groupIds.includes(String(file.owner_id)) && !taskIds.includes(String(file.owner_id)))
            continue
          const original = (await tx.select<Row>('SELECT * FROM file_refs WHERE id=?', [file.file_ref_id]))[0]!
          if (original.deleted_at === null) {
            const after = { ...original, deleted_at: new Date().toISOString() }
            await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=?', [after.deleted_at, file.file_ref_id])
            await logOperation(tx, { table: 'file_refs', recordId: String(file.file_ref_id), action: 'delete', before: original, after, operator: actor.actorId })
          }
        }
        for (const id of evidence.projectIds)
          await advanceProductionWbsRevision(tx, id)
        const result: WbsImportResult = { ...JSON.parse(String(imported.result_json)), commandId: String(input.commandId), restored: true }
        await tx.execute('INSERT INTO schedule_import_restores VALUES (?,?,?,?,?,?)', [input.importId, input.commandId, actor.workspaceId, actor.actorId, JSON.stringify(result), new Date().toISOString()])
        return receipt(tx, actor, proof, result)
      })
    },
    resolve(input: unknown, session: Session) {
      if (!object(input) || Object.keys(input).sort().join(',') !== 'action,actorId,commandId,family,scopeId,targetId,workspaceId' || input.family !== 'schedule-import' || input.targetId !== null || !['adopt', 'restore'].includes(String(input.action)) || !/^[a-z0-9][\w-]{2,79}$/i.test(String(input.commandId)) || typeof input.scopeId !== 'string' || (input.action === 'adopt' ? !/^[a-f0-9]{64}$/.test(input.scopeId) : !/^wbs-import-[\da-f-]{36}$/.test(input.scopeId)))
        return fail('原恢复只接受最小原编号描述')
      const descriptor = input as unknown as CommandRecoveryDescriptor
      return run(session, true, async (tx, actor) => {
        if (descriptor.workspaceId !== actor.workspaceId || descriptor.actorId !== actor.actorId)
          throw scheduleProblem('forbidden', '原接管编号与可信身份不同')
        const original = (await tx.select<Row>('SELECT * FROM schedule_import_intents WHERE command_id=?', [descriptor.commandId]))[0]
        if (original) {
          const proof = JSON.parse(String(original.request_proof_json))
          if (original.action !== descriptor.action || original.workspace_id !== actor.workspaceId || original.actor_id !== actor.actorId || descriptor.scopeId !== (proof.action === 'adopt' ? proof.sourceSha256 : proof.importId))
            throw scheduleProblem('conflict', '恢复动作、范围或可信身份与原意图不同')
        }
        const saved = (await tx.select<Row>('SELECT * FROM schedule_import_commands WHERE command_id=?', [descriptor.commandId]))[0]
        if (saved)
          return { outcome: 'applied' as const, result: JSON.parse(String(saved.result_json)) as WbsImportResult }
        const sealed = (await tx.select<Row>('SELECT * FROM schedule_import_resolutions WHERE command_id=?', [descriptor.commandId]))[0]
        if (sealed && wbsDigest(JSON.parse(String(sealed.descriptor_json))) !== wbsDigest(descriptor))
          throw scheduleProblem('conflict', '原封存编号已对应另一动作或范围')
        await tx.execute('INSERT OR IGNORE INTO schedule_import_resolutions VALUES(?,?,?,?,?)', [descriptor.commandId, actor.workspaceId, actor.actorId, JSON.stringify(descriptor), new Date().toISOString()])
        return { outcome: 'not-applied' as const, commandId: descriptor.commandId }
      })
    },
    files(projectId: string, session: Session) { return run(session, false, tx => productionWbsFiles(tx, projectId)) },
  }
}
