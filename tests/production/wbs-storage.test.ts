import type { ScheduleCommand } from '../../app/lib/schedule/central-contract'
import type { WbsImportCommand } from '../../app/lib/schedule/import-contract'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { createProductionProcessLibraryService } from '../../server/utils/production-process-library-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { wbsBytesDigest } from '../../server/utils/production-wbs-files'
import { productionWbsLibraryUsage } from '../../server/utils/production-wbs-library-usage'
import { createProductionWbsMigration } from '../../server/utils/production-wbs-migration'
import { createProductionWbsService } from '../../server/utils/production-wbs-service'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createWbsActualBoqFixture } from '../helpers/production-wbs-upstream-fixture'

const close: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(close.splice(0).map(fn => fn()))
})
async function fixture() {
  const base = resolve('.tmp/opt-02/wbs-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/wbs-`)
  const options = { directory, workspaceId: 'wbs-workspace', ownerId: 'wbs-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  close.push(() => storage.close())
  let actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['schedule:read', 'schedule:write', 'schedule:import', 'project:list:read', 'project:write', 'process-library:read', 'process-library:write'] }
  const session = () => structuredClone(actor)
  const project = await createProductionProjectService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'wbs-project-create', requiredCapability: 'project:write', baseVersion: null, action: 'draft', draft: { name: '正式WBS项目', code: 'WP' }, attachments: {} }, session)
  const libraryService = createProductionProcessLibraryService(storage)
  const library = await libraryService.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, origin: 'real', requiredCapability: 'process-library:write', commandId: 'wbs-library-create', action: 'create-version', baseVersion: 0, sourceVersion: null, draft: { sourceLibraryId: null, code: 'INSIDE', name: '内部工序', description: '', tasks: [{ key: 'wall', name: '墙面', durationDays: 10, trade: '油漆工', color: '#123456', stageCode: 'WALL', itemCodes: ['WALL'], predecessorKey: null }, { key: 'clean', name: '清洁', durationDays: 2, trade: '杂工', color: '#223344', stageCode: '', itemCodes: [], predecessorKey: 'wall' }] } }, session)
  await storage.withTransaction(async (tx) => {
    for (const sql of [
      `INSERT INTO buildings(id,project_id,code,name) VALUES ('wbs-b','${project.id}','B','一栋'),('wbs-empty','${project.id}','E','空栋')`,
      'INSERT INTO floors(id,building_id,code,name) VALUES (\'wbs-f\',\'wbs-b\',\'F\',\'一层\')',
      `INSERT INTO house_type_templates(id,project_id,code,name) VALUES ('wbs-ta','${project.id}','A','户型甲'),('wbs-tb','${project.id}','B','户型乙')`,
      'INSERT INTO rooms(id,template_id,code,name) VALUES (\'wbs-ra\',\'wbs-ta\',\'R\',\'客厅\'),(\'wbs-rb\',\'wbs-tb\',\'R\',\'客厅\')',
      'INSERT INTO units(id,floor_id,house_type_template_id,code,name) VALUES (\'wbs-u1\',\'wbs-f\',\'wbs-ta\',\'1\',\'一户\'),(\'wbs-u2\',\'wbs-f\',\'wbs-tb\',\'2\',\'二户\')',
      `INSERT INTO items(id,project_id,code,name,trade,unit) VALUES ('wbs-i','${project.id}','WALL','墙面','油漆工','㎡'),('wbs-z','${project.id}','ZERO','踢脚','油漆工','m')`,
      'INSERT INTO house_type_template_items(id,room_id,item_id,provisional_qty) VALUES (\'wbs-a\',\'wbs-ra\',\'wbs-i\',8),(\'wbs-b-line\',\'wbs-rb\',\'wbs-i\',NULL),(\'wbs-zero\',\'wbs-ra\',\'wbs-z\',0)',
      `INSERT INTO construction_stages(id,project_id,code,name,trade) VALUES ('wbs-s','${project.id}','WALL','墙面完成','油漆工')`,
      'INSERT INTO construction_stage_items(id,stage_id,item_id) VALUES (\'wbs-mapping\',\'wbs-s\',\'wbs-i\')',
    ]) await tx.execute(sql)
  })
  const service = createProductionWbsService(storage)
  const query = { projectId: project.id, origin: 'real' as const, includeDemo: false, today: '2026-09-12' }
  let sequence = 0
  const command = async (action: ScheduleCommand['action'], commandId = `wbs-command-${++sequence}`): Promise<ScheduleCommand> => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId, origin: 'real', requiredCapability: 'schedule:write', projectId: project.id, sourceVersion: (await service.read(query, '', session)).sourceVersion, action })
  const group = () => ({ kind: 'create-group' as const, draft: { projectId: project.id, scopeBasis: 'provisional' as const, processLibraryId: library.id, librarySourceVersion: library.sourceVersion, name: '内部计划', buildingIds: ['wbs-b'], startDate: '2026-09-01', overlapMode: 'seq' as const, tasks: [{ templateKey: 'wall', durationDays: 10, enabled: true, anchorStart: null }, { templateKey: 'clean', durationDays: 2, enabled: true, anchorStart: null }] } })
  return { storage, options, session, project, library, libraryService, service, query, command, group, setActor: (next: typeof actor) => {
    actor = next
  } }
}
async function migrationFixture(f: Awaited<ReturnType<typeof fixture>>, external = false, legacyJournal = false) {
  const native = await createMigratedMemoryDb()
  await native.execute('INSERT INTO projects(id,name) VALUES (?,?)', [f.project.id, '原排程项目'])
  for (const table of ['items', 'buildings', 'house_type_templates', 'construction_stages', 'floors', 'rooms', 'units', 'construction_stage_items', 'house_type_template_items']) {
    const columns = new Set((await native.select<{ name: string }>(`PRAGMA table_info(${table})`)).map(row => row.name))
    for (const row of await f.storage.select<Record<string, unknown>>(`SELECT * FROM ${table}`)) {
      if (table === 'rooms' && row.kind === 'whole_unit')
        continue
      const entries = Object.entries(row).filter(([key]) => columns.has(key))
      await native.execute(`INSERT INTO ${table}(${entries.map(([key]) => key).join(',')}) VALUES(${entries.map(() => '?').join(',')})`, entries.map(([, value]) => value))
    }
  }
  const library = await f.libraryService.detail(f.library.id, 'real', f.session)
  await native.execute('INSERT INTO schedule_process_libraries(id,code,name,version,description) VALUES (?,?,?,?,?)', ['legacy-wbs-library', library.code, library.name, library.version, library.description])
  for (const task of library.tasks)
    await native.execute('INSERT INTO schedule_process_library_tasks(id,library_id,task_key,name,trade,color,duration_days,stage_code,item_codes_json,sort_order,predecessor_task_key,predecessor_disabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [`legacy-${task.key}`, 'legacy-wbs-library', task.key, task.name, task.trade, task.color, task.durationDays, task.stageCode ?? '', JSON.stringify(task.itemCodes), task.sortOrder, task.predecessorKey, task.predecessorDisabled ? 1 : 0])
  await native.execute('ALTER TABLE schedule_tasks ADD COLUMN unknown_json TEXT')
  await native.execute('ALTER TABLE schedule_tasks ADD COLUMN unknown_integer INTEGER')
  await native.execute('ALTER TABLE schedule_tasks ADD COLUMN unknown_blob BLOB')
  await native.execute('INSERT INTO schedule_groups(id,project_id,name,scope_basis,process_library_id,process_library_name_snapshot,process_library_version_snapshot) VALUES (?,?,?,\'provisional\',?,?,1)', ['legacy-wbs-group', f.project.id, '原冻结组', 'legacy-wbs-library', library.name])
  await native.execute('INSERT INTO schedule_group_buildings(id,group_id,building_id) VALUES (\'legacy-wbs-building\',\'legacy-wbs-group\',\'wbs-b\')')
  const rawSnapshot = '{"libraryId":"legacy-wbs-library","libraryTaskId":"legacy-wall","future":{"quoted":"legacy-wbs-library","keep":true}}'
  await native.execute('INSERT INTO schedule_tasks(id,project_id,group_id,name,trade,duration_days,planned_start,planned_finish,baseline_start,baseline_finish,has_qty,stage_id,source_library_task_id,source_library_version,template_snapshot_json,unknown_json) VALUES (?,?,\'legacy-wbs-group\',\'原冻结任务\',\'油漆工\',10,\'2026-09-01\',\'2026-09-10\',\'2026-08-30\',\'2026-09-08\',1,\'wbs-s\',\'legacy-wall\',1,?,?)', ['legacy-wbs-task', f.project.id, rawSnapshot, '{"literal":"legacy-wbs-task","future":7}'])
  await native.execute('UPDATE schedule_tasks SET unknown_integer=CAST(\'9223372036854775807\' AS INTEGER),unknown_blob=x\'0080FF\'')
  await native.execute('INSERT INTO schedule_tasks(id,project_id,group_id,name,planned_start,planned_finish,has_qty,manual_progress,deleted_at) VALUES (?,?,NULL,\'原无组删除任务\',\'2026-08-01\',\'2026-08-01\',0,0,\'2026-08-02 01:00:00\')', ['legacy-ungrouped', f.project.id])
  await native.execute('INSERT INTO task_item_map(id,task_id,item_id) VALUES (\'legacy-wbs-map\',\'legacy-wbs-task\',\'wbs-i\')')
  await native.execute('INSERT INTO schedule_task_floor_plans(id,task_id,floor_id,item_id,source_basis,provisional_qty,planned_start,planned_finish,is_manual,note) VALUES (\'legacy-wbs-floor\',\'legacy-wbs-task\',\'wbs-f\',\'wbs-i\',\'provisional\',0,\'2026-09-02\',\'2026-09-05\',1,\'保真实零及原微调\')')
  await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,after_data,operator) VALUES (\'legacy-wbs-log\',\'schedule_tasks\',\'legacy-wbs-task\',\'update\',NULL,?,NULL)', [JSON.stringify({ id: 'legacy-wbs-task', project_id: f.project.id, unknown_extension: '原审计未知字段' })])
  await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES (\'legacy-wbs-original\',\'schedule_task\',\'legacy-wbs-task\',\'原计划.txt\',\'\',3,\'text/plain\')')
  await native.execute('INSERT INTO file_payloads VALUES (\'legacy-wbs-original\',\'base64\',\'YWJj\')')
  if (external)
    await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size) VALUES (\'legacy-wbs-external\',\'schedule_group\',\'legacy-wbs-group\',\'原外部文件.bin\',\'D:/原工程/计划.bin\',4)')
  await native.execute('CREATE TABLE private_other_domain(secret TEXT)')
  await native.execute('INSERT INTO private_other_domain VALUES (\'DO_NOT_PERSIST_WBS_UNRELATED_PRIVATE_DOMAIN\')')
  if (legacyJournal) {
    await native.execute('CREATE TABLE schedule_command_receipts(command_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,actor_id TEXT NOT NULL,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL)')
    await native.execute('INSERT INTO schedule_command_receipts VALUES (?,?,?,?,?)', ['legacy-wbs-command', f.project.id, 'legacy-operator', 'legacy-unknown-body-fingerprint', JSON.stringify({ commandId: 'legacy-wbs-command', projectId: f.project.id, sourceVersion: 'original-source', value: 'legacy-wbs-group' })])
  }
  const bytes = native.raw.export()
  native.close()
  const migration = createProductionWbsMigration(f.storage)
  const command: WbsImportCommand = { workspaceId: f.session().workspaceId, actorId: f.session().actorId, commandId: 'wbs-native-import', action: 'preflight', source: { sha256: wbsBytesDigest(bytes), payloadBase64: Buffer.from(bytes).toString('base64') }, references: [], libraries: [], originals: external ? [{ fileId: 'legacy-wbs-external', payloadBase64: 'AAECAw==' }] : [] }
  const preview = await migration.preflight(command, f.session)
  command.references = preview.references.map(row => ({ table: row.table, legacyId: row.id, id: row.id, version: row.candidates.find(candidate => candidate.id === row.id)!.version }))
  command.libraries = preview.libraries.map(row => ({ legacyId: row.id, id: row.candidates[0]!.id, version: row.candidates[0]!.version }))
  command.action = 'adopt'
  return { migration, command, bytes, rawSnapshot }
}

it('完整SQLite WBS迁入保原ID、原JSON、精确unknown类型、原件与历史；安全归档保原证据', async () => {
  const f = await fixture()
  const source = await migrationFixture(f, true)
  const saved = await source.migration.adopt(source.command, f.session)
  expect(await source.migration.adopt(source.command, f.session)).toEqual(saved)
  const read = await f.service.read(f.query, '', f.session)
  expect(read.snapshot.groups[0]).toMatchObject({ id: 'legacy-wbs-group', scopeBasis: 'provisional' })
  expect(read.snapshot.groups[0]!.tasks[0]!.floorPlans[0]).toMatchObject({ id: 'legacy-wbs-floor', provisionalQty: 0, legacyQuantityDetailMissing: true, quantitySnapshot: null })
  expect(read.history.removedTasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'legacy-ungrouped', manualProgress: 0 })]))
  expect(read.history.logs.find(row => row.id === 'legacy-wbs-log')).toMatchObject({ operator: null, afterJson: expect.stringContaining('原审计未知字段') })
  expect((await f.storage.select<{ template_snapshot_json: string }>('SELECT template_snapshot_json FROM schedule_tasks WHERE id=\'legacy-wbs-task\''))[0]!.template_snapshot_json).toBe(source.rawSnapshot)
  const evidence = JSON.parse((await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM schedule_source_imports'))[0]!.evidence_json)
  expect(evidence.rawDomain.schedule_tasks.find((row: { legacyId: string }) => row.legacyId === 'legacy-wbs-task').columns).toMatchObject({ unknown_integer: { sqliteType: 'integer', exactValue: '9223372036854775807' }, unknown_blob: { sqliteType: 'blob', exactValue: '0080FF' } })
  expect(JSON.stringify(evidence)).not.toContain('DO_NOT_PERSIST_WBS_UNRELATED_PRIVATE_DOMAIN')
  expect(JSON.stringify(evidence)).not.toContain(source.command.source.payloadBase64)
  expect((await source.migration.files(f.project.id, f.session)).files).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'legacy-wbs-original', payloadBase64: 'YWJj' }), expect.objectContaining({ id: 'legacy-wbs-external', payloadBase64: 'AAECAw==' })]))
  const restored = await source.migration.restore({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, commandId: 'wbs-native-restore', importId: saved.importId }, f.session)
  expect(restored.restored).toBe(true)
  expect((await f.service.read(f.query, '', f.session)).snapshot.groups).toEqual([])
  expect((await source.migration.files(f.project.id, f.session)).files[0]!.payloadBase64).not.toBeNull()
  expect(wbsBytesDigest(source.bytes)).toBe(source.command.source.sha256)
})

it('wBS迁入原号在独立Node进程冷恢复；scope错配与封存错配均拒绝，后来动作整批拒恢复', async () => {
  const f = await fixture()
  const source = await migrationFixture(f)
  const saved = await source.migration.adopt(source.command, f.session)
  const descriptor = { family: 'schedule-import', targetId: null, scopeId: source.command.source.sha256, action: 'adopt', commandId: source.command.commandId, workspaceId: f.session().workspaceId, actorId: f.session().actorId }
  await expect(source.migration.resolve({ ...descriptor, scopeId: '0'.repeat(64) }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  const missing = { ...descriptor, commandId: 'wbs-source-never-applied' }
  expect(await source.migration.resolve(missing, f.session)).toEqual({ outcome: 'not-applied', commandId: missing.commandId })
  await expect(source.migration.resolve({ ...missing, scopeId: '0'.repeat(64) }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  const output = resolve(f.options.directory, 'cold-wbs-import.json')
  await f.storage.close()
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('tests/helpers/production-wbs-cold.ts'), f.options.directory, f.project.id, JSON.stringify(descriptor), output], { windowsHide: true })
  const cold = JSON.parse(await readFile(output, 'utf8'))
  expect(cold.resolution).toEqual({ outcome: 'applied', result: saved })
  expect(cold.read.history.removedTasks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'legacy-ungrouped' })]))
  expect(cold.files.files).toEqual(expect.arrayContaining([expect.objectContaining({ payloadBase64: 'YWJj' })]))
  const restarted = createProductionStorage(f.options)
  close.push(() => restarted.close())
  const owner = createProductionWbsService(restarted)
  const migration = createProductionWbsMigration(restarted)
  const read = await owner.read(f.query, '', f.session)
  await owner.execute({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, origin: 'real', requiredCapability: 'schedule:write', commandId: 'wbs-import-later-baseline', projectId: f.project.id, sourceVersion: read.sourceVersion, action: { kind: 'set-baseline' } }, f.session)
  const before = await restarted.select('SELECT * FROM schedule_tasks ORDER BY id')
  await expect(migration.restore({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, commandId: 'wbs-danger-restore', importId: saved.importId }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  expect(await restarted.select('SELECT * FROM schedule_tasks ORDER BY id')).toEqual(before)
  const rejected = { ...descriptor, action: 'restore', scopeId: saved.importId, commandId: 'wbs-danger-restore' }
  expect(await migration.resolve(rejected, f.session)).toEqual({ outcome: 'not-applied', commandId: rejected.commandId })
  await expect(migration.resolve({ ...rejected, scopeId: 'wbs-import-00000000-0000-0000-0000-000000000000' }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
}, 30000)

it('同组无关任务改动不阻断人工进度；原任务变化与实际端点/依赖变化拒绝；整图合法', async () => {
  const f = await fixture()
  await f.service.execute(await f.command(f.group()), f.session)
  const read = await f.service.read(f.query, '', f.session)
  const wall = read.snapshot.groups[0]!.tasks[0]!
  const clean = read.snapshot.groups[0]!.tasks[1]!
  const manual = await f.command({ kind: 'update-task', taskId: clean.id, patch: { manualProgress: 0.5 } })
  await f.service.execute(await f.command({ kind: 'update-task', taskId: wall.id, patch: { plannedStart: '2026-08-30' } }), f.session)
  await f.service.execute(manual, f.session)
  expect((await f.service.read(f.query, '', f.session)).snapshot.groups[0]!.tasks[1]!.manualProgress).toBe(0.5)
  const old = await f.command({ kind: 'update-task', taskId: clean.id, patch: { plannedFinish: '2026-09-14' } })
  await f.service.execute(await f.command({ kind: 'update-dependency', successorId: clean.id, predecessorId: wall.id, lagDays: 0 }), f.session)
  await expect(f.service.execute(old, f.session)).rejects.toMatchObject({ problem: { code: 'stale-source', commandOutcome: 'not-applied' } })
  const sameTask = await f.command({ kind: 'update-task', taskId: clean.id, patch: { manualProgress: 0.25 } })
  await f.service.execute(await f.command({ kind: 'update-task', taskId: clean.id, patch: { manualProgress: 0.75 } }), f.session)
  await expect(f.service.execute(sameTask, f.session)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
})

it('正常WBS原意图丢响应后在独立Node冷进程仅凭原号恢复完整冻结图', async () => {
  const f = await fixture()
  const command = await f.command(f.group())
  const saved = await f.service.execute(command, f.session)
  await f.storage.close()
  const descriptor = { family: 'schedule', targetId: f.project.id, action: 'create-group', commandId: command.commandId, workspaceId: command.workspaceId, actorId: command.actorId }
  const output = resolve(f.options.directory, 'cold-wbs-command.json')
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('tests/helpers/production-wbs-cold.ts'), f.options.directory, f.project.id, JSON.stringify(descriptor), output], { windowsHide: true })
  const cold = JSON.parse(await readFile(output, 'utf8'))
  expect(cold.resolution).toEqual({ outcome: 'applied', result: saved })
  expect(cold.read.snapshot.groups[0].tasks[0].floorPlans[0]).toMatchObject({ quantitySnapshot: { value: null, knownValue: 8, missingCount: 1 } })
}, 30000)

it('工序库使用量是真实WBS投影，0/已用项目/无权未知/原项目软删分别保留，原不可变JSON不变', async () => {
  const f = await fixture()
  const session = () => ({ ...f.session(), capabilities: [...f.session().capabilities, 'quantity:read'] })
  const before = await f.storage.select('SELECT snapshot_json FROM process_library_versions WHERE id=?', [f.library.id])
  const usage = () => f.storage.withTransaction(tx => productionWbsLibraryUsage(tx, session()))
  expect((await usage())!.get(f.library.id) ?? []).toEqual([])
  await f.service.execute(await f.command(f.group()), f.session)
  expect((await usage())!.get(f.library.id)).toEqual([{ id: f.project.id, name: '正式WBS项目', groupCount: 1 }])
  expect(await f.storage.withTransaction(tx => productionWbsLibraryUsage(tx, { ...session(), capabilities: session().capabilities.filter(cap => cap !== 'quantity:read') }))).toBeNull()
  const projectService = createProductionProjectService(f.storage)
  const lifecycle = await projectService.lifecycle(f.project.id, f.session)
  await projectService.executeLifecycle({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, commandId: 'wbs-project-retire', id: f.project.id, requiredCapability: 'project:write', baseVersion: lifecycle.version, action: 'delete' }, f.session)
  expect((await usage())!.get(f.library.id) ?? []).toEqual([])
  expect(await f.storage.select('SELECT snapshot_json FROM process_library_versions WHERE id=?', [f.library.id])).toEqual(before)
  expect((await f.storage.select('SELECT * FROM schedule_tasks WHERE project_id=?', [f.project.id])).length).toBeGreaterThan(0)
})

it('原库旧回执欠同可信identity原意图时保未知，不能伪未应用封存或改造新正文覆盖', async () => {
  const f = await fixture()
  const source = await migrationFixture(f, false, true)
  await source.migration.adopt(source.command, f.session)
  const descriptor = { commandId: 'legacy-wbs-command', workspaceId: f.session().workspaceId, actorId: f.session().actorId, family: 'schedule', targetId: f.project.id, action: 'create-group' }
  await expect(f.service.resolve(descriptor, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  await expect(f.service.execute(await f.command({ kind: 'set-baseline' }, descriptor.commandId), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  expect(await f.storage.select('SELECT * FROM schedule_command_resolutions WHERE command_id=?', [descriptor.commandId])).toEqual([])
  expect(await f.storage.select('SELECT * FROM schedule_command_intents WHERE command_id=?', [descriptor.commandId])).toEqual([])
})

it('手工阶段追加工序沿用既有has_qty/manual/stage互斥约束，冻结源阶段引用仍保留', async () => {
  const f = await fixture()
  await f.storage.execute('UPDATE construction_stages SET completion_mode=\'manual\' WHERE id=\'wbs-s\'')
  await f.storage.execute('DELETE FROM construction_stage_items WHERE stage_id=\'wbs-s\'')
  const created = await f.service.execute(await f.command(f.group()), f.session)
  const added = await f.service.execute(await f.command({ kind: 'add-task', groupId: String(created.value), draft: { templateKey: 'wall', plannedStart: '2026-10-14' } }), f.session)
  const row = (await f.storage.select<{ has_qty: number, manual_progress: number, stage_id: string | null, template_snapshot_json: string }>('SELECT * FROM schedule_tasks WHERE id=?', [added.value]))[0]!
  expect(row).toMatchObject({ has_qty: 0, manual_progress: 0, stage_id: null })
  expect(JSON.parse(row.template_snapshot_json)).toMatchObject({ stageId: 'wbs-s', stageCode: 'WALL' })
})

it('缺真实上游的合同绑定拒写，原号可封存已知未应用，迟到相同正文不能绑定', async () => {
  const f = await fixture()
  const group = await f.service.execute(await f.command(f.group()), f.session)
  const command = await f.command({ kind: 'bind-contract', groupId: String(group.value), contractId: 'unjoined-contract' })
  await expect(f.service.execute(command, f.session)).rejects.toMatchObject({ problem: { code: 'stale-source', commandId: command.commandId, commandOutcome: 'not-applied' } })
  const descriptor = { family: 'schedule', targetId: f.project.id, action: 'bind-contract', commandId: command.commandId, workspaceId: command.workspaceId, actorId: command.actorId }
  expect(await f.service.resolve(descriptor, f.session)).toEqual({ outcome: 'not-applied', commandId: command.commandId })
  await expect(f.service.execute(command, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  expect((await f.service.read(f.query, '', f.session)).snapshot.groups[0]).toMatchObject({ scopeBasis: 'provisional', contractId: '' })
})

it('正式WBS不读Native合同库，真实暂估逐单位保8/null与0；GET不建表或改事实', async () => {
  const f = await fixture()
  const before = (await f.storage.select<{ n: number }>('SELECT total_changes() AS n'))[0]!.n
  expect((await f.service.read(f.query, '', f.session)).contractSourceState).toBe('unavailable')
  const preview = await f.service.scope(f.query, ['wbs-b', 'wbs-empty'], f.session)
  expect(preview.preview.quantities).toEqual(expect.arrayContaining([expect.objectContaining({ unit: '㎡', value: null, knownValue: 8, missingCount: 1 }), expect.objectContaining({ unit: 'm', value: 0, missingCount: 0 })]))
  expect((await f.storage.select<{ n: number }>('SELECT total_changes() AS n'))[0]!.n).toBe(before)
  const request = await f.command(f.group())
  const saved = await f.service.execute(request, f.session)
  expect(await f.service.execute(request, f.session)).toEqual(saved)
  const read = await f.service.read(f.query, '', f.session)
  expect(read.snapshot.groups[0]!.tasks[0]!.floorPlans[0]).toMatchObject({ provisionalQty: null, quantitySnapshot: { knownValue: 8, missingCount: 1, value: null } })
  expect(await f.storage.select('SELECT name FROM sqlite_schema WHERE name IN (\'contracts\',\'schedule_process_libraries\')')).toEqual([])
  const columns = (await f.storage.select<{ name: string }>('PRAGMA table_info(boq_lines)')).map(row => row.name)
  expect(columns).toContain('record_json')
  expect(columns).not.toContain('qty')
  expect(columns).not.toContain('item_name')
})

it('真实施工主合同/已确认BOQ逐栋逐item来源可直接建合同WBS，不复制Native列/主档/量价', async () => {
  const f = await fixture()
  const source = await createWbsActualBoqFixture(f)
  const before = (await f.storage.select<{ n: number }>('SELECT total_changes() AS n'))[0]!.n
  const read = await f.service.read(f.query, source.main.id, f.session)
  expect(read.contractSourceState).toBe('available')
  expect(read.contracts).toEqual([{ id: source.main.id, projectId: f.project.id, no: 'WBS-MAIN', name: 'WBS真实施工主合同', lineCount: 2 }])
  expect(read.buildingCoverage).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'wbs-b', inContract: true, scheduled: false }), expect.objectContaining({ id: 'wbs-empty', inContract: false })]))
  expect((await f.storage.select<{ n: number }>('SELECT total_changes() AS n'))[0]!.n).toBe(before)
  const action = f.group()
  const command = await f.command({ ...action, draft: { ...action.draft, scopeBasis: 'contract', contractId: source.main.id, name: '实际合同计划' } })
  // Contract plans consume physical floors/unit type and BOQ scope, not the unrelated provisional quantities.
  await f.storage.withTransaction(tx => tx.execute('UPDATE house_type_template_items SET provisional_qty=99 WHERE id=\'wbs-a\''))
  const saved = await f.service.execute(command, f.session)
  expect(await f.service.execute(command, f.session)).toEqual(saved)
  const result = await f.service.read(f.query, '', f.session)
  expect(result.snapshot.groups[0]).toMatchObject({ contractId: source.main.id, scopeBasis: 'contract' })
  expect(result.snapshot.groups[0]!.tasks[0]!.floorPlans[0]).toMatchObject({ boqLineId: source.saved.lineIds![0], sourceBasis: 'contract', itemName: '墙面原清单' })
  expect(await f.storage.select('SELECT name FROM sqlite_schema WHERE name=\'contracts\'')).toEqual([])
})

it('实际楼栋声明stableID优先，元数据改名后不按旧标签误接另一栋，原ID失效也不fallback', async () => {
  const f = await fixture()
  const source = await createWbsActualBoqFixture(f)
  f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'quantity:read'] })
  const evidence = await source.owner.building(source.scope, f.session)
  const lineId = source.saved.lineIds![0]!
  await source.owner.correctBuilding({ ...source.scope, workspaceId: f.session().workspaceId, actorId: f.session().actorId, commandId: 'wbs-real-stable-building-declaration', requiredCapability: 'owner-document:write', sourceVersion: evidence.sourceVersion, contractVersion: evidence.contractVersion!, lineId, lineVersion: evidence.lines.find(row => row.id === lineId)!.version!, buildingId: 'wbs-b', buildingVersion: evidence.buildings.find(row => row.id === 'wbs-b')!.version!, reason: '原施工书面证明固定此楼栋身份' }, f.session)
  await f.storage.withTransaction(async (tx) => {
    await tx.execute('UPDATE buildings SET code=\'X\',name=\'已更名的一栋\' WHERE id=\'wbs-b\'')
    await tx.execute('INSERT INTO buildings(id,project_id,code,name) VALUES(?,?,?,?)', ['wbs-another-b', f.project.id, 'B', '另一栋同旧标签'])
  })
  const read = await f.service.read(f.query, source.main.id, f.session)
  expect(read.buildingCoverage.find(row => row.id === 'wbs-b')?.inContract).toBe(true)
  // The uncorrected ZERO line still carries its original legacy label; it cannot displace the WALL declaration.
  const action = f.group()
  const saved = await f.service.execute(await f.command({ ...action, draft: { ...action.draft, scopeBasis: 'contract', contractId: source.main.id, name: '固定楼栋计划' } }), f.session)
  expect((await f.service.read(f.query, '', f.session)).snapshot.groups.find(row => row.id === saved.value)?.tasks[0]?.floorPlans[0]).toMatchObject({ floorId: 'wbs-f', boqLineId: lineId })
  await f.storage.withTransaction(tx => tx.execute('UPDATE buildings SET deleted_at=? WHERE id=\'wbs-b\'', ['2026-10-07T00:00:00.000Z']))
  const after = await f.service.read(f.query, source.main.id, f.session)
  expect(after.buildingCoverage.find(row => row.id === 'wbs-b')).toBeUndefined()
  expect(after.buildingCoverage.find(row => row.id === 'wbs-another-b')?.inContract).toBe(true)
  const ownLineCoverage = await f.storage.withTransaction(async (tx) => {
    const { productionWbsLinesByItem } = await import('../../server/utils/production-wbs-boq-sources')
    return productionWbsLinesByItem(tx, f.session(), f.project.id, source.main.id, ['wbs-i'], ['wbs-another-b'])
  })
  expect([...ownLineCoverage.values()].flat()).toEqual([])
})

it('真正同Main绑定保冻结8/null与原执行；无关兄弟价格可保存，原号独立冷恢复不再绑定', async () => {
  const f = await fixture()
  const source = await createWbsActualBoqFixture(f)
  const made = await f.service.execute(await f.command(f.group()), f.session)
  const groupId = String(made.value)
  const preview = await f.service.binding(f.query, groupId, source.main.id, f.session)
  expect(preview.preview?.items.find(row => row.id === 'wbs-i')).toMatchObject({ provisional: { value: null, knownValue: 8, missingCount: 1 }, contract: { value: 0, missingCount: 0 }, differenceQty: null })
  expect(preview.preview?.canBind).toBe(true)
  const frozen = await f.storage.select('SELECT * FROM schedule_floor_quantity_snapshots ORDER BY id')
  const command = await f.command({ kind: 'bind-contract', groupId, contractId: source.main.id })
  const other = (await source.owner.read(source.scope, f.session)).lines.find(row => row.id === source.saved.lineIds![1])!
  await source.owner.execute({ ...source.command, commandId: 'wbs-unrelated-sibling-price', action: { kind: 'patch-line', lineId: other.id, version: other.version, patch: { unitPrice: 99 } } }, f.session)
  const saved = await f.service.execute(command, f.session)
  expect(await f.service.execute(command, f.session)).toEqual(saved)
  expect(await f.storage.select('SELECT * FROM schedule_floor_quantity_snapshots ORDER BY id')).toEqual(frozen)
  const bound = await f.service.binding(f.query, groupId, source.main.id, f.session)
  expect(bound.binding).toMatchObject({ contractId: source.main.id, legacyDetailMissing: false, actorId: f.session().actorId })
  const descriptor = { family: 'schedule', targetId: f.project.id, action: 'bind-contract', commandId: command.commandId, workspaceId: command.workspaceId, actorId: command.actorId }
  const output = resolve(f.options.directory, 'cold-wbs-actual-boq.json')
  await f.storage.close()
  await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('tests/helpers/production-wbs-cold.ts'), f.options.directory, f.project.id, JSON.stringify(descriptor), output], { windowsHide: true })
  const cold = JSON.parse(await readFile(output, 'utf8'))
  expect(cold.resolution).toEqual({ outcome: 'applied', result: saved })
  expect(cold.read.snapshot.groups[0]).toMatchObject({ scopeBasis: 'contract', contractId: source.main.id })
}, 20_000)

it('绑定真正已读BOQ量或冻结逐户证据变化拒原号整动作，不把price或全Main版本作冲突', async () => {
  const f = await fixture()
  const source = await createWbsActualBoqFixture(f)
  const made = await f.service.execute(await f.command(f.group()), f.session)
  const command = await f.command({ kind: 'bind-contract', groupId: String(made.value), contractId: source.main.id })
  const current = (await source.owner.read(source.scope, f.session)).lines.find(row => row.id === source.saved.lineIds![0])!
  await source.owner.execute({ ...source.command, commandId: 'wbs-real-consumed-boq-qty', action: { kind: 'patch-line', lineId: current.id, version: current.version, patch: { qty: 3 } } }, f.session)
  await expect(f.service.execute(command, f.session)).rejects.toMatchObject({ problem: { code: 'stale-source', commandOutcome: 'not-applied' } })
  expect((await f.service.read(f.query, '', f.session)).snapshot.groups[0]).toMatchObject({ scopeBasis: 'provisional', contractId: '' })
  const next = await f.command({ kind: 'bind-contract', groupId: String(made.value), contractId: source.main.id })
  await f.storage.withTransaction(tx => tx.execute('UPDATE schedule_task_floor_plans SET provisional_qty=0 WHERE source_basis=\'provisional\''))
  await expect(f.service.execute(next, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  expect(await f.storage.select('SELECT command_id FROM schedule_command_intents WHERE command_id=?', [next.commandId])).toEqual([])
})

it('施工详情只消费实际同Main已存BOQ变更，真实零/已批增额及权限缺口不借开发单据或假零', async () => {
  const f = await fixture()
  const source = await createWbsActualBoqFixture(f)
  const before = await source.construction.detail(source.main.id, { origin: 'real' }, f.session)
  expect(before.sections.changes).toEqual([])
  expect(before.meta.sources.find(row => row.key === 'boq-changes')).toMatchObject({ state: 'readable', sourceVersion: expect.any(String) })
  expect(before.contract.amounts).toMatchObject({ contract: null, changed: null, settled: null, received: null })
  const actor = f.session()
  const draft = { projectId: f.project.id, contractId: source.main.id, no: 'WBS-MAIN-CHANGE', name: '真正已批增加工程量', documentType: 'change_negotiation', applicationDate: '2026-10-07', reason: '原施工明确增加依据', note: '', lines: [{ id: 'main-real-quantity-change', operation: 'qty', boqLineId: source.saved.lineIds![0], deltaQty: 2, newUnitPrice: null }] }
  const base = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'owner-document:write' as const, kind: 'owner_change' as const, attachments: {} }
  const saved = await source.owner.execute({ ...source.command, commandId: 'main-boq-change-save', action: { kind: 'owner-change', command: { ...base, commandId: 'main-boq-change-save', id: null, baseVersion: null, action: 'save', draft } } }, f.session)
  await source.owner.execute({ ...source.command, commandId: 'main-boq-change-submit', action: { kind: 'owner-change', command: { ...base, commandId: 'main-boq-change-submit', id: saved.changeId!, baseVersion: '1', action: 'submit', draft } } }, f.session)
  const { attachments: _saveOnlyAttachments, ...approvalBase } = base
  await source.owner.execute({ ...source.command, commandId: 'main-boq-change-approve', action: { kind: 'owner-change', command: { ...approvalBase, commandId: 'main-boq-change-approve', id: saved.changeId!, baseVersion: '2', action: 'approve', approvedAt: '2026-10-07' } } }, f.session)
  const actual = await source.construction.detail(source.main.id, { origin: 'real' }, f.session)
  expect(actual.sections.changes).toEqual([expect.objectContaining({ id: saved.changeId, status: 'approved', amount: '24.00', navigation: { kind: 'unavailable', reason: 'unverified-target' } })])
  expect(actual.meta.sources.find(row => row.key === 'boq-changes')?.sourceVersion).not.toBe(before.meta.sources.find(row => row.key === 'boq-changes')?.sourceVersion)
  f.setActor({ ...actor, capabilities: actor.capabilities.filter(capability => capability !== 'boq:read') })
  const blocked = await source.construction.detail(source.main.id, { origin: 'real' }, f.session)
  expect(blocked.meta.sources.find(row => row.key === 'boq-changes')).toMatchObject({ state: 'forbidden', sourceVersion: null })
  expect(blocked.sections.changes).toEqual([])
  expect(blocked.contract.amounts.changed).toBeNull()
})

it('被真实BOQ消费的Main跨项目改写整动作拒绝，旧原号/数据仍可读；无消费Main可合法改项目', async () => {
  const f = await fixture()
  const source = await createWbsActualBoqFixture(f)
  const actor = f.session()
  const other = await createProductionProjectService(f.storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'project:write', commandId: 'main-other-real-project', baseVersion: null, action: 'draft', draft: { name: '另一真实项目', customerId: source.customer.id }, attachments: {} }, f.session)
  const form = await source.construction.form(source.main.id, f.session)
  const before = await f.storage.select('SELECT * FROM construction_contract_records ORDER BY id')
  await expect(source.construction.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'construction-contract:write', commandId: 'main-consumed-move-rejected', id: source.main.id, baseVersion: form.version, action: 'save', draft: { ...form.draft, projectId: other.id }, attachments: {} }, f.session, source.main.id)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch', commandOutcome: 'not-applied' } })
  expect(await f.storage.select('SELECT * FROM construction_contract_records ORDER BY id')).toEqual(before)
  expect(await source.construction.resolve('wbs-upstream-main', f.session)).toEqual({ outcome: 'applied', result: source.main })
  expect((await source.owner.read(source.scope, f.session)).lines.map(row => row.id).sort()).toEqual([...source.saved.lineIds!].sort())
  const { id: _originalId, ...newDraft } = form.draft
  const idle = await source.construction.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'construction-contract:write', commandId: 'main-unconsumed-original', baseVersion: null, action: 'save', draft: { ...newDraft, no: 'MAIN-NOT-CONSUMED', name: '尚无下游的主合同' }, attachments: {} }, f.session)
  const idleForm = await source.construction.form(idle.id, f.session)
  await source.construction.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'construction-contract:write', commandId: 'main-unconsumed-move', id: idle.id, baseVersion: idleForm.version, action: 'save', draft: { ...idleForm.draft, projectId: other.id }, attachments: {} }, f.session, idle.id)
  expect((await source.construction.form(idle.id, f.session)).draft.projectId).toBe(other.id)
})
it('实际消费版本允许无关库版本更新，阻断采用区域变化；原编号恢复与迟到拒绝', async () => {
  const f = await fixture()
  const request = await f.command(f.group())
  await f.libraryService.execute({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, origin: 'real', requiredCapability: 'process-library:write', commandId: 'wbs-unrelated-library', action: 'create-version', baseVersion: 0, sourceVersion: null, draft: { sourceLibraryId: null, code: 'OTHER', name: '无关库', description: '', tasks: [{ key: 'one', name: '无关工序', durationDays: 1, trade: '杂工', color: '#123456', stageCode: '', itemCodes: [], predecessorKey: null }] } }, f.session)
  await f.storage.execute('INSERT INTO construction_stages(id,project_id,code,name,trade,completion_mode) VALUES(?,?,\'UNUSED\',\'无关阶段\',\'杂工\',\'manual\')', ['wbs-unused-stage', f.project.id])
  await f.storage.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(?,?,\'UNUSED\',\'无关分项\',\'杂工\',\'m\')', ['wbs-unused-item', f.project.id])
  const saved = await f.service.execute(request, f.session)
  const descriptor = { commandId: request.commandId, workspaceId: request.workspaceId, actorId: request.actorId, family: 'schedule', targetId: request.projectId, action: request.action.kind }
  expect(await f.service.resolve(descriptor, f.session)).toEqual({ outcome: 'applied', result: saved })
  const task = (await f.service.read(f.query, '', f.session)).snapshot.groups[0]!.tasks[1]!
  const edit = await f.command({ kind: 'update-task', taskId: task.id, patch: { manualProgress: 0.5 } })
  await f.storage.execute('UPDATE house_type_template_items SET provisional_qty=9 WHERE id=\'wbs-a\'')
  await f.service.execute(edit, f.session)
  const absent = { ...descriptor, commandId: 'wbs-never-applied', action: 'set-baseline' }
  expect(await f.service.resolve(absent, f.session)).toEqual({ outcome: 'not-applied', commandId: absent.commandId })
  await expect(f.service.execute(await f.command({ kind: 'set-baseline' }, absent.commandId), f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
})
