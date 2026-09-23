import { PRODUCTION_PROCESS_LIBRARY_SCHEMA, PRODUCTION_PROCESS_LIBRARY_TABLES } from './production-process-library-schema'
import { PRODUCTION_PROJECT_SCHEMA, PRODUCTION_PROJECT_TABLES } from './production-project-schema'

export const PRODUCTION_STORAGE_VERSION = 3
/** Append a new numbered upgrade when a domain lands; never rewrite an applied step. */
export const PRODUCTION_STORAGE_UPGRADES = [
  { from: 1, to: 2, sql: PRODUCTION_PROCESS_LIBRARY_SCHEMA, participants: { 'process-library': { schemaVersion: 1, tables: PRODUCTION_PROCESS_LIBRARY_TABLES } } },
  { from: 2, to: 3, sql: PRODUCTION_PROJECT_SCHEMA, participants: { project: { schemaVersion: 1, tables: PRODUCTION_PROJECT_TABLES } } },
] as const

export function productionStorageManifest(version = PRODUCTION_STORAGE_VERSION) {
  if (!Number.isSafeInteger(version) || version < 1 || version > PRODUCTION_STORAGE_VERSION)
    throw new Error('此发布物不能验证该正式存储版本的完整清单。')
  const participants: Record<string, { schemaVersion: number, tables: readonly string[] }> = {
    customer: { schemaVersion: 1, tables: ['customer_revision', 'customers', 'file_refs', 'file_payloads', 'customer_command_receipts', 'customer_command_resolutions', 'customer_audits'] },
  }
  for (const upgrade of PRODUCTION_STORAGE_UPGRADES) {
    if (upgrade.to <= version)
      Object.assign(participants, upgrade.participants)
  }
  return structuredClone({ schemaVersion: version, coreTables: ['production_metadata', 'production_participants'], participants })
}
export function productionParticipantVersions(version: number): Record<string, number> {
  return Object.fromEntries(Object.entries(productionStorageManifest(version).participants).map(([domain, value]) => [domain, value.schemaVersion]))
}
export const PRODUCTION_PARTICIPANTS = Object.keys(productionParticipantVersions(PRODUCTION_STORAGE_VERSION))

/** Frozen v1 bootstrap. Existing databases reach later domains through the numbered upgrades. */
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
