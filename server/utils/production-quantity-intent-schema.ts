export const PRODUCTION_QUANTITY_INTENT_TABLES = ['quantity_command_intents'] as const

/** Original identities survive a rejected or interrupted attempt without browser body storage. */
export const PRODUCTION_QUANTITY_INTENT_SCHEMA = `
CREATE TABLE quantity_command_intents(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id),fingerprint TEXT NOT NULL,
 request_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TRIGGER quantity_intents_no_update BEFORE UPDATE ON quantity_command_intents
 BEGIN SELECT RAISE(ABORT,'quantity original intent is immutable'); END;
CREATE TRIGGER quantity_intents_no_delete BEFORE DELETE ON quantity_command_intents
 BEGIN SELECT RAISE(ABORT,'quantity original intent is immutable'); END;
ALTER TABLE quantity_resolutions ADD COLUMN descriptor_json TEXT;
`
