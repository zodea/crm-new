import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BoqImportEvidence } from './production-boq-import-evidence'
import { boqDigest, boqFail } from './production-boq-record'

function references(value: unknown, ids: ReadonlySet<string>): boolean {
  if (typeof value === 'string')
    return ids.has(value)
  if (Array.isArray(value))
    return value.some(entry => references(entry, ids))
  return !!value && typeof value === 'object' && Object.values(value).some(entry => references(entry, ids))
}
/** All physical and frozen later consumers participate. The batch's own graph may be archived together. */
export async function assertProductionBoqRestoreSafe(tx: Pick<TransactionDb, 'select'>, evidence: BoqImportEvidence) {
  const lineIds = new Set(evidence.mappings.filter(row => row.table === 'boq_lines').map(row => row.id))
  const entityIds = new Set(evidence.mappings.map(row => row.id))
  for (const mapping of evidence.mappings) {
    const [current] = await tx.select(`SELECT * FROM ${mapping.table} WHERE id=?`, [mapping.id])
    if (!current || boqDigest(current) !== evidence.installed[`${mapping.table}:${mapping.id}`])
      return boqFail('conflict', '整批危险恢复拒绝：原施工清单或有效变化已经有后来修改，不能覆盖已确认事实')
  }
  for (const row of await tx.select<{ id: string, record_json: string }>('SELECT id,record_json FROM boq_change_records')) {
    if (!entityIds.has(row.id) && references(JSON.parse(row.record_json), lineIds))
      return boqFail('conflict', '整批危险恢复拒绝：后来变洽签及其历史仍采用原清单')
  }
  for (const intent of await tx.select<{ command_id: string, request_json: string }>('SELECT command_id,request_json FROM boq_command_intents')) {
    if (references(JSON.parse(intent.request_json), entityIds))
      return boqFail('conflict', '整批危险恢复拒绝：后来固定原意图仍引用原清单或原变化')
  }
  const physical = [
    ['house_type_template_items', 'boq_line_id'],
    ['task_item_map', 'boq_line_id'],
    ['schedule_task_floor_plans', 'boq_line_id'],
  ] as const
  for (const [table, column] of physical) {
    const fields = await tx.select<{ name: string }>(`PRAGMA table_info(${table})`)
    if (!fields.some(field => field.name === column))
      continue
    for (const id of lineIds) {
      if ((await tx.select(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`, [id])).length)
        return boqFail('conflict', '整批危险恢复拒绝：工程量模板或WBS当前/软删历史仍引用原清单')
    }
  }
  const snapshots = [
    ['quantity_command_intents', 'request_json'],
    ['quantity_commands', 'request_json'],
    ['schedule_command_intents', 'request_json'],
    ['schedule_floor_quantity_snapshots', 'snapshot_json'],
    ['schedule_groups', 'template_snapshot_json'],
    ['schedule_imports', 'evidence_json'],
    ['payroll_statements', 'snapshot_json'],
    ['payroll_workbooks', 'record_json'],
    ['payroll_source_imports', 'evidence_json'],
    ['payroll_command_receipts', 'request_json'],
  ] as const
  for (const [table, column] of snapshots) {
    const fields = await tx.select<{ name: string }>(`PRAGMA table_info(${table})`)
    if (!fields.some(field => field.name === column))
      continue
    for (const row of await tx.select<Record<string, unknown>>(`SELECT ${column} FROM ${table}`)) {
      if (row[column] == null)
        continue
      let snapshot: unknown
      try {
        snapshot = JSON.parse(String(row[column]))
      }
      catch { return boqFail('unavailable', '完整冻结来源无法读取，不能用空集合放行危险恢复') }
      if (references(snapshot, lineIds))
        return boqFail('conflict', '整批危险恢复拒绝：原命令、WBS冻结或完整工资历史仍采用原清单')
    }
  }
  const ownedConsumers = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')
  for (const { name } of ownedConsumers.filter(row => /^(?:payroll_|wage_|schedule_|task_item_map$|task_dependencies$)/.test(row.name))) {
    for (const row of await tx.select<Record<string, unknown>>(`SELECT * FROM "${name.replaceAll('"', '""')}"`)) {
      for (const value of Object.values(row)) {
        if (references(value, lineIds))
          return boqFail('conflict', '整批危险恢复拒绝：完整工资、WBS或其物理历史仍引用原清单')
        if (typeof value === 'string' && ['{', '['].includes(value.trimStart()[0] ?? '')) {
          let parsed: unknown
          try {
            parsed = JSON.parse(value)
          }
          catch { return boqFail('unavailable', '原消费历史JSON无法完整核对，不能恢复施工清单来源') }
          if (references(parsed, lineIds))
            return boqFail('conflict', '整批危险恢复拒绝：完整工资、WBS冻结或历史原命令仍消费原清单')
        }
      }
    }
  }
}
