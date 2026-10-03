export const PRODUCTION_SUPPLIER_TABLES = [
  'supplier_revision',
  'suppliers',
  'supplier_credential_scopes',
  'supplier_credentials',
  'supplier_credential_files',
  'supplier_credential_requirements',
  'supplier_credential_audits',
  'supplier_audits',
  'supplier_command_receipts',
  'supplier_command_resolutions',
] as const

export const PRODUCTION_SUPPLIER_SCHEMA = `
CREATE TABLE supplier_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO supplier_revision VALUES(1,0);
CREATE TABLE suppliers(
  id TEXT PRIMARY KEY, draft_json TEXT NOT NULL, credential_status TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0), updated_at TEXT NOT NULL, migration_batch_id TEXT,
  imported INTEGER NOT NULL CHECK(imported IN (0,1))
);
CREATE UNIQUE INDEX supplier_tax_number ON suppliers(json_extract(draft_json,'$.taxNo')) WHERE json_extract(draft_json,'$.taxNo')<>'';
CREATE UNIQUE INDEX supplier_internal_code ON suppliers(json_extract(draft_json,'$.uniqueCode')) WHERE json_extract(draft_json,'$.uniqueCode')<>'';
CREATE TABLE supplier_credential_scopes(
  supplier_id TEXT PRIMARY KEY REFERENCES suppliers(id), version INTEGER NOT NULL CHECK(version>=0), metadata_json TEXT NOT NULL
);
CREATE TABLE supplier_credentials(
  id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  file_ref_id TEXT REFERENCES file_refs(id) DEFERRABLE INITIALLY DEFERRED, record_json TEXT NOT NULL
);
CREATE TABLE supplier_credential_files(
  file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id), supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  credential_id TEXT NOT NULL REFERENCES supplier_credentials(id), metadata_json TEXT NOT NULL
);
CREATE TABLE supplier_credential_requirements(
  id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), record_json TEXT NOT NULL
);
CREATE TABLE supplier_credential_audits(
  id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  credential_id TEXT REFERENCES supplier_credentials(id), record_json TEXT NOT NULL
);
CREATE TABLE supplier_audits(
  id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), record_json TEXT NOT NULL
);
CREATE TABLE supplier_command_receipts(
  command_id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('master','credential')),
  fingerprint TEXT NOT NULL, import_fingerprint TEXT, result_json TEXT NOT NULL
);
CREATE TABLE supplier_command_resolutions(
  command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, resolved_at TEXT NOT NULL
);
INSERT INTO production_participants VALUES('supplier',1);
`
