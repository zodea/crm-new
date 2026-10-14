export const PRODUCTION_AUXILIARY_CONTRACT_DOMAIN = 'auxiliary-contract'
export const PRODUCTION_AUXILIARY_CONTRACT_DOMAIN_VERSION = 1
export const PRODUCTION_AUXILIARY_CONTRACT_CAPABILITIES = ['auxiliary-contract:read', 'auxiliary-contract:write', 'auxiliary-contract:import'] as const
export const PRODUCTION_AUXILIARY_CONTRACT_TABLES = ['auxiliary_contract_revision', 'auxiliary_contract_records', 'auxiliary_contract_supplements', 'auxiliary_contract_versions', 'auxiliary_contract_files', 'auxiliary_contract_intents', 'auxiliary_contract_receipts', 'auxiliary_contract_resolutions', 'auxiliary_contract_imports', 'auxiliary_contract_import_restores'] as const
export const PRODUCTION_AUXILIARY_CONTRACT_SCHEMA = `
CREATE TABLE auxiliary_contract_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO auxiliary_contract_revision VALUES(1,0);
CREATE TABLE auxiliary_contract_records(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),supplier_id TEXT REFERENCES suppliers(id),deleted_at TEXT,record_json TEXT NOT NULL);
CREATE TABLE auxiliary_contract_supplements(id TEXT PRIMARY KEY,contract_id TEXT NOT NULL REFERENCES auxiliary_contract_records(id),record_json TEXT NOT NULL);
CREATE TABLE auxiliary_contract_versions(id TEXT NOT NULL REFERENCES auxiliary_contract_records(id),version INTEGER NOT NULL CHECK(version>=1),actor_id TEXT NOT NULL,command_id TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(id,version));
CREATE TABLE auxiliary_contract_files(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),contract_id TEXT NOT NULL REFERENCES auxiliary_contract_records(id),owner_kind TEXT NOT NULL CHECK(owner_kind IN('head','supplement')),supplement_id TEXT REFERENCES auxiliary_contract_supplements(id),original_metadata_json TEXT NOT NULL,body_state TEXT NOT NULL CHECK(body_state IN('embedded','metadata-only')),sha256 TEXT,CHECK((owner_kind='head' AND supplement_id IS NULL) OR (owner_kind='supplement' AND supplement_id IS NOT NULL)));
CREATE TABLE auxiliary_contract_intents(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('save','adopt','restore')),scope_id TEXT NOT NULL,target_id TEXT,fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE auxiliary_contract_receipts(command_id TEXT PRIMARY KEY REFERENCES auxiliary_contract_intents(command_id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,scope_id TEXT NOT NULL,contract_id TEXT REFERENCES auxiliary_contract_records(id),fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE auxiliary_contract_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,scope_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE TABLE auxiliary_contract_imports(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL UNIQUE,source_sha256 TEXT NOT NULL UNIQUE,evidence_json TEXT NOT NULL,evidence_sha256 TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE auxiliary_contract_import_restores(import_id TEXT PRIMARY KEY REFERENCES auxiliary_contract_imports(id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL UNIQUE,result_json TEXT NOT NULL,restored_at TEXT NOT NULL);
${['auxiliary_contract_versions', 'auxiliary_contract_intents', 'auxiliary_contract_receipts', 'auxiliary_contract_resolutions', 'auxiliary_contract_imports', 'auxiliary_contract_import_restores'].map(table => `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'auxiliary original evidence is immutable'); END;\nCREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'auxiliary original evidence is immutable'); END;`).join('\n')}
INSERT INTO production_participants VALUES('auxiliary-contract',1);
`
export function isProductionAuxiliaryContractRoute(path: string, method = 'GET') {
  return method === 'GET' ? /^\/api\/read\/auxiliary-contracts(?:\/[a-z0-9][\w-]{2,79}(?:\/files\/[a-z0-9][\w-]{2,79})?)?$/i.test(path) : method === 'POST' && /^\/api\/commands\/auxiliary-contracts(?:\/(?:resolve|import|restore-import))?$/.test(path)
}
