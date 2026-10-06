export const MATERIAL_QUOTATION_TABLES = ['quotation_revision', 'material_quotations', 'material_quotation_lines', 'material_quotation_history', 'material_quotation_commands', 'material_quotation_resolutions', 'material_quotation_files', 'quotation_imports'] as const
/** Independent owner. Shared original bodies remain in file_refs/file_payloads. Never derive quotes from contracts or deliveries. */
export const MATERIAL_QUOTATION_SCHEMA = `
CREATE TABLE quotation_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO quotation_revision VALUES(1,0);
CREATE TABLE material_quotations(id TEXT PRIMARY KEY,party_name TEXT NOT NULL,supplier_id TEXT,project_id TEXT,scope TEXT NOT NULL CHECK(scope IN ('general','project','unknown')),quotation_date TEXT,draft_json TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE material_quotation_lines(id TEXT PRIMARY KEY,quotation_id TEXT NOT NULL REFERENCES material_quotations(id),name TEXT NOT NULL,unit TEXT NOT NULL,unit_price REAL CHECK(unit_price>=0),tax_rate REAL CHECK(tax_rate>=0 AND tax_rate<=100),line_json TEXT NOT NULL,deleted_at TEXT);
CREATE INDEX material_quotation_line_owner ON material_quotation_lines(quotation_id);
CREATE TABLE material_quotation_commands(scoped_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,result_json TEXT NOT NULL,quotation_id TEXT NOT NULL REFERENCES material_quotations(id));
CREATE TABLE material_quotation_resolutions(scoped_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE TABLE material_quotation_history(quotation_id TEXT NOT NULL REFERENCES material_quotations(id),version INTEGER NOT NULL CHECK(version>0),snapshot_json TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,occurred_at TEXT NOT NULL,PRIMARY KEY(quotation_id,version));
CREATE TABLE material_quotation_files(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),quotation_id TEXT NOT NULL REFERENCES material_quotations(id),sha256 TEXT NOT NULL);
CREATE TABLE quotation_imports(scoped_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,batch_id TEXT UNIQUE,fingerprint TEXT,graph_hash TEXT,graph_json TEXT,result_json TEXT,sealed_at TEXT,CHECK((batch_id IS NOT NULL AND fingerprint IS NOT NULL AND graph_hash IS NOT NULL AND graph_json IS NOT NULL AND result_json IS NOT NULL AND sealed_at IS NULL) OR (batch_id IS NULL AND fingerprint IS NULL AND graph_hash IS NULL AND graph_json IS NULL AND result_json IS NULL AND sealed_at IS NOT NULL)));
CREATE TRIGGER quotation_import_update BEFORE UPDATE ON quotation_imports BEGIN SELECT RAISE(ABORT,'Quotation import evidence is immutable'); END;
CREATE TRIGGER quotation_import_delete BEFORE DELETE ON quotation_imports BEGIN SELECT RAISE(ABORT,'Quotation import evidence must be retained'); END;
CREATE TRIGGER quotation_history_update BEFORE UPDATE ON material_quotation_history BEGIN SELECT RAISE(ABORT,'Quotation history is immutable'); END;
CREATE TRIGGER quotation_history_delete BEFORE DELETE ON material_quotation_history BEGIN SELECT RAISE(ABORT,'Quotation history is immutable'); END;
CREATE TRIGGER quotation_head_delete BEFORE DELETE ON material_quotations BEGIN SELECT RAISE(ABORT,'Quotation identity must be retained'); END;
CREATE TRIGGER quotation_line_delete BEFORE DELETE ON material_quotation_lines BEGIN SELECT RAISE(ABORT,'Quotation line identity must be retained'); END;
CREATE TRIGGER quotation_line_owner BEFORE UPDATE OF id,quotation_id ON material_quotation_lines BEGIN SELECT RAISE(ABORT,'Quotation line ownership is immutable'); END;
CREATE TRIGGER quotation_command_update BEFORE UPDATE ON material_quotation_commands BEGIN SELECT RAISE(ABORT,'Quotation receipt is immutable'); END;
CREATE TRIGGER quotation_command_delete BEFORE DELETE ON material_quotation_commands BEGIN SELECT RAISE(ABORT,'Quotation receipt is immutable'); END;
CREATE TRIGGER quotation_resolution_update BEFORE UPDATE ON material_quotation_resolutions BEGIN SELECT RAISE(ABORT,'Quotation resolution is immutable'); END;
CREATE TRIGGER quotation_resolution_delete BEFORE DELETE ON material_quotation_resolutions BEGIN SELECT RAISE(ABORT,'Quotation resolution is immutable'); END;
CREATE TRIGGER quotation_file_update BEFORE UPDATE ON material_quotation_files BEGIN SELECT RAISE(ABORT,'Quotation original identity is immutable'); END;
CREATE TRIGGER quotation_file_delete BEFORE DELETE ON material_quotation_files BEGIN SELECT RAISE(ABORT,'Quotation original identity is immutable'); END;
CREATE TRIGGER quotation_original_metadata BEFORE UPDATE OF id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at ON file_refs WHEN EXISTS(SELECT 1 FROM material_quotation_files WHERE file_ref_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Quotation original metadata is immutable'); END;
CREATE TRIGGER quotation_original_delete BEFORE DELETE ON file_refs WHEN EXISTS(SELECT 1 FROM material_quotation_files WHERE file_ref_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Quotation original must be retained'); END;
CREATE TRIGGER quotation_payload_update BEFORE UPDATE ON file_payloads WHEN EXISTS(SELECT 1 FROM material_quotation_files WHERE file_ref_id=OLD.file_ref_id) BEGIN SELECT RAISE(ABORT,'Quotation original bytes are immutable'); END;
CREATE TRIGGER quotation_payload_delete BEFORE DELETE ON file_payloads WHEN EXISTS(SELECT 1 FROM material_quotation_files WHERE file_ref_id=OLD.file_ref_id) BEGIN SELECT RAISE(ABORT,'Quotation original bytes must be retained'); END;
`
