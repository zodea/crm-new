import { EXPENSE_REFERENCE_GUARDS } from '../../app/lib/finance/expense-references'
import { FINANCE_EXPENSE_PARTY_GUARDS } from '../../app/lib/finance/party-references'
import { FINANCE_PAYMENT_ALLOCATION_GUARDS } from '../../app/lib/finance/payment-allocation-guards'
import { FINANCE_PAYMENT_PARTY_GUARDS } from '../../app/lib/finance/payment-party-upgrade'

export const PRODUCTION_FINANCE_TABLES = [
  'current_transactions',
  'expense_reimbursements',
  'expense_reimbursement_lines',
  'invoice_applications',
  'payment_applications',
  'payment_records',
  'payment_application_settlement_allocations',
  'payment_application_invoice_allocations',
  'payment_record_application_allocations',
  'operation_logs',
  'finance_versions',
  'finance_history',
  'finance_revision',
  'finance_commands',
  'finance_resolutions',
  'finance_imports',
  'finance_import_resolutions',
] as const

// External owner IDs remain stable evidence; the real owner resolves new references.
// Finance owns no customer, worker, supplier, contract, settlement or invoice master.
const timestamps = 'created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')), deleted_at TEXT'
function allocation(table: string, source: string, target: string, foreign: string) {
  return `CREATE TABLE ${table} (
  id TEXT PRIMARY KEY, ${source} TEXT NOT NULL REFERENCES ${foreign}(id), ${target} TEXT NOT NULL,
  allocated_amount REAL NOT NULL CHECK(allocated_amount>0), note TEXT NOT NULL DEFAULT '', ${timestamps});
  CREATE UNIQUE INDEX ${table}_unique ON ${table}(${source},${target}) WHERE deleted_at IS NULL;`
}

export const PRODUCTION_FINANCE_SCHEMA = `
CREATE TABLE current_transactions (
 id TEXT PRIMARY KEY, no TEXT NOT NULL DEFAULT '', direction TEXT NOT NULL CHECK(direction IN ('receipt','payment')),
 project_id TEXT, counterparty TEXT NOT NULL DEFAULT '', supplier_id TEXT, counterparty_name_snapshot TEXT,
 purpose TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0 CHECK(amount>=0), payment_method TEXT NOT NULL DEFAULT '',
 transaction_date TEXT NOT NULL DEFAULT '', bank_serial_no TEXT NOT NULL DEFAULT '', handler TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft', note TEXT NOT NULL DEFAULT '', ${timestamps}
);
CREATE TABLE expense_reimbursements (
 id TEXT PRIMARY KEY, no TEXT NOT NULL DEFAULT '', project_id TEXT, applicant TEXT NOT NULL DEFAULT '',
 applicant_worker_id TEXT, applicant_supplier_id TEXT, applicant_name_snapshot TEXT,
 category TEXT NOT NULL DEFAULT '', reimbursement_date TEXT NOT NULL DEFAULT '', invoice_count INTEGER NOT NULL DEFAULT 0 CHECK(invoice_count>=0),
 reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', note TEXT NOT NULL DEFAULT '', external_ref TEXT NOT NULL DEFAULT '', ${timestamps},
 CHECK(applicant_worker_id IS NULL OR applicant_supplier_id IS NULL)
);
CREATE TABLE expense_reimbursement_lines (
 id TEXT PRIMARY KEY, reimbursement_id TEXT NOT NULL REFERENCES expense_reimbursements(id),
 expense_item TEXT NOT NULL DEFAULT '', expense_date TEXT NOT NULL DEFAULT '', amount REAL NOT NULL CHECK(amount>0),
 note TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, original_expense_line_id TEXT REFERENCES expense_reimbursement_lines(id),
 counterparty_supplier_id TEXT, counterparty_name_snapshot TEXT, ${timestamps}, CHECK(original_expense_line_id IS NULL OR original_expense_line_id<>id)
);
CREATE TABLE invoice_applications (
 id TEXT PRIMARY KEY, no TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', project_id TEXT, contract_id TEXT, customer_id TEXT,
 buyer_name_snapshot TEXT NOT NULL DEFAULT '', buyer_tax_no_snapshot TEXT NOT NULL DEFAULT '', invoice_type TEXT NOT NULL DEFAULT '',
 amount REAL NOT NULL DEFAULT 0 CHECK(amount>=0), tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate>=0), tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount>=0),
 invoice_content TEXT NOT NULL DEFAULT '', invoice_remark TEXT NOT NULL DEFAULT '', applicant TEXT NOT NULL DEFAULT '', application_date TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft', note TEXT NOT NULL DEFAULT '', ${timestamps}
);
CREATE TABLE payment_applications (
 id TEXT PRIMARY KEY, no TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', biz_type TEXT NOT NULL DEFAULT '', project_id TEXT, supplier_id TEXT, worker_id TEXT, payee_name_snapshot TEXT, contract_id TEXT, company_expense_contract_id TEXT,
 cost_name TEXT NOT NULL DEFAULT '', apply_amount REAL NOT NULL DEFAULT 0 CHECK(apply_amount>=0), apply_date TEXT NOT NULL DEFAULT '', applicant TEXT NOT NULL DEFAULT '',
 invoice_state TEXT NOT NULL DEFAULT '先款后票' CHECK(invoice_state IN ('先票后款','先款后票','无需发票')), pay_content TEXT NOT NULL DEFAULT '',
 prepay_deduct REAL NOT NULL DEFAULT 0 CHECK(prepay_deduct>=0), prepay_note TEXT NOT NULL DEFAULT '',
 approved_amount REAL CHECK(approved_amount IS NULL OR approved_amount>=0), approved_amount_origin TEXT NOT NULL DEFAULT 'user-entry' CHECK(approved_amount_origin IN ('legacy','user-entry')),
 approval_note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', note TEXT NOT NULL DEFAULT '', external_ref TEXT NOT NULL DEFAULT '', ${timestamps},
 CHECK(company_expense_contract_id IS NULL OR (project_id IS NULL AND contract_id IS NULL))
);
CREATE TABLE payment_records (
 id TEXT PRIMARY KEY, no TEXT NOT NULL DEFAULT '', project_id TEXT, supplier_id TEXT, worker_id TEXT, payee_name_snapshot TEXT, payee_name TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL DEFAULT '',
 payment_date TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0 CHECK(amount>=0), payment_method TEXT NOT NULL DEFAULT '', voucher_no TEXT NOT NULL DEFAULT '',
 bank_serial_no TEXT NOT NULL DEFAULT '', payee_account TEXT NOT NULL DEFAULT '', payee_bank TEXT NOT NULL DEFAULT '', payee_bank_account TEXT NOT NULL DEFAULT '', handler TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','image_ocr','excel_import')), recognition_status TEXT NOT NULL DEFAULT 'not_applicable',
 ocr_payload TEXT NOT NULL DEFAULT '{}', field_confidence TEXT NOT NULL DEFAULT '{}', confirmation_status TEXT NOT NULL DEFAULT 'draft' CHECK(confirmation_status IN ('draft','needs_review','confirmed')),
 confirmed_by TEXT NOT NULL DEFAULT '', confirmed_at TEXT, external_ref TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', ${timestamps},
 CHECK(confirmation_status<>'confirmed' OR (amount>0 AND trim(payment_date)<>'' AND trim(payee_name)<>'' AND trim(voucher_no)<>'' AND trim(bank_serial_no)<>'' AND trim(confirmed_by)<>'' AND confirmed_at IS NOT NULL))
);
${allocation('payment_application_settlement_allocations', 'payment_application_id', 'settlement_id', 'payment_applications')}
${allocation('payment_application_invoice_allocations', 'payment_application_id', 'invoice_id', 'payment_applications')}
${allocation('payment_record_application_allocations', 'payment_record_id', 'payment_application_id', 'payment_records')}
CREATE TABLE operation_logs(id TEXT PRIMARY KEY, table_name TEXT NOT NULL, record_id TEXT NOT NULL, action TEXT NOT NULL,
 before_data TEXT, after_data TEXT, operator TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX finance_logs_record ON operation_logs(table_name,record_id);
CREATE TABLE finance_versions(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),updated_at TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE TABLE finance_history(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),command_id TEXT NOT NULL,actor_id TEXT NOT NULL,occurred_at TEXT NOT NULL,snapshot_json TEXT NOT NULL,PRIMARY KEY(kind,id,version));
CREATE TRIGGER finance_history_no_update BEFORE UPDATE ON finance_history BEGIN SELECT RAISE(ABORT,'finance frozen history is immutable'); END;
CREATE TRIGGER finance_history_no_delete BEFORE DELETE ON finance_history BEGIN SELECT RAISE(ABORT,'finance frozen history is immutable'); END;
CREATE TABLE finance_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO finance_revision VALUES(1,0);
CREATE TABLE finance_commands(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,result_json TEXT);
CREATE TABLE finance_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE TABLE finance_imports(id TEXT PRIMARY KEY,command_id TEXT NOT NULL UNIQUE,source_fingerprint TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,evidence_json TEXT NOT NULL,result_json TEXT NOT NULL,imported_at TEXT NOT NULL);
CREATE TRIGGER finance_imports_no_update BEFORE UPDATE ON finance_imports BEGIN SELECT RAISE(ABORT,'finance import evidence is immutable'); END;
CREATE TRIGGER finance_imports_no_delete BEFORE DELETE ON finance_imports BEGIN SELECT RAISE(ABORT,'finance import evidence is immutable'); END;
CREATE TABLE finance_import_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE UNIQUE INDEX finance_current_bank_serial ON current_transactions(bank_serial_no) WHERE deleted_at IS NULL AND trim(bank_serial_no)<>'';
CREATE UNIQUE INDEX finance_payment_bank_serial ON payment_records(bank_serial_no) WHERE deleted_at IS NULL AND trim(bank_serial_no)<>'';
${EXPENSE_REFERENCE_GUARDS.join(';\n')};
${FINANCE_EXPENSE_PARTY_GUARDS.map(guard => guard.sql).join(';\n')};
${FINANCE_PAYMENT_PARTY_GUARDS.map(guard => guard.sql).join(';\n')};
${FINANCE_PAYMENT_ALLOCATION_GUARDS}
INSERT INTO production_participants VALUES('finance',1);
`
