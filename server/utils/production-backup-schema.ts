export const PRODUCTION_BACKUP_TABLES = ['production_backup_runs', 'production_backup_baseline'] as const

export const PRODUCTION_BACKUP_SCHEMA = `
CREATE TABLE production_backup_runs (
  id TEXT PRIMARY KEY, action TEXT NOT NULL CHECK(action IN ('backup','copy-offline','verify-restore')),
  source_backup_id TEXT, fingerprint TEXT NOT NULL, actor_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed')),
  started_at TEXT NOT NULL, completed_at TEXT, captured_at TEXT,
  package_id TEXT, error_message TEXT, result_json TEXT
);
CREATE TABLE production_backup_baseline (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), package_id TEXT NOT NULL,
  database_sha256 TEXT NOT NULL, captured_at TEXT NOT NULL, restored_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL, participants_sha256 TEXT NOT NULL,
  proof_command_id TEXT NOT NULL REFERENCES production_backup_runs(id)
);
INSERT INTO production_participants VALUES ('backup',1);
`
