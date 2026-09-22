export const PRODUCTION_STORAGE_VERSION = 1
export const PRODUCTION_PARTICIPANTS = ['customer'] as const

/** PG-01 only. Further domains join through an explicit storage version upgrade. */
export const PRODUCTION_STORAGE_SCHEMA = `
CREATE TABLE production_metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), schema_version INTEGER NOT NULL,
  workspace_id TEXT NOT NULL, owner_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('verification','production')), created_at TEXT NOT NULL
);
CREATE TABLE production_participants (domain TEXT PRIMARY KEY, schema_version INTEGER NOT NULL);
INSERT INTO production_participants VALUES ('customer',1);
CREATE TABLE customer_revision (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL);
INSERT INTO customer_revision VALUES(1,0);
CREATE TABLE customers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',
  tax_no TEXT NOT NULL DEFAULT '', legal_rep TEXT NOT NULL DEFAULT '', registered_address TEXT NOT NULL DEFAULT '',
  invoice_name TEXT NOT NULL DEFAULT '', bank TEXT NOT NULL DEFAULT '', bank_account TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '', contact_phone TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL CHECK(version>0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE UNIQUE INDEX customer_tax_number ON customers(tax_no) WHERE tax_no<>'';
CREATE TABLE file_refs (
  id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
  file_name TEXT NOT NULL, file_path TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL CHECK(file_size>=0),
  mime_type TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', uploader TEXT NOT NULL,
  uploaded_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX file_refs_owner ON file_refs(owner_type,owner_id);
CREATE TABLE file_payloads (
  file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id), content BLOB NOT NULL, sha256 TEXT NOT NULL
);
CREATE TABLE customer_command_receipts (
  command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id), fingerprint TEXT NOT NULL,
  action TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE customer_command_resolutions (
  command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, resolved_at TEXT NOT NULL
);
CREATE TABLE customer_audits (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
  command_id TEXT NOT NULL REFERENCES customer_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
  actor_id TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
`
