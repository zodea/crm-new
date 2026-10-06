export const OTHER_SETTLEMENT_TABLES = ['expenditure_settlements', 'expenditure_settlement_expense_allocations', 'other_settlement_revision', 'other_settlement_history', 'other_settlement_commands', 'other_settlement_resolutions', 'other_settlement_files', 'other_settlement_imports'] as const

/** The same logical expenditure settlement owner; allocations refer to original costs, never create another cost. */
export const OTHER_SETTLEMENT_HEAD_SCHEMA = `CREATE TABLE expenditure_settlements (
 id TEXT PRIMARY KEY, no TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', biz_type TEXT NOT NULL DEFAULT '其他',
 project_id TEXT, supplier_id TEXT, contract_id TEXT, settlement_type TEXT NOT NULL DEFAULT '',
 total_amount REAL CHECK(total_amount IS NULL OR total_amount>=0), amount REAL CHECK(amount IS NULL OR amount>=0),
 tax_amount REAL CHECK(tax_amount IS NULL OR tax_amount>=0), tax_rate REAL CHECK(tax_rate IS NULL OR (tax_rate>=0 AND tax_rate<=100)),
 settlement_date TEXT NOT NULL DEFAULT '', settlement_period TEXT NOT NULL DEFAULT '', deduction_note TEXT NOT NULL DEFAULT '',
 created_by TEXT, updated_by TEXT, responsible TEXT, department TEXT, status TEXT NOT NULL DEFAULT 'draft', note TEXT NOT NULL DEFAULT '',
 created_at TEXT, updated_at TEXT, deleted_at TEXT,
 payee_supplier_id TEXT, payee_worker_id TEXT, payee_name_snapshot TEXT,
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0), record_json TEXT,
 CHECK(payee_supplier_id IS NULL OR payee_worker_id IS NULL)
);`
export const OTHER_SETTLEMENT_RELATED_SCHEMA = `
CREATE TABLE expenditure_settlement_expense_allocations (
 id TEXT PRIMARY KEY, settlement_id TEXT NOT NULL REFERENCES expenditure_settlements(id), original_expense_line_id TEXT NOT NULL,
 source_version TEXT NOT NULL, source_revision TEXT NOT NULL, allocated_amount REAL CHECK(allocated_amount IS NULL OR allocated_amount>=0),
 frozen_json TEXT NOT NULL, adopted_at TEXT NOT NULL, adopted_by TEXT NOT NULL, deleted_at TEXT
);
CREATE UNIQUE INDEX other_settlement_expense_unique ON expenditure_settlement_expense_allocations(settlement_id,original_expense_line_id) WHERE deleted_at IS NULL;
CREATE INDEX other_settlement_expense_source ON expenditure_settlement_expense_allocations(original_expense_line_id,deleted_at);
CREATE TABLE other_settlement_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO other_settlement_revision VALUES(1,0);
CREATE TABLE other_settlement_history(settlement_id TEXT NOT NULL REFERENCES expenditure_settlements(id),version INTEGER NOT NULL CHECK(version>=1),snapshot_json TEXT NOT NULL,actor_id TEXT,command_id TEXT NOT NULL,occurred_at TEXT NOT NULL,PRIMARY KEY(settlement_id,version));
CREATE TABLE other_settlement_commands(scoped_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,result_json TEXT NOT NULL,settlement_id TEXT NOT NULL REFERENCES expenditure_settlements(id));
CREATE TABLE other_settlement_resolutions(scoped_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE TABLE other_settlement_files(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),settlement_id TEXT NOT NULL REFERENCES expenditure_settlements(id),sha256 TEXT NOT NULL CHECK(length(sha256)=64));
CREATE TABLE other_settlement_imports(scoped_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,batch_id TEXT UNIQUE,fingerprint TEXT,graph_hash TEXT,graph_json TEXT,result_json TEXT,sealed_at TEXT,
 CHECK((sealed_at IS NULL AND batch_id IS NOT NULL AND fingerprint IS NOT NULL AND graph_hash IS NOT NULL AND graph_json IS NOT NULL AND result_json IS NOT NULL) OR (sealed_at IS NOT NULL AND batch_id IS NULL AND fingerprint IS NULL AND graph_hash IS NULL AND graph_json IS NULL AND result_json IS NULL)));
CREATE INDEX other_settlement_project ON expenditure_settlements(project_id,deleted_at);
CREATE INDEX other_settlement_payee ON expenditure_settlements(payee_supplier_id,payee_worker_id,deleted_at);
CREATE TRIGGER other_settlement_confirmed_lock BEFORE UPDATE ON expenditure_settlements WHEN OLD.status IN ('confirmed','已确认') BEGIN SELECT RAISE(ABORT,'confirmed expenditure settlement is immutable'); END;
CREATE TRIGGER other_settlement_head_no_delete BEFORE DELETE ON expenditure_settlements BEGIN SELECT RAISE(ABORT,'expenditure settlement history must be retained'); END;
CREATE TRIGGER other_settlement_line_identity BEFORE UPDATE ON expenditure_settlement_expense_allocations WHEN NEW.id IS NOT OLD.id OR NEW.settlement_id IS NOT OLD.settlement_id OR NEW.original_expense_line_id IS NOT OLD.original_expense_line_id BEGIN SELECT RAISE(ABORT,'original expense allocation identity is immutable'); END;
CREATE TRIGGER other_settlement_confirmed_expense_lock BEFORE UPDATE ON expenditure_settlement_expense_allocations WHEN (SELECT status FROM expenditure_settlements WHERE id=OLD.settlement_id) IN ('confirmed','已确认') BEGIN SELECT RAISE(ABORT,'confirmed expense adoption is immutable'); END;
CREATE TRIGGER other_settlement_expense_no_delete BEFORE DELETE ON expenditure_settlement_expense_allocations BEGIN SELECT RAISE(ABORT,'original expense adoption must be retained'); END;
CREATE TRIGGER other_settlement_confirmed_expense_insert BEFORE INSERT ON expenditure_settlement_expense_allocations WHEN (SELECT status FROM expenditure_settlements WHERE id=NEW.settlement_id) IN ('confirmed','已确认') BEGIN SELECT RAISE(ABORT,'confirmed expense adoption is immutable'); END;
CREATE TRIGGER other_settlement_file_identity BEFORE UPDATE ON other_settlement_files BEGIN SELECT RAISE(ABORT,'settlement original identity is immutable'); END;
CREATE TRIGGER other_settlement_file_no_delete BEFORE DELETE ON other_settlement_files BEGIN SELECT RAISE(ABORT,'settlement original must be retained'); END;
CREATE TRIGGER other_settlement_original_metadata BEFORE UPDATE ON file_refs WHEN OLD.owner_type='expenditure_settlement' AND (NEW.id IS NOT OLD.id OR NEW.owner_type IS NOT OLD.owner_type OR NEW.owner_id IS NOT OLD.owner_id OR NEW.file_name IS NOT OLD.file_name OR NEW.file_path IS NOT OLD.file_path OR NEW.file_size IS NOT OLD.file_size OR NEW.mime_type IS NOT OLD.mime_type OR NEW.category IS NOT OLD.category OR NEW.uploader IS NOT OLD.uploader OR NEW.uploaded_at IS NOT OLD.uploaded_at) BEGIN SELECT RAISE(ABORT,'settlement original metadata is immutable'); END;
CREATE TRIGGER other_settlement_original_no_delete BEFORE DELETE ON file_refs WHEN OLD.owner_type='expenditure_settlement' BEGIN SELECT RAISE(ABORT,'settlement original must be retained'); END;
CREATE TRIGGER other_settlement_original_bytes_update BEFORE UPDATE ON file_payloads WHEN EXISTS(SELECT 1 FROM other_settlement_files WHERE file_ref_id=OLD.file_ref_id) BEGIN SELECT RAISE(ABORT,'settlement original bytes are immutable'); END;
CREATE TRIGGER other_settlement_original_bytes_delete BEFORE DELETE ON file_payloads WHEN EXISTS(SELECT 1 FROM other_settlement_files WHERE file_ref_id=OLD.file_ref_id) BEGIN SELECT RAISE(ABORT,'settlement original bytes must be retained'); END;
${['other_settlement_history', 'other_settlement_commands', 'other_settlement_resolutions', 'other_settlement_imports'].flatMap(table => ['UPDATE', 'DELETE'].map(action => `CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'settlement frozen evidence is immutable'); END;`)).join('\n')}
`
export const OTHER_SETTLEMENT_SCHEMA = `${OTHER_SETTLEMENT_HEAD_SCHEMA}\n${OTHER_SETTLEMENT_RELATED_SCHEMA}`
