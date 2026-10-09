export const PRODUCTION_CONSTRUCTION_CONTRACT_TABLES = ['construction_contract_revision', 'construction_contract_records', 'construction_contract_supplements', 'construction_contract_versions', 'construction_contract_files', 'construction_contract_intents', 'construction_contract_receipts', 'construction_contract_resolutions', 'construction_contract_imports', 'construction_contract_import_restores'] as const

/** Appended v21 domain owner; existing project/customer, signatory and number owners remain authoritative. */
export const PRODUCTION_CONSTRUCTION_CONTRACT_SCHEMA = `
CREATE TABLE construction_contract_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO construction_contract_revision VALUES(1,0);
CREATE TABLE construction_contract_records(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),customer_id TEXT REFERENCES customers(id),deleted_at TEXT,record_json TEXT NOT NULL,
 no TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.no')) VIRTUAL,
 name TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.name')) VIRTUAL,
 kind TEXT GENERATED ALWAYS AS ('施工') VIRTUAL,
 status TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.status')) VIRTUAL,
 version INTEGER GENERATED ALWAYS AS (json_extract(record_json,'$.version')) VIRTUAL);
CREATE TABLE construction_contract_supplements(id TEXT PRIMARY KEY,contract_id TEXT NOT NULL REFERENCES construction_contract_records(id),record_json TEXT NOT NULL);
CREATE TABLE construction_contract_versions(id TEXT NOT NULL REFERENCES construction_contract_records(id),version INTEGER NOT NULL CHECK(version>=1),actor_id TEXT NOT NULL,command_id TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(id,version));
CREATE TABLE construction_contract_files(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),contract_id TEXT NOT NULL REFERENCES construction_contract_records(id),owner_kind TEXT NOT NULL CHECK(owner_kind IN('head','supplement')),supplement_id TEXT REFERENCES construction_contract_supplements(id),original_metadata_json TEXT NOT NULL,body_state TEXT NOT NULL CHECK(body_state IN('embedded','metadata-only')),sha256 TEXT,CHECK((owner_kind='head' AND supplement_id IS NULL) OR (owner_kind='supplement' AND supplement_id IS NOT NULL)));
CREATE TABLE construction_contract_intents(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,target_id TEXT REFERENCES construction_contract_records(id) DEFERRABLE INITIALLY DEFERRED,fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE construction_contract_receipts(command_id TEXT PRIMARY KEY REFERENCES construction_contract_intents(command_id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,contract_id TEXT NOT NULL REFERENCES construction_contract_records(id),fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE construction_contract_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE TABLE construction_contract_imports(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL UNIQUE,source_sha256 TEXT NOT NULL UNIQUE,evidence_json TEXT NOT NULL,evidence_sha256 TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE construction_contract_import_restores(import_id TEXT PRIMARY KEY REFERENCES construction_contract_imports(id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL UNIQUE,result_json TEXT NOT NULL,restored_at TEXT NOT NULL);
CREATE TRIGGER construction_contract_versions_no_update BEFORE UPDATE ON construction_contract_versions BEGIN SELECT RAISE(ABORT,'construction original history is immutable'); END;
CREATE TRIGGER construction_contract_versions_no_delete BEFORE DELETE ON construction_contract_versions BEGIN SELECT RAISE(ABORT,'construction original history is immutable'); END;
CREATE TRIGGER construction_contract_intents_no_update BEFORE UPDATE ON construction_contract_intents BEGIN SELECT RAISE(ABORT,'construction original intent is immutable'); END;
CREATE TRIGGER construction_contract_intents_no_delete BEFORE DELETE ON construction_contract_intents BEGIN SELECT RAISE(ABORT,'construction original intent is immutable'); END;
CREATE TRIGGER construction_contract_receipts_no_update BEFORE UPDATE ON construction_contract_receipts BEGIN SELECT RAISE(ABORT,'construction original receipt is immutable'); END;
CREATE TRIGGER construction_contract_receipts_no_delete BEFORE DELETE ON construction_contract_receipts BEGIN SELECT RAISE(ABORT,'construction original receipt is immutable'); END;
CREATE TRIGGER construction_contract_resolutions_no_update BEFORE UPDATE ON construction_contract_resolutions BEGIN SELECT RAISE(ABORT,'construction original sealed key is immutable'); END;
CREATE TRIGGER construction_contract_resolutions_no_delete BEFORE DELETE ON construction_contract_resolutions BEGIN SELECT RAISE(ABORT,'construction original sealed key is immutable'); END;
CREATE TRIGGER construction_contract_imports_no_update BEFORE UPDATE ON construction_contract_imports BEGIN SELECT RAISE(ABORT,'construction source proof is immutable'); END;
CREATE TRIGGER construction_contract_imports_no_delete BEFORE DELETE ON construction_contract_imports BEGIN SELECT RAISE(ABORT,'construction source proof is immutable'); END;
CREATE TRIGGER construction_contract_import_restores_no_update BEFORE UPDATE ON construction_contract_import_restores BEGIN SELECT RAISE(ABORT,'construction restore proof is immutable'); END;
CREATE TRIGGER construction_contract_import_restores_no_delete BEFORE DELETE ON construction_contract_import_restores BEGIN SELECT RAISE(ABORT,'construction restore proof is immutable'); END;
INSERT INTO production_participants VALUES('construction-contracts',1);
`

export const PRODUCTION_CONSTRUCTION_IMPORT_TABLES = ['construction_contract_import_intents', 'construction_contract_import_receipts', 'construction_contract_import_resolutions'] as const
export const PRODUCTION_CONSTRUCTION_IMPORT_SCHEMA = `
CREATE TABLE construction_contract_import_intents(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('adopt','restore')),scope_id TEXT NOT NULL,fingerprint TEXT NOT NULL,request_proof_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE construction_contract_import_receipts(command_id TEXT PRIMARY KEY REFERENCES construction_contract_import_intents(command_id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,scope_id TEXT NOT NULL,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL);
CREATE TABLE construction_contract_import_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,scope_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE TRIGGER construction_contract_import_intents_no_update BEFORE UPDATE ON construction_contract_import_intents BEGIN SELECT RAISE(ABORT,'construction import original intent is immutable'); END;
CREATE TRIGGER construction_contract_import_intents_no_delete BEFORE DELETE ON construction_contract_import_intents BEGIN SELECT RAISE(ABORT,'construction import original intent is immutable'); END;
CREATE TRIGGER construction_contract_import_receipts_no_update BEFORE UPDATE ON construction_contract_import_receipts BEGIN SELECT RAISE(ABORT,'construction import original receipt is immutable'); END;
CREATE TRIGGER construction_contract_import_receipts_no_delete BEFORE DELETE ON construction_contract_import_receipts BEGIN SELECT RAISE(ABORT,'construction import original receipt is immutable'); END;
CREATE TRIGGER construction_contract_import_resolutions_no_update BEFORE UPDATE ON construction_contract_import_resolutions BEGIN SELECT RAISE(ABORT,'construction import original sealed key is immutable'); END;
CREATE TRIGGER construction_contract_import_resolutions_no_delete BEFORE DELETE ON construction_contract_import_resolutions BEGIN SELECT RAISE(ABORT,'construction import original sealed key is immutable'); END;
`
