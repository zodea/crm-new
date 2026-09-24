import type { CoreMigrationSourceEntityDTO } from './core-contract'

export const OTHER_SETTLEMENT_SOURCE_SQL = `SELECT s.*,
  (SELECT json_group_array(json_object('id', f.id, 'fileName', f.file_name, 'fileSize', f.file_size, 'mimeType', f.mime_type, 'category', f.category, 'uploader', f.uploader, 'uploadedAt', f.uploaded_at, 'deletedAt', f.deleted_at)) FROM file_refs f WHERE f.owner_type = 'expenditure_settlement' AND f.owner_id = s.id) files_json,
  (SELECT json_group_array(json_object('id', id, 'kind', kind, 'sourceId', source_id, 'parentId', parent_id, 'projectId', project_id, 'supplierId', supplier_id, 'contractId', contract_id, 'no', no, 'name', name, 'amount', amount, 'date', date, 'status', status, 'effective', effective, 'attribution', attribution)) FROM (
    SELECT d.id, 'penalty' kind, p.id source_id, NULL parent_id, p.projectId project_id, COALESCE(p.supplier_id, s.supplier_id) supplier_id, COALESCE(p.contract_id, s.contract_id) contract_id,
      p.noticeNo no, p.reason name, printf('%.2f', d.amount) amount, d.created_at date, 'executed' status,
      (d.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status <> 'draft' AND (p.contract_id IS NOT NULL OR p.supplier_id IS NOT NULL)) effective, 'exact' attribution
      FROM penalty_settlement_deductions d JOIN penalty_records p ON p.id = d.penalty_id WHERE d.settlement_id = s.id
    UNION ALL
    SELECT a.id, 'application', p.id, NULL, p.project_id, p.supplier_id, p.contract_id, p.no, p.name, printf('%.2f', a.allocated_amount), p.apply_date, p.status,
      (a.deleted_at IS NULL AND p.deleted_at IS NULL), 'exact'
      FROM payment_application_settlement_allocations a JOIN payment_applications p ON p.id = a.payment_application_id WHERE a.settlement_id = s.id
    UNION ALL
    SELECT a.id, 'payment', r.id, p.id, p.project_id, p.supplier_id, p.contract_id, r.no, r.purpose, printf('%.2f', a.allocated_amount), r.payment_date, r.confirmation_status,
      (a.deleted_at IS NULL AND r.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status IN ('submitted','approved','paying','paid')),
      CASE WHEN (SELECT COUNT(DISTINCT x.settlement_id) FROM payment_application_settlement_allocations x WHERE x.payment_application_id = p.id AND x.deleted_at IS NULL) = 1 THEN 'exact' ELSE 'unknown' END
      FROM payment_record_application_allocations a JOIN payment_records r ON r.id = a.payment_record_id JOIN payment_applications p ON p.id = a.payment_application_id
      WHERE EXISTS (SELECT 1 FROM payment_application_settlement_allocations x WHERE x.payment_application_id = p.id AND x.settlement_id = s.id AND x.deleted_at IS NULL)
  )) facts_json
  FROM expenditure_settlements s WHERE s.biz_type IN ('机械', '其他', '其他支出')`
export function otherSettlementSourceEntity(row: Record<string, unknown>): CoreMigrationSourceEntityDTO {
  const text = (key: string) => row[key] == null ? null : String(row[key])
  return { legacyId: String(row.id), name: String(row.name ?? ''), deletedAt: text('deleted_at'), amount: row.total_amount == null ? null : Number(row.total_amount).toFixed(2), references: { projectId: text('project_id'), supplierId: text('supplier_id'), contractId: row.contract_id == null ? null : `other_expense:${row.contract_id}` }, attributes: {
    no: text('no'),
    status: text('status'),
    settlementDate: text('settlement_date'),
    settlementType: text('settlement_type'),
    period: text('settlement_period'),
    deductionNote: text('deduction_note'),
    note: text('note'),
    taxRate: row.tax_rate == null ? null : Number(row.tax_rate),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    createdAt: text('created_at'),
    updatedAt: text('updated_at'),
    responsible: text('responsible'),
    department: text('department'),
    sourceProjectId: text('project_id'),
    sourceSupplierId: text('supplier_id'),
    sourceContractId: text('contract_id'),
    filesJson: String(row.files_json ?? '[]'),
    factsJson: String(row.facts_json ?? '[]'),
  } }
}
