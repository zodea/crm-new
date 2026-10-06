export const PRODUCTION_FINANCE_CLEARANCE_TABLES = ['finance_expense_clearance_verifications'] as const
export const PRODUCTION_FINANCE_CLEARANCE_SCHEMA = `
CREATE TABLE finance_expense_clearance_verifications (
 id TEXT PRIMARY KEY, original_expense_line_id TEXT NOT NULL REFERENCES expense_reimbursement_lines(id),
 reimbursement_id TEXT NOT NULL REFERENCES expense_reimbursements(id), reimbursement_version INTEGER NOT NULL CHECK(reimbursement_version>0),
 command_id TEXT NOT NULL REFERENCES finance_commands(command_id), workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 verified_at TEXT NOT NULL, proof_json TEXT NOT NULL, UNIQUE(original_expense_line_id,reimbursement_version)
);
CREATE TRIGGER finance_expense_clearance_verifications_no_update BEFORE UPDATE ON finance_expense_clearance_verifications BEGIN SELECT RAISE(ABORT,'clearance verification evidence is immutable'); END;
CREATE TRIGGER finance_expense_clearance_verifications_no_delete BEFORE DELETE ON finance_expense_clearance_verifications BEGIN SELECT RAISE(ABORT,'clearance verification evidence is immutable'); END;
`
export const PRODUCTION_OTHER_CLEARANCE_TABLES = ['expenditure_settlement_clearance_links'] as const
export const PRODUCTION_OTHER_CLEARANCE_SCHEMA = `
CREATE TABLE expenditure_settlement_clearance_links (
 id TEXT PRIMARY KEY, expense_allocation_id TEXT NOT NULL REFERENCES expenditure_settlement_expense_allocations(id),
 verification_id TEXT NOT NULL REFERENCES finance_expense_clearance_verifications(id), recognition_item_id TEXT NOT NULL,
 amount REAL NOT NULL CHECK(amount>0), origin_family TEXT NOT NULL CHECK(origin_family IN ('finance','other-settlement')),
 command_id TEXT NOT NULL, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, link_json TEXT NOT NULL,
 UNIQUE(expense_allocation_id,recognition_item_id)
);
CREATE TRIGGER expenditure_settlement_clearance_links_no_update BEFORE UPDATE ON expenditure_settlement_clearance_links BEGIN SELECT RAISE(ABORT,'clearance adoption evidence is immutable'); END;
CREATE TRIGGER expenditure_settlement_clearance_links_no_delete BEFORE DELETE ON expenditure_settlement_clearance_links BEGIN SELECT RAISE(ABORT,'clearance adoption evidence is immutable'); END;
`
