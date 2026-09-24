/** 关联子查询不会返回无单头记录，必须在采证入口单独检查，不能把它们计为已迁。 */
export const DELIVERY_SOURCE_DIAGNOSTICS_SQL = `SELECT
  (SELECT COUNT(*) FROM delivery_lines l WHERE NOT EXISTS
    (SELECT 1 FROM delivery_records d WHERE d.id = l.delivery_record_id)) AS orphan_lines,
  (SELECT COUNT(*) FROM file_refs f WHERE f.owner_type = 'delivery_record' AND NOT EXISTS
    (SELECT 1 FROM delivery_records d WHERE d.id = f.owner_id)) AS orphan_sources,
  (SELECT COUNT(*) FROM operation_logs o WHERE o.table_name = 'delivery_records' AND NOT EXISTS
    (SELECT 1 FROM delivery_records d WHERE d.id = o.record_id)) AS orphan_audit`

export function assertDeliverySourceDiagnostics(rows: readonly Record<string, unknown>[]) {
  const row = rows[0]
  const keys = ['orphan_lines', 'orphan_sources', 'orphan_audit'] as const
  if (rows.length !== 1 || !row || keys.some(key => typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || row[key] < 0))
    throw new Error('送货迁移孤儿诊断未完成，请重新读取旧库')
  if (keys.some(key => row[key] !== 0))
    throw new Error(`送货迁移存在孤儿记录：材料行 ${row.orphan_lines}、原件引用 ${row.orphan_sources}、审计 ${row.orphan_audit}。原数据仍保留，请先对账后重试。`)
}
