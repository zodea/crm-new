/** PG-11 v30: one expenditure settlement head, with an explicit immutable owner. */
export const PRODUCTION_OWNER_SETTLEMENT_UPGRADE = `
ALTER TABLE expenditure_settlements ADD COLUMN document_owner TEXT NOT NULL DEFAULT 'other' CHECK(document_owner IN ('other','business'));
CREATE INDEX expenditure_settlement_owner ON expenditure_settlements(document_owner,project_id,deleted_at);
CREATE TRIGGER expenditure_settlement_owner_immutable BEFORE UPDATE ON expenditure_settlements
WHEN NEW.id IS NOT OLD.id OR NEW.document_owner IS NOT OLD.document_owner
BEGIN SELECT RAISE(ABORT,'expenditure settlement owner and identity are immutable'); END;
DROP TRIGGER other_settlement_confirmed_lock;
CREATE TRIGGER other_settlement_confirmed_lock BEFORE UPDATE ON expenditure_settlements
WHEN OLD.document_owner='other' AND OLD.status IN ('confirmed','已确认')
BEGIN SELECT RAISE(ABORT,'confirmed expenditure settlement is immutable'); END;
CREATE TRIGGER business_settlement_confirmed_lock BEFORE UPDATE ON expenditure_settlements
WHEN OLD.document_owner='business' AND OLD.status IN ('confirmed','已确认') AND (
 ${['no', 'name', 'biz_type', 'project_id', 'supplier_id', 'contract_id', 'settlement_type', 'total_amount', 'amount', 'tax_amount', 'tax_rate', 'settlement_date', 'settlement_period', 'deduction_note', 'created_by', 'updated_by', 'responsible', 'department', 'status', 'note', 'created_at', 'deleted_at', 'payee_supplier_id', 'payee_worker_id', 'payee_name_snapshot'].map(column => `NEW.${column} IS NOT OLD.${column}`).join(' OR\n ')}
 OR NEW.version<>OLD.version+1
 OR json_remove(NEW.record_json,'$.version','$.updatedAt','$.files') IS NOT json_remove(OLD.record_json,'$.version','$.updatedAt','$.files')
)
BEGIN SELECT RAISE(ABORT,'confirmed business settlement facts are immutable'); END;
${[
  ['expenditure_settlement_expense_allocations', 'settlement_id'],
  ['other_settlement_history', 'settlement_id'],
  ['other_settlement_commands', 'settlement_id'],
  ['other_settlement_files', 'settlement_id'],
].map(([table, column]) => `CREATE TRIGGER ${table}_other_owner BEFORE INSERT ON ${table}
WHEN (SELECT document_owner FROM expenditure_settlements WHERE id=NEW.${column}) IS NOT 'other'
BEGIN SELECT RAISE(ABORT,'other settlement evidence cannot adopt another owner'); END;`).join('\n')}
`

/** v31 permits only the protected import batch archive after its immutable restore proof exists. */
export const PRODUCTION_OWNER_SETTLEMENT_RESTORE_UPGRADE = `
DROP TRIGGER business_settlement_confirmed_lock;
CREATE TRIGGER business_settlement_confirmed_lock BEFORE UPDATE ON expenditure_settlements
WHEN OLD.document_owner='business' AND OLD.status IN ('confirmed','已确认') AND (
 ${['no', 'name', 'biz_type', 'project_id', 'supplier_id', 'contract_id', 'settlement_type', 'total_amount', 'amount', 'tax_amount', 'tax_rate', 'settlement_date', 'settlement_period', 'deduction_note', 'created_by', 'updated_by', 'responsible', 'department', 'status', 'note', 'created_at', 'payee_supplier_id', 'payee_worker_id', 'payee_name_snapshot'].map(column => `NEW.${column} IS NOT OLD.${column}`).join(' OR\n ')}
 OR NEW.version<>OLD.version+1
 OR (NEW.deleted_at IS NOT OLD.deleted_at AND NOT (
   OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS(
     SELECT 1 FROM owner_document_import_bindings b JOIN owner_document_import_restores r ON r.import_id=b.import_id
     WHERE b.source_table='expenditure_settlements' AND b.kind='sub_settlement' AND b.document_id=OLD.id
       AND r.restored_at=NEW.deleted_at AND json_extract(NEW.record_json,'$.deletedAt')=r.restored_at
   )
 ))
 OR (json_remove(NEW.record_json,'$.version','$.updatedAt','$.files') IS NOT json_remove(OLD.record_json,'$.version','$.updatedAt','$.files')
   AND NOT (NEW.deleted_at IS NOT OLD.deleted_at AND json_remove(NEW.record_json,'$.version','$.updatedAt','$.files','$.deletedAt') IS json_remove(OLD.record_json,'$.version','$.updatedAt','$.files','$.deletedAt')))
)
BEGIN SELECT RAISE(ABORT,'confirmed business settlement facts are immutable'); END;
`
