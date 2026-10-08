export const PRODUCTION_TARGET_COST_TABLES = ['target_costs', 'target_cost_items', 'target_cost_versions', 'target_cost_commands', 'target_cost_resolutions', 'target_cost_draft_claims', 'target_cost_files', 'target_cost_imports', 'target_cost_import_restores', 'target_cost_import_commands', 'target_cost_import_resolutions'] as const

/** Appended by the shared production upgrade registry. No GET installs this schema. */
export const PRODUCTION_TARGET_COST_SCHEMA = `
CREATE TABLE target_costs(
 id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),name TEXT NOT NULL,
 is_baseline INTEGER NOT NULL DEFAULT 0 CHECK(is_baseline IN (0,1)),
 contract_revenue REAL CHECK(contract_revenue IS NULL OR contract_revenue>=0),
 planned_profit REAL CHECK(planned_profit IS NULL OR planned_profit>=0),
 signed_contract_sum REAL CHECK(signed_contract_sum IS NULL OR signed_contract_sum>=0),
 tax_inclusive_total REAL CHECK(tax_inclusive_total IS NULL OR tax_inclusive_total>=0),
 tax_exclusive_total REAL CHECK(tax_exclusive_total IS NULL OR tax_exclusive_total>=0),
 tax_amount REAL CHECK(tax_amount IS NULL OR tax_amount>=0),
 status TEXT NOT NULL DEFAULT 'draft',note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),deleted_at TEXT
);
CREATE UNIQUE INDEX production_target_cost_baseline ON target_costs(project_id) WHERE deleted_at IS NULL AND is_baseline=1;
CREATE INDEX production_target_cost_project ON target_costs(project_id);
CREATE TABLE target_cost_items(
 id TEXT PRIMARY KEY,target_cost_id TEXT NOT NULL REFERENCES target_costs(id),
 cost_category TEXT NOT NULL CHECK(cost_category IN ('专业分包','合同劳务','材料','机械','工人工资','费用报销','其他')),
 item_name TEXT,unit TEXT,qty REAL CHECK(qty IS NULL OR qty>=0),unit_price REAL CHECK(unit_price IS NULL OR unit_price>=0),
 amount REAL NOT NULL CHECK(amount>=0),note TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),deleted_at TEXT
);
CREATE INDEX production_target_cost_items ON target_cost_items(target_cost_id);
CREATE TABLE target_cost_versions(id TEXT PRIMARY KEY REFERENCES target_costs(id),version INTEGER NOT NULL CHECK(version>0),fingerprint TEXT NOT NULL);
CREATE TABLE target_cost_commands(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 target_cost_id TEXT NOT NULL REFERENCES target_costs(id),action TEXT NOT NULL,fingerprint TEXT NOT NULL,
 request_json TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE target_cost_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE TABLE target_cost_draft_claims(draft_key TEXT PRIMARY KEY,target_cost_id TEXT NOT NULL REFERENCES target_costs(id),command_id TEXT NOT NULL REFERENCES target_cost_commands(command_id) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE target_cost_files(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),target_cost_id TEXT NOT NULL REFERENCES target_costs(id),
 original_metadata_json TEXT NOT NULL,body_state TEXT NOT NULL CHECK(body_state IN ('embedded','metadata-only')),sha256 TEXT);
CREATE TABLE target_cost_imports(id TEXT PRIMARY KEY,command_id TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 source_sha256 TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,evidence_json TEXT NOT NULL,evidence_sha256 TEXT NOT NULL,result_json TEXT NOT NULL,imported_at TEXT NOT NULL);
CREATE TRIGGER target_cost_import_no_update BEFORE UPDATE ON target_cost_imports BEGIN SELECT RAISE(ABORT,'budget source evidence is immutable'); END;
CREATE TRIGGER target_cost_import_no_delete BEFORE DELETE ON target_cost_imports BEGIN SELECT RAISE(ABORT,'budget source evidence is immutable'); END;
CREATE TABLE target_cost_import_restores(import_id TEXT PRIMARY KEY REFERENCES target_cost_imports(id),command_id TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,result_json TEXT NOT NULL,restored_at TEXT NOT NULL);
CREATE TABLE target_cost_import_commands(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL);
CREATE TABLE target_cost_import_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
${['target_cost_commands', 'target_cost_resolutions', 'target_cost_import_commands', 'target_cost_import_resolutions', 'target_cost_import_restores'].flatMap(table => ['UPDATE', 'DELETE'].map(action => `CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'budget original command evidence is immutable'); END;`)).join('\n')}
INSERT INTO production_participants VALUES('target-cost',1);
`
