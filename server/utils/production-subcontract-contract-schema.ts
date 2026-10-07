export const PRODUCTION_SUBCONTRACT_CONTRACT_TABLES = [
  'subcontract_contract_revision',
  'subcontract_contract_records',
  'subcontract_contract_supplements',
  'subcontract_contract_versions',
  'subcontract_contract_files',
  'subcontract_contract_intents',
  'subcontract_contract_receipts',
  'subcontract_contract_resolutions',
  'subcontract_contract_imports',
  'subcontract_contract_import_restores',
  'subcontract_contract_import_intents',
  'subcontract_contract_import_receipts',
  'subcontract_contract_import_resolutions',
] as const

/** The existing F2 owner and immutable adoption evidence; no copied directory, cost or cash tables. */
export const PRODUCTION_SUBCONTRACT_CONTRACT_SCHEMA = `
CREATE TABLE subcontract_contract_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO subcontract_contract_revision VALUES(1,0);
CREATE TABLE subcontract_contract_records(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),supplier_id TEXT REFERENCES suppliers(id),deleted_at TEXT,record_json TEXT NOT NULL,
  no TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.no')) VIRTUAL,
  name TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.name')) VIRTUAL,
  kind TEXT GENERATED ALWAYS AS ('分包') VIRTUAL,
  status TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.status')) VIRTUAL,
  version INTEGER GENERATED ALWAYS AS (json_extract(record_json,'$.version')) VIRTUAL);
CREATE TABLE subcontract_contract_supplements(id TEXT PRIMARY KEY,contract_id TEXT NOT NULL REFERENCES subcontract_contract_records(id),record_json TEXT NOT NULL);
CREATE TABLE subcontract_contract_versions(id TEXT NOT NULL REFERENCES subcontract_contract_records(id),version INTEGER NOT NULL CHECK(version>=1),actor_id TEXT NOT NULL,command_id TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(id,version));
CREATE TABLE subcontract_contract_files(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),contract_id TEXT NOT NULL REFERENCES subcontract_contract_records(id),owner_kind TEXT NOT NULL CHECK(owner_kind IN('head','supplement')),supplement_id TEXT REFERENCES subcontract_contract_supplements(id),original_metadata_json TEXT NOT NULL,body_state TEXT NOT NULL CHECK(body_state IN('embedded','metadata-only')),sha256 TEXT,CHECK((owner_kind='head' AND supplement_id IS NULL) OR (owner_kind='supplement' AND supplement_id IS NOT NULL)));
CREATE TABLE subcontract_contract_intents(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,target_id TEXT,fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE subcontract_contract_receipts(command_id TEXT PRIMARY KEY REFERENCES subcontract_contract_intents(command_id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,contract_id TEXT NOT NULL REFERENCES subcontract_contract_records(id),fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE subcontract_contract_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE TABLE subcontract_contract_imports(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL UNIQUE,source_sha256 TEXT NOT NULL UNIQUE,evidence_json TEXT NOT NULL,evidence_sha256 TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE subcontract_contract_import_restores(import_id TEXT PRIMARY KEY REFERENCES subcontract_contract_imports(id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL UNIQUE,result_json TEXT NOT NULL,restored_at TEXT NOT NULL);
CREATE TABLE subcontract_contract_import_intents(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('adopt','restore')),scope_id TEXT NOT NULL,fingerprint TEXT NOT NULL,request_proof_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE subcontract_contract_import_receipts(command_id TEXT PRIMARY KEY REFERENCES subcontract_contract_import_intents(command_id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('adopt','restore')),scope_id TEXT NOT NULL,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL);
CREATE TABLE subcontract_contract_import_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('adopt','restore')),scope_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
${['subcontract_contract_versions', 'subcontract_contract_intents', 'subcontract_contract_receipts', 'subcontract_contract_resolutions', 'subcontract_contract_imports', 'subcontract_contract_import_restores', 'subcontract_contract_import_intents', 'subcontract_contract_import_receipts', 'subcontract_contract_import_resolutions'].map(table => `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'subcontract original evidence is immutable'); END;\nCREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'subcontract original evidence is immutable'); END;`).join('\n')}
INSERT INTO production_participants VALUES('subcontract-contracts',1);
`
