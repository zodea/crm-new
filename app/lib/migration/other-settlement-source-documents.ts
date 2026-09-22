import type { CoreMigrationSourceEntityDTO } from './core-contract'

const linkedApplications = `SELECT DISTINCT a.payment_application_id FROM payment_application_settlement_allocations a JOIN expenditure_settlements s ON s.id = a.settlement_id WHERE s.biz_type IN ('机械', '其他', '其他支出')`
const filesSql = (owner: string) => `(SELECT json_group_array(json_object('id', f.id, 'fileName', f.file_name, 'fileSize', f.file_size, 'uploader', f.uploader, 'uploadedAt', f.uploaded_at, 'deletedAt', f.deleted_at)) FROM file_refs f WHERE f.owner_type = '${owner}' AND f.owner_id = p.id) files_json`
// Source records and allocation identities are read independently of settlement totals.
export const OTHER_SETTLEMENT_APPLICATION_SOURCE_SQL = `SELECT p.*,
  ${filesSql('payment_application')},
  (SELECT json_group_array(json_object('id', a.id, 'targetId', a.settlement_id, 'amount', a.allocated_amount, 'deletedAt', a.deleted_at)) FROM payment_application_settlement_allocations a WHERE a.payment_application_id = p.id) allocations_json
  FROM payment_applications p WHERE p.id IN (${linkedApplications})`
export const OTHER_SETTLEMENT_PAYMENT_SOURCE_SQL = `SELECT p.*,
  ${filesSql('payment_record')},
  (SELECT json_group_array(json_object('id', a.id, 'targetId', a.payment_application_id, 'amount', a.allocated_amount, 'deletedAt', a.deleted_at)) FROM payment_record_application_allocations a WHERE a.payment_record_id = p.id) allocations_json
  FROM payment_records p WHERE EXISTS (SELECT 1 FROM payment_record_application_allocations a WHERE a.payment_record_id = p.id AND a.payment_application_id IN (${linkedApplications}))`
export function otherSettlementDocumentSource(row: Record<string, unknown>, kind: 'application' | 'payment'): CoreMigrationSourceEntityDTO {
  const string = (key: string) => row[key] == null ? null : String(row[key])
  const fields = kind === 'application'
    ? ['biz_type', 'applicant', 'invoice_state', 'pay_content', 'prepay_note', 'approval_note', 'external_ref', 'note', 'apply_date', 'created_at', 'updated_at']
    : ['payee_name', 'payment_method', 'purpose', 'voucher_no', 'bank_serial_no', 'confirmed_by', 'confirmed_at', 'payment_date', 'handler', 'note', 'created_at', 'updated_at']
  return {
    legacyId: `${kind}:${row.id}`,
    name: string(kind === 'application' ? 'name' : 'purpose') || string('no') || (kind === 'application' ? '付款申请' : '支付记录'),
    deletedAt: string('deleted_at'),
    amount: row[kind === 'application' ? 'apply_amount' : 'amount'] == null ? null : Number(row[kind === 'application' ? 'apply_amount' : 'amount']).toFixed(2),
    references: { projectId: string('project_id'), supplierId: string('supplier_id'), ...(kind === 'application' ? { contractId: row.contract_id == null ? null : `other_expense:${row.contract_id}` } : {}) },
    attributes: { kind, no: string('no'), status: string(kind === 'application' ? 'status' : 'confirmation_status'), approvedAmount: kind === 'application' && row.approved_amount != null ? Number(row.approved_amount).toFixed(2) : null, ...(kind === 'application' ? { approvedAmountOrigin: row.approved_amount_origin === 'user-entry' ? 'user-entry' : 'legacy' } : {}), allocationsJson: string('allocations_json') || '[]', filesJson: string('files_json') || '[]', ...Object.fromEntries(fields.map(key => [key, string(key)])) },
  }
}
