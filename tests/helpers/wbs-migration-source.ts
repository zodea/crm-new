import type { TestDb } from './memory-db'
import { SCHEDULE_DEPENDENCY_CONFLICT_OPERATOR } from '../../app/lib/schedule/planning'
import { readQuantityCoreSource, seedQuantityMigrationSource } from './quantity-migration-source'

/** SQLite 六表、无组旧任务、绑定前后审计和冻结量均是原始事实。 */
export async function seedWbsMigrationSource(db: TestDb) {
  await seedQuantityMigrationSource(db)
  await db.execute('INSERT INTO buildings (id,project_id,code,name) VALUES (?,?,?,?)', ['wbs-contract-building', 'q-project', 'B2', '合同待建二栋'])
  await db.execute('INSERT INTO floors (id,building_id,code,name) VALUES (?,?,?,?)', ['wbs-contract-floor', 'wbs-contract-building', 'F1', '一层'])
  await db.execute('INSERT INTO house_type_templates (id,project_id,code,name) VALUES (?,?,?,?)', ['wbs-contract-template', 'q-project', 'TC', '合同待建户型'])
  await db.execute('INSERT INTO rooms (id,template_id,code,name) VALUES (?,?,?,?)', ['wbs-contract-room', 'wbs-contract-template', 'R', '客厅'])
  await db.execute('INSERT INTO units (id,floor_id,house_type_template_id,code) VALUES (?,?,?,?)', ['wbs-contract-unit', 'wbs-contract-floor', 'wbs-contract-template', '201'])
  await db.execute('INSERT INTO boq_lines (id,boq_file_id,project_id,contract_id,item_id,item_name,unit,qty,unit_price,building) VALUES (?,?,?,?,?,?,?,?,?,?)', ['wbs-contract-boq', 'q-source', 'q-project', 'q-contract', 'q-item', '腻子', '㎡', 12, 1, '合同待建二栋'])
  await db.execute('UPDATE boq_lines SET unit_type = ?, floor_zone = ? WHERE id = ?', ['合同待建户型', '一层', 'wbs-contract-boq'])
  await db.execute('INSERT INTO house_type_template_items (id,room_id,item_id,boq_line_id,contract_qty,provisional_qty) VALUES (?,?,?,?,?,?)', ['wbs-contract-line', 'wbs-contract-room', 'q-item', 'wbs-contract-boq', 12, 8])
  await db.execute('INSERT INTO schedule_process_libraries (id,code,name,version) VALUES (?,?,?,?)', ['wbs-library', 'wbs-history', '历史排程库', 3])
  await db.execute('INSERT INTO schedule_process_library_tasks (id,library_id,task_key,name,trade,color,duration_days,stage_code,item_codes_json) VALUES (?,?,?,?,?,?,?,?,?)', ['wbs-library-task', 'wbs-library', 'paint', '原腻子工序', '油漆工', '#123456', 3, 'S', '["I"]'])
  await db.execute('INSERT INTO schedule_groups (id,project_id,name,contract_id,scope_basis,contract_bound_at,process_library_id,process_library_name_snapshot,process_library_version_snapshot) VALUES (?,?,?,?,?,?,?,?,?)', ['wbs-group', 'q-project', '已绑定的原暂估组', 'q-contract', 'contract', '2026-09-11 09:00:00', 'wbs-library', '历史排程库', 3])
  await db.execute('INSERT INTO schedule_group_buildings (id,group_id,building_id) VALUES (?,?,?)', ['wbs-building', 'wbs-group', 'q-building'])
  const snapshot = JSON.stringify({ libraryId: 'wbs-library', libraryTaskId: 'wbs-library-task', libraryVersion: 3, libraryName: '原冻结名称', key: 'paint', itemCodes: ['I'], stageCode: 'S', predecessorKey: null, predecessorDisabled: false, provisionalFloorPlans: [{ floorId: 'q-floor', itemId: 'q-item', provisionalQty: 8, unitCount: 2 }] })
  await db.execute('INSERT INTO schedule_tasks (id,project_id,group_id,name,trade,duration_days,planned_start,planned_finish,baseline_start,baseline_finish,has_qty,stage_id,source_library_task_id,source_library_version,template_snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['wbs-task', 'q-project', 'wbs-group', '原冻结任务', '油漆工', 3, '2026-09-01', '2026-09-03', '2026-08-30', '2026-09-01', 1, 'q-stage', 'wbs-library-task', 3, snapshot])
  await db.execute('INSERT INTO schedule_tasks (id,project_id,group_id,name,duration_days,planned_start,planned_finish,has_qty,manual_progress) VALUES (?,?,?,?,?,?,?,?,?)', ['wbs-manual', 'q-project', 'wbs-group', '手工任务', 2, '2026-09-04', '2026-09-05', 0, 0.25])
  await db.execute('INSERT INTO schedule_tasks (id,project_id,group_id,name,duration_days,planned_start,planned_finish,has_qty,manual_progress,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)', ['wbs-ungrouped', 'q-project', null, '无组旧删除任务', 1, '2026-08-01', '2026-08-01', 0, 0, '2026-08-02 01:00:00'])
  await db.execute('INSERT INTO task_item_map (id,task_id,item_id) VALUES (?,?,?)', ['wbs-item', 'wbs-task', 'q-item'])
  await db.execute('INSERT INTO schedule_task_floor_plans (id,task_id,floor_id,item_id,source_basis,provisional_qty,planned_start,planned_finish,is_manual,note) VALUES (?,?,?,?,?,?,?,?,?,?)', ['wbs-floor', 'wbs-task', 'q-floor', 'q-item', 'provisional', 8, '2026-09-02', '2026-09-03', 1, '保留人工微调与历史8'])
  await db.execute('INSERT INTO task_dependencies (id,pred_id,succ_id,lag_days,deleted_at) VALUES (?,?,?,?,?)', ['wbs-dep', 'wbs-task', 'wbs-manual', 1, '2026-09-11 08:00:00'])
  const [group] = await db.select<Record<string, unknown>>('SELECT * FROM schedule_groups WHERE id = ?', ['wbs-group'])
  const [dependency] = await db.select<Record<string, unknown>>('SELECT * FROM task_dependencies WHERE id = ?', ['wbs-dep'])
  for (const [id, table, record, before, after, operator, action] of [
    ['wbs-bind-log', 'schedule_groups', 'wbs-group', { ...group, contract_id: null, scope_basis: 'provisional', contract_bound_at: null }, group, 'schedule:bind-contract', 'update'],
    ['wbs-disable-log', 'task_dependencies', 'wbs-dep', { ...dependency, deleted_at: null }, dependency, SCHEDULE_DEPENDENCY_CONFLICT_OPERATOR, 'delete'],
  ] as const)
    await db.execute('INSERT INTO operation_logs (id,table_name,record_id,before_data,after_data,operator,action) VALUES (?,?,?,?,?,?,?)', [id, table, record, JSON.stringify(before), JSON.stringify(after), operator, action])
  return readQuantityCoreSource(db)
}
