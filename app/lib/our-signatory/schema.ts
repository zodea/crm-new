export const OUR_SIGNATORY_TABLES = ['our_signatory_revision', 'our_signatories', 'our_signatory_history', 'our_signatory_commands', 'our_signatory_resolutions'] as const
export const OUR_SIGNATORY_SCHEMA = `
CREATE TABLE our_signatory_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0));
INSERT INTO our_signatory_revision VALUES(1,0);
CREATE TABLE our_signatories(id TEXT PRIMARY KEY,draft_json TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE our_signatory_history(id TEXT PRIMARY KEY,signatory_id TEXT NOT NULL REFERENCES our_signatories(id),version INTEGER NOT NULL CHECK(version>0),draft_json TEXT NOT NULL,actor_id TEXT,command_id TEXT,occurred_at TEXT NOT NULL,UNIQUE(signatory_id,version));
CREATE TABLE our_signatory_commands(scoped_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,result_json TEXT,signatory_id TEXT REFERENCES our_signatories(id));
CREATE TABLE our_signatory_resolutions(scoped_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE TRIGGER our_signatory_history_update_guard BEFORE UPDATE ON our_signatory_history BEGIN SELECT RAISE(ABORT,'our signatory history is immutable'); END;
CREATE TRIGGER our_signatory_history_delete_guard BEFORE DELETE ON our_signatory_history BEGIN SELECT RAISE(ABORT,'our signatory history is immutable'); END;
CREATE TRIGGER our_signatory_delete_guard BEFORE DELETE ON our_signatories BEGIN SELECT RAISE(ABORT,'retire our signatories without deleting identity'); END;
`

export const CONTRACT_NUMBER_TABLES = ['contract_number_claims', 'contract_number_history'] as const
export const CONTRACT_NUMBER_SCHEMA = `
CREATE TABLE contract_number_claims(owner_domain TEXT NOT NULL,contract_id TEXT NOT NULL,number TEXT NOT NULL,version TEXT NOT NULL,claimed_at TEXT NOT NULL,PRIMARY KEY(owner_domain,contract_id));
CREATE INDEX contract_number_lookup ON contract_number_claims(number);
CREATE TABLE contract_number_history(id TEXT PRIMARY KEY,owner_domain TEXT NOT NULL,contract_id TEXT NOT NULL,number TEXT NOT NULL,version TEXT NOT NULL,occurred_at TEXT NOT NULL,reason TEXT NOT NULL);
CREATE TRIGGER contract_number_history_update_guard BEFORE UPDATE ON contract_number_history BEGIN SELECT RAISE(ABORT,'contract number history is immutable'); END;
CREATE TRIGGER contract_number_history_delete_guard BEFORE DELETE ON contract_number_history BEGIN SELECT RAISE(ABORT,'contract number history is immutable'); END;
`
