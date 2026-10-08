/** Focused WBS instance facts. Immutable libraries remain in their existing formal owner. */
export const PRODUCTION_WBS_TABLES = ['quantity_contract_references', 'schedule_group_buildings', 'task_dependencies', 'schedule_groups', 'schedule_tasks', 'task_item_map', 'schedule_task_floor_plans', 'schedule_migration_evidence', 'schedule_command_receipts', 'schedule_revisions', 'schedule_floor_quantity_snapshots', 'schedule_command_intents', 'schedule_command_resolutions', 'schedule_source_imports', 'schedule_import_restores', 'schedule_files', 'schedule_import_intents', 'schedule_import_commands', 'schedule_import_resolutions'] as const

export const PRODUCTION_WBS_SCHEMA = `
CREATE TABLE quantity_contract_references(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id));
CREATE TABLE schedule_group_buildings (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES schedule_groups(id),
  building_id TEXT NOT NULL REFERENCES buildings(id),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT DEFAULT NULL
);

CREATE TABLE task_dependencies (
  id              TEXT PRIMARY KEY,
  pred_id         TEXT NOT NULL REFERENCES schedule_tasks(id),
  succ_id         TEXT NOT NULL REFERENCES schedule_tasks(id),
  dependency_type TEXT NOT NULL DEFAULT 'FS' CHECK (dependency_type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT DEFAULT NULL,
  CHECK (pred_id <> succ_id)
);

CREATE INDEX idx_sgb_group ON schedule_group_buildings(group_id);

CREATE INDEX idx_sgb_building ON schedule_group_buildings(building_id);

CREATE INDEX idx_task_deps_pred ON task_dependencies(pred_id);

CREATE INDEX idx_task_deps_succ ON task_dependencies(succ_id);

CREATE UNIQUE INDEX uq_schedule_group_building
  ON schedule_group_buildings(group_id, building_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_task_dependency
  ON task_dependencies(pred_id, succ_id, dependency_type) WHERE deleted_at IS NULL;

CREATE INDEX idx_schedule_group_buildings_deleted
  ON schedule_group_buildings(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_task_dependencies_deleted
  ON task_dependencies(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE "schedule_groups" (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
, "contract_id" TEXT REFERENCES quantity_contract_references(id), "scope_basis" TEXT CHECK (scope_basis IN ('contract', 'provisional')), "contract_bound_at" TEXT, "process_library_id" TEXT REFERENCES process_library_versions(id), "process_library_name_snapshot" TEXT NOT NULL DEFAULT '', "process_library_version_snapshot" INTEGER);

CREATE INDEX idx_schedule_groups_project ON schedule_groups(project_id);

CREATE UNIQUE INDEX uq_schedule_group_name
  ON schedule_groups(project_id, name) WHERE deleted_at IS NULL;

CREATE INDEX idx_schedule_groups_deleted
  ON schedule_groups(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_schedule_groups_contract
          ON schedule_groups(contract_id);

CREATE INDEX idx_schedule_groups_scope_basis
      ON schedule_groups(project_id, scope_basis);

CREATE INDEX idx_schedule_groups_process_library
      ON schedule_groups(process_library_id);

CREATE TRIGGER trg_schedule_group_scope_insert
    BEFORE INSERT ON schedule_groups
    WHEN NEW.scope_basis IS NOT NULL
      AND (
        (NEW.scope_basis = 'contract' AND NEW.contract_id IS NULL)
        OR (NEW.scope_basis = 'provisional' AND NEW.contract_id IS NOT NULL)
      )
    BEGIN
      SELECT RAISE(ABORT, 'schedule scope basis mismatch');
    END;

CREATE TRIGGER trg_schedule_group_scope_update
    BEFORE UPDATE OF scope_basis, contract_id ON schedule_groups
    WHEN NEW.scope_basis IS NOT NULL
      AND (
        (NEW.scope_basis = 'contract' AND NEW.contract_id IS NULL)
        OR (NEW.scope_basis = 'provisional' AND NEW.contract_id IS NOT NULL)
      )
    BEGIN
      SELECT RAISE(ABORT, 'schedule scope basis mismatch');
    END;

CREATE TABLE "schedule_tasks" (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  group_id        TEXT REFERENCES schedule_groups(id),
  parent_id       TEXT REFERENCES schedule_tasks(id),
  name            TEXT NOT NULL,
  trade           TEXT NOT NULL DEFAULT '',
  color           TEXT NOT NULL DEFAULT '#64748b',
  duration_days   INTEGER NOT NULL DEFAULT 1 CHECK (duration_days > 0),
  planned_start   TEXT NOT NULL,
  planned_finish  TEXT NOT NULL,
  baseline_start  TEXT,
  baseline_finish TEXT,
  has_qty         INTEGER NOT NULL DEFAULT 0 CHECK (has_qty IN (0, 1)),
  manual_progress REAL,
  stage_id        TEXT REFERENCES construction_stages(id),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT DEFAULT NULL, "source_library_task_id" TEXT, "source_library_version" INTEGER, "template_snapshot_json" TEXT DEFAULT '{}',
  CHECK (planned_finish >= planned_start),
  CHECK (
    (baseline_start IS NULL AND baseline_finish IS NULL)
    OR (
      baseline_start IS NOT NULL
      AND baseline_finish IS NOT NULL
      AND baseline_finish >= baseline_start
    )
  ),
  CHECK (
    (has_qty = 1 AND stage_id IS NOT NULL AND manual_progress IS NULL)
    OR (
      has_qty = 0
      AND stage_id IS NULL
      AND manual_progress IS NOT NULL
      AND manual_progress >= 0
      AND manual_progress <= 1
    )
  )
);

CREATE INDEX idx_schedule_tasks_project ON schedule_tasks(project_id);

CREATE INDEX idx_schedule_tasks_group ON schedule_tasks(group_id);

CREATE INDEX idx_schedule_tasks_parent ON schedule_tasks(parent_id);

CREATE INDEX idx_schedule_tasks_stage ON schedule_tasks(stage_id);

CREATE INDEX idx_schedule_tasks_deleted
  ON schedule_tasks(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE "task_item_map" (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES schedule_tasks(id),
  item_id    TEXT NOT NULL REFERENCES items(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
, "boq_line_id" TEXT REFERENCES quantity_boq_references(id));

CREATE INDEX idx_task_item_map_task ON task_item_map(task_id);

CREATE INDEX idx_task_item_map_item ON task_item_map(item_id);

CREATE UNIQUE INDEX uq_task_item_map
  ON task_item_map(task_id, item_id) WHERE deleted_at IS NULL;

CREATE INDEX idx_task_item_map_deleted
  ON task_item_map(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_task_item_map_boq_line
          ON task_item_map(boq_line_id);

CREATE TABLE "schedule_task_floor_plans" (
            id              TEXT PRIMARY KEY,
            task_id         TEXT NOT NULL REFERENCES schedule_tasks(id),
            floor_id        TEXT NOT NULL REFERENCES floors(id),
            item_id         TEXT NOT NULL REFERENCES items(id),
            boq_line_id     TEXT REFERENCES quantity_boq_references(id),
            source_basis    TEXT NOT NULL
                            CHECK (source_basis IN ('contract', 'provisional')),
            provisional_qty REAL,
            planned_start   TEXT NOT NULL,
            planned_finish  TEXT NOT NULL,
            is_manual       INTEGER NOT NULL DEFAULT 0 CHECK (is_manual IN (0, 1)),
            note            TEXT NOT NULL DEFAULT '',
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
            deleted_at      TEXT DEFAULT NULL,
            CHECK (planned_finish >= planned_start),
            CHECK (
              (
                source_basis = 'contract'
                AND boq_line_id IS NOT NULL
                AND provisional_qty IS NULL
              )
              OR (
                source_basis = 'provisional'
                AND boq_line_id IS NULL

                AND provisional_qty >= 0
              )
            )
          );

CREATE INDEX idx_schedule_floor_plans_task
            ON schedule_task_floor_plans(task_id);

CREATE INDEX idx_schedule_floor_plans_floor
            ON schedule_task_floor_plans(floor_id);

CREATE INDEX idx_schedule_floor_plans_item
            ON schedule_task_floor_plans(item_id);

CREATE INDEX idx_schedule_floor_plans_boq
            ON schedule_task_floor_plans(boq_line_id);

CREATE INDEX idx_schedule_task_floor_plans_deleted
            ON schedule_task_floor_plans(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE UNIQUE INDEX uq_schedule_floor_plan_contract_scope
            ON schedule_task_floor_plans(task_id, floor_id, boq_line_id)
            WHERE deleted_at IS NULL
              AND source_basis = 'contract'
              AND boq_line_id IS NOT NULL;

CREATE UNIQUE INDEX uq_schedule_floor_plan_provisional_scope
            ON schedule_task_floor_plans(task_id, floor_id, item_id)
            WHERE deleted_at IS NULL
              AND source_basis = 'provisional';

CREATE TABLE schedule_migration_evidence (entity_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, batch_id TEXT NOT NULL, source_graph_json TEXT NOT NULL, provisional_detail_status TEXT NOT NULL);

CREATE TABLE schedule_command_receipts (
    command_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, result_json TEXT NOT NULL);

CREATE TABLE schedule_revisions (
    project_id TEXT PRIMARY KEY REFERENCES projects(id), revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),fingerprint TEXT NOT NULL);

CREATE TABLE schedule_floor_quantity_snapshots (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL, legacy_missing INTEGER NOT NULL DEFAULT 0);
CREATE TABLE schedule_command_intents(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL UNIQUE,project_id TEXT NOT NULL REFERENCES projects(id),
 fingerprint TEXT NOT NULL,request_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE schedule_command_resolutions(
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,descriptor_json TEXT NOT NULL,resolved_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,command_id)
);
CREATE TABLE schedule_source_imports(
 id TEXT PRIMARY KEY,source_sha256 TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 command_id TEXT NOT NULL UNIQUE,evidence_json TEXT NOT NULL,evidence_sha256 TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE schedule_import_restores(
 import_id TEXT PRIMARY KEY REFERENCES schedule_source_imports(id),command_id TEXT NOT NULL UNIQUE,
 workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,result_json TEXT NOT NULL,restored_at TEXT NOT NULL
);
CREATE TABLE schedule_files(
 file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),project_id TEXT NOT NULL REFERENCES projects(id),
 owner_type TEXT NOT NULL CHECK(owner_type IN('schedule_group','schedule_task')),owner_id TEXT NOT NULL,
 original_metadata_json TEXT NOT NULL,body_state TEXT NOT NULL CHECK(body_state IN('embedded','metadata-only')),sha256 TEXT
);
CREATE TABLE schedule_import_intents(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('adopt','restore')),fingerprint TEXT NOT NULL,request_proof_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE schedule_import_commands(command_id TEXT PRIMARY KEY REFERENCES schedule_import_intents(command_id),workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('adopt','restore')),fingerprint TEXT NOT NULL,result_json TEXT NOT NULL);
CREATE TABLE schedule_import_resolutions(command_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,descriptor_json TEXT NOT NULL,resolved_at TEXT NOT NULL);
CREATE TRIGGER schedule_import_intents_no_update BEFORE UPDATE ON schedule_import_intents BEGIN SELECT RAISE(ABORT,'WBS import original evidence is immutable'); END;
CREATE TRIGGER schedule_import_intents_no_delete BEFORE DELETE ON schedule_import_intents BEGIN SELECT RAISE(ABORT,'WBS import original evidence is immutable'); END;
CREATE TRIGGER schedule_import_commands_no_update BEFORE UPDATE ON schedule_import_commands BEGIN SELECT RAISE(ABORT,'WBS import original evidence is immutable'); END;
CREATE TRIGGER schedule_import_commands_no_delete BEFORE DELETE ON schedule_import_commands BEGIN SELECT RAISE(ABORT,'WBS import original evidence is immutable'); END;
CREATE TRIGGER schedule_import_resolutions_no_update BEFORE UPDATE ON schedule_import_resolutions BEGIN SELECT RAISE(ABORT,'WBS import original evidence is immutable'); END;
CREATE TRIGGER schedule_import_resolutions_no_delete BEFORE DELETE ON schedule_import_resolutions BEGIN SELECT RAISE(ABORT,'WBS import original evidence is immutable'); END;
CREATE TRIGGER schedule_command_intents_no_update BEFORE UPDATE ON schedule_command_intents BEGIN SELECT RAISE(ABORT,'WBS original evidence is immutable'); END;
CREATE TRIGGER schedule_command_receipts_no_update BEFORE UPDATE ON schedule_command_receipts BEGIN SELECT RAISE(ABORT,'WBS original evidence is immutable'); END;
CREATE TRIGGER schedule_command_receipts_no_delete BEFORE DELETE ON schedule_command_receipts BEGIN SELECT RAISE(ABORT,'WBS original evidence is immutable'); END;
CREATE TRIGGER schedule_command_intents_no_delete BEFORE DELETE ON schedule_command_intents BEGIN SELECT RAISE(ABORT,'WBS original evidence is immutable'); END;
CREATE TRIGGER schedule_command_resolutions_no_update BEFORE UPDATE ON schedule_command_resolutions BEGIN SELECT RAISE(ABORT,'WBS original evidence is immutable'); END;
CREATE TRIGGER schedule_command_resolutions_no_delete BEFORE DELETE ON schedule_command_resolutions BEGIN SELECT RAISE(ABORT,'WBS original evidence is immutable'); END;
CREATE TRIGGER schedule_source_imports_no_update BEFORE UPDATE ON schedule_source_imports BEGIN SELECT RAISE(ABORT,'WBS original evidence is immutable'); END;
CREATE TRIGGER schedule_source_imports_no_delete BEFORE DELETE ON schedule_source_imports BEGIN SELECT RAISE(ABORT,'WBS original evidence is immutable'); END;
CREATE TRIGGER schedule_import_restores_no_update BEFORE UPDATE ON schedule_import_restores BEGIN SELECT RAISE(ABORT,'WBS original evidence is immutable'); END;
CREATE TRIGGER schedule_import_restores_no_delete BEFORE DELETE ON schedule_import_restores BEGIN SELECT RAISE(ABORT,'WBS original evidence is immutable'); END;
INSERT INTO production_participants VALUES('wbs',1);
`
