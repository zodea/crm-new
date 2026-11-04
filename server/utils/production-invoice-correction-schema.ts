/** Candidate v32: owned by invoices, not registered until readers and backup validate it. */
export const PRODUCTION_INVOICE_CORRECTION_TABLES = ['invoice_correction_revision', 'invoice_corrections', 'invoice_correction_versions', 'invoice_correction_receipts', 'invoice_correction_resolutions', 'invoice_correction_files'] as const

export const PRODUCTION_INVOICE_CORRECTION_SCHEMA = `
CREATE TABLE invoice_correction_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO invoice_correction_revision VALUES(1,0);
CREATE TABLE invoice_corrections(
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), base_invoice_version INTEGER NOT NULL CHECK(base_invoice_version>0),
 version INTEGER NOT NULL CHECK(version>0), state TEXT NOT NULL CHECK(state IN('draft','submitted')),
 baseline_json TEXT NOT NULL CHECK(json_valid(baseline_json)), record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, submitted_at TEXT, result_invoice_version INTEGER,
 CHECK((state='draft' AND submitted_at IS NULL AND result_invoice_version IS NULL) OR
       (state='submitted' AND submitted_at IS NOT NULL AND result_invoice_version=base_invoice_version+1))
);
CREATE INDEX invoice_corrections_invoice ON invoice_corrections(invoice_id);
CREATE TRIGGER invoice_corrections_no_delete BEFORE DELETE ON invoice_corrections BEGIN SELECT RAISE(ABORT,'invoice correction history is immutable'); END;
CREATE TRIGGER invoice_corrections_identity BEFORE UPDATE ON invoice_corrections
 WHEN OLD.state='submitted' OR NEW.id IS NOT OLD.id OR NEW.invoice_id IS NOT OLD.invoice_id OR NEW.base_invoice_version IS NOT OLD.base_invoice_version
 OR NEW.baseline_json IS NOT OLD.baseline_json OR NEW.created_at IS NOT OLD.created_at OR NEW.version<>OLD.version+1
 BEGIN SELECT RAISE(ABORT,'invoice correction identity or submitted history is immutable'); END;
CREATE TABLE invoice_correction_receipts(
 command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 correction_id TEXT NOT NULL REFERENCES invoice_corrections(id), action TEXT NOT NULL CHECK(action IN('save-draft','submit')),
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
 request_json TEXT NOT NULL CHECK(json_valid(request_json)), result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL
);
CREATE TABLE invoice_correction_versions(
 correction_id TEXT NOT NULL REFERENCES invoice_corrections(id), version INTEGER NOT NULL CHECK(version>0),
 command_id TEXT NOT NULL UNIQUE REFERENCES invoice_correction_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
 actor_id TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(correction_id,version)
);
CREATE TABLE invoice_correction_resolutions(
 command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('save-draft','submit')), invoice_id TEXT NOT NULL REFERENCES invoices(id),
 correction_id TEXT REFERENCES invoice_corrections(id), resolved_at TEXT NOT NULL
);
CREATE TABLE invoice_correction_files(
 file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id), correction_id TEXT NOT NULL REFERENCES invoice_corrections(id),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*')
);
${['invoice_correction_versions', 'invoice_correction_receipts', 'invoice_correction_resolutions', 'invoice_correction_files'].flatMap(table => ['UPDATE', 'DELETE'].map(action => `CREATE TRIGGER ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'invoice correction evidence is immutable'); END;`)).join('\n')}
CREATE TRIGGER invoice_correction_file_metadata BEFORE UPDATE ON file_refs WHEN EXISTS(SELECT 1 FROM invoice_correction_files WHERE file_ref_id=OLD.id) BEGIN SELECT RAISE(ABORT,'invoice correction original is immutable'); END;
CREATE TRIGGER invoice_correction_file_no_delete BEFORE DELETE ON file_refs WHEN EXISTS(SELECT 1 FROM invoice_correction_files WHERE file_ref_id=OLD.id) BEGIN SELECT RAISE(ABORT,'invoice correction original is immutable'); END;
CREATE TRIGGER invoice_correction_payload_no_update BEFORE UPDATE ON file_payloads WHEN EXISTS(SELECT 1 FROM invoice_correction_files WHERE file_ref_id=OLD.file_ref_id) BEGIN SELECT RAISE(ABORT,'invoice correction original is immutable'); END;
CREATE TRIGGER invoice_correction_payload_no_delete BEFORE DELETE ON file_payloads WHEN EXISTS(SELECT 1 FROM invoice_correction_files WHERE file_ref_id=OLD.file_ref_id) BEGIN SELECT RAISE(ABORT,'invoice correction original is immutable'); END;
`
