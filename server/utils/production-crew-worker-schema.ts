import { WORKER_ROSTER_SCHEMA_STATEMENTS, WORKER_ROSTER_TABLES } from './worker-roster-storage'

export const PRODUCTION_CREW_WORKER_TABLES = [
  'crew_worker_revision',
  'crews',
  'workers',
  'crew_worker_audits',
  'crew_worker_command_receipts',
  'crew_worker_command_resolutions',
  'crew_worker_import_sources',
  'crew_worker_import_receipts',
  'crew_worker_import_resolutions',
  ...WORKER_ROSTER_TABLES,
] as const

const immutableTables = ['crew_worker_audits', 'crew_worker_command_receipts', 'crew_worker_command_resolutions', 'crew_worker_import_sources', 'crew_worker_import_receipts', 'crew_worker_import_resolutions', 'worker_roster_profile_versions', 'worker_roster_archives', 'worker_roster_receipts'] as const
const historyGuards = immutableTables.map(table => `
CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Frozen crew-worker history cannot be replaced'); END;
CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Frozen crew-worker history cannot be deleted'); END;
`).join('')

export const PRODUCTION_CREW_WORKER_SCHEMA = `
CREATE TABLE crew_worker_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO crew_worker_revision VALUES(1,0);
CREATE TABLE crews(id TEXT PRIMARY KEY, record_json TEXT NOT NULL CHECK(COALESCE(json_valid(record_json) AND json_type(record_json,'$.id')='text' AND json_extract(record_json,'$.id')=id,0)));
CREATE TABLE workers(id TEXT PRIMARY KEY, record_json TEXT NOT NULL CHECK(COALESCE(json_valid(record_json) AND json_type(record_json,'$.id')='text' AND json_extract(record_json,'$.id')=id,0)));
CREATE TABLE crew_worker_audits(
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('crew','worker')),
  entity_id TEXT NOT NULL, actor_id TEXT NOT NULL, command_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE crew_worker_command_receipts(
  workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('crew','worker')),
  command_id TEXT NOT NULL, entity_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,actor_id,kind,command_id)
);
CREATE TABLE crew_worker_command_resolutions(
  workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('crew','worker')),
  command_id TEXT NOT NULL, resolved_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,actor_id,kind,command_id)
);
CREATE TABLE crew_worker_import_sources(
  source_sha256 TEXT PRIMARY KEY, schema_version INTEGER NOT NULL,
  source_graph_json TEXT NOT NULL CHECK(json_valid(source_graph_json)),
  source_evidence_json TEXT NOT NULL CHECK(json_valid(source_evidence_json)),
  created_at TEXT NOT NULL, actor_id TEXT NOT NULL
);
CREATE TABLE crew_worker_import_receipts(
  workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, command_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL, source_sha256 TEXT NOT NULL REFERENCES crew_worker_import_sources(source_sha256),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE crew_worker_import_resolutions(
  workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, command_id TEXT NOT NULL, resolved_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,actor_id,command_id)
);
${WORKER_ROSTER_SCHEMA_STATEMENTS.map(sql => `${sql};`).join('\n')}
${historyGuards}
INSERT INTO production_participants VALUES('crew-worker',1);
`
