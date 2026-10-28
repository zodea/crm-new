export const PRODUCTION_BOQ_TABLES = ['boq_revision', 'boq_files', 'boq_lines', 'item_unit_prices', 'boq_change_records', 'boq_history', 'boq_command_intents', 'boq_commands', 'boq_resolutions', 'boq_source_imports', 'boq_import_restores', 'boq_source_bindings'] as const

const immutable = ['boq_history', 'boq_command_intents', 'boq_commands', 'boq_resolutions', 'boq_source_imports', 'boq_import_restores', 'boq_source_bindings'].map(table => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Original BOQ evidence is immutable'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Original BOQ evidence cannot be deleted'); END;`).join('\n')

/** BOQ and effective owner changes own their facts; contracts, items and originals retain their existing owners. */
export const PRODUCTION_BOQ_SCHEMA = `
CREATE TABLE boq_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO boq_revision VALUES(1,0);
CREATE TABLE boq_files(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
 contract_id TEXT NOT NULL REFERENCES construction_contract_records(id),
 file_ref_id TEXT REFERENCES file_refs(id),record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
);
CREATE TABLE boq_change_records(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
 contract_id TEXT NOT NULL REFERENCES construction_contract_records(id),
 record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
);
CREATE TABLE boq_lines(
 id TEXT PRIMARY KEY,boq_file_id TEXT REFERENCES boq_files(id),
 change_order_id TEXT REFERENCES boq_change_records(id),
 project_id TEXT NOT NULL REFERENCES projects(id),contract_id TEXT NOT NULL REFERENCES construction_contract_records(id),
 item_id TEXT REFERENCES items(id),record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,
 CHECK ((boq_file_id IS NOT NULL AND change_order_id IS NULL) OR (boq_file_id IS NULL AND change_order_id IS NOT NULL))
);
CREATE TABLE item_unit_prices(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
 contract_id TEXT NOT NULL REFERENCES construction_contract_records(id),
 boq_file_id TEXT NOT NULL REFERENCES boq_files(id),item_id TEXT REFERENCES items(id),
 record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
);
CREATE TABLE boq_history(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),contract_id TEXT NOT NULL REFERENCES construction_contract_records(id),
 entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 before_json TEXT,after_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE boq_command_intents(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id),contract_id TEXT NOT NULL REFERENCES construction_contract_records(id),
 fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE boq_commands(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE boq_resolutions(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 descriptor_json TEXT NOT NULL,resolved_at TEXT NOT NULL,PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE boq_source_imports(
 id TEXT PRIMARY KEY,source_sha256 TEXT NOT NULL UNIQUE,evidence_json TEXT NOT NULL,evidence_sha256 TEXT NOT NULL,
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE boq_import_restores(
 import_id TEXT PRIMARY KEY REFERENCES boq_source_imports(id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 command_id TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE boq_source_bindings(
 source_sha256 TEXT NOT NULL,legacy_id TEXT NOT NULL,entity_type TEXT NOT NULL,
 entity_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),contract_id TEXT NOT NULL REFERENCES construction_contract_records(id),
 import_id TEXT NOT NULL REFERENCES boq_source_imports(id),PRIMARY KEY(source_sha256,entity_type,legacy_id)
);
CREATE INDEX boq_files_contract ON boq_files(contract_id);
CREATE INDEX boq_lines_contract ON boq_lines(contract_id);
CREATE INDEX boq_change_contract ON boq_change_records(contract_id);
${immutable}
INSERT INTO production_participants VALUES('boq',1);
`

export const PRODUCTION_BOQ_IMPORT_TABLES = ['boq_import_intents', 'boq_import_commands', 'boq_import_resolutions'] as const

/** Appended journal step: a full source batch keeps its own SHA scope across all original Main contracts. */
export const PRODUCTION_BOQ_IMPORT_SCHEMA = `
CREATE TABLE boq_import_intents(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('adopt','restore')),source_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE boq_import_commands(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE boq_import_resolutions(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 descriptor_json TEXT NOT NULL,resolved_at TEXT NOT NULL,PRIMARY KEY(workspace_id,actor_id,command_id)
);
${PRODUCTION_BOQ_IMPORT_TABLES.map(table => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Original BOQ migration evidence is immutable'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Original BOQ migration evidence cannot be deleted'); END;`).join('\n')}
`
