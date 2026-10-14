/** Read projections of the existing owner JSON. No independently writable identities. */
export const PRODUCTION_MASTER_READ_SCHEMA = `
ALTER TABLE crews ADD COLUMN name TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.name')) VIRTUAL;
ALTER TABLE crews ADD COLUMN trade TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.trade')) VIRTUAL;
ALTER TABLE crews ADD COLUMN trade_capabilities TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.capabilityTrades')) VIRTUAL;
ALTER TABLE crews ADD COLUMN item_capabilities TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.capabilityItems')) VIRTUAL;
ALTER TABLE crews ADD COLUMN deleted_at TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.deletedAt')) VIRTUAL;
ALTER TABLE crews ADD COLUMN created_at TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.createdAt')) VIRTUAL;
ALTER TABLE crews ADD COLUMN updated_at TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.updatedAt')) VIRTUAL;
ALTER TABLE workers ADD COLUMN name TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.name')) VIRTUAL;
ALTER TABLE workers ADD COLUMN trade TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.trade')) VIRTUAL;
ALTER TABLE workers ADD COLUMN trade_capabilities TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.capabilityTrades')) VIRTUAL;
ALTER TABLE workers ADD COLUMN item_capabilities TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.capabilityItems')) VIRTUAL;
ALTER TABLE workers ADD COLUMN crew_id TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.crewId')) VIRTUAL;
ALTER TABLE workers ADD COLUMN current_project_id TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.draft.currentProjectId')) VIRTUAL;
ALTER TABLE workers ADD COLUMN daily_wage REAL GENERATED ALWAYS AS (json_extract(record_json,'$.draft.dailyWage')) VIRTUAL;
ALTER TABLE workers ADD COLUMN deleted_at TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.deletedAt')) VIRTUAL;
ALTER TABLE workers ADD COLUMN created_at TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.createdAt')) VIRTUAL;
ALTER TABLE workers ADD COLUMN updated_at TEXT GENERATED ALWAYS AS (json_extract(record_json,'$.updatedAt')) VIRTUAL;
`
