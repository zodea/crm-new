/** Focused current quantity DDL. No Native bootstrap, default library, or master synchronization. */
export const PRODUCTION_QUANTITY_TABLES = ['items', 'buildings', 'house_type_templates', 'construction_stages', 'floors', 'rooms', 'units', 'construction_stage_items', 'unit_assignments', 'unit_stage_completions', 'unit_assignment_scopes', 'quantity_boq_references', 'house_type_template_items', 'quantity_hollow_records', 'quantity_hollow_revisions', 'quantity_hollow_rectifications', 'quantity_hollow_logs', 'quantity_hollow_command_receipts', 'quantity_hollow_migration_evidence', 'quantity_revisions', 'quantity_commands', 'quantity_resolutions', 'quantity_source_imports', 'quantity_import_restores'] as const

export const PRODUCTION_QUANTITY_SCHEMA = `
ALTER TABLE projects ADD COLUMN matrix_archived_at TEXT;
CREATE TABLE items (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  section    TEXT,
  trade      TEXT NOT NULL,
  unit       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE buildings (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE house_type_templates (
  id                      TEXT PRIMARY KEY,
  project_id              TEXT NOT NULL REFERENCES projects(id),
  code                    TEXT NOT NULL,
  name                    TEXT,
  copied_from_template_id TEXT REFERENCES house_type_templates(id),
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at              TEXT DEFAULT NULL
);

CREATE TABLE construction_stages (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  trade           TEXT NOT NULL,
  completion_mode TEXT NOT NULL DEFAULT 'unit' CHECK (completion_mode IN ('unit', 'manual')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT DEFAULT NULL
);

CREATE TABLE floors (
  id          TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT DEFAULT NULL
);

CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES house_type_templates(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'room' CHECK (kind IN ('room', 'whole_unit')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT DEFAULT NULL
);

CREATE TABLE units (
  id                     TEXT PRIMARY KEY,
  floor_id               TEXT NOT NULL REFERENCES floors(id),
  house_type_template_id TEXT NOT NULL REFERENCES house_type_templates(id),
  code                   TEXT NOT NULL,
  name                   TEXT,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT DEFAULT NULL
);

CREATE TABLE construction_stage_items (
  id         TEXT PRIMARY KEY,
  stage_id   TEXT NOT NULL REFERENCES construction_stages(id),
  item_id    TEXT NOT NULL REFERENCES items(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
, "is_reporting_stage" INTEGER NOT NULL DEFAULT 0 CHECK (is_reporting_stage IN (0, 1)));

CREATE TABLE unit_assignments (
  id         TEXT PRIMARY KEY,
  unit_id    TEXT NOT NULL REFERENCES units(id),
  trade      TEXT NOT NULL,
  crew_id    TEXT REFERENCES crews(id),
  worker_id  TEXT REFERENCES workers(id),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL,
  CHECK (
    (crew_id IS NOT NULL AND worker_id IS NULL)
    OR (crew_id IS NULL AND worker_id IS NOT NULL)
  )
);

CREATE TABLE unit_stage_completions (
  id            TEXT PRIMARY KEY,
  unit_id       TEXT NOT NULL REFERENCES units(id),
  stage_id      TEXT NOT NULL REFERENCES construction_stages(id),
  assignment_id TEXT REFERENCES unit_assignments(id),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  completed_at  TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL,
  CHECK (status = 'draft' OR (completed_at IS NOT NULL AND assignment_id IS NOT NULL))
);

CREATE TABLE unit_assignment_scopes (
  id            TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES unit_assignments(id),
  room_id       TEXT NOT NULL REFERENCES rooms(id),
  item_id       TEXT NOT NULL REFERENCES items(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL
);

CREATE INDEX idx_buildings_project ON buildings(project_id);

CREATE INDEX idx_floors_building ON floors(building_id);

CREATE INDEX idx_units_floor ON units(floor_id);

CREATE INDEX idx_units_template ON units(house_type_template_id);

CREATE INDEX idx_rooms_template ON rooms(template_id);

CREATE INDEX idx_items_project ON items(project_id);

CREATE INDEX idx_ht_project ON house_type_templates(project_id);

CREATE INDEX idx_stages_project ON construction_stages(project_id);

CREATE INDEX idx_stage_items_stage ON construction_stage_items(stage_id);

CREATE INDEX idx_unit_assignments_unit ON unit_assignments(unit_id);

CREATE INDEX idx_unit_assignments_crew ON unit_assignments(crew_id);

CREATE INDEX idx_unit_assignments_worker ON unit_assignments(worker_id);

CREATE INDEX idx_unit_assignments_trade ON unit_assignments(trade);

CREATE INDEX idx_uas_assignment ON unit_assignment_scopes(assignment_id);

CREATE INDEX idx_usc_stage_date ON unit_stage_completions(stage_id, completed_at);

CREATE INDEX idx_usc_unit ON unit_stage_completions(unit_id);

CREATE INDEX idx_usc_assignment ON unit_stage_completions(assignment_id);

CREATE UNIQUE INDEX uq_building_code
  ON buildings(project_id, code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_floor_code
  ON floors(building_id, code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_unit_code
  ON units(floor_id, code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_room_code
  ON rooms(template_id, code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_room_whole_unit
  ON rooms(template_id) WHERE deleted_at IS NULL AND kind = 'whole_unit';

CREATE UNIQUE INDEX uq_item_code
  ON items(project_id, code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_ht_code
  ON house_type_templates(project_id, code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_stage_code
  ON construction_stages(project_id, code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_stage_item
  ON construction_stage_items(stage_id, item_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_unit_assignment_trade
  ON unit_assignments(unit_id, trade) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_uas_scope
  ON unit_assignment_scopes(assignment_id, room_id, item_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_usc_unit_stage
  ON unit_stage_completions(unit_id, stage_id) WHERE deleted_at IS NULL;

CREATE INDEX idx_items_deleted ON items(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_buildings_deleted ON buildings(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_floors_deleted ON floors(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_house_type_templates_deleted ON house_type_templates(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_rooms_deleted ON rooms(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_units_deleted ON units(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_construction_stages_deleted ON construction_stages(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_construction_stage_items_deleted ON construction_stage_items(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_unit_assignments_deleted ON unit_assignments(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_unit_stage_completions_deleted ON unit_stage_completions(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_unit_assignment_scopes_deleted ON unit_assignment_scopes(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER trg_house_type_templates_whole_unit
AFTER INSERT ON house_type_templates
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO rooms (id, template_id, code, name, kind, sort_order)
  VALUES (NEW.id || ':whole_unit', NEW.id, '__whole_unit__', '鏁存埛鑼冨洿', 'whole_unit', -1);
END;

CREATE TRIGGER trg_rooms_keep_whole_unit
BEFORE UPDATE OF deleted_at ON rooms
WHEN OLD.kind = 'whole_unit' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'whole_unit room cannot be deleted');
END;

CREATE UNIQUE INDEX uq_stage_item_reporting
        ON construction_stage_items(item_id)
        WHERE deleted_at IS NULL AND is_reporting_stage = 1
      ;

CREATE TABLE quantity_boq_references (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), contract_id TEXT NOT NULL);

CREATE TABLE "house_type_template_items" (
  id                      TEXT PRIMARY KEY,
  room_id                 TEXT NOT NULL REFERENCES rooms(id),
  item_id                 TEXT NOT NULL REFERENCES items(id),
  recognized_contract_qty REAL,
  contract_qty            REAL,
  provisional_qty         REAL,
  field_formula           TEXT,
  field_qty               REAL,
  note                    TEXT,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at              TEXT DEFAULT NULL
, "boq_line_id" TEXT REFERENCES quantity_boq_references(id));

CREATE INDEX idx_hti_room ON house_type_template_items(room_id);

CREATE INDEX idx_hti_item ON house_type_template_items(item_id);

CREATE UNIQUE INDEX uq_hti_room_item
  ON house_type_template_items(room_id, item_id) WHERE deleted_at IS NULL;

CREATE INDEX idx_house_type_template_items_deleted ON house_type_template_items(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_hti_boq_line
          ON house_type_template_items(boq_line_id);

CREATE TABLE quantity_hollow_records (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), unit_id TEXT NOT NULL REFERENCES units(id),
    assignment_id TEXT NOT NULL REFERENCES unit_assignments(id), room_id TEXT NOT NULL REFERENCES rooms(id), item_id TEXT NOT NULL REFERENCES items(id),
    ownership_key TEXT NOT NULL, original_party_json TEXT NOT NULL, location_json TEXT NOT NULL, responsibility_proof_json TEXT NOT NULL,
    responsibility_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, command_receipt_id TEXT NOT NULL REFERENCES quantity_hollow_command_receipts(id) DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE quantity_hollow_revisions (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES quantity_hollow_records(id) DEFERRABLE INITIALLY DEFERRED,
    previous_revision_id TEXT REFERENCES quantity_hollow_revisions(id) DEFERRABLE INITIALLY DEFERRED,
    inspected_on TEXT NOT NULL, count INTEGER NOT NULL CHECK(typeof(count)='integer' AND count>=0 AND count<=9007199254740991),
    note TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL, command_receipt_id TEXT NOT NULL UNIQUE REFERENCES quantity_hollow_command_receipts(id) DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE quantity_hollow_rectifications (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES quantity_hollow_records(id), revision_id TEXT NOT NULL REFERENCES quantity_hollow_revisions(id),
    rectified_on TEXT NOT NULL, count INTEGER NOT NULL CHECK(typeof(count)='integer' AND count>0 AND count<=9007199254740991),
    note TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, command_receipt_id TEXT NOT NULL UNIQUE REFERENCES quantity_hollow_command_receipts(id) DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE quantity_hollow_logs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), record_id TEXT NOT NULL REFERENCES quantity_hollow_records(id),
    previous_log_id TEXT REFERENCES quantity_hollow_logs(id), kind TEXT NOT NULL CHECK(kind IN ('create-hollow-inspection','revise-hollow-inspection','rectify-hollow-inspection')),
    revision_id TEXT NOT NULL REFERENCES quantity_hollow_revisions(id), rectification_id TEXT REFERENCES quantity_hollow_rectifications(id),
    payload_json TEXT NOT NULL, payload_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, actor_id TEXT NOT NULL, command_receipt_id TEXT NOT NULL UNIQUE REFERENCES quantity_hollow_command_receipts(id) DEFERRABLE INITIALLY DEFERRED);

CREATE TABLE quantity_hollow_command_receipts (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, command_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id), unit_id TEXT NOT NULL REFERENCES units(id), record_id TEXT NOT NULL REFERENCES quantity_hollow_records(id) DEFERRABLE INITIALLY DEFERRED,
    kind TEXT NOT NULL CHECK(kind IN ('create-hollow-inspection','revise-hollow-inspection','rectify-hollow-inspection')), request_json TEXT NOT NULL, request_fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, result_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(workspace_id,actor_id,command_id));

CREATE UNIQUE INDEX quantity_hollow_revisions_first ON quantity_hollow_revisions(record_id) WHERE previous_revision_id IS NULL;

CREATE UNIQUE INDEX quantity_hollow_revisions_successor ON quantity_hollow_revisions(previous_revision_id) WHERE previous_revision_id IS NOT NULL;

CREATE UNIQUE INDEX quantity_hollow_logs_first ON quantity_hollow_logs(record_id) WHERE previous_log_id IS NULL;

CREATE UNIQUE INDEX quantity_hollow_logs_successor ON quantity_hollow_logs(previous_log_id) WHERE previous_log_id IS NOT NULL;

CREATE TABLE quantity_hollow_migration_evidence (
    entity_id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE, batch_id TEXT NOT NULL,
    source_package_json TEXT NOT NULL, source_fingerprint TEXT NOT NULL, mapped_package_json TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE quantity_revisions(project_id TEXT PRIMARY KEY REFERENCES projects(id),revision INTEGER NOT NULL CHECK(revision>=0));
CREATE TABLE quantity_commands(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id),fingerprint TEXT NOT NULL,
 request_json TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE quantity_resolutions(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,resolved_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE quantity_source_imports(
 id TEXT PRIMARY KEY,source_sha256 TEXT NOT NULL UNIQUE,
 evidence_json TEXT NOT NULL,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 command_id TEXT NOT NULL UNIQUE,result_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE quantity_import_restores(
 import_id TEXT PRIMARY KEY REFERENCES quantity_source_imports(id),command_id TEXT NOT NULL UNIQUE,
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL
);
INSERT INTO production_participants VALUES('quantity',1);
`
