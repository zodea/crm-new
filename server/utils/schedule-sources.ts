import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { QuantityBoqWorkspace } from '../../app/lib/quantity/central-boq'
import type { ProcessLibraryVersion } from '../../app/lib/schedule/process-library-contract'

export interface ScheduleSources {
  version: string
  contracts: { id: string, projectId: string, name: string, no: string }[]
  boq: QuantityBoqWorkspace
  libraries: ProcessLibraryVersion[]
}

/** 只投影当前权威事实；分项只通过显式中央 BOQ 关联解析，不按名称补 ID。 */
export async function synchronizeScheduleSources(db: TransactionDb, projectId: string, source: ScheduleSources) {
  await db.execute('UPDATE contracts SET deleted_at = \'source-unavailable\' WHERE project_id = ?', [projectId])
  await db.execute('UPDATE boq_lines SET deleted_at = \'source-unavailable\' WHERE project_id = ?', [projectId])
  for (const contract of source.contracts) {
    await db.execute(`INSERT INTO contracts (id, project_id, name, no, kind) VALUES (?, ?, ?, ?, '施工')
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, no = excluded.no, deleted_at = NULL`, [contract.id, projectId, contract.name, contract.no])
    await db.execute('INSERT INTO quantity_contract_references (id, project_id) VALUES (?, ?) ON CONFLICT(id) DO NOTHING', [contract.id, projectId])
  }
  for (const line of source.boq.lines) {
    if (!source.contracts.some(contract => contract.id === line.contractId))
      continue
    const fileId = `schedule-central-boq:${line.contractId}`
    await db.execute('INSERT INTO boq_files (id, contract_id, file_name, parse_status) VALUES (?, ?, \'中央清单投影\', \'parsed\') ON CONFLICT(id) DO NOTHING', [fileId, line.contractId])
    const mapped = await db.select<{ item_id: string }>(`SELECT DISTINCT item.item_id FROM house_type_template_items item
      JOIN rooms room ON room.id = item.room_id JOIN house_type_templates template ON template.id = room.template_id
      WHERE item.boq_line_id = ? AND item.deleted_at IS NULL AND room.deleted_at IS NULL AND template.deleted_at IS NULL AND template.project_id = ?`, [line.id, projectId])
    await db.execute(`INSERT INTO boq_lines (id, boq_file_id, project_id, contract_id, item_id, item_name, unit, qty, unit_price, building, unit_type, floor_zone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET item_id = excluded.item_id, item_name = excluded.item_name,
      unit = excluded.unit, qty = excluded.qty, unit_price = excluded.unit_price, building = excluded.building, unit_type = excluded.unit_type, floor_zone = excluded.floor_zone, deleted_at = NULL`, [line.id, fileId, projectId, line.contractId, mapped.length === 1 ? mapped[0]!.item_id : null, line.itemName, line.unit, line.qty, line.unitPrice, line.building ?? '', line.unitType ?? '', line.floorZone ?? ''])
    await db.execute('INSERT INTO quantity_boq_references (id, project_id, contract_id) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING', [line.id, projectId, line.contractId])
  }
  // 库正文保持不可变；这个 SQL 适配只服务现有排程引擎。
  await db.execute('UPDATE schedule_process_libraries SET is_default = 0, deleted_at = \'source-unavailable\'')
  await db.execute('UPDATE schedule_process_library_tasks SET deleted_at = \'source-unavailable\'')
  for (const library of source.libraries) {
    await db.execute(`INSERT INTO schedule_process_libraries (id, code, name, version, description, is_default, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET deleted_at = NULL, is_default = excluded.is_default`, [library.id, library.code, library.name, library.version, library.description, Number(library.isDefault), library.sortOrder])
    for (const task of library.tasks) {
      await db.execute(`INSERT INTO schedule_process_library_tasks (id, library_id, task_key, name, trade, color, duration_days, stage_code, item_codes_json, sort_order, predecessor_task_key, predecessor_disabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET deleted_at = NULL`, [task.id, library.id, task.key, task.name, task.trade, task.color, task.durationDays, task.stageCode ?? '', JSON.stringify(task.itemCodes), task.sortOrder, task.predecessorKey, Number(task.predecessorDisabled)])
    }
  }
}
