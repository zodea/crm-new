import type { CoreMigrationSourceEntityDTO } from './core-contract'

const files = (ownerType: string) => `(SELECT json_group_array(json_object('id', f.id, 'ownerType', '${ownerType}', 'ownerId', c.id, 'fileName', f.file_name, 'filePath', '', 'fileSize', f.file_size, 'mimeType', f.mime_type, 'category', f.category, 'uploader', f.uploader, 'uploadedAt', f.uploaded_at, 'deletedAt', f.deleted_at)) FROM file_refs f WHERE f.owner_type = '${ownerType}' AND f.owner_id = c.id)`
function facts(kind: string, fk: string) {
  return `(SELECT json_group_array(json_object('id', id, 'kind', kind, 'no', no, 'name', name, 'amount', amount, 'date', date, 'status', status, 'effective', effective)) FROM (
    SELECT i.id, 'invoice' kind, i.invoice_number no, i.seller name, CASE WHEN i.total_amount IS NULL THEN NULL ELSE printf('%.2f', i.total_amount) END amount, i.invoice_date date, i.account_status status, i.account_status = 'archived' effective FROM invoices i WHERE i.${fk} = c.id AND i.deleted_at IS NULL
    UNION ALL
    SELECT a.id, 'payment', r.no, r.purpose, printf('%.2f', a.allocated_amount), r.payment_date, r.confirmation_status, r.confirmation_status = 'confirmed'
      FROM payment_record_application_allocations a JOIN payment_applications p ON p.id = a.payment_application_id JOIN payment_records r ON r.id = a.payment_record_id
      WHERE p.${fk} = c.id AND a.deleted_at IS NULL AND p.deleted_at IS NULL AND r.deleted_at IS NULL
    ${kind === 'other_expense'
      ? `UNION ALL SELECT s.id, 'settlement', s.no, s.name, CASE WHEN s.total_amount IS NULL THEN NULL ELSE printf('%.2f', s.total_amount) END, s.settlement_date, s.status, s.status IN ('confirmed', '已确认') FROM expenditure_settlements s WHERE s.contract_id = c.id AND s.project_id = c.project_id AND s.supplier_id = c.supplier_id AND s.deleted_at IS NULL
    UNION ALL SELECT s.id, 'supplement', s.no, s.name, printf('%.2f', s.amount), s.sign_date, s.status, s.status IN ('生效', '已生效', 'approved') FROM contract_supplements s WHERE s.contract_id = c.id AND s.deleted_at IS NULL`
      : ''}
  ))`
}
export const AUXILIARY_CONTRACT_SOURCE_SQL = `
  SELECT c.*, 'other_expense' auxiliary_kind, c.other_expense_kind category, NULL counterparty,
    ${files('contract')} files_json, ${facts('other_expense', 'contract_id')} facts_json
    FROM contracts c WHERE c.kind = '其他支出'
`
export const COMPANY_CONTRACT_SOURCE_SQL = `
  SELECT c.*, 'company_expense' auxiliary_kind, NULL project_id, NULL supplier_id,
    ${files('company_expense_contract')} files_json, ${facts('company_expense', 'company_expense_contract_id')} facts_json
    FROM company_expense_contracts c
`
export function auxiliaryContractSourceEntity(row: Record<string, unknown>): CoreMigrationSourceEntityDTO {
  const kind = String(row.auxiliary_kind)
  return {
    legacyId: `${kind}:${row.id}`,
    name: String(row.name ?? ''),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    references: kind === 'other_expense' ? { projectId: row.project_id == null ? null : String(row.project_id), supplierId: row.supplier_id == null ? null : String(row.supplier_id) } : {},
    amount: row.amount == null ? null : Number(row.amount).toFixed(2),
    attributes: {
      kind,
      sourceId: String(row.id),
      no: String(row.no ?? ''),
      category: String(row.category ?? ''),
      counterparty: String(row.counterparty ?? ''),
      partyA: row.party_a == null ? null : String(row.party_a),
      taxRate: row.tax_rate == null ? null : Number(row.tax_rate),
      invoiceType: row.invoice_type == null ? null : String(row.invoice_type),
      signDate: String(row.sign_date ?? ''),
      servicePeriod: String(row.service_period ?? ''),
      paymentCycle: String(row.payment_cycle ?? ''),
      mainTerms: String(row.main_terms ?? ''),
      content: row.content == null ? null : String(row.content),
      contactName: row.contact_name == null ? null : String(row.contact_name),
      contactPhone: row.contact_phone == null ? null : String(row.contact_phone),
      status: String(row.status ?? ''),
      note: String(row.note ?? ''),
      createdAt: row.created_at == null ? null : String(row.created_at),
      updatedAt: row.updated_at == null ? null : String(row.updated_at),
      createdBy: row.created_by == null ? null : String(row.created_by),
      updatedBy: row.updated_by == null ? null : String(row.updated_by),
      responsible: row.responsible == null ? null : String(row.responsible),
      department: row.department == null ? null : String(row.department),
      settlementStatus: row.settlement_status == null ? null : String(row.settlement_status),
      clearanceStatus: row.clearance_status == null ? null : String(row.clearance_status),
      filesJson: String(row.files_json ?? '[]'),
      factsJson: String(row.facts_json ?? '[]'),
    },
  }
}
