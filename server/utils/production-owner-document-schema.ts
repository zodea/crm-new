export const PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES = {
  owner_report: 'monthly_statements',
  acceptance: 'project_acceptances',
  final_settlement: 'owner_final_settlements',
  owner_penalty: 'owner_penalties',
  sub_change: 'subcontract_change_orders',
  project_penalty: 'penalty_records',
} as const

export const PRODUCTION_OWNER_DOCUMENT_CAPABILITIES = ['owner-document:read', 'owner-document:write', 'owner-document:import', 'subcontract-document:read', 'subcontract-document:write'] as const
const documentKinds = '(?:owner_change|owner_report|acceptance|final_settlement|owner_penalty|sub_change|sub_settlement|project_penalty)'
const documentIdentity = '[A-Za-z0-9][\\w-]{2,79}'
const documentReads = new RegExp(`^/api/read/owner-documents/(?:import|${documentKinds}(?:/${documentIdentity}(?:/files/${documentIdentity})?)?)$`)
const documentForm = new RegExp(`^/api/commands/owner-documents/${documentKinds}/${documentIdentity}/form$`)
export function isProductionOwnerDocumentRoute(method: string, path: string) {
  return method === 'GET'
    ? documentReads.test(path) || documentForm.test(path) || ['/api/commands/owner-documents/context', '/api/commands/owner-documents/boq-lines'].includes(path)
    : method === 'POST' && ['/api/commands/owner-documents', '/api/commands/owner-documents/resolve', '/api/commands/owner-documents/import', '/api/commands/owner-documents/import/preflight', '/api/commands/owner-documents/import/restore', '/api/commands/owner-documents/import/resolve'].includes(path)
}

export const PRODUCTION_OWNER_DOCUMENT_TABLES = [
  ...Object.values(PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES),
  'owner_document_revision',
  'owner_document_command_intents',
  'owner_document_command_receipts',
  'owner_document_command_resolutions',
  'owner_document_history',
  'penalty_settlement_deductions',
  'penalty_rectification_events',
  'owner_document_files',
  'owner_document_imports',
  'owner_document_import_bindings',
  'owner_document_import_restores',
  'owner_document_import_intents',
  'owner_document_import_commands',
  'owner_document_import_resolutions',
] as const

/** One business owner, appended only by the shared continuous storage upgrade. */
export const PRODUCTION_OWNER_DOCUMENT_SCHEMA = `
${Object.values(PRODUCTION_OWNER_DOCUMENT_HEAD_TABLES).map(table => `CREATE TABLE ${table}(
 id TEXT PRIMARY KEY,project_id TEXT,contract_id TEXT,supplier_id TEXT,crew_id TEXT,period_no TEXT,
 record_json TEXT NOT NULL CHECK(json_valid(record_json)),version INTEGER NOT NULL CHECK(version>0),deleted_at TEXT
);
CREATE INDEX production_${table}_project ON ${table}(project_id,deleted_at);
CREATE INDEX production_${table}_contract ON ${table}(contract_id,deleted_at);
CREATE TRIGGER production_${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'business document history must be retained'); END;
CREATE TRIGGER production_${table}_identity BEFORE UPDATE ON ${table} WHEN NEW.id IS NOT OLD.id BEGIN SELECT RAISE(ABORT,'business document identity is immutable'); END;`).join('\n')}
CREATE UNIQUE INDEX production_monthly_statement_period ON monthly_statements(contract_id,period_no) WHERE deleted_at IS NULL AND contract_id IS NOT NULL AND period_no<>'';
CREATE TABLE owner_document_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=1),metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)));
INSERT INTO owner_document_revision VALUES(1,1,'{"migrationKeys":[],"migrationSnapshotFingerprint":null}');
CREATE TABLE owner_document_command_intents(workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 kind TEXT NOT NULL,target_id TEXT,fingerprint TEXT NOT NULL,request_json TEXT NOT NULL CHECK(json_valid(request_json)),created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id));
CREATE TABLE owner_document_command_receipts(workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 kind TEXT NOT NULL,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL CHECK(json_valid(result_json)),created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id),FOREIGN KEY(workspace_id,actor_id,command_id) REFERENCES owner_document_command_intents(workspace_id,actor_id,command_id));
CREATE TABLE owner_document_command_resolutions(workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 kind TEXT NOT NULL,descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json)),resolved_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id));
CREATE TABLE owner_document_history(id TEXT PRIMARY KEY,kind TEXT NOT NULL,document_id TEXT NOT NULL,actor_id TEXT,command_id TEXT NOT NULL,
 before_json TEXT,after_json TEXT NOT NULL CHECK(json_valid(after_json)),occurred_at TEXT NOT NULL);
CREATE INDEX production_owner_document_history_target ON owner_document_history(kind,document_id);
CREATE TABLE penalty_settlement_deductions(id TEXT PRIMARY KEY,penalty_id TEXT NOT NULL REFERENCES penalty_records(id),settlement_id TEXT NOT NULL,record_json TEXT NOT NULL CHECK(json_valid(record_json)));
CREATE INDEX production_penalty_deduction_settlement ON penalty_settlement_deductions(settlement_id);
CREATE TABLE penalty_rectification_events(id TEXT PRIMARY KEY,penalty_id TEXT NOT NULL REFERENCES penalty_records(id),record_json TEXT NOT NULL CHECK(json_valid(record_json)));
CREATE TABLE owner_document_files(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),kind TEXT NOT NULL,owner_id TEXT NOT NULL,
 original_metadata_json TEXT NOT NULL CHECK(json_valid(original_metadata_json)),body_state TEXT NOT NULL CHECK(body_state IN ('embedded','metadata-only')),sha256 TEXT);
CREATE TABLE owner_document_imports(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 source_sha256 TEXT NOT NULL UNIQUE,evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),evidence_sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE owner_document_import_bindings(import_id TEXT NOT NULL REFERENCES owner_document_imports(id),source_table TEXT NOT NULL,legacy_id TEXT NOT NULL,
 kind TEXT NOT NULL,document_id TEXT NOT NULL,project_id TEXT,contract_id TEXT,PRIMARY KEY(import_id,source_table,legacy_id));
CREATE TABLE owner_document_import_restores(import_id TEXT PRIMARY KEY REFERENCES owner_document_imports(id),command_id TEXT NOT NULL,actor_id TEXT NOT NULL,restored_at TEXT NOT NULL);
CREATE TABLE owner_document_import_intents(workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,action TEXT NOT NULL,scope_id TEXT NOT NULL,fingerprint TEXT NOT NULL,request_json TEXT NOT NULL CHECK(json_valid(request_json)),created_at TEXT NOT NULL,PRIMARY KEY(workspace_id,actor_id,command_id));
CREATE TABLE owner_document_import_commands(workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
 request_json TEXT NOT NULL CHECK(json_valid(request_json)),result_json TEXT NOT NULL CHECK(json_valid(result_json)),created_at TEXT NOT NULL,PRIMARY KEY(workspace_id,actor_id,command_id));
CREATE TABLE owner_document_import_resolutions(workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json)),resolved_at TEXT NOT NULL,PRIMARY KEY(workspace_id,actor_id,command_id));
${['owner_document_command_intents', 'owner_document_command_receipts', 'owner_document_command_resolutions', 'owner_document_history', 'penalty_settlement_deductions', 'penalty_rectification_events', 'owner_document_files', 'owner_document_imports', 'owner_document_import_bindings', 'owner_document_import_restores', 'owner_document_import_intents', 'owner_document_import_commands', 'owner_document_import_resolutions'].flatMap(table => ['UPDATE', 'DELETE'].map(action => `CREATE TRIGGER production_${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'business document original evidence is immutable'); END;`)).join('\n')}
CREATE TRIGGER production_owner_document_bytes_update BEFORE UPDATE ON file_payloads WHEN EXISTS(SELECT 1 FROM owner_document_files WHERE file_ref_id=OLD.file_ref_id) BEGIN SELECT RAISE(ABORT,'business document original bytes are immutable'); END;
CREATE TRIGGER production_owner_document_bytes_delete BEFORE DELETE ON file_payloads WHEN EXISTS(SELECT 1 FROM owner_document_files WHERE file_ref_id=OLD.file_ref_id) BEGIN SELECT RAISE(ABORT,'business document original bytes must be retained'); END;
CREATE TRIGGER production_owner_document_file_metadata BEFORE UPDATE ON file_refs WHEN EXISTS(SELECT 1 FROM owner_document_files WHERE file_ref_id=OLD.id) AND (NEW.id IS NOT OLD.id OR NEW.owner_type IS NOT OLD.owner_type OR NEW.owner_id IS NOT OLD.owner_id OR NEW.file_name IS NOT OLD.file_name OR NEW.file_size IS NOT OLD.file_size OR NEW.mime_type IS NOT OLD.mime_type OR NEW.category IS NOT OLD.category OR NEW.uploader IS NOT OLD.uploader OR NEW.uploaded_at IS NOT OLD.uploaded_at) BEGIN SELECT RAISE(ABORT,'business document original metadata is immutable'); END;
CREATE TRIGGER production_owner_document_file_no_delete BEFORE DELETE ON file_refs WHEN EXISTS(SELECT 1 FROM owner_document_files WHERE file_ref_id=OLD.id) BEGIN SELECT RAISE(ABORT,'business document original metadata must be retained'); END;
INSERT INTO production_participants VALUES('owner-documents',1);
`
