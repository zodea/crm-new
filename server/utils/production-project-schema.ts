export const PRODUCTION_PROJECT_TABLES = ['project_revision', 'projects', 'project_command_receipts', 'project_command_resolutions', 'project_import_receipts', 'project_audits'] as const
/** Project participant only. The shared upgrade registry chooses its installation version. */
export const PRODUCTION_PROJECT_SCHEMA = `
CREATE TABLE project_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL);
INSERT INTO project_revision VALUES(1,0);
CREATE TABLE projects(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL,
 customer_id TEXT REFERENCES customers(id), secondary_customer_id TEXT REFERENCES customers(id),
 draft_json TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX production_project_customer ON projects(customer_id,secondary_customer_id);
CREATE TABLE project_command_receipts(
 command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id), fingerprint TEXT NOT NULL,
 action TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE project_command_resolutions(
 command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, resolved_at TEXT NOT NULL
);
CREATE TABLE project_import_receipts(
 project_id TEXT PRIMARY KEY REFERENCES projects(id), command_id TEXT NOT NULL REFERENCES project_command_receipts(command_id),
 file_digest TEXT NOT NULL, sheet_name TEXT NOT NULL, row_number INTEGER NOT NULL CHECK(row_number>0),
 external_ref TEXT NOT NULL, source_json TEXT NOT NULL, draft_fingerprint TEXT NOT NULL,
 UNIQUE(file_digest,sheet_name,row_number)
);
CREATE UNIQUE INDEX production_project_import_external ON project_import_receipts(external_ref) WHERE external_ref<>'';
CREATE TABLE project_audits(
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 command_id TEXT NOT NULL REFERENCES project_command_receipts(command_id) DEFERRABLE INITIALLY DEFERRED,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO production_participants VALUES('project',1);
`
