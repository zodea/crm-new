export const PRODUCTION_PROCESS_LIBRARY_TABLES = ['process_library_revision', 'process_library_versions', 'process_library_command_receipts', 'process_library_audits'] as const

/** Complete immutable graphs, original commands and audit facts share one disk transaction. */
export const PRODUCTION_PROCESS_LIBRARY_SCHEMA = `
CREATE TABLE process_library_revision (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO process_library_revision VALUES(1,0);
CREATE TABLE process_library_versions (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
  source_version_id TEXT REFERENCES process_library_versions(id), snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL, actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE REFERENCES process_library_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(code,version)
);
CREATE TABLE process_library_command_receipts (
  command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES process_library_versions(id), fingerprint TEXT NOT NULL,
  command_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE process_library_audits (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES process_library_versions(id),
  command_id TEXT NOT NULL REFERENCES process_library_command_receipts(command_id),
  actor_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action='create-version'),
  after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO production_participants VALUES ('process-library',1);
`
