export const PRODUCTION_MATERIAL_CONTRACT_TABLES = ['material_contract_revision', 'material_contract_records', 'material_contract_commands', 'material_contract_resolutions'] as const

export const PRODUCTION_MATERIAL_CONTRACT_SCHEMA = `
CREATE TABLE material_contract_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO material_contract_revision VALUES(1,0);
CREATE TABLE material_contract_records(
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES material_contract_records(id) DEFERRABLE INITIALLY DEFERRED,
  project_id TEXT REFERENCES projects(id),
  supplier_id TEXT REFERENCES suppliers(id),
  record_json TEXT NOT NULL
);
CREATE TABLE material_contract_commands(
  scoped_id TEXT PRIMARY KEY, command_id TEXT NOT NULL, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT,
  contract_id TEXT REFERENCES material_contract_records(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE material_contract_resolutions(
  scoped_id TEXT PRIMARY KEY, command_id TEXT NOT NULL, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  resolved_at TEXT NOT NULL
);
INSERT INTO production_participants VALUES('material-contracts',1);
`
