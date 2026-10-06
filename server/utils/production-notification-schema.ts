export const PRODUCTION_NOTIFICATION_TABLES = ['notification_revision', 'notification_events', 'notification_reads', 'notification_commands'] as const
export const PRODUCTION_NOTIFICATION_SCHEMA = `
CREATE TABLE notification_revision (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL,
  evaluated_at TEXT, supplier_source_version INTEGER
);
INSERT INTO notification_revision VALUES(1,0,NULL,NULL);
CREATE TABLE notification_events (
  event_id TEXT PRIMARY KEY, owner_domain TEXT NOT NULL CHECK(owner_domain='supplier'),
  problem_id TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL REFERENCES suppliers(id), occurred_at TEXT NOT NULL
);
CREATE TABLE notification_reads (
  event_id TEXT NOT NULL REFERENCES notification_events(event_id), actor_id TEXT NOT NULL, read_at TEXT NOT NULL,
  PRIMARY KEY(event_id,actor_id)
);
CREATE TABLE notification_commands (
  command_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO production_participants VALUES('notifications',1);
`
