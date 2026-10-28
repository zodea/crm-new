export const PRODUCTION_CONSTRUCTION_SCOPE_TABLES = ['construction_scope_revision', 'construction_scope_links', 'construction_scope_history', 'construction_scope_intents', 'construction_scope_receipts', 'construction_scope_resolutions'] as const

/** Relationships only. Economic facts and originals stay with their existing owners. */
export const PRODUCTION_CONSTRUCTION_SCOPE_SCHEMA = `
CREATE TABLE construction_scope_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO construction_scope_revision VALUES(1,0);
CREATE TABLE construction_scope_links(id TEXT PRIMARY KEY,source_domain TEXT NOT NULL CHECK(source_domain IN('material-contract','original-expense')),source_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),main_id TEXT REFERENCES construction_contract_records(id),version INTEGER NOT NULL CHECK(version>=1),source_basis TEXT NOT NULL,main_basis TEXT,updated_at TEXT NOT NULL,deleted_at TEXT,UNIQUE(source_domain,source_id),CHECK((main_id IS NULL AND main_basis IS NULL AND deleted_at IS NOT NULL) OR (main_id IS NOT NULL AND main_basis IS NOT NULL AND deleted_at IS NULL)));
CREATE TABLE construction_scope_history(link_id TEXT NOT NULL REFERENCES construction_scope_links(id),version INTEGER NOT NULL CHECK(version>=1),source_domain TEXT NOT NULL,source_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),main_id TEXT REFERENCES construction_contract_records(id),source_basis TEXT NOT NULL,main_basis TEXT,command_id TEXT NOT NULL,actor_id TEXT NOT NULL,occurred_at TEXT NOT NULL,deleted_at TEXT,PRIMARY KEY(link_id,version));
CREATE TABLE construction_scope_intents(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,link_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('bind','unbind')),fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE construction_scope_receipts(command_id TEXT PRIMARY KEY REFERENCES construction_scope_intents(command_id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,link_id TEXT NOT NULL REFERENCES construction_scope_links(id),fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE construction_scope_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,link_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('bind','unbind')),resolved_at TEXT NOT NULL);
CREATE TRIGGER construction_scope_links_no_delete BEFORE DELETE ON construction_scope_links BEGIN SELECT RAISE(ABORT,'construction scope history cannot be deleted'); END;
${['construction_scope_history', 'construction_scope_intents', 'construction_scope_receipts', 'construction_scope_resolutions'].map(table => `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'construction scope original evidence is immutable'); END;\nCREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'construction scope original evidence is immutable'); END;`).join('\n')}
INSERT INTO production_participants VALUES('construction-scope',1);
`

/** Append-only expansion. Old rows and immutable evidence retain their original IDs and bytes. */
export const PRODUCTION_CONSTRUCTION_SCOPE_CONTRACT_UPGRADE = `
CREATE TABLE construction_scope_links_next(id TEXT PRIMARY KEY,source_domain TEXT NOT NULL CHECK(source_domain IN('material-contract','original-expense','subcontract-contract','auxiliary-contract')),source_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),main_id TEXT REFERENCES construction_contract_records(id),version INTEGER NOT NULL CHECK(version>=1),source_basis TEXT NOT NULL,main_basis TEXT,updated_at TEXT NOT NULL,deleted_at TEXT,UNIQUE(source_domain,source_id),CHECK((main_id IS NULL AND main_basis IS NULL AND deleted_at IS NOT NULL) OR (main_id IS NOT NULL AND main_basis IS NOT NULL AND deleted_at IS NULL)));
CREATE TABLE construction_scope_history_next(link_id TEXT NOT NULL REFERENCES construction_scope_links_next(id),version INTEGER NOT NULL CHECK(version>=1),source_domain TEXT NOT NULL,source_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),main_id TEXT REFERENCES construction_contract_records(id),source_basis TEXT NOT NULL,main_basis TEXT,command_id TEXT NOT NULL,actor_id TEXT NOT NULL,occurred_at TEXT NOT NULL,deleted_at TEXT,PRIMARY KEY(link_id,version));
CREATE TABLE construction_scope_receipts_next(command_id TEXT PRIMARY KEY REFERENCES construction_scope_intents(command_id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,link_id TEXT NOT NULL REFERENCES construction_scope_links_next(id),fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
INSERT INTO construction_scope_links_next SELECT * FROM construction_scope_links;
INSERT INTO construction_scope_history_next SELECT * FROM construction_scope_history;
INSERT INTO construction_scope_receipts_next SELECT * FROM construction_scope_receipts;
DROP TABLE construction_scope_receipts;
DROP TABLE construction_scope_history;
DROP TABLE construction_scope_links;
ALTER TABLE construction_scope_links_next RENAME TO construction_scope_links;
ALTER TABLE construction_scope_history_next RENAME TO construction_scope_history;
ALTER TABLE construction_scope_receipts_next RENAME TO construction_scope_receipts;
CREATE TRIGGER construction_scope_links_no_delete BEFORE DELETE ON construction_scope_links BEGIN SELECT RAISE(ABORT,'construction scope history cannot be deleted'); END;
${['construction_scope_history', 'construction_scope_receipts'].map(table => `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'construction scope original evidence is immutable'); END;\nCREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'construction scope original evidence is immutable'); END;`).join('\n')}
UPDATE production_participants SET schema_version=2 WHERE domain='construction-scope';
`
