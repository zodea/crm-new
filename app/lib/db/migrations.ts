import { ALL_SCHEMA, BATCH_5_PAYROLL_ATTENDANCE } from './schema'

/** 迁移器依赖的最小驱动形状（connection.ts 的 DbDriver 结构兼容，测试可用 sql.js 内存库实现） */
export interface MigrationDb {
  execute: (sql: string, params?: unknown[]) => Promise<void>
  select: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

export interface Migration {
  version: number
  name: string
  up: (db: MigrationDb) => Promise<void>
}

export interface MigrateResult {
  from: number
  to: number
  applied: string[]
}

/** 与现有 connection.ts 相同的拆句语义：按分号拆分（schema 内不含字符串分号） */
export function splitStatements(sql: string): string[] {
  return sql.split(';').map(s => s.trim()).filter(Boolean)
}

export async function execScript(db: MigrationDb, sql: string): Promise<void> {
  for (const stmt of splitStatements(sql)) {
    await db.execute(`${stmt};`)
  }
}

export function assertIdentifier(name: string): void {
  if (!/^[A-Z_]\w*$/i.test(name)) {
    throw new Error(`[db] 非法标识符: ${name}`)
  }
}

/**
 * 给存量表补列（幂等）：列已存在则跳过。
 * ALTER 类迁移一律经由此 helper，重复执行/半途重跑都安全。
 * @returns 是否真正执行了 ALTER
 */
export async function addColumnIfMissing(
  db: MigrationDb,
  table: string,
  column: string,
  ddl: string,
): Promise<boolean> {
  assertIdentifier(table)
  assertIdentifier(column)
  const cols = await db.select<{ name: string }>(
    'SELECT name FROM pragma_table_info(?)',
    [table],
  )
  if (cols.some(c => c.name === column))
    return false
  await db.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${ddl};`)
  return true
}

async function columnExists(db: MigrationDb, table: string, column: string): Promise<boolean> {
  const columns = await db.select<{ name: string }>(
    'SELECT name FROM pragma_table_info(?)',
    [table],
  )
  return columns.some(item => item.name === column)
}

async function dropColumnIfExists(
  db: MigrationDb,
  table: string,
  column: string,
): Promise<boolean> {
  assertIdentifier(table)
  assertIdentifier(column)
  if (!await columnExists(db, table, column))
    return false
  await db.execute(`ALTER TABLE "${table}" DROP COLUMN "${column}";`)
  return true
}

/** v2 补列的业务表清单——迁移是历史事实,冻结快照,后续新表在各自迁移里自带 deleted_at */
const V2_TABLES = [
  'projects',
  'suppliers',
  'invoices',
  'crews',
  'supplier_credentials',
  'project_suppliers',
  'phase_tasks',
  'construction_contracts',
  'owner_change_orders',
  'expenditure_contracts',
  'invoice_applications',
  'receipt_registrations',
  'current_receipts',
  'current_payments',
  'payment_records',
  'workers',
  'settlements',
  'supplement_agreements',
  'contract_line_items',
  'ticket_registrations',
  'payment_applications',
  'file_refs',
]

/** 操作日志表(DATABASE.md §8.2) */
const V2_OPERATION_LOGS = `
CREATE TABLE IF NOT EXISTS operation_logs (
  id          TEXT PRIMARY KEY,
  table_name  TEXT NOT NULL,
  record_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  before_data TEXT,
  after_data  TEXT,
  operator    TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_record ON operation_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_time ON operation_logs(created_at);
`

/** v3 合同域轻实体仓(issue #90 批A):三类合同单表 kind 区分,自带 deleted_at(v2 之后的新表各自迁移带列) */
const V3_CONTRACTS = `
CREATE TABLE IF NOT EXISTS contracts (
  id          TEXT PRIMARY KEY,
  no          TEXT DEFAULT '',
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT '施工',
  sub_kind    TEXT DEFAULT '',
  project_id  TEXT NOT NULL REFERENCES projects(id),
  supplier_id TEXT REFERENCES suppliers(id),
  amount      REAL DEFAULT 0,
  changed     REAL DEFAULT 0,
  settled     REAL DEFAULT 0,
  invoiced    REAL DEFAULT 0,
  paid        REAL DEFAULT 0,
  sign_date   TEXT DEFAULT '',
  status      TEXT DEFAULT '履约中',
  note        TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now')),
  deleted_at  TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_contracts_proj ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_contracts_sup ON contracts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_contracts_kind ON contracts(kind);
CREATE INDEX IF NOT EXISTS idx_contracts_deleted ON contracts(deleted_at) WHERE deleted_at IS NOT NULL;
`

/** v7 送货单 pass-1(#101)：归档库头表 + 材料明细，OCR/导出仍由 #42/#23 深化。 */
const V7_DELIVERY_RECORDS = `
CREATE TABLE IF NOT EXISTS delivery_records (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  supplier_id   TEXT REFERENCES suppliers(id),
  raw_site_text TEXT DEFAULT '',
  order_no      TEXT DEFAULT '',
  delivery_date TEXT DEFAULT '',
  file_name     TEXT DEFAULT '',
  file_path     TEXT DEFAULT '',
  ocr_status    TEXT DEFAULT 'pending',
  archived      INTEGER DEFAULT 0,
  stored        INTEGER DEFAULT 0,
  review_flag   TEXT DEFAULT '',
  note          TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS delivery_lines (
  id                 TEXT PRIMARY KEY,
  delivery_record_id TEXT NOT NULL REFERENCES delivery_records(id),
  material_name      TEXT NOT NULL DEFAULT '',
  spec               TEXT DEFAULT '',
  unit               TEXT DEFAULT '',
  qty                REAL DEFAULT 0,
  unit_price         REAL DEFAULT 0,
  amount             REAL DEFAULT 0,
  note               TEXT DEFAULT '',
  sort_order         INTEGER DEFAULT 0,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now')),
  deleted_at         TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_delivery_proj ON delivery_records(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_sup ON delivery_records(supplier_id);
CREATE INDEX IF NOT EXISTS idx_delivery_lines_rec ON delivery_lines(delivery_record_id);
CREATE INDEX IF NOT EXISTS idx_delivery_records_deleted ON delivery_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_lines_deleted ON delivery_lines(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_natural
  ON delivery_records(project_id, supplier_id, order_no)
  WHERE deleted_at IS NULL AND supplier_id IS NOT NULL;
`

/** v8 工地别名：首次人工选定项目时记忆 OCR 工地写法，后续自动预选。 */
const V8_PROJECT_ALIASES = `
CREATE TABLE IF NOT EXISTS project_aliases (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  alias      TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_aliases_project ON project_aliases(project_id);
CREATE INDEX IF NOT EXISTS idx_project_aliases_deleted ON project_aliases(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_alias ON project_aliases(alias) WHERE deleted_at IS NULL;
`

/** v10 送货单归档原件：file_refs 只保留轻量元数据，正文独立存放并按记录惰性读取。 */
const V10_DELIVERY_SOURCE_FILES = `
CREATE TABLE IF NOT EXISTS file_payloads (
  file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),
  encoding    TEXT NOT NULL DEFAULT 'base64',
  content     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_file_refs_delivery_source
  ON file_refs(owner_type, owner_id, category)
  WHERE deleted_at IS NULL
    AND owner_type = 'delivery_record'
    AND category = 'source';
`

/** v12 工程量矩阵底座(#103)：稳定模板房间 + 户工种责任 + 户阶段完成。 */
const V12_QUANTITY_FOUNDATION = `
CREATE TABLE IF NOT EXISTS items (
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

CREATE TABLE IF NOT EXISTS buildings (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS house_type_templates (
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

CREATE TABLE IF NOT EXISTS construction_stages (
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

CREATE TABLE IF NOT EXISTS floors (
  id          TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
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

CREATE TABLE IF NOT EXISTS units (
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

CREATE TABLE IF NOT EXISTS house_type_template_items (
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
);

CREATE TABLE IF NOT EXISTS construction_stage_items (
  id         TEXT PRIMARY KEY,
  stage_id   TEXT NOT NULL REFERENCES construction_stages(id),
  item_id    TEXT NOT NULL REFERENCES items(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS unit_assignments (
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

CREATE TABLE IF NOT EXISTS unit_stage_completions (
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

CREATE TABLE IF NOT EXISTS unit_assignment_scopes (
  id            TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES unit_assignments(id),
  room_id       TEXT NOT NULL REFERENCES rooms(id),
  item_id       TEXT NOT NULL REFERENCES items(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_buildings_project ON buildings(project_id);
CREATE INDEX IF NOT EXISTS idx_floors_building ON floors(building_id);
CREATE INDEX IF NOT EXISTS idx_units_floor ON units(floor_id);
CREATE INDEX IF NOT EXISTS idx_units_template ON units(house_type_template_id);
CREATE INDEX IF NOT EXISTS idx_rooms_template ON rooms(template_id);
CREATE INDEX IF NOT EXISTS idx_items_project ON items(project_id);
CREATE INDEX IF NOT EXISTS idx_ht_project ON house_type_templates(project_id);
CREATE INDEX IF NOT EXISTS idx_hti_room ON house_type_template_items(room_id);
CREATE INDEX IF NOT EXISTS idx_hti_item ON house_type_template_items(item_id);
CREATE INDEX IF NOT EXISTS idx_stages_project ON construction_stages(project_id);
CREATE INDEX IF NOT EXISTS idx_stage_items_stage ON construction_stage_items(stage_id);
CREATE INDEX IF NOT EXISTS idx_unit_assignments_unit ON unit_assignments(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_assignments_crew ON unit_assignments(crew_id);
CREATE INDEX IF NOT EXISTS idx_unit_assignments_worker ON unit_assignments(worker_id);
CREATE INDEX IF NOT EXISTS idx_unit_assignments_trade ON unit_assignments(trade);
CREATE INDEX IF NOT EXISTS idx_uas_assignment ON unit_assignment_scopes(assignment_id);
CREATE INDEX IF NOT EXISTS idx_usc_stage_date ON unit_stage_completions(stage_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_usc_unit ON unit_stage_completions(unit_id);
CREATE INDEX IF NOT EXISTS idx_usc_assignment ON unit_stage_completions(assignment_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_building_code
  ON buildings(project_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_code
  ON floors(building_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_code
  ON units(floor_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_room_code
  ON rooms(template_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_room_whole_unit
  ON rooms(template_id) WHERE deleted_at IS NULL AND kind = 'whole_unit';
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_code
  ON items(project_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ht_code
  ON house_type_templates(project_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hti_room_item
  ON house_type_template_items(room_id, item_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_code
  ON construction_stages(project_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_item
  ON construction_stage_items(stage_id, item_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_assignment_trade
  ON unit_assignments(unit_id, trade) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_uas_scope
  ON unit_assignment_scopes(assignment_id, room_id, item_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_usc_unit_stage
  ON unit_stage_completions(unit_id, stage_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buildings_deleted ON buildings(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_floors_deleted ON floors(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_house_type_templates_deleted ON house_type_templates(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rooms_deleted ON rooms(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_units_deleted ON units(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_house_type_template_items_deleted ON house_type_template_items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_construction_stages_deleted ON construction_stages(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_construction_stage_items_deleted ON construction_stage_items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unit_assignments_deleted ON unit_assignments(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unit_stage_completions_deleted ON unit_stage_completions(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unit_assignment_scopes_deleted ON unit_assignment_scopes(deleted_at) WHERE deleted_at IS NOT NULL;
`

// trigger body 含内部分号，不能交给 execScript 的简单拆句器，须作为完整语句执行。
const V12_CREATE_WHOLE_UNIT_ROOM = `
CREATE TRIGGER IF NOT EXISTS trg_house_type_templates_whole_unit
AFTER INSERT ON house_type_templates
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO rooms (id, template_id, code, name, kind, sort_order)
  VALUES (NEW.id || ':whole_unit', NEW.id, '__whole_unit__', '整户范围', 'whole_unit', -1);
END;
`

const V12_PROTECT_WHOLE_UNIT_ROOM = `
CREATE TRIGGER IF NOT EXISTS trg_rooms_keep_whole_unit
BEFORE UPDATE OF deleted_at ON rooms
WHEN OLD.kind = 'whole_unit' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'whole_unit room cannot be deleted');
END;
`

/** v14 施工进度排程底座(#114)：楼栋分组、WBS 工序、依赖与分项映射。 */
const V14_SCHEDULE_FOUNDATION = `
CREATE TABLE IF NOT EXISTS schedule_groups (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS schedule_group_buildings (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES schedule_groups(id),
  building_id TEXT NOT NULL REFERENCES buildings(id),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS schedule_tasks (
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
  deleted_at      TEXT DEFAULT NULL,
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

CREATE TABLE IF NOT EXISTS task_dependencies (
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

CREATE TABLE IF NOT EXISTS task_item_map (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES schedule_tasks(id),
  item_id    TEXT NOT NULL REFERENCES items(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_groups_project ON schedule_groups(project_id);
CREATE INDEX IF NOT EXISTS idx_sgb_group ON schedule_group_buildings(group_id);
CREATE INDEX IF NOT EXISTS idx_sgb_building ON schedule_group_buildings(building_id);
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_project ON schedule_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_group ON schedule_tasks(group_id);
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_parent ON schedule_tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_stage ON schedule_tasks(stage_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_pred ON task_dependencies(pred_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_succ ON task_dependencies(succ_id);
CREATE INDEX IF NOT EXISTS idx_task_item_map_task ON task_item_map(task_id);
CREATE INDEX IF NOT EXISTS idx_task_item_map_item ON task_item_map(item_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_group_name
  ON schedule_groups(project_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_group_building
  ON schedule_group_buildings(group_id, building_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_dependency
  ON task_dependencies(pred_id, succ_id, dependency_type) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_item_map
  ON task_item_map(task_id, item_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_groups_deleted
  ON schedule_groups(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_group_buildings_deleted
  ON schedule_group_buildings(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_deleted
  ON schedule_tasks(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_dependencies_deleted
  ON task_dependencies(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_item_map_deleted
  ON task_item_map(deleted_at) WHERE deleted_at IS NOT NULL;
`

/** v15 BOQ 深模块(#115)：清单唯一量价源、变更签证与月度报量。 */
const V15_BOQ_FOUNDATION = `
CREATE TABLE IF NOT EXISTS boq_change_orders (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  contract_id    TEXT NOT NULL REFERENCES contracts(id),
  code           TEXT NOT NULL DEFAULT '',
  name           TEXT NOT NULL,
  change_type    TEXT NOT NULL DEFAULT 'qty'
                 CHECK (change_type IN ('add', 'qty', 'price', 'mixed')),
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'submitted', 'rejected', 'approved')),
  status_note    TEXT NOT NULL DEFAULT '',
  directive_no   TEXT NOT NULL DEFAULT '',
  directive_type TEXT NOT NULL DEFAULT ''
                 CHECK (directive_type IN ('', 'issued', 'changed', 'supplemented')),
  total_amount   REAL NOT NULL DEFAULT 0,
  approved_at    TEXT,
  ledger_id      TEXT REFERENCES owner_change_orders(id),
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT DEFAULT NULL,
  CHECK (
    (status = 'approved' AND approved_at IS NOT NULL AND ledger_id IS NOT NULL)
    OR status <> 'approved'
  )
);

CREATE TABLE IF NOT EXISTS boq_files (
  id           TEXT PRIMARY KEY,
  contract_id  TEXT NOT NULL REFERENCES contracts(id),
  file_name    TEXT NOT NULL,
  file_path    TEXT NOT NULL DEFAULT '',
  format_class TEXT NOT NULL DEFAULT '',
  parse_status TEXT NOT NULL DEFAULT 'pending'
               CHECK (parse_status IN ('pending', 'parsed')),
  line_count   INTEGER NOT NULL DEFAULT 0 CHECK (line_count >= 0),
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS boq_lines (
  id                    TEXT PRIMARY KEY,
  boq_file_id           TEXT REFERENCES boq_files(id),
  project_id            TEXT NOT NULL REFERENCES projects(id),
  contract_id           TEXT NOT NULL REFERENCES contracts(id),
  item_id               TEXT REFERENCES items(id),
  section               TEXT NOT NULL DEFAULT '',
  trade                 TEXT NOT NULL DEFAULT '',
  item_name             TEXT NOT NULL,
  unit                  TEXT NOT NULL DEFAULT '',
  qty                   REAL,
  unit_price            REAL,
  amount                REAL,
  trace_key             TEXT NOT NULL DEFAULT '',
  source_sheet          TEXT NOT NULL DEFAULT '',
  source_row            INTEGER,
  recognized_qty        REAL,
  recognized_unit_price REAL,
  building              TEXT NOT NULL DEFAULT '',
  unit_type             TEXT NOT NULL DEFAULT '',
  multiplier            REAL,
  room                  TEXT NOT NULL DEFAULT '',
  floor_zone            TEXT NOT NULL DEFAULT '',
  spec                  TEXT NOT NULL DEFAULT '',
  tax_rate              REAL,
  owner_supplied        INTEGER NOT NULL DEFAULT 0 CHECK (owner_supplied IN (0, 1)),
  change_order_id       TEXT REFERENCES boq_change_orders(id),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT DEFAULT NULL,
  CHECK (
    (boq_file_id IS NOT NULL AND change_order_id IS NULL)
    OR (boq_file_id IS NULL AND change_order_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS boq_change_lines (
  id                 TEXT PRIMARY KEY,
  change_order_id    TEXT NOT NULL REFERENCES boq_change_orders(id),
  boq_line_id        TEXT REFERENCES boq_lines(id),
  result_boq_line_id TEXT REFERENCES boq_lines(id),
  item_id            TEXT REFERENCES items(id),
  operation          TEXT NOT NULL CHECK (operation IN ('add', 'qty', 'price')),
  section            TEXT NOT NULL DEFAULT '',
  trade              TEXT NOT NULL DEFAULT '',
  item_name          TEXT NOT NULL DEFAULT '',
  unit               TEXT NOT NULL DEFAULT '',
  spec               TEXT NOT NULL DEFAULT '',
  delta_qty          REAL,
  new_unit_price     REAL,
  amount             REAL NOT NULL DEFAULT 0,
  note               TEXT NOT NULL DEFAULT '',
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT DEFAULT NULL,
  CHECK (
    (operation = 'add' AND boq_line_id IS NULL AND delta_qty IS NOT NULL)
    OR (operation = 'qty' AND boq_line_id IS NOT NULL AND delta_qty IS NOT NULL)
    OR (operation = 'price' AND boq_line_id IS NOT NULL AND new_unit_price IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS monthly_statements (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  contract_id  TEXT NOT NULL REFERENCES contracts(id),
  month        TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'adjusted', 'exported')),
  total_amount REAL NOT NULL DEFAULT 0,
  quantity_basis TEXT NOT NULL DEFAULT 'field'
               CHECK (quantity_basis IN ('contract', 'provisional', 'field')),
  source_version    TEXT NOT NULL DEFAULT '',
  source_updated_at TEXT DEFAULT NULL,
  operator_name     TEXT NOT NULL DEFAULT '',
  submitted_at      TEXT DEFAULT NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS monthly_statement_lines (
  id            TEXT PRIMARY KEY,
  statement_id  TEXT NOT NULL REFERENCES monthly_statements(id),
  boq_line_id   TEXT NOT NULL REFERENCES boq_lines(id),
  item_name     TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT '',
  auto_qty      REAL NOT NULL DEFAULT 0,
  adjusted_qty  REAL,
  unit_price    REAL NOT NULL DEFAULT 0,
  amount        REAL NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_boq_files_contract ON boq_files(contract_id);
CREATE INDEX IF NOT EXISTS idx_boq_lines_file ON boq_lines(boq_file_id);
CREATE INDEX IF NOT EXISTS idx_boq_lines_project ON boq_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_boq_lines_contract ON boq_lines(contract_id);
CREATE INDEX IF NOT EXISTS idx_boq_lines_item ON boq_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_boq_change_orders_project ON boq_change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_boq_change_orders_contract ON boq_change_orders(contract_id);
CREATE INDEX IF NOT EXISTS idx_boq_change_orders_status ON boq_change_orders(status);
CREATE INDEX IF NOT EXISTS idx_boq_change_lines_order ON boq_change_lines(change_order_id);
CREATE INDEX IF NOT EXISTS idx_boq_change_lines_item ON boq_change_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_monthly_statements_project_month
  ON monthly_statements(project_id, month);
CREATE INDEX IF NOT EXISTS idx_monthly_statement_lines_statement
  ON monthly_statement_lines(statement_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_boq_line_trace
  ON boq_lines(boq_file_id, trace_key)
  WHERE deleted_at IS NULL AND boq_file_id IS NOT NULL AND trace_key <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_boq_change_order_code
  ON boq_change_orders(project_id, code)
  WHERE deleted_at IS NULL AND code <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_boq_change_order_ledger
  ON boq_change_orders(ledger_id)
  WHERE deleted_at IS NULL AND ledger_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_statement_contract_month
  ON monthly_statements(contract_id, month)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_boq_files_deleted
  ON boq_files(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_boq_lines_deleted
  ON boq_lines(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_boq_change_orders_deleted
  ON boq_change_orders(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_boq_change_lines_deleted
  ON boq_change_lines(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_monthly_statements_deleted
  ON monthly_statements(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_monthly_statement_lines_deleted
  ON monthly_statement_lines(deleted_at) WHERE deleted_at IS NOT NULL;
`

/** v17 #115 排程域分项×楼层计划：BOQ 仅作来源引用，计划与微调归排程所有。 */
const V17_SCHEDULE_FLOOR_PLANS = `
CREATE TABLE IF NOT EXISTS schedule_task_floor_plans (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES schedule_tasks(id),
  floor_id       TEXT NOT NULL REFERENCES floors(id),
  boq_line_id    TEXT NOT NULL REFERENCES boq_lines(id),
  planned_start  TEXT NOT NULL,
  planned_finish TEXT NOT NULL,
  is_manual      INTEGER NOT NULL DEFAULT 0 CHECK (is_manual IN (0, 1)),
  note           TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT DEFAULT NULL,
  CHECK (planned_finish >= planned_start)
);

CREATE INDEX IF NOT EXISTS idx_schedule_floor_plans_task
  ON schedule_task_floor_plans(task_id);
CREATE INDEX IF NOT EXISTS idx_schedule_floor_plans_floor
  ON schedule_task_floor_plans(floor_id);
CREATE INDEX IF NOT EXISTS idx_schedule_floor_plans_boq
  ON schedule_task_floor_plans(boq_line_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_floor_plan_scope
  ON schedule_task_floor_plans(task_id, floor_id, boq_line_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_task_floor_plans_deleted
  ON schedule_task_floor_plans(deleted_at) WHERE deleted_at IS NOT NULL;
`

/** v18 #115 E 类零星维修清单进入独立分项单价库，不伪装成合同工程量。 */
const V18_ITEM_UNIT_PRICES = `
CREATE TABLE IF NOT EXISTS item_unit_prices (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  item_id       TEXT REFERENCES items(id),
  boq_file_id   TEXT NOT NULL REFERENCES boq_files(id),
  item_code     TEXT NOT NULL DEFAULT '',
  item_name     TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT '',
  unit_price    REAL NOT NULL CHECK (unit_price >= 0),
  spec          TEXT NOT NULL DEFAULT '',
  trace_key     TEXT NOT NULL DEFAULT '',
  source_sheet  TEXT NOT NULL DEFAULT '',
  source_row    INTEGER,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_item_unit_prices_project
  ON item_unit_prices(project_id);
CREATE INDEX IF NOT EXISTS idx_item_unit_prices_item
  ON item_unit_prices(item_id);
CREATE INDEX IF NOT EXISTS idx_item_unit_prices_file
  ON item_unit_prices(boq_file_id);
CREATE INDEX IF NOT EXISTS idx_item_unit_prices_deleted
  ON item_unit_prices(deleted_at) WHERE deleted_at IS NOT NULL;
`

/** v19 F1 基础主数据(#147)：客户、目标成本和迁移对账底座。 */
const V19_F1_TABLES = `
CREATE TABLE IF NOT EXISTS customers (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  aliases            TEXT NOT NULL DEFAULT '[]',
  tax_no             TEXT NOT NULL DEFAULT '',
  legal_rep          TEXT NOT NULL DEFAULT '',
  registered_address TEXT NOT NULL DEFAULT '',
  invoice_name       TEXT NOT NULL DEFAULT '',
  bank               TEXT NOT NULL DEFAULT '',
  bank_account       TEXT NOT NULL DEFAULT '',
  contact            TEXT NOT NULL DEFAULT '',
  contact_phone      TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'draft',
  note               TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS import_batches (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id),
  source_file  TEXT NOT NULL,
  source_hash  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  created_at   TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS reconciliation_issues (
  id              TEXT PRIMARY KEY,
  import_batch_id TEXT NOT NULL REFERENCES import_batches(id),
  project_id      TEXT REFERENCES projects(id),
  entity_type     TEXT NOT NULL DEFAULT '',
  entity_id       TEXT NOT NULL DEFAULT '',
  field_name      TEXT NOT NULL DEFAULT '',
  source_value    TEXT NOT NULL DEFAULT '',
  metric_key      TEXT NOT NULL,
  source_ref      TEXT DEFAULT '',
  excel_value     REAL,
  system_value    REAL,
  difference      REAL,
  attribution     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  resolution      TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now')),
  resolved_at     TEXT
);

CREATE TABLE IF NOT EXISTS target_costs (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT REFERENCES projects(id),
  name                TEXT NOT NULL,
  is_baseline         INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1)),
  contract_revenue    REAL DEFAULT 0 CHECK (contract_revenue >= 0),
  planned_profit      REAL DEFAULT 0 CHECK (planned_profit >= 0),
  signed_contract_sum REAL DEFAULT 0 CHECK (signed_contract_sum >= 0),
  tax_inclusive_total REAL DEFAULT 0 CHECK (tax_inclusive_total >= 0),
  tax_exclusive_total REAL DEFAULT 0 CHECK (tax_exclusive_total >= 0),
  tax_amount          REAL DEFAULT 0 CHECK (tax_amount >= 0),
  status              TEXT NOT NULL DEFAULT 'draft',
  note                TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS target_cost_items (
  id             TEXT PRIMARY KEY,
  target_cost_id TEXT NOT NULL REFERENCES target_costs(id),
  cost_category  TEXT NOT NULL CHECK (
    cost_category IN ('专业分包', '合同劳务', '材料', '机械', '工人工资', '费用报销', '其他')
  ),
  item_name      TEXT,
  unit           TEXT DEFAULT '',
  qty            REAL CHECK (qty IS NULL OR qty >= 0),
  unit_price     REAL CHECK (unit_price IS NULL OR unit_price >= 0),
  amount         REAL NOT NULL CHECK (amount >= 0),
  note           TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT DEFAULT NULL
);
`

const V19_F1_INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tax_no
  ON customers(tax_no)
  WHERE deleted_at IS NULL AND tax_no <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_crews_name_active
  ON crews(name)
  WHERE deleted_at IS NULL AND name <> '';
CREATE INDEX IF NOT EXISTS idx_customers_deleted
  ON customers(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_customer
  ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_secondary_customer
  ON projects(secondary_customer_id);
CREATE INDEX IF NOT EXISTS idx_workers_current_project
  ON workers(current_project_id);
CREATE INDEX IF NOT EXISTS idx_target_costs_proj
  ON target_costs(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_target_costs_baseline
  ON target_costs(project_id)
  WHERE deleted_at IS NULL AND is_baseline = 1;
CREATE INDEX IF NOT EXISTS idx_target_costs_deleted
  ON target_costs(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tci_target
  ON target_cost_items(target_cost_id);
CREATE INDEX IF NOT EXISTS idx_target_cost_items_deleted
  ON target_cost_items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reconciliation_issues_batch
  ON reconciliation_issues(import_batch_id, status);
`

const V20_TARGET_COST_DRAFT_TABLES = `
DROP INDEX IF EXISTS idx_target_costs_proj;
DROP INDEX IF EXISTS uq_target_costs_baseline;
DROP INDEX IF EXISTS idx_target_costs_deleted;
DROP INDEX IF EXISTS idx_tci_target;
DROP INDEX IF EXISTS idx_target_cost_items_deleted;

ALTER TABLE target_cost_items RENAME TO target_cost_items_v20_old;
ALTER TABLE target_costs RENAME TO target_costs_v20_old;

CREATE TABLE target_costs (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT REFERENCES projects(id),
  name                TEXT NOT NULL,
  is_baseline         INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1)),
  contract_revenue    REAL DEFAULT 0 CHECK (contract_revenue >= 0),
  planned_profit      REAL DEFAULT 0 CHECK (planned_profit >= 0),
  signed_contract_sum REAL DEFAULT 0 CHECK (signed_contract_sum >= 0),
  tax_inclusive_total REAL DEFAULT 0 CHECK (tax_inclusive_total >= 0),
  tax_exclusive_total REAL DEFAULT 0 CHECK (tax_exclusive_total >= 0),
  tax_amount          REAL DEFAULT 0 CHECK (tax_amount >= 0),
  status              TEXT NOT NULL DEFAULT 'draft',
  note                TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT DEFAULT NULL
);

CREATE TABLE target_cost_items (
  id             TEXT PRIMARY KEY,
  target_cost_id TEXT NOT NULL REFERENCES target_costs(id),
  cost_category  TEXT NOT NULL CHECK (
    cost_category IN ('专业分包', '合同劳务', '材料', '机械', '工人工资', '费用报销', '其他')
  ),
  item_name      TEXT,
  unit           TEXT DEFAULT '',
  qty            REAL CHECK (qty IS NULL OR qty >= 0),
  unit_price     REAL CHECK (unit_price IS NULL OR unit_price >= 0),
  amount         REAL NOT NULL CHECK (amount >= 0),
  note           TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT DEFAULT NULL
);

INSERT INTO target_costs (
  id, project_id, name, is_baseline, contract_revenue, planned_profit,
  signed_contract_sum, tax_inclusive_total, tax_exclusive_total, tax_amount,
  status, note, created_at, updated_at, deleted_at
)
SELECT
  id, project_id, name, is_baseline, contract_revenue, planned_profit,
  signed_contract_sum, tax_inclusive_total, tax_exclusive_total, tax_amount,
  status, note, created_at, updated_at, deleted_at
FROM target_costs_v20_old;

INSERT INTO target_cost_items (
  id, target_cost_id, cost_category, item_name, unit, qty, unit_price, amount,
  note, sort_order, created_at, updated_at, deleted_at
)
SELECT
  id, target_cost_id, cost_category, item_name, unit, qty, unit_price, amount,
  note, sort_order, created_at, updated_at, deleted_at
FROM target_cost_items_v20_old;

DROP TABLE target_cost_items_v20_old;
DROP TABLE target_costs_v20_old;
`

const V20_TARGET_COST_DRAFT_INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS uq_crews_name_active
  ON crews(name)
  WHERE deleted_at IS NULL AND name <> '';
CREATE INDEX IF NOT EXISTS idx_target_costs_proj
  ON target_costs(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_target_costs_baseline
  ON target_costs(project_id)
  WHERE deleted_at IS NULL AND is_baseline = 1;
CREATE INDEX IF NOT EXISTS idx_target_costs_deleted
  ON target_costs(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tci_target
  ON target_cost_items(target_cost_id);
CREATE INDEX IF NOT EXISTS idx_target_cost_items_deleted
  ON target_cost_items(deleted_at) WHERE deleted_at IS NOT NULL;
`

async function allowIncompleteTargetCostDrafts(db: MigrationDb): Promise<void> {
  const [projectColumn] = await db.select<{ notnull: number }>(
    `SELECT "notnull" FROM pragma_table_info('target_costs') WHERE name = 'project_id'`,
  )
  if (!projectColumn?.notnull) {
    await execScript(db, V20_TARGET_COST_DRAFT_INDEXES)
    return
  }

  await db.execute('PRAGMA foreign_keys = OFF')
  let transactionStarted = false
  try {
    await db.execute('BEGIN IMMEDIATE')
    transactionStarted = true
    await execScript(db, V20_TARGET_COST_DRAFT_TABLES)
    const violations = await db.select<{ table: string }>('PRAGMA foreign_key_check')
    if (violations.length)
      throw new Error(`[db] v20 目标成本重建后存在 ${violations.length} 条外键异常`)
    await execScript(db, V20_TARGET_COST_DRAFT_INDEXES)
    await db.execute('COMMIT')
    transactionStarted = false
  }
  catch (error) {
    if (transactionStarted) {
      try {
        await db.execute('ROLLBACK')
      }
      catch {
        // 保留原始迁移错误；连接后续会由 initializeDb 关闭。
      }
    }
    throw error
  }
  finally {
    await db.execute('PRAGMA foreign_keys = ON')
  }
}

/** v21 F2 合同与支出结算(#148)：canonical 头表、补充协议、材采明细及统一结算。 */
const V21_CONTRACTS_TABLE = `
CREATE TABLE contracts_v21_new (
  id                    TEXT PRIMARY KEY,
  no                    TEXT NOT NULL DEFAULT '',
  name                  TEXT NOT NULL DEFAULT '',
  kind                  TEXT NOT NULL DEFAULT '施工'
                          CHECK (kind IN ('施工', '分包', '材采', '其他支出')),
  sub_kind              TEXT NOT NULL DEFAULT '',
  cost_category         TEXT NOT NULL DEFAULT '',
  legacy_type           TEXT NOT NULL DEFAULT '',
  classification_state  TEXT NOT NULL DEFAULT 'classified'
                          CHECK (classification_state IN ('classified', 'unclassified', 'no_contract')),
  project_id            TEXT REFERENCES projects(id),
  customer_id           TEXT REFERENCES customers(id),
  supplier_id           TEXT REFERENCES suppliers(id),
  amount                REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  changed               REAL NOT NULL DEFAULT 0 CHECK (changed >= 0),
  settled               REAL NOT NULL DEFAULT 0 CHECK (settled >= 0),
  invoiced              REAL NOT NULL DEFAULT 0 CHECK (invoiced >= 0),
  paid                  REAL NOT NULL DEFAULT 0 CHECK (paid >= 0),
  content               TEXT NOT NULL DEFAULT '',
  invoice_type          TEXT NOT NULL DEFAULT '',
  signer_name           TEXT NOT NULL DEFAULT '',
  contact_name          TEXT NOT NULL DEFAULT '',
  contact_phone         TEXT NOT NULL DEFAULT '',
  tax_rate              REAL CHECK (tax_rate IS NULL OR tax_rate >= 0),
  sign_date             TEXT NOT NULL DEFAULT '',
  main_terms            TEXT NOT NULL DEFAULT '',
  payment_terms         TEXT NOT NULL DEFAULT '',
  brand_quality_terms   TEXT NOT NULL DEFAULT '',
  schedule_terms        TEXT NOT NULL DEFAULT '',
  warranty_terms        TEXT NOT NULL DEFAULT '',
  special_terms         TEXT NOT NULL DEFAULT '',
  retention_ratio       REAL CHECK (
                          retention_ratio IS NULL
                          OR (retention_ratio >= 0 AND retention_ratio <= 1)
                        ),
  retention_amount      REAL CHECK (retention_amount IS NULL OR retention_amount >= 0),
  retention_days        INTEGER CHECK (retention_days IS NULL OR retention_days >= 0),
  invoice_name          TEXT NOT NULL DEFAULT '',
  invoice_tax_no        TEXT NOT NULL DEFAULT '',
  invoice_address_phone TEXT NOT NULL DEFAULT '',
  invoice_bank          TEXT NOT NULL DEFAULT '',
  invoice_bank_account  TEXT NOT NULL DEFAULT '',
  other_expense_kind    TEXT NOT NULL DEFAULT '',
  service_period        TEXT NOT NULL DEFAULT '',
  payment_cycle         TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT '草稿',
  note                  TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT DEFAULT NULL
);
`

const V21_F2_TABLES = `
CREATE TABLE IF NOT EXISTS contract_legacy_mappings (
  id           TEXT PRIMARY KEY,
  source_table TEXT NOT NULL,
  legacy_id    TEXT NOT NULL,
  contract_id  TEXT NOT NULL REFERENCES contracts(id),
  source_no    TEXT NOT NULL DEFAULT '',
  source_name  TEXT NOT NULL DEFAULT '',
  mapped_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source_table, legacy_id)
);

CREATE TABLE IF NOT EXISTS contract_supplements (
  id          TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  no          TEXT NOT NULL DEFAULT '',
  name        TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  amount      REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  sign_date   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT '草稿',
  external_ref TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS company_expense_contracts (
  id            TEXT PRIMARY KEY,
  no            TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT '',
  counterparty  TEXT NOT NULL DEFAULT '',
  sign_date     TEXT NOT NULL DEFAULT '',
  service_period TEXT NOT NULL DEFAULT '',
  amount        REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_cycle TEXT NOT NULL DEFAULT '',
  main_terms    TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT '草稿',
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS expenditure_settlements (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  name              TEXT NOT NULL DEFAULT '',
  biz_type          TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  supplier_id       TEXT REFERENCES suppliers(id),
  contract_id       TEXT REFERENCES contracts(id),
  settlement_type   TEXT NOT NULL DEFAULT '',
  total_amount      REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount            REAL CHECK (amount IS NULL OR amount >= 0),
  tax_amount        REAL CHECK (tax_amount IS NULL OR tax_amount >= 0),
  tax_rate          REAL CHECK (tax_rate IS NULL OR tax_rate >= 0),
  settlement_date   TEXT NOT NULL DEFAULT '',
  settlement_period TEXT NOT NULL DEFAULT '',
  deduction_note    TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT '草稿',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT DEFAULT NULL
);
`

const V21_CONTRACT_LINE_ITEMS_TABLE = `
CREATE TABLE contract_line_items_v21_new (
  id                       TEXT PRIMARY KEY,
  contract_id              TEXT NOT NULL REFERENCES contracts(id),
  material_name            TEXT NOT NULL DEFAULT '',
  spec                     TEXT NOT NULL DEFAULT '',
  brand                    TEXT NOT NULL DEFAULT '',
  unit                     TEXT NOT NULL DEFAULT '',
  qty                      REAL CHECK (qty IS NULL OR qty > 0),
  tax_inclusive_unit_price REAL
                            CHECK (tax_inclusive_unit_price IS NULL
                              OR tax_inclusive_unit_price >= 0),
  planned_arrival_date     TEXT NOT NULL DEFAULT '',
  note                     TEXT NOT NULL DEFAULT '',
  sort_order               INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at               TEXT DEFAULT NULL
);
`

const V21_PAYMENT_APPLICATIONS_TABLE = `
CREATE TABLE payment_applications_v21_new (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT REFERENCES projects(id),
  supplier_id            TEXT REFERENCES suppliers(id),
  contract_id            TEXT REFERENCES contracts(id),
  application_no         TEXT NOT NULL DEFAULT '',
  name                   TEXT NOT NULL DEFAULT '',
  approval_status        TEXT NOT NULL DEFAULT '',
  applicant              TEXT NOT NULL DEFAULT '',
  amount                 REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  approved_amount        REAL NOT NULL DEFAULT 0 CHECK (approved_amount >= 0),
  paid_amount            REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  payment_method         TEXT NOT NULL DEFAULT '',
  actual_payment         REAL NOT NULL DEFAULT 0 CHECK (actual_payment >= 0),
  payment_status         TEXT NOT NULL DEFAULT '',
  acceptor               TEXT NOT NULL DEFAULT '',
  note                   TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT DEFAULT NULL
);
`

const V21_F2_INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_legacy_source
  ON contract_legacy_mappings(source_table, legacy_id);
CREATE INDEX IF NOT EXISTS idx_contract_legacy_contract
  ON contract_legacy_mappings(contract_id);
CREATE INDEX IF NOT EXISTS idx_contracts_proj ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_sup ON contracts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_contracts_kind ON contracts(kind);
CREATE INDEX IF NOT EXISTS idx_contracts_deleted
  ON contracts(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_supplements_contract
  ON contract_supplements(contract_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_contract_supplements_deleted
  ON contract_supplements(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_line_items_contract
  ON contract_line_items(contract_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_contract_line_items_deleted
  ON contract_line_items(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_expense_contracts_deleted
  ON company_expense_contracts(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenditure_settlements_proj
  ON expenditure_settlements(project_id);
CREATE INDEX IF NOT EXISTS idx_expenditure_settlements_sup
  ON expenditure_settlements(supplier_id);
CREATE INDEX IF NOT EXISTS idx_expenditure_settlements_contract
  ON expenditure_settlements(contract_id);
CREATE INDEX IF NOT EXISTS idx_expenditure_settlements_deleted
  ON expenditure_settlements(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_applications_proj
  ON payment_applications(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_sup
  ON payment_applications(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_contract
  ON payment_applications(contract_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_deleted
  ON payment_applications(deleted_at) WHERE deleted_at IS NOT NULL;
`

const V22_RECEIPT_REGISTRATIONS_TABLE = `
CREATE TABLE receipt_registrations_v22_new (
  id                 TEXT PRIMARY KEY,
  no                 TEXT NOT NULL DEFAULT '',
  receipt_date       TEXT NOT NULL DEFAULT '',
  project_id         TEXT REFERENCES projects(id),
  contract_id        TEXT REFERENCES contracts(id),
  customer_id        TEXT REFERENCES customers(id),
  payer_account      TEXT NOT NULL DEFAULT '',
  amount             REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_method     TEXT NOT NULL DEFAULT '',
  acceptance_bill_no TEXT NOT NULL DEFAULT '',
  bill_due_date      TEXT NOT NULL DEFAULT '',
  period_no          TEXT NOT NULL DEFAULT '',
  bank_serial_no     TEXT NOT NULL DEFAULT '',
  handler            TEXT NOT NULL DEFAULT '',
  review_status      TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'draft',
  note               TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT DEFAULT NULL
);
`

const V22_INVOICE_APPLICATIONS_TABLE = `
CREATE TABLE invoice_applications_v22_new (
  id                     TEXT PRIMARY KEY,
  no                     TEXT NOT NULL DEFAULT '',
  name                   TEXT NOT NULL DEFAULT '',
  project_id             TEXT REFERENCES projects(id),
  contract_id            TEXT REFERENCES contracts(id),
  customer_id            TEXT REFERENCES customers(id),
  buyer_name_snapshot    TEXT NOT NULL DEFAULT '',
  buyer_tax_no_snapshot  TEXT NOT NULL DEFAULT '',
  invoice_type           TEXT NOT NULL DEFAULT '',
  amount                 REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  tax_rate               REAL NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  tax_amount             REAL NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  invoice_content        TEXT NOT NULL DEFAULT '',
  invoice_remark         TEXT NOT NULL DEFAULT '',
  applicant              TEXT NOT NULL DEFAULT '',
  application_date       TEXT NOT NULL DEFAULT '',
  status                 TEXT NOT NULL DEFAULT 'draft',
  note                   TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT DEFAULT NULL
);
`

const V22_CURRENT_TRANSACTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS current_transactions (
  id                 TEXT PRIMARY KEY,
  no                 TEXT NOT NULL DEFAULT '',
  direction          TEXT NOT NULL CHECK (direction IN ('receipt', 'payment')),
  project_id         TEXT REFERENCES projects(id),
  counterparty       TEXT NOT NULL DEFAULT '',
  purpose            TEXT NOT NULL DEFAULT '',
  amount             REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_method     TEXT NOT NULL DEFAULT '',
  transaction_date   TEXT NOT NULL DEFAULT '',
  bank_serial_no     TEXT NOT NULL DEFAULT '',
  handler            TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'draft',
  note               TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT DEFAULT NULL
);
`

const V22_PAYMENT_APPLICATIONS_TABLE = `
CREATE TABLE payment_applications_v22_new (
  id                 TEXT PRIMARY KEY,
  no                 TEXT NOT NULL DEFAULT '',
  name               TEXT NOT NULL DEFAULT '',
  biz_type           TEXT NOT NULL DEFAULT '',
  project_id         TEXT REFERENCES projects(id),
  supplier_id        TEXT REFERENCES suppliers(id),
  contract_id        TEXT REFERENCES contracts(id),
  cost_name          TEXT NOT NULL DEFAULT '',
  apply_amount       REAL NOT NULL DEFAULT 0 CHECK (apply_amount >= 0),
  apply_date         TEXT NOT NULL DEFAULT '',
  applicant          TEXT NOT NULL DEFAULT '',
  invoice_state      TEXT NOT NULL DEFAULT '先款后票'
                     CHECK (invoice_state IN ('先票后款', '先款后票', '无需发票')),
  pay_content        TEXT NOT NULL DEFAULT '',
  prepay_deduct      REAL NOT NULL DEFAULT 0 CHECK (prepay_deduct >= 0),
  prepay_note        TEXT NOT NULL DEFAULT '',
  approved_amount    REAL NOT NULL DEFAULT 0 CHECK (approved_amount >= 0),
  approval_note      TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'draft',
  note               TEXT NOT NULL DEFAULT '',
  external_ref       TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT DEFAULT NULL
);
`

const V22_PAYMENT_RECORDS_TABLE = `
CREATE TABLE payment_records_v22_new (
  id                   TEXT PRIMARY KEY,
  no                   TEXT NOT NULL DEFAULT '',
  project_id           TEXT REFERENCES projects(id),
  supplier_id          TEXT REFERENCES suppliers(id),
  payee_name           TEXT NOT NULL DEFAULT '',
  purpose              TEXT NOT NULL DEFAULT '',
  payment_date         TEXT NOT NULL DEFAULT '',
  amount               REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_method       TEXT NOT NULL DEFAULT '',
  voucher_no           TEXT NOT NULL DEFAULT '',
  bank_serial_no       TEXT NOT NULL DEFAULT '',
  payee_account        TEXT NOT NULL DEFAULT '',
  payee_bank           TEXT NOT NULL DEFAULT '',
  payee_bank_account   TEXT NOT NULL DEFAULT '',
  handler              TEXT NOT NULL DEFAULT '',
  source               TEXT NOT NULL DEFAULT 'manual'
                       CHECK (source IN ('manual', 'image_ocr', 'excel_import')),
  recognition_status   TEXT NOT NULL DEFAULT 'not_applicable',
  ocr_payload           TEXT NOT NULL DEFAULT '{}',
  field_confidence     TEXT NOT NULL DEFAULT '{}',
  confirmation_status  TEXT NOT NULL DEFAULT 'draft'
                       CHECK (confirmation_status IN ('draft', 'needs_review', 'confirmed')),
  confirmed_by         TEXT NOT NULL DEFAULT '',
  confirmed_at         TEXT,
  external_ref         TEXT NOT NULL DEFAULT '',
  note                 TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at           TEXT DEFAULT NULL,
  CHECK (
    confirmation_status <> 'confirmed'
    OR (
      amount > 0
      AND TRIM(payment_date) <> ''
      AND TRIM(payee_name) <> ''
      AND TRIM(voucher_no) <> ''
      AND TRIM(bank_serial_no) <> ''
      AND TRIM(confirmed_by) <> ''
      AND confirmed_at IS NOT NULL
    )
  )
);
`

const V22_EXPENSE_REIMBURSEMENTS_TABLE = `
CREATE TABLE expense_reimbursements_v22_new (
  id                   TEXT PRIMARY KEY,
  no                   TEXT NOT NULL DEFAULT '',
  project_id           TEXT REFERENCES projects(id),
  applicant            TEXT NOT NULL DEFAULT '',
  category             TEXT NOT NULL DEFAULT '',
  reimbursement_date   TEXT NOT NULL DEFAULT '',
  invoice_count        INTEGER NOT NULL DEFAULT 0 CHECK (invoice_count >= 0),
  reason               TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'draft',
  note                 TEXT NOT NULL DEFAULT '',
  external_ref         TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at           TEXT DEFAULT NULL
);
`

const V22_F3_CHILD_TABLES = `
CREATE TABLE IF NOT EXISTS expense_reimbursement_lines (
  id                   TEXT PRIMARY KEY,
  reimbursement_id     TEXT NOT NULL REFERENCES expense_reimbursements(id),
  expense_item         TEXT NOT NULL DEFAULT '',
  expense_date         TEXT NOT NULL DEFAULT '',
  amount               REAL NOT NULL CHECK (amount > 0),
  note                 TEXT NOT NULL DEFAULT '',
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at           TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS payment_application_settlement_allocations (
  id                     TEXT PRIMARY KEY,
  payment_application_id TEXT NOT NULL REFERENCES payment_applications(id),
  settlement_id          TEXT NOT NULL REFERENCES expenditure_settlements(id),
  allocated_amount       REAL NOT NULL CHECK (allocated_amount > 0),
  note                   TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS payment_application_invoice_allocations (
  id                     TEXT PRIMARY KEY,
  payment_application_id TEXT NOT NULL REFERENCES payment_applications(id),
  invoice_id             TEXT NOT NULL REFERENCES invoices(id),
  allocated_amount       REAL NOT NULL CHECK (allocated_amount > 0),
  note                   TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS payment_record_application_allocations (
  id                     TEXT PRIMARY KEY,
  payment_record_id      TEXT NOT NULL REFERENCES payment_records(id),
  payment_application_id TEXT NOT NULL REFERENCES payment_applications(id),
  allocated_amount       REAL NOT NULL CHECK (allocated_amount > 0),
  note                   TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT DEFAULT NULL
);
`

const V22_F3_INDEXES_AND_TRIGGERS = `
CREATE INDEX IF NOT EXISTS idx_receipt_registrations_project
  ON receipt_registrations(project_id);
CREATE INDEX IF NOT EXISTS idx_receipt_registrations_contract
  ON receipt_registrations(contract_id);
CREATE INDEX IF NOT EXISTS idx_receipt_registrations_customer
  ON receipt_registrations(customer_id);
CREATE INDEX IF NOT EXISTS idx_receipt_registrations_deleted
  ON receipt_registrations(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_bank_serial
  ON receipt_registrations(bank_serial_no)
  WHERE deleted_at IS NULL AND TRIM(bank_serial_no) <> '';
CREATE INDEX IF NOT EXISTS idx_invoice_applications_project
  ON invoice_applications(project_id);
CREATE INDEX IF NOT EXISTS idx_invoice_applications_contract
  ON invoice_applications(contract_id);
CREATE INDEX IF NOT EXISTS idx_invoice_applications_deleted
  ON invoice_applications(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_current_transactions_project
  ON current_transactions(project_id);
CREATE INDEX IF NOT EXISTS idx_current_transactions_direction
  ON current_transactions(direction, transaction_date);
CREATE INDEX IF NOT EXISTS idx_current_transactions_deleted
  ON current_transactions(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_current_transaction_bank_serial
  ON current_transactions(bank_serial_no)
  WHERE deleted_at IS NULL AND TRIM(bank_serial_no) <> '';
CREATE INDEX IF NOT EXISTS idx_payment_applications_project
  ON payment_applications(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_supplier
  ON payment_applications(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_contract
  ON payment_applications(contract_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_deleted
  ON payment_applications(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_records_project
  ON payment_records(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_supplier
  ON payment_records(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_confirmation
  ON payment_records(confirmation_status, payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_records_deleted
  ON payment_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_record_bank_serial
  ON payment_records(bank_serial_no)
  WHERE deleted_at IS NULL AND TRIM(bank_serial_no) <> '';
CREATE INDEX IF NOT EXISTS idx_expense_reimbursements_project
  ON expense_reimbursements(project_id);
CREATE INDEX IF NOT EXISTS idx_expense_reimbursements_deleted
  ON expense_reimbursements(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expense_reimbursement_lines_head
  ON expense_reimbursement_lines(reimbursement_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_expense_reimbursement_lines_deleted
  ON expense_reimbursement_lines(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_application_settlement
  ON payment_application_settlement_allocations(payment_application_id, settlement_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_settlement_allocation_source
  ON payment_application_settlement_allocations(settlement_id);
CREATE INDEX IF NOT EXISTS idx_payment_application_settlement_allocations_deleted
  ON payment_application_settlement_allocations(deleted_at)
  WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_application_invoice
  ON payment_application_invoice_allocations(payment_application_id, invoice_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_invoice_allocation_source
  ON payment_application_invoice_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_application_invoice_allocations_deleted
  ON payment_application_invoice_allocations(deleted_at)
  WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_record_application
  ON payment_record_application_allocations(payment_record_id, payment_application_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_application_payment
  ON payment_record_application_allocations(payment_application_id);
CREATE INDEX IF NOT EXISTS idx_payment_record_application_allocations_deleted
  ON payment_record_application_allocations(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_invoice_allocation_cap_insert
BEFORE INSERT ON payment_application_invoice_allocations
WHEN NEW.deleted_at IS NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM invoices
      WHERE id = NEW.invoice_id AND deleted_at IS NULL
    )
    THEN RAISE(ABORT, '关联发票不存在或已删除')
  END;
  SELECT CASE
    WHEN (
      COALESCE((
        SELECT SUM(allocation.allocated_amount)
        FROM payment_application_invoice_allocations AS allocation
        WHERE allocation.invoice_id = NEW.invoice_id
          AND allocation.deleted_at IS NULL
      ), 0) + NEW.allocated_amount
    ) > COALESCE((
      SELECT invoice.total_amount FROM invoices AS invoice
      WHERE invoice.id = NEW.invoice_id
    ), 0) + 0.0001
    THEN RAISE(ABORT, '发票可关联额度不足')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_allocation_cap_update
BEFORE UPDATE OF invoice_id, allocated_amount, deleted_at
ON payment_application_invoice_allocations
WHEN NEW.deleted_at IS NULL
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM invoices
      WHERE id = NEW.invoice_id AND deleted_at IS NULL
    )
    THEN RAISE(ABORT, '关联发票不存在或已删除')
  END;
  SELECT CASE
    WHEN (
      COALESCE((
        SELECT SUM(allocation.allocated_amount)
        FROM payment_application_invoice_allocations AS allocation
        WHERE allocation.invoice_id = NEW.invoice_id
          AND allocation.deleted_at IS NULL
          AND allocation.id <> OLD.id
      ), 0) + NEW.allocated_amount
    ) > COALESCE((
      SELECT invoice.total_amount FROM invoices AS invoice
      WHERE invoice.id = NEW.invoice_id
    ), 0) + 0.0001
    THEN RAISE(ABORT, '发票可关联额度不足')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_confirmation_balanced
BEFORE UPDATE OF confirmation_status ON payment_records
WHEN NEW.confirmation_status = 'confirmed'
  AND OLD.confirmation_status <> 'confirmed'
BEGIN
  SELECT CASE
    WHEN ABS(
      COALESCE((
        SELECT SUM(allocation.allocated_amount)
        FROM payment_record_application_allocations AS allocation
        WHERE allocation.payment_record_id = NEW.id
          AND allocation.deleted_at IS NULL
      ), 0) - NEW.amount
    ) > 0.0001
    THEN RAISE(ABORT, '支付分摊合计必须等于支付金额')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_confirmed_payment_allocation_insert
BEFORE INSERT ON payment_record_application_allocations
WHEN EXISTS (
  SELECT 1 FROM payment_records
  WHERE id = NEW.payment_record_id
    AND confirmation_status = 'confirmed'
    AND deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, '已确认支付需先撤回再修改分摊');
END;

CREATE TRIGGER IF NOT EXISTS trg_confirmed_payment_allocation_update
BEFORE UPDATE ON payment_record_application_allocations
WHEN EXISTS (
  SELECT 1 FROM payment_records
  WHERE id = NEW.payment_record_id
    AND confirmation_status = 'confirmed'
    AND deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, '已确认支付需先撤回再修改分摊');
END;

CREATE TRIGGER IF NOT EXISTS trg_confirmed_payment_allocation_delete
BEFORE DELETE ON payment_record_application_allocations
WHEN EXISTS (
  SELECT 1 FROM payment_records
  WHERE id = OLD.payment_record_id
    AND confirmation_status = 'confirmed'
    AND deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, '已确认支付需先撤回再修改分摊');
END;
`

const F2_IMPORT_BATCH_ID = 'migration_f2_v21'

const F1_IMPORT_BATCH_ID = 'migration_f1_v19'

const F3_IMPORT_BATCH_ID = 'migration_f3_v22'

const V23_F4_MATERIAL_TABLES = `
CREATE TABLE IF NOT EXISTS material_requisitions (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  contract_id       TEXT REFERENCES contracts(id),
  applicant         TEXT NOT NULL DEFAULT '',
  requisition_date  TEXT NOT NULL DEFAULT '',
  required_date     TEXT NOT NULL DEFAULT '',
  material_name     TEXT NOT NULL DEFAULT '',
  spec              TEXT NOT NULL DEFAULT '',
  unit              TEXT NOT NULL DEFAULT '',
  planned_qty       REAL NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
  warehouse         TEXT NOT NULL DEFAULT '',
  purpose           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS material_arrivals (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  supplier_id       TEXT REFERENCES suppliers(id),
  contract_id       TEXT REFERENCES contracts(id),
  requisition_id    TEXT REFERENCES material_requisitions(id),
  warehouse         TEXT NOT NULL DEFAULT '',
  arrival_date      TEXT NOT NULL DEFAULT '',
  receiver          TEXT NOT NULL DEFAULT '',
  quality_result    TEXT NOT NULL DEFAULT '',
  stock_status      TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS material_arrival_lines (
  id                TEXT PRIMARY KEY,
  arrival_id        TEXT NOT NULL REFERENCES material_arrivals(id),
  material_name     TEXT NOT NULL,
  spec              TEXT NOT NULL DEFAULT '',
  unit              TEXT NOT NULL DEFAULT '',
  qty               REAL NOT NULL CHECK (qty > 0),
  unit_price        REAL CHECK (unit_price IS NULL OR unit_price >= 0),
  note              TEXT NOT NULL DEFAULT '',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS material_uses (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  warehouse         TEXT NOT NULL DEFAULT '',
  use_date          TEXT NOT NULL DEFAULT '',
  material_name     TEXT NOT NULL DEFAULT '',
  spec              TEXT NOT NULL DEFAULT '',
  unit              TEXT NOT NULL DEFAULT '',
  qty               REAL NOT NULL DEFAULT 0 CHECK (qty >= 0),
  receiver          TEXT NOT NULL DEFAULT '',
  crew_id           TEXT REFERENCES crews(id),
  purpose           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS stock_checks (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  warehouse         TEXT NOT NULL DEFAULT '',
  checker           TEXT NOT NULL DEFAULT '',
  check_date        TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS stock_check_lines (
  id                TEXT PRIMARY KEY,
  stock_check_id    TEXT NOT NULL REFERENCES stock_checks(id),
  material_name     TEXT NOT NULL,
  spec              TEXT NOT NULL DEFAULT '',
  unit              TEXT NOT NULL DEFAULT '',
  book_qty          REAL NOT NULL DEFAULT 0 CHECK (book_qty >= 0),
  actual_qty        REAL NOT NULL DEFAULT 0 CHECK (actual_qty >= 0),
  variance_amount   REAL NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS owner_material_controls (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  customer_id       TEXT REFERENCES customers(id),
  material_name     TEXT NOT NULL DEFAULT '',
  spec              TEXT NOT NULL DEFAULT '',
  unit              TEXT NOT NULL DEFAULT '',
  control_qty       REAL NOT NULL DEFAULT 0 CHECK (control_qty >= 0),
  status            TEXT NOT NULL DEFAULT 'draft',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS owner_material_requisitions (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  applicant         TEXT NOT NULL DEFAULT '',
  application_date  TEXT NOT NULL DEFAULT '',
  required_date     TEXT NOT NULL DEFAULT '',
  material_name     TEXT NOT NULL DEFAULT '',
  spec              TEXT NOT NULL DEFAULT '',
  unit              TEXT NOT NULL DEFAULT '',
  planned_qty       REAL NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
  status            TEXT NOT NULL DEFAULT 'draft',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS owner_material_arrivals (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  warehouse         TEXT NOT NULL DEFAULT '',
  arrival_date      TEXT NOT NULL DEFAULT '',
  receiver          TEXT NOT NULL DEFAULT '',
  material_name     TEXT NOT NULL DEFAULT '',
  spec              TEXT NOT NULL DEFAULT '',
  unit              TEXT NOT NULL DEFAULT '',
  qty               REAL NOT NULL DEFAULT 0 CHECK (qty >= 0),
  quality_result    TEXT NOT NULL DEFAULT '',
  stock_status      TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS owner_material_uses (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  use_date          TEXT NOT NULL DEFAULT '',
  material_name     TEXT NOT NULL DEFAULT '',
  unit              TEXT NOT NULL DEFAULT '',
  qty               REAL NOT NULL DEFAULT 0 CHECK (qty >= 0),
  receiver          TEXT NOT NULL DEFAULT '',
  crew_id           TEXT REFERENCES crews(id),
  purpose           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS owner_material_directs (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  customer_id       TEXT REFERENCES customers(id),
  transaction_date  TEXT NOT NULL DEFAULT '',
  material_name     TEXT NOT NULL DEFAULT '',
  unit              TEXT NOT NULL DEFAULT '',
  qty               REAL NOT NULL DEFAULT 0 CHECK (qty >= 0),
  purpose           TEXT NOT NULL DEFAULT '',
  use_location      TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  deleted_at        TEXT DEFAULT NULL
);
`

const V23_F4_MATERIAL_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_material_requisitions_deleted
  ON material_requisitions(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_material_arrivals_deleted
  ON material_arrivals(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_material_arrival_lines_deleted
  ON material_arrival_lines(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_material_uses_deleted
  ON material_uses(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_checks_deleted
  ON stock_checks(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_check_lines_deleted
  ON stock_check_lines(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_material_controls_deleted
  ON owner_material_controls(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_material_requisitions_deleted
  ON owner_material_requisitions(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_material_arrivals_deleted
  ON owner_material_arrivals(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_material_uses_deleted
  ON owner_material_uses(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_material_directs_deleted
  ON owner_material_directs(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_material_requisitions_project
  ON material_requisitions(project_id);
CREATE INDEX IF NOT EXISTS idx_material_requisitions_contract
  ON material_requisitions(contract_id);
CREATE INDEX IF NOT EXISTS idx_material_arrivals_project
  ON material_arrivals(project_id);
CREATE INDEX IF NOT EXISTS idx_material_arrivals_supplier
  ON material_arrivals(supplier_id);
CREATE INDEX IF NOT EXISTS idx_material_arrivals_contract
  ON material_arrivals(contract_id);
CREATE INDEX IF NOT EXISTS idx_material_arrivals_requisition
  ON material_arrivals(requisition_id);
CREATE INDEX IF NOT EXISTS idx_material_arrival_lines_head
  ON material_arrival_lines(arrival_id);
CREATE INDEX IF NOT EXISTS idx_material_uses_project
  ON material_uses(project_id);
CREATE INDEX IF NOT EXISTS idx_material_uses_crew
  ON material_uses(crew_id);
CREATE INDEX IF NOT EXISTS idx_stock_check_lines_head
  ON stock_check_lines(stock_check_id);
CREATE INDEX IF NOT EXISTS idx_owner_material_controls_project
  ON owner_material_controls(project_id);
CREATE INDEX IF NOT EXISTS idx_owner_material_controls_customer
  ON owner_material_controls(customer_id);
CREATE INDEX IF NOT EXISTS idx_owner_material_requisitions_project
  ON owner_material_requisitions(project_id);
CREATE INDEX IF NOT EXISTS idx_owner_material_arrivals_project
  ON owner_material_arrivals(project_id);
CREATE INDEX IF NOT EXISTS idx_owner_material_uses_project
  ON owner_material_uses(project_id);
CREATE INDEX IF NOT EXISTS idx_owner_material_uses_crew
  ON owner_material_uses(crew_id);
CREATE INDEX IF NOT EXISTS idx_owner_material_directs_project
  ON owner_material_directs(project_id);
CREATE INDEX IF NOT EXISTS idx_owner_material_directs_customer
  ON owner_material_directs(customer_id);
`

/** v24 #151 F5 甲方/分包单据：复用 BOQ、报量与支出结算，补齐验收/罚扣事实。 */
const V24_F5_OWNER_SUBCONTRACT_TABLES = `
CREATE TABLE IF NOT EXISTS project_acceptances (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  type              TEXT NOT NULL DEFAULT 'acceptance'
                    CHECK (type IN ('acceptance', 'warranty')),
  name              TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  contract_id       TEXT REFERENCES contracts(id),
  document_date     TEXT NOT NULL DEFAULT '',
  contract_estimate REAL CHECK (contract_estimate IS NULL OR contract_estimate >= 0),
  acceptor          TEXT NOT NULL DEFAULT '',
  warranty_owner    TEXT NOT NULL DEFAULT '',
  conclusion        TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'accepted', 'warranty', 'expired')),
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS owner_final_settlements (
  id                TEXT PRIMARY KEY,
  no                TEXT NOT NULL DEFAULT '',
  name              TEXT NOT NULL DEFAULT '',
  project_id        TEXT REFERENCES projects(id),
  contract_id       TEXT REFERENCES contracts(id),
  settlement_amount REAL NOT NULL DEFAULT 0 CHECK (settlement_amount >= 0),
  submission_date   TEXT NOT NULL DEFAULT '',
  basis             TEXT NOT NULL DEFAULT '',
  difference_note   TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'draft',
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS owner_penalties (
  id           TEXT PRIMARY KEY,
  no           TEXT NOT NULL DEFAULT '',
  project_id   TEXT REFERENCES projects(id),
  contract_id  TEXT REFERENCES contracts(id),
  notice_no    TEXT NOT NULL DEFAULT '',
  amount       REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  penalty_date TEXT NOT NULL DEFAULT '',
  reason       TEXT NOT NULL DEFAULT '',
  appeal_note  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft',
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS subcontract_change_orders (
  id                    TEXT PRIMARY KEY,
  no                    TEXT NOT NULL DEFAULT '',
  change_type           TEXT NOT NULL DEFAULT '',
  project_id            TEXT REFERENCES projects(id),
  supplier_id           TEXT REFERENCES suppliers(id),
  contract_id           TEXT REFERENCES contracts(id),
  change_date           TEXT NOT NULL DEFAULT '',
  approved_amount       REAL NOT NULL DEFAULT 0,
  changed_area          REAL,
  actual_approved_price REAL,
  reason                TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'draft',
  note                  TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS penalty_records (
  id                     TEXT PRIMARY KEY,
  no                     TEXT NOT NULL DEFAULT '',
  projectId              TEXT REFERENCES projects(id),
  crewId                 TEXT REFERENCES crews(id),
  workerId               TEXT REFERENCES workers(id),
  source                 TEXT NOT NULL DEFAULT 'project'
                         CHECK (source IN ('inspection', 'owner_notice', 'acceptance', 'project')),
  noticeNo               TEXT NOT NULL DEFAULT '',
  building               TEXT NOT NULL DEFAULT '',
  floor                  TEXT NOT NULL DEFAULT '',
  room                   TEXT NOT NULL DEFAULT '',
  location               TEXT NOT NULL DEFAULT '',
  reason                 TEXT NOT NULL DEFAULT '',
  amount                 REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  penaltyDate            TEXT NOT NULL DEFAULT '',
  chargeMethod           TEXT NOT NULL DEFAULT '',
  responsibleWorkerId    TEXT REFERENCES workers(id),
  responsibleWorkerName  TEXT NOT NULL DEFAULT '',
  reportedBy             TEXT NOT NULL DEFAULT '',
  repairedByWorkerId     TEXT REFERENCES workers(id),
  repairedByWorkerName   TEXT NOT NULL DEFAULT '',
  deadline               TEXT NOT NULL DEFAULT '',
  status                 TEXT NOT NULL DEFAULT 'pending'
                         CHECK (
                           status IN (
                             'draft', 'pending', 'repairing', 'repaired_self',
                             'repaired_other', 'deducted'
                           )
                         ),
  repairedAt             TEXT,
  deductedAt             TEXT,
  supplier_id            TEXT REFERENCES suppliers(id),
  contract_id            TEXT REFERENCES contracts(id),
  deduction_method       TEXT NOT NULL DEFAULT '',
  rectification_note     TEXT NOT NULL DEFAULT '',
  note                   TEXT NOT NULL DEFAULT '',
  createdAt              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS penalty_settlement_deductions (
  id            TEXT PRIMARY KEY,
  penalty_id    TEXT NOT NULL REFERENCES penalty_records(id),
  settlement_id TEXT NOT NULL REFERENCES expenditure_settlements(id),
  amount        REAL NOT NULL CHECK (amount > 0),
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL
);
`

const V24_OWNER_CHANGE_ORDERS_TABLE = `
CREATE TABLE owner_change_orders_v24_new (
  id                            TEXT PRIMARY KEY,
  project_id                    TEXT REFERENCES projects(id),
  change_no                     TEXT NOT NULL DEFAULT '',
  contract_name                 TEXT NOT NULL DEFAULT '',
  tax_inc_amount                REAL NOT NULL DEFAULT 0,
  tax_exc_amount                REAL NOT NULL DEFAULT 0,
  applied_amount                REAL NOT NULL DEFAULT 0,
  approval_date                 TEXT NOT NULL DEFAULT '',
  created_at                    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at                    TEXT DEFAULT NULL,
  source_type                   TEXT NOT NULL DEFAULT 'manual',
  source_id                     TEXT,
  source_locked                 INTEGER NOT NULL DEFAULT 0 CHECK (source_locked IN (0, 1)),
  contract_id                   TEXT REFERENCES contracts(id),
  name                          TEXT NOT NULL DEFAULT '',
  document_type                 TEXT NOT NULL DEFAULT 'change_negotiation'
                                CHECK (
                                  document_type IN (
                                    'change_negotiation', 'site_visa', 'claim', 'material_price_approval'
                                  )
                                ),
  directive_no                  TEXT NOT NULL DEFAULT '',
  directive_type                TEXT NOT NULL DEFAULT ''
                                CHECK (directive_type IN ('', 'issued', 'changed', 'supplemented')),
  application_date              TEXT NOT NULL DEFAULT '',
  reason                        TEXT NOT NULL DEFAULT '',
  status                        TEXT NOT NULL DEFAULT 'draft',
  status_note                   TEXT NOT NULL DEFAULT '',
  note                          TEXT NOT NULL DEFAULT '',
  updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
);
`

const V24_MONTHLY_STATEMENTS_TABLE = `
CREATE TABLE monthly_statements_v24_new (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT REFERENCES projects(id),
  contract_id        TEXT REFERENCES contracts(id),
  month              TEXT NOT NULL DEFAULT ''
                     CHECK (month = '' OR month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'adjusted', 'exported')),
  total_amount       REAL NOT NULL DEFAULT 0,
  note               TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT DEFAULT NULL,
  no                 TEXT NOT NULL DEFAULT '',
  period_no          TEXT NOT NULL DEFAULT '',
  application_date   TEXT NOT NULL DEFAULT '',
  reported_amount    REAL CHECK (reported_amount IS NULL OR reported_amount >= 0),
  audited_amount     REAL CHECK (audited_amount IS NULL OR audited_amount >= 0)
);
`

const V24_F5_OWNER_SUBCONTRACT_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_project_acceptances_project
  ON project_acceptances(project_id);
CREATE INDEX IF NOT EXISTS idx_project_acceptances_contract
  ON project_acceptances(contract_id);
CREATE INDEX IF NOT EXISTS idx_project_acceptances_deleted
  ON project_acceptances(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_final_settlements_project
  ON owner_final_settlements(project_id);
CREATE INDEX IF NOT EXISTS idx_owner_final_settlements_contract
  ON owner_final_settlements(contract_id);
CREATE INDEX IF NOT EXISTS idx_owner_final_settlements_deleted
  ON owner_final_settlements(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_penalties_project
  ON owner_penalties(project_id);
CREATE INDEX IF NOT EXISTS idx_owner_penalties_contract
  ON owner_penalties(contract_id);
CREATE INDEX IF NOT EXISTS idx_owner_penalties_deleted
  ON owner_penalties(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subcontract_change_project
  ON subcontract_change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_change_supplier
  ON subcontract_change_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_change_contract
  ON subcontract_change_orders(contract_id);
CREATE INDEX IF NOT EXISTS idx_subcontract_change_orders_deleted
  ON subcontract_change_orders(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_penalty_records_project
  ON penalty_records(projectId);
CREATE INDEX IF NOT EXISTS idx_penalty_records_crew
  ON penalty_records(crewId);
CREATE INDEX IF NOT EXISTS idx_penalty_records_worker
  ON penalty_records(workerId);
CREATE INDEX IF NOT EXISTS idx_penalty_records_supplier
  ON penalty_records(supplier_id);
CREATE INDEX IF NOT EXISTS idx_penalty_records_contract
  ON penalty_records(contract_id);
CREATE INDEX IF NOT EXISTS idx_penalty_records_deleted
  ON penalty_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_penalty_deductions_penalty
  ON penalty_settlement_deductions(penalty_id);
CREATE INDEX IF NOT EXISTS idx_penalty_deductions_settlement
  ON penalty_settlement_deductions(settlement_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_penalty_settlement_deduction
  ON penalty_settlement_deductions(penalty_id, settlement_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_penalty_settlement_deductions_deleted
  ON penalty_settlement_deductions(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_change_orders_contract
  ON owner_change_orders(contract_id);
CREATE INDEX IF NOT EXISTS idx_owner_change_orders_proj
  ON owner_change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_owner_change_orders_deleted
  ON owner_change_orders(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_change_order_boq_source
  ON owner_change_orders(source_type, source_id)
  WHERE deleted_at IS NULL
    AND source_type = 'boq_change_order'
    AND source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_monthly_statements_project_month
  ON monthly_statements(project_id, month);
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_statement_contract_month
  ON monthly_statements(contract_id, month)
  WHERE deleted_at IS NULL
    AND contract_id IS NOT NULL
    AND month <> '';
CREATE INDEX IF NOT EXISTS idx_monthly_statements_deleted
  ON monthly_statements(deleted_at) WHERE deleted_at IS NOT NULL;
`

async function rebuildOwnerChangeOrdersForF5(db: MigrationDb): Promise<void> {
  await db.execute('DROP TABLE IF EXISTS owner_change_orders_v24_new')
  await execScript(db, V24_OWNER_CHANGE_ORDERS_TABLE)
  await db.execute(`
    INSERT INTO owner_change_orders_v24_new (
      id, project_id, change_no, contract_name, tax_inc_amount, tax_exc_amount,
      applied_amount, approval_date, created_at, deleted_at, source_type,
      source_id, source_locked, contract_id, name, document_type, directive_no,
      directive_type, application_date, reason, status, status_note, note, updated_at
    )
    SELECT
      id, project_id, change_no, contract_name, tax_inc_amount, tax_exc_amount,
      applied_amount, approval_date, created_at, deleted_at, source_type,
      source_id, source_locked, contract_id, name, document_type, directive_no,
      directive_type, application_date, reason, status, status_note, note, updated_at
    FROM owner_change_orders
  `)
  await db.execute('DROP TABLE owner_change_orders')
  await db.execute('ALTER TABLE owner_change_orders_v24_new RENAME TO owner_change_orders')
}

async function rebuildMonthlyStatementsForF5(db: MigrationDb): Promise<void> {
  await db.execute('DROP TABLE IF EXISTS monthly_statements_v24_new')
  await execScript(db, V24_MONTHLY_STATEMENTS_TABLE)
  await db.execute(`
    INSERT INTO monthly_statements_v24_new (
      id, project_id, contract_id, month, status, total_amount, note,
      created_at, updated_at, deleted_at, no, period_no, application_date,
      reported_amount, audited_amount
    )
    SELECT
      id, project_id, contract_id, month, status, total_amount, note,
      created_at, updated_at, deleted_at, no, period_no, application_date,
      reported_amount, audited_amount
    FROM monthly_statements
  `)
  await db.execute('DROP TABLE monthly_statements')
  await db.execute('ALTER TABLE monthly_statements_v24_new RENAME TO monthly_statements')
}

async function migrateF5OwnerSubcontractDocuments(db: MigrationDb): Promise<void> {
  await db.execute('PRAGMA foreign_keys = OFF')
  let transactionStarted = false
  try {
    await db.execute('BEGIN IMMEDIATE')
    transactionStarted = true
    await addColumnIfMissing(
      db,
      'boq_change_orders',
      'document_type',
      `TEXT NOT NULL DEFAULT 'change_negotiation'
       CHECK (
         document_type IN (
           'change_negotiation', 'site_visa', 'claim', 'material_price_approval'
         )
       )`,
    )
    await addColumnIfMissing(db, 'boq_change_orders', 'application_date', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(db, 'boq_change_orders', 'reason', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(db, 'boq_change_orders', 'approved_tax_inclusive_amount', 'REAL')
    await addColumnIfMissing(db, 'boq_change_orders', 'approved_tax_exclusive_amount', 'REAL')
    await addColumnIfMissing(db, 'boq_change_orders', 'applied_tax_exclusive_amount', 'REAL')

    await addColumnIfMissing(db, 'owner_change_orders', 'contract_id', 'TEXT REFERENCES contracts(id)')
    await addColumnIfMissing(db, 'owner_change_orders', 'name', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(
      db,
      'owner_change_orders',
      'document_type',
      `TEXT NOT NULL DEFAULT 'change_negotiation'
       CHECK (
         document_type IN (
           'change_negotiation', 'site_visa', 'claim', 'material_price_approval'
         )
       )`,
    )
    await addColumnIfMissing(db, 'owner_change_orders', 'directive_no', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(
      db,
      'owner_change_orders',
      'directive_type',
      `TEXT NOT NULL DEFAULT ''
       CHECK (directive_type IN ('', 'issued', 'changed', 'supplemented'))`,
    )
    await addColumnIfMissing(db, 'owner_change_orders', 'application_date', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(db, 'owner_change_orders', 'reason', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(db, 'owner_change_orders', 'status', `TEXT NOT NULL DEFAULT 'draft'`)
    await addColumnIfMissing(db, 'owner_change_orders', 'status_note', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(db, 'owner_change_orders', 'note', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(db, 'owner_change_orders', 'updated_at', `TEXT NOT NULL DEFAULT (datetime('now'))`)

    await addColumnIfMissing(db, 'monthly_statements', 'no', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(db, 'monthly_statements', 'period_no', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(db, 'monthly_statements', 'application_date', `TEXT NOT NULL DEFAULT ''`)
    await addColumnIfMissing(
      db,
      'monthly_statements',
      'reported_amount',
      'REAL CHECK (reported_amount IS NULL OR reported_amount >= 0)',
    )
    await addColumnIfMissing(
      db,
      'monthly_statements',
      'audited_amount',
      'REAL CHECK (audited_amount IS NULL OR audited_amount >= 0)',
    )
    await addColumnIfMissing(
      db,
      'monthly_statement_lines',
      'reported_qty',
      'REAL CHECK (reported_qty IS NULL OR reported_qty >= 0)',
    )
    await addColumnIfMissing(
      db,
      'monthly_statement_lines',
      'audited_qty',
      'REAL CHECK (audited_qty IS NULL OR audited_qty >= 0)',
    )
    await addColumnIfMissing(
      db,
      'monthly_statement_lines',
      'audited_amount',
      'REAL CHECK (audited_amount IS NULL OR audited_amount >= 0)',
    )

    await rebuildOwnerChangeOrdersForF5(db)
    await rebuildMonthlyStatementsForF5(db)
    await execScript(db, V24_F5_OWNER_SUBCONTRACT_TABLES)
    await execScript(db, V24_F5_OWNER_SUBCONTRACT_INDEXES)
    const foreignKeyIssues = await db.select<{ table: string }>('PRAGMA foreign_key_check')
    if (foreignKeyIssues.length > 0)
      throw new Error('[db] F5 迁移后存在无效外键')
    await db.execute('COMMIT')
    transactionStarted = false
  }
  catch (error) {
    if (transactionStarted) {
      try {
        await db.execute('ROLLBACK')
      }
      catch {
        // 保留原始迁移错误。
      }
    }
    throw error
  }
  finally {
    await db.execute('PRAGMA foreign_keys = ON')
  }
}

function normalizeLegacyName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function stableMigrationId(prefix: string, ...parts: string[]): string {
  let hash = 2166136261
  for (const char of parts.join('\u001F')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function quotedColumnOr(
  available: Set<string>,
  column: string,
  fallback: string,
): string {
  return available.has(column) ? `"${column}"` : fallback
}

async function rebuildContractsForF2(db: MigrationDb): Promise<void> {
  if (await columnExists(db, 'contracts', 'customer_id'))
    return

  const columns = await db.select<{ name: string }>(
    `SELECT name FROM pragma_table_info('contracts')`,
  )
  const available = new Set(columns.map(column => column.name))
  await db.execute('DROP TABLE IF EXISTS contracts_v21_new')
  await execScript(db, V21_CONTRACTS_TABLE)

  const targets = [
    'id',
    'no',
    'name',
    'kind',
    'sub_kind',
    'cost_category',
    'legacy_type',
    'classification_state',
    'project_id',
    'customer_id',
    'supplier_id',
    'amount',
    'changed',
    'settled',
    'invoiced',
    'paid',
    'content',
    'invoice_type',
    'signer_name',
    'contact_name',
    'contact_phone',
    'tax_rate',
    'sign_date',
    'main_terms',
    'payment_terms',
    'brand_quality_terms',
    'schedule_terms',
    'warranty_terms',
    'special_terms',
    'retention_ratio',
    'retention_amount',
    'retention_days',
    'invoice_name',
    'invoice_tax_no',
    'invoice_address_phone',
    'invoice_bank',
    'invoice_bank_account',
    'other_expense_kind',
    'service_period',
    'payment_cycle',
    'status',
    'note',
    'created_at',
    'updated_at',
    'deleted_at',
  ]
  const expressions: Record<string, string> = {
    id: quotedColumnOr(available, 'id', `''`),
    no: `COALESCE(${quotedColumnOr(available, 'no', `''`)}, '')`,
    name: `COALESCE(${quotedColumnOr(available, 'name', `''`)}, '')`,
    kind: `CASE
      WHEN ${quotedColumnOr(available, 'kind', `'施工'`)} IN ('施工', '分包', '材采', '其他支出')
        THEN ${quotedColumnOr(available, 'kind', `'施工'`)}
      ELSE '其他支出'
    END`,
    sub_kind: `COALESCE(${quotedColumnOr(available, 'sub_kind', `''`)}, '')`,
    cost_category: `COALESCE(${quotedColumnOr(available, 'cost_category', `''`)}, '')`,
    legacy_type: `COALESCE(${quotedColumnOr(available, 'legacy_type', `''`)}, '')`,
    classification_state: `COALESCE(${quotedColumnOr(available, 'classification_state', `'classified'`)}, 'classified')`,
    project_id: `NULLIF(${quotedColumnOr(available, 'project_id', 'NULL')}, '')`,
    customer_id: 'NULL',
    supplier_id: `NULLIF(${quotedColumnOr(available, 'supplier_id', 'NULL')}, '')`,
    amount: `MAX(COALESCE(${quotedColumnOr(available, 'amount', '0')}, 0), 0)`,
    changed: `MAX(COALESCE(${quotedColumnOr(available, 'changed', '0')}, 0), 0)`,
    settled: `MAX(COALESCE(${quotedColumnOr(available, 'settled', '0')}, 0), 0)`,
    invoiced: `MAX(COALESCE(${quotedColumnOr(available, 'invoiced', '0')}, 0), 0)`,
    paid: `MAX(COALESCE(${quotedColumnOr(available, 'paid', '0')}, 0), 0)`,
    content: `COALESCE(${quotedColumnOr(available, 'content', `''`)}, '')`,
    invoice_type: `COALESCE(${quotedColumnOr(available, 'invoice_type', `''`)}, '')`,
    signer_name: `COALESCE(${quotedColumnOr(available, 'signer_name', `''`)}, '')`,
    contact_name: `COALESCE(${quotedColumnOr(available, 'contact_name', `''`)}, '')`,
    contact_phone: `COALESCE(${quotedColumnOr(available, 'contact_phone', `''`)}, '')`,
    tax_rate: quotedColumnOr(available, 'tax_rate', 'NULL'),
    sign_date: `COALESCE(${quotedColumnOr(available, 'sign_date', `''`)}, '')`,
    main_terms: `COALESCE(${quotedColumnOr(available, 'main_terms', `''`)}, '')`,
    payment_terms: `COALESCE(${quotedColumnOr(available, 'payment_terms', `''`)}, '')`,
    brand_quality_terms: `COALESCE(${quotedColumnOr(available, 'brand_quality_terms', `''`)}, '')`,
    schedule_terms: `COALESCE(${quotedColumnOr(available, 'schedule_terms', `''`)}, '')`,
    warranty_terms: `COALESCE(${quotedColumnOr(available, 'warranty_terms', `''`)}, '')`,
    special_terms: `COALESCE(${quotedColumnOr(available, 'special_terms', `''`)}, '')`,
    retention_ratio: quotedColumnOr(available, 'retention_ratio', 'NULL'),
    retention_amount: quotedColumnOr(available, 'retention_amount', 'NULL'),
    retention_days: quotedColumnOr(available, 'retention_days', 'NULL'),
    invoice_name: `COALESCE(${quotedColumnOr(available, 'invoice_name', `''`)}, '')`,
    invoice_tax_no: `COALESCE(${quotedColumnOr(available, 'invoice_tax_no', `''`)}, '')`,
    invoice_address_phone: `COALESCE(${quotedColumnOr(available, 'invoice_address_phone', `''`)}, '')`,
    invoice_bank: `COALESCE(${quotedColumnOr(available, 'invoice_bank', `''`)}, '')`,
    invoice_bank_account: `COALESCE(${quotedColumnOr(available, 'invoice_bank_account', `''`)}, '')`,
    other_expense_kind: `COALESCE(${quotedColumnOr(available, 'other_expense_kind', `''`)}, '')`,
    service_period: `COALESCE(${quotedColumnOr(available, 'service_period', `''`)}, '')`,
    payment_cycle: `COALESCE(${quotedColumnOr(available, 'payment_cycle', `''`)}, '')`,
    status: `COALESCE(${quotedColumnOr(available, 'status', `'draft'`)}, 'draft')`,
    note: `COALESCE(${quotedColumnOr(available, 'note', `''`)}, '')`,
    created_at: `COALESCE(${quotedColumnOr(available, 'created_at', `datetime('now')`)}, datetime('now'))`,
    updated_at: `COALESCE(${quotedColumnOr(available, 'updated_at', `datetime('now')`)}, datetime('now'))`,
    deleted_at: quotedColumnOr(available, 'deleted_at', 'NULL'),
  }

  await db.execute(`
    INSERT INTO contracts_v21_new (${targets.join(', ')})
    SELECT ${targets.map(column => expressions[column]).join(', ')}
    FROM contracts
  `)
  await db.execute('DROP TABLE contracts')
  await db.execute('ALTER TABLE contracts_v21_new RENAME TO contracts')
}

interface LegacyConstructionContractRow {
  id: string
  project_id: string
  name: string
  contract_no: string
  amount: number | null
  status: string | null
  sign_date: string | null
  category: string | null
  tax_rate: number | null
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

interface LegacyExpenditureContractRow {
  id: string
  project_id: string
  supplier_id: string | null
  name: string
  contract_no: string
  approval_status: string | null
  tax_inc_total: number | null
  effective_date: string | null
  contract_type: string | null
  tax_rate: number | null
  payment_method: string | null
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
}

interface LegacyContractMapping {
  sourceTable: 'construction_contracts' | 'expenditure_contracts'
  legacyId: string
  contractId: string
  sourceNo: string
  sourceName: string
}

async function upsertLegacyContractMapping(
  db: MigrationDb,
  mapping: LegacyContractMapping,
): Promise<void> {
  await db.execute(`
    INSERT INTO contract_legacy_mappings (
      id, source_table, legacy_id, contract_id, source_no, source_name, mapped_at
    )
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(source_table, legacy_id) DO UPDATE SET
      contract_id = excluded.contract_id,
      source_no = excluded.source_no,
      source_name = excluded.source_name,
      mapped_at = excluded.mapped_at
  `, [
    stableMigrationId('contract_map', mapping.sourceTable, mapping.legacyId),
    mapping.sourceTable,
    mapping.legacyId,
    mapping.contractId,
    mapping.sourceNo,
    mapping.sourceName,
  ])
}

async function mappedContractId(
  db: MigrationDb,
  sourceTable: LegacyContractMapping['sourceTable'],
  legacyId: string,
): Promise<string | null> {
  const [mapping] = await db.select<{ contract_id: string }>(`
    SELECT contract_id
    FROM contract_legacy_mappings
    WHERE source_table = ? AND legacy_id = ?
    LIMIT 1
  `, [sourceTable, legacyId])
  return mapping?.contract_id ?? null
}

async function findCanonicalContractMatch(
  db: MigrationDb,
  input: {
    sourceTable: LegacyContractMapping['sourceTable']
    legacyId: string
    kind: string
    projectId: string
    supplierId?: string | null
    no: string
    name: string
    amount: number
    signDate: string
  },
): Promise<string | null> {
  const candidates = await db.select<{
    id: string
    kind: string
    project_id: string
    supplier_id: string | null
    no: string
    name: string
    amount: number
    sign_date: string
  }>(`
    SELECT id, kind, project_id, supplier_id, no, name, amount, sign_date
    FROM contracts
    WHERE id = ?
       OR (
        kind = ?
        AND project_id = ?
        AND COALESCE(supplier_id, '') = COALESCE(?, '')
        AND (
          (? <> '' AND no = ?)
          OR name = ?
        )
      )
    ORDER BY created_at, id
  `, [
    input.legacyId,
    input.kind,
    input.projectId,
    input.supplierId ?? null,
    input.no,
    input.no,
    input.name,
  ])

  const exact = candidates.filter(candidate =>
    candidate.kind === input.kind
    && candidate.project_id === input.projectId
    && (candidate.supplier_id ?? null) === (input.supplierId ?? null)
    && normalizeLegacyName(candidate.no) === normalizeLegacyName(input.no)
    && normalizeLegacyName(candidate.name) === normalizeLegacyName(input.name)
    && Math.abs(Number(candidate.amount) - input.amount) < 0.005
    && (candidate.sign_date ?? '') === input.signDate,
  )
  if (exact.length === 1)
    return exact[0]!.id

  if (candidates.length) {
    const issueId = stableMigrationId(
      'reconciliation_f2_contract',
      input.sourceTable,
      input.legacyId,
    )
    await db.execute(`
      INSERT OR IGNORE INTO reconciliation_issues (
        id, import_batch_id, project_id, entity_type, entity_id, field_name,
        source_value, metric_key, source_ref, attribution
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'mapping')
    `, [
      issueId,
      F2_IMPORT_BATCH_ID,
      input.projectId,
      input.sourceTable,
      input.legacyId,
      'contract_id',
      JSON.stringify({
        no: input.no,
        name: input.name,
        amount: input.amount,
        signDate: input.signDate,
        candidateIds: candidates.map(candidate => candidate.id),
      }),
      `${input.sourceTable}.contract_id`,
      `schema:v21:${input.sourceTable}:${input.legacyId}`,
    ])
  }
  return null
}

async function availableCanonicalId(
  db: MigrationDb,
  sourceTable: string,
  legacyId: string,
): Promise<string> {
  const [sameId] = await db.select<{ id: string }>(
    `SELECT id FROM contracts WHERE id = ? LIMIT 1`,
    [legacyId],
  )
  if (!sameId)
    return legacyId
  return stableMigrationId('contract_legacy', sourceTable, legacyId)
}

function classifyLegacyExpenditureContract(legacyType: string): {
  kind: '分包' | '材采' | '其他支出'
  subKind: '' | '劳务' | '专业'
  costCategory: '专业分包' | '合同劳务' | '材料' | '机械' | '其他'
  otherExpenseKind: string
} {
  if (/劳务/.test(legacyType)) {
    return {
      kind: '分包',
      subKind: '劳务',
      costCategory: '合同劳务',
      otherExpenseKind: '',
    }
  }
  if (/专业|分包/.test(legacyType)) {
    return {
      kind: '分包',
      subKind: '专业',
      costCategory: '专业分包',
      otherExpenseKind: '',
    }
  }
  if (/材料|采购/.test(legacyType)) {
    return {
      kind: '材采',
      subKind: '',
      costCategory: '材料',
      otherExpenseKind: '',
    }
  }
  if (/机械|租赁/.test(legacyType)) {
    return {
      kind: '其他支出',
      subKind: '',
      costCategory: '机械',
      otherExpenseKind: '机械租赁',
    }
  }
  return {
    kind: '其他支出',
    subKind: '',
    costCategory: '其他',
    otherExpenseKind: legacyType,
  }
}

async function migrateLegacyConstructionContracts(db: MigrationDb): Promise<void> {
  const rows = await db.select<LegacyConstructionContractRow>(`
    SELECT
      id, project_id, name, contract_no, amount, status, sign_date,
      category, tax_rate, created_at, updated_at, deleted_at
    FROM construction_contracts
    ORDER BY id
  `)
  for (const row of rows) {
    let contractId = await mappedContractId(db, 'construction_contracts', row.id)
    contractId ??= await findCanonicalContractMatch(db, {
      sourceTable: 'construction_contracts',
      legacyId: row.id,
      kind: '施工',
      projectId: row.project_id,
      supplierId: null,
      no: row.contract_no ?? '',
      name: row.name,
      amount: Math.max(row.amount ?? 0, 0),
      signDate: row.sign_date ?? '',
    })
    if (!contractId) {
      contractId = await availableCanonicalId(db, 'construction_contracts', row.id)
      await db.execute(`
        INSERT INTO contracts (
          id, no, name, kind, project_id, customer_id, amount, changed,
          legacy_type, tax_rate, sign_date, status, created_at, updated_at, deleted_at
        )
        SELECT
          ?, ?, ?, '施工', ?, project.customer_id, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM projects AS project
        WHERE project.id = ?
      `, [
        contractId,
        row.contract_no ?? '',
        row.name,
        row.project_id,
        Math.max(row.amount ?? 0, 0),
        Math.max(row.amount ?? 0, 0),
        row.category ?? '',
        row.tax_rate,
        row.sign_date ?? '',
        row.status || '履约中',
        row.created_at ?? new Date().toISOString(),
        row.updated_at ?? row.created_at ?? new Date().toISOString(),
        row.deleted_at,
        row.project_id,
      ])
    }
    else {
      await db.execute(`
        UPDATE contracts
        SET customer_id = COALESCE(
              customer_id,
              (SELECT customer_id FROM projects WHERE id = contracts.project_id)
            ),
            legacy_type = CASE WHEN legacy_type = '' THEN ? ELSE legacy_type END,
            tax_rate = COALESCE(tax_rate, ?)
        WHERE id = ?
      `, [row.category ?? '', row.tax_rate, contractId])
    }
    await upsertLegacyContractMapping(db, {
      sourceTable: 'construction_contracts',
      legacyId: row.id,
      contractId,
      sourceNo: row.contract_no ?? '',
      sourceName: row.name,
    })
  }

  await db.execute(`
    UPDATE contracts
    SET customer_id = (
      SELECT project.customer_id
      FROM projects AS project
      WHERE project.id = contracts.project_id
    )
    WHERE kind = '施工'
      AND customer_id IS NULL
      AND project_id IS NOT NULL
  `)
}

async function migrateLegacyExpenditureContracts(db: MigrationDb): Promise<void> {
  const rows = await db.select<LegacyExpenditureContractRow>(`
    SELECT
      id, project_id, supplier_id, name, contract_no, approval_status,
      tax_inc_total, effective_date, contract_type, tax_rate, payment_method,
      created_at, updated_at, deleted_at
    FROM expenditure_contracts
    ORDER BY id
  `)
  for (const row of rows) {
    const classification = classifyLegacyExpenditureContract(row.contract_type ?? '')
    let contractId = await mappedContractId(db, 'expenditure_contracts', row.id)
    contractId ??= await findCanonicalContractMatch(db, {
      sourceTable: 'expenditure_contracts',
      legacyId: row.id,
      kind: classification.kind,
      projectId: row.project_id,
      supplierId: row.supplier_id,
      no: row.contract_no ?? '',
      name: row.name,
      amount: Math.max(row.tax_inc_total ?? 0, 0),
      signDate: row.effective_date ?? '',
    })
    if (!contractId) {
      contractId = await availableCanonicalId(db, 'expenditure_contracts', row.id)
      await db.execute(`
        INSERT INTO contracts (
          id, no, name, kind, sub_kind, cost_category, legacy_type,
          project_id, supplier_id, amount, changed, tax_rate, sign_date,
          payment_terms, other_expense_kind, payment_cycle, status,
          created_at, updated_at, deleted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        contractId,
        row.contract_no ?? '',
        row.name,
        classification.kind,
        classification.subKind,
        classification.costCategory,
        row.contract_type ?? '',
        row.project_id,
        row.supplier_id,
        Math.max(row.tax_inc_total ?? 0, 0),
        Math.max(row.tax_inc_total ?? 0, 0),
        row.tax_rate,
        row.effective_date ?? '',
        row.payment_method ?? '',
        classification.otherExpenseKind,
        row.payment_method ?? '',
        row.approval_status || 'draft',
        row.created_at ?? new Date().toISOString(),
        row.updated_at ?? row.created_at ?? new Date().toISOString(),
        row.deleted_at,
      ])
    }
    else {
      await db.execute(`
        UPDATE contracts
        SET cost_category = CASE WHEN cost_category = '' THEN ? ELSE cost_category END,
            legacy_type = CASE WHEN legacy_type = '' THEN ? ELSE legacy_type END,
            tax_rate = COALESCE(tax_rate, ?),
            payment_cycle = CASE WHEN payment_cycle = '' THEN ? ELSE payment_cycle END
        WHERE id = ?
      `, [
        classification.costCategory,
        row.contract_type ?? '',
        row.tax_rate,
        row.payment_method ?? '',
        contractId,
      ])
    }
    await upsertLegacyContractMapping(db, {
      sourceTable: 'expenditure_contracts',
      legacyId: row.id,
      contractId,
      sourceNo: row.contract_no ?? '',
      sourceName: row.name,
    })
  }
}

async function migrateLegacySupplements(db: MigrationDb): Promise<void> {
  const rows = await db.select<{
    id: string
    contract_id: string
    name: string
    amount: number | null
    sign_date: string | null
    created_at: string | null
    deleted_at: string | null
  }>(`
    SELECT id, contract_id, name, amount, sign_date, created_at, deleted_at
    FROM supplement_agreements
    ORDER BY id
  `)
  for (const row of rows) {
    const contractId = await mappedContractId(db, 'construction_contracts', row.contract_id)
    if (!contractId)
      continue
    await db.execute(`
      INSERT OR IGNORE INTO contract_supplements (
        id, contract_id, name, amount, sign_date, status,
        created_at, updated_at, deleted_at
      )
      VALUES (?, ?, ?, ?, ?, '有效', ?, ?, ?)
    `, [
      row.id,
      contractId,
      row.name,
      Math.max(row.amount ?? 0, 0),
      row.sign_date ?? '',
      row.created_at ?? new Date().toISOString(),
      row.created_at ?? new Date().toISOString(),
      row.deleted_at,
    ])
  }
}

async function migrateLegacyContractReferences(db: MigrationDb): Promise<void> {
  for (const table of [
    'invoices',
    'boq_files',
    'boq_change_orders',
    'boq_lines',
    'monthly_statements',
    'schedule_groups',
  ]) {
    if (!await columnExists(db, table, 'contract_id'))
      continue
    await db.execute(`
      UPDATE "${table}"
      SET contract_id = COALESCE(
        (
          SELECT mapping.contract_id
          FROM contract_legacy_mappings AS mapping
          WHERE mapping.source_table = 'expenditure_contracts'
            AND mapping.legacy_id = "${table}".contract_id
        ),
        (
          SELECT mapping.contract_id
          FROM contract_legacy_mappings AS mapping
          WHERE mapping.source_table = 'construction_contracts'
            AND mapping.legacy_id = "${table}".contract_id
        ),
        contract_id
      )
      WHERE contract_id IS NOT NULL AND TRIM(contract_id) <> ''
    `)
  }
}

async function rebuildContractLineItemsForF2(db: MigrationDb): Promise<void> {
  if (await columnExists(db, 'contract_line_items', 'material_name'))
    return

  await db.execute('DROP TABLE IF EXISTS contract_line_items_v21_new')
  await execScript(db, V21_CONTRACT_LINE_ITEMS_TABLE)
  await db.execute(`
    INSERT INTO contract_line_items_v21_new (
      id, contract_id, material_name, spec, brand, unit, qty,
      tax_inclusive_unit_price, sort_order, created_at, updated_at, deleted_at
    )
    SELECT
      legacy.id,
      mapping.contract_id,
      COALESCE(legacy.item_name, ''),
      COALESCE(legacy.spec, ''),
      COALESCE(legacy.brand, ''),
      COALESCE(legacy.unit, ''),
      CASE WHEN legacy.quantity > 0 THEN legacy.quantity ELSE NULL END,
      MAX(COALESCE(legacy.unit_price, 0), 0),
      COALESCE(legacy.sort_order, 0),
      COALESCE(legacy.created_at, datetime('now')),
      COALESCE(legacy.created_at, datetime('now')),
      legacy.deleted_at
    FROM contract_line_items AS legacy
    JOIN contract_legacy_mappings AS mapping
      ON mapping.source_table = 'expenditure_contracts'
     AND mapping.legacy_id = legacy.contract_id
  `)
  await db.execute('DROP TABLE contract_line_items')
  await db.execute(
    'ALTER TABLE contract_line_items_v21_new RENAME TO contract_line_items',
  )
}

async function paymentApplicationsReferenceCanonicalContracts(db: MigrationDb): Promise<boolean> {
  const foreignKeys = await db.select<{ table: string, from: string }>(
    `PRAGMA foreign_key_list('payment_applications')`,
  )
  return foreignKeys.some(key => key.from === 'contract_id' && key.table === 'contracts')
}

async function rebuildPaymentApplicationsForF2(db: MigrationDb): Promise<void> {
  if (await paymentApplicationsReferenceCanonicalContracts(db))
    return

  await db.execute('DROP TABLE IF EXISTS payment_applications_v21_new')
  await execScript(db, V21_PAYMENT_APPLICATIONS_TABLE)
  await db.execute(`
    INSERT INTO payment_applications_v21_new (
      id, project_id, supplier_id, contract_id, application_no, name,
      approval_status, applicant, amount, approved_amount, paid_amount,
      payment_method, actual_payment, payment_status, acceptor, note,
      created_at, updated_at, deleted_at
    )
    SELECT
      application.id,
      NULLIF(application.project_id, ''),
      NULLIF(application.supplier_id, ''),
      COALESCE(
        (
          SELECT mapping.contract_id
          FROM contract_legacy_mappings AS mapping
          WHERE mapping.source_table = 'expenditure_contracts'
            AND mapping.legacy_id = application.contract_id
        ),
        (
          SELECT contract.id
          FROM contracts AS contract
          WHERE contract.id = application.contract_id
        )
      ),
      COALESCE(application.application_no, ''),
      COALESCE(application.name, ''),
      COALESCE(application.approval_status, ''),
      COALESCE(application.applicant, ''),
      MAX(COALESCE(application.amount, 0), 0),
      MAX(COALESCE(application.approved_amount, 0), 0),
      MAX(COALESCE(application.paid_amount, 0), 0),
      COALESCE(application.payment_method, ''),
      MAX(COALESCE(application.actual_payment, 0), 0),
      COALESCE(application.payment_status, ''),
      COALESCE(application.acceptor, ''),
      COALESCE(application.note, ''),
      COALESCE(application.created_at, datetime('now')),
      COALESCE(application.updated_at, datetime('now')),
      application.deleted_at
    FROM payment_applications AS application
  `)
  await db.execute('DROP TABLE payment_applications')
  await db.execute(
    'ALTER TABLE payment_applications_v21_new RENAME TO payment_applications',
  )
}

async function migrateF2ContractsAndSettlements(db: MigrationDb): Promise<void> {
  await db.execute('PRAGMA foreign_keys = OFF')
  let transactionStarted = false
  try {
    await db.execute('BEGIN IMMEDIATE')
    transactionStarted = true
    await rebuildContractsForF2(db)
    await execScript(db, V21_F2_TABLES)
    await db.execute(`
      INSERT INTO import_batches (
        id, project_id, source_file, source_hash, status, completed_at
      )
      VALUES (?, NULL, 'schema:v21', 'f2-canonical-contracts-settlements', 'running', NULL)
      ON CONFLICT(id) DO UPDATE SET
        status = 'running',
        completed_at = NULL
    `, [F2_IMPORT_BATCH_ID])

    await migrateLegacyConstructionContracts(db)
    await migrateLegacyExpenditureContracts(db)
    await migrateLegacySupplements(db)
    await migrateLegacyContractReferences(db)
    await rebuildContractLineItemsForF2(db)
    await rebuildPaymentApplicationsForF2(db)
    for (const table of [
      'contracts',
      'contract_supplements',
      'company_expense_contracts',
      'expenditure_settlements',
    ]) {
      await db.execute(`
        UPDATE "${table}"
        SET status = CASE status
          WHEN 'draft' THEN '草稿'
          WHEN 'submitted' THEN '审批中'
          ELSE status
        END
      `)
    }
    await execScript(db, V21_F2_INDEXES)

    const violations = await db.select<{ table: string }>('PRAGMA foreign_key_check')
    if (violations.length)
      throw new Error(`[db] v21 F2 迁移后存在 ${violations.length} 条外键异常`)

    await db.execute(`
      UPDATE import_batches
      SET status = 'completed', completed_at = datetime('now')
      WHERE id = ?
    `, [F2_IMPORT_BATCH_ID])
    await db.execute('COMMIT')
    transactionStarted = false
  }
  catch (error) {
    if (transactionStarted) {
      try {
        await db.execute('ROLLBACK')
      }
      catch {
        // 保留原始迁移错误。
      }
    }
    throw error
  }
  finally {
    await db.execute('PRAGMA foreign_keys = ON')
  }
}

interface F1CustomerCandidate {
  id: string
  name: string
  aliases: string
  deleted_at: string | null
}

function customerSearchNames(customer: F1CustomerCandidate): string[] {
  let aliases: unknown = []
  try {
    aliases = JSON.parse(customer.aliases || '[]')
  }
  catch {
    aliases = []
  }
  return [
    customer.name,
    ...(Array.isArray(aliases) ? aliases.filter(alias => typeof alias === 'string') : []),
  ].map(normalizeLegacyName).filter(Boolean)
}

async function insertF1ReconciliationIssue(
  db: MigrationDb,
  input: {
    projectId?: string | null
    entityType: string
    entityId: string
    fieldName: string
    sourceValue: string
    attribution: 'mapping' | 'missing_source'
  },
): Promise<void> {
  const id = stableMigrationId(
    'reconciliation_f1',
    input.entityType,
    input.entityId,
    input.fieldName,
  )
  await db.execute(`
    INSERT OR IGNORE INTO reconciliation_issues (
      id, import_batch_id, project_id, entity_type, entity_id, field_name,
      source_value, metric_key, source_ref, attribution
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    F1_IMPORT_BATCH_ID,
    input.projectId ?? null,
    input.entityType,
    input.entityId,
    input.fieldName,
    input.sourceValue,
    `${input.entityType}.${input.fieldName}`,
    `schema:v19:${input.entityType}:${input.entityId}`,
    input.attribution,
  ])
}

async function migrateF1ProjectCustomers(db: MigrationDb): Promise<void> {
  const projectColumns = await db.select<{ name: string }>('SELECT name FROM pragma_table_info(?)', ['projects'])
  const available = new Set(projectColumns.map(column => column.name))
  const legacyFields = [
    { source: 'developer', target: 'customer_id' },
    { source: 'developer2', target: 'secondary_customer_id' },
  ].filter(field => available.has(field.source))
  if (!legacyFields.length)
    return

  const legacySelect = legacyFields
    .map(field => `"${field.source}"`)
    .join(', ')
  const projects = await db.select<Record<string, unknown>>(
    `SELECT id, ${legacySelect} FROM projects`,
  )
  const customers = await db.select<F1CustomerCandidate>(
    `SELECT id, name, aliases, deleted_at FROM customers`,
  )

  for (const project of projects) {
    for (const field of legacyFields) {
      const sourceValue = String(project[field.source] ?? '').trim()
      const normalized = normalizeLegacyName(sourceValue)
      if (!normalized)
        continue

      const matches = customers.filter(customer =>
        customer.deleted_at == null && customerSearchNames(customer).includes(normalized),
      )

      if (matches.length === 1) {
        await db.execute(
          `UPDATE projects SET "${field.target}" = ? WHERE id = ?`,
          [matches[0]!.id, project.id],
        )
      }
      else {
        await insertF1ReconciliationIssue(db, {
          projectId: String(project.id),
          entityType: 'project',
          entityId: String(project.id),
          fieldName: field.target,
          sourceValue,
          attribution: matches.length > 1 ? 'mapping' : 'missing_source',
        })
      }
    }
  }
}

async function migrateF1WorkerProjects(db: MigrationDb): Promise<void> {
  if (!await columnExists(db, 'workers', 'current_project'))
    return

  const projects = await db.select<{
    id: string
    name: string
    deleted_at: string | null
  }>(`SELECT id, name, deleted_at FROM projects`)
  const workers = await db.select<{
    id: string
    current_project: string
  }>(`SELECT id, current_project FROM workers`)

  for (const worker of workers) {
    const sourceValue = String(worker.current_project ?? '').trim()
    const normalized = normalizeLegacyName(sourceValue)
    if (!normalized)
      continue
    const matches = projects.filter(project =>
      project.deleted_at == null && normalizeLegacyName(project.name) === normalized,
    )
    if (matches.length === 1) {
      await db.execute(
        `UPDATE workers SET current_project_id = ? WHERE id = ?`,
        [matches[0]!.id, worker.id],
      )
    }
    else {
      await insertF1ReconciliationIssue(db, {
        entityType: 'worker',
        entityId: worker.id,
        fieldName: 'current_project_id',
        sourceValue,
        attribution: matches.length > 1 ? 'mapping' : 'missing_source',
      })
    }
  }
}

async function recordF1SupplierHierarchy(db: MigrationDb): Promise<void> {
  if (!await columnExists(db, 'suppliers', 'parent_supplier_id'))
    return
  const suppliers = await db.select<{
    id: string
    parent_supplier_id: string | null
  }>(`
    SELECT id, parent_supplier_id
    FROM suppliers
    WHERE parent_supplier_id IS NOT NULL AND TRIM(parent_supplier_id) <> ''
  `)
  for (const supplier of suppliers) {
    await insertF1ReconciliationIssue(db, {
      entityType: 'supplier',
      entityId: supplier.id,
      fieldName: 'parent_supplier_id',
      sourceValue: supplier.parent_supplier_id!,
      attribution: 'mapping',
    })
  }
}

async function f3TableExists(db: MigrationDb, table: string): Promise<boolean> {
  const rows = await db.select<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [table],
  )
  return rows.length > 0
}

async function f3Columns(db: MigrationDb, table: string): Promise<Set<string>> {
  const rows = await db.select<{ name: string }>(
    `SELECT name FROM pragma_table_info(?)`,
    [table],
  )
  return new Set(rows.map(row => row.name))
}

function f3Column(
  available: Set<string>,
  column: string,
  fallback: string,
  alias = 'legacy',
): string {
  assertIdentifier(column)
  assertIdentifier(alias)
  return available.has(column) ? `${alias}."${column}"` : fallback
}

async function rebuildReceiptRegistrationsForF3(db: MigrationDb): Promise<void> {
  if (await columnExists(db, 'receipt_registrations', 'bank_serial_no'))
    return

  const available = await f3Columns(db, 'receipt_registrations')
  const no = available.has('no')
    ? f3Column(available, 'no', `''`)
    : f3Column(available, 'receipt_no', `''`)
  const customer = f3Column(available, 'customer_id', 'NULL')
  await db.execute('DROP TABLE IF EXISTS receipt_registrations_v22_new')
  await execScript(db, V22_RECEIPT_REGISTRATIONS_TABLE)
  await db.execute(`
    INSERT INTO receipt_registrations_v22_new (
      id, no, receipt_date, project_id, contract_id, customer_id,
      payer_account, amount, payment_method, acceptance_bill_no,
      bill_due_date, period_no, bank_serial_no, handler, review_status,
      status, note, created_at, updated_at, deleted_at
    )
    SELECT
      ${f3Column(available, 'id', `''`)},
      COALESCE(${no}, ''),
      COALESCE(${f3Column(available, 'receipt_date', `''`)}, ''),
      ${f3Column(available, 'project_id', 'NULL')},
      NULLIF(${f3Column(available, 'contract_id', 'NULL')}, ''),
      COALESCE(
        NULLIF(${customer}, ''),
        (
          SELECT project.customer_id
          FROM projects AS project
          WHERE project.id = ${f3Column(available, 'project_id', 'NULL')}
        )
      ),
      COALESCE(${f3Column(available, 'payer_account', `''`)}, ''),
      MAX(COALESCE(${f3Column(available, 'amount', '0')}, 0), 0),
      COALESCE(${f3Column(available, 'payment_method', `''`)}, ''),
      COALESCE(${f3Column(available, 'acceptance_bill_no', `''`)}, ''),
      COALESCE(${f3Column(available, 'bill_due_date', `''`)}, ''),
      COALESCE(${f3Column(available, 'period_no', `''`)}, ''),
      COALESCE(${f3Column(available, 'bank_serial_no', `''`)}, ''),
      COALESCE(${f3Column(available, 'handler', `''`)}, ''),
      COALESCE(${f3Column(available, 'review_status', `''`)}, ''),
      COALESCE(NULLIF(${f3Column(available, 'status', `''`)}, ''), 'submitted'),
      COALESCE(${f3Column(available, 'note', `''`)}, ''),
      COALESCE(${f3Column(available, 'created_at', `datetime('now')`)}, datetime('now')),
      COALESCE(${f3Column(available, 'updated_at', f3Column(available, 'created_at', `datetime('now')`))}, datetime('now')),
      ${f3Column(available, 'deleted_at', 'NULL')}
    FROM receipt_registrations AS legacy
  `)
  await db.execute('DROP TABLE receipt_registrations')
  await db.execute(
    'ALTER TABLE receipt_registrations_v22_new RENAME TO receipt_registrations',
  )
}

async function rebuildInvoiceApplicationsForF3(db: MigrationDb): Promise<void> {
  if (await columnExists(db, 'invoice_applications', 'buyer_name_snapshot'))
    return

  const available = await f3Columns(db, 'invoice_applications')
  const customer = f3Column(available, 'customer_id', 'NULL')
  const project = f3Column(available, 'project_id', 'NULL')
  await db.execute('DROP TABLE IF EXISTS invoice_applications_v22_new')
  await execScript(db, V22_INVOICE_APPLICATIONS_TABLE)
  await db.execute(`
    INSERT INTO invoice_applications_v22_new (
      id, no, name, project_id, contract_id, customer_id,
      buyer_name_snapshot, buyer_tax_no_snapshot, invoice_type,
      amount, tax_rate, tax_amount, invoice_content, invoice_remark,
      applicant, application_date, status, note, created_at, updated_at,
      deleted_at
    )
    SELECT
      ${f3Column(available, 'id', `''`)},
      COALESCE(${f3Column(available, 'no', `''`)}, ''),
      COALESCE(${f3Column(available, 'name', `''`)}, ''),
      ${project},
      NULLIF(${f3Column(available, 'contract_id', 'NULL')}, ''),
      COALESCE(
        NULLIF(${customer}, ''),
        (
          SELECT project_row.customer_id
          FROM projects AS project_row
          WHERE project_row.id = ${project}
        )
      ),
      COALESCE(
        NULLIF(${f3Column(available, 'buyer_name_snapshot', `''`)}, ''),
        (
          SELECT customer_row.name
          FROM customers AS customer_row
          WHERE customer_row.id = COALESCE(
            NULLIF(${customer}, ''),
            (
              SELECT project_row.customer_id
              FROM projects AS project_row
              WHERE project_row.id = ${project}
            )
          )
        ),
        ''
      ),
      COALESCE(
        NULLIF(${f3Column(available, 'buyer_tax_no_snapshot', `''`)}, ''),
        (
          SELECT customer_row.tax_no
          FROM customers AS customer_row
          WHERE customer_row.id = COALESCE(
            NULLIF(${customer}, ''),
            (
              SELECT project_row.customer_id
              FROM projects AS project_row
              WHERE project_row.id = ${project}
            )
          )
        ),
        ''
      ),
      COALESCE(${f3Column(available, 'invoice_type', `''`)}, ''),
      MAX(COALESCE(${f3Column(available, 'amount', '0')}, 0), 0),
      MAX(COALESCE(${f3Column(available, 'tax_rate', '0')}, 0), 0),
      MAX(COALESCE(${f3Column(available, 'tax_amount', '0')}, 0), 0),
      COALESCE(${f3Column(available, 'invoice_content', `''`)}, ''),
      COALESCE(${f3Column(available, 'invoice_remark', `''`)}, ''),
      COALESCE(${f3Column(available, 'applicant', `''`)}, ''),
      COALESCE(
        NULLIF(${f3Column(available, 'application_date', `''`)}, ''),
        ${f3Column(available, 'invoice_date', `''`)},
        ''
      ),
      COALESCE(NULLIF(${f3Column(available, 'status', `''`)}, ''), 'submitted'),
      COALESCE(${f3Column(available, 'note', `''`)}, ''),
      COALESCE(${f3Column(available, 'created_at', `datetime('now')`)}, datetime('now')),
      COALESCE(${f3Column(available, 'updated_at', f3Column(available, 'created_at', `datetime('now')`))}, datetime('now')),
      ${f3Column(available, 'deleted_at', 'NULL')}
    FROM invoice_applications AS legacy
  `)
  await db.execute('DROP TABLE invoice_applications')
  await db.execute(
    'ALTER TABLE invoice_applications_v22_new RENAME TO invoice_applications',
  )
}

async function migrateCurrentTransactionsForF3(db: MigrationDb): Promise<void> {
  await execScript(db, V22_CURRENT_TRANSACTIONS_TABLE)
  if (await f3TableExists(db, 'current_receipts')) {
    await db.execute(`
      INSERT OR IGNORE INTO current_transactions (
        id, no, direction, project_id, counterparty, amount,
        transaction_date, status, created_at, updated_at, deleted_at
      )
      SELECT
        receipt.id,
        COALESCE(receipt.receipt_no, ''),
        'receipt',
        receipt.project_id,
        COALESCE(receipt.payer, ''),
        MAX(COALESCE(receipt.amount, 0), 0),
        COALESCE(receipt.receipt_date, ''),
        'submitted',
        COALESCE(receipt.created_at, datetime('now')),
        COALESCE(receipt.created_at, datetime('now')),
        receipt.deleted_at
      FROM current_receipts AS receipt
    `)
    await db.execute('DROP TABLE current_receipts')
  }
  if (await f3TableExists(db, 'current_payments')) {
    await db.execute(`
      INSERT OR IGNORE INTO current_transactions (
        id, no, direction, project_id, counterparty, amount,
        payment_method, transaction_date, status,
        created_at, updated_at, deleted_at
      )
      SELECT
        payment.id,
        COALESCE(payment.payment_no, ''),
        'payment',
        payment.project_id,
        COALESCE(payment.payee, ''),
        MAX(COALESCE(payment.amount, 0), 0),
        COALESCE(payment.payment_method, ''),
        COALESCE(payment.payment_date, ''),
        COALESCE(NULLIF(payment.approval_status, ''), 'submitted'),
        COALESCE(payment.created_at, datetime('now')),
        COALESCE(payment.created_at, datetime('now')),
        payment.deleted_at
      FROM current_payments AS payment
    `)
    await db.execute('DROP TABLE current_payments')
  }
}

async function snapshotLegacyPaymentFactsForF3(db: MigrationDb): Promise<void> {
  await db.execute('DROP TABLE IF EXISTS f3_legacy_payment_links_v22')
  await db.execute(`
    CREATE TABLE f3_legacy_payment_links_v22 (
      payment_record_id TEXT PRIMARY KEY,
      payment_application_id TEXT,
      allocated_amount REAL NOT NULL DEFAULT 0
    )
  `)
  if (await columnExists(db, 'payment_records', 'payment_application_id')) {
    await db.execute(`
      INSERT INTO f3_legacy_payment_links_v22 (
        payment_record_id, payment_application_id, allocated_amount
      )
      SELECT id, NULLIF(payment_application_id, ''), MAX(COALESCE(amount, 0), 0)
      FROM payment_records
      WHERE payment_application_id IS NOT NULL
        AND TRIM(payment_application_id) <> ''
    `)
  }

  if (await columnExists(db, 'payment_applications', 'paid_amount')) {
    await db.execute(`
      INSERT OR IGNORE INTO reconciliation_issues (
        id, import_batch_id, project_id, entity_type, entity_id, field_name,
        source_value, metric_key, source_ref, excel_value, system_value,
        difference, attribution
      )
      SELECT
        'f3_payment_paid_' || application.id,
        ?,
        application.project_id,
        'payment_applications',
        application.id,
        'paid_amount',
        CAST(application.paid_amount AS TEXT),
        'payment_applications.paid_amount',
        'schema:v22:payment_applications:' || application.id,
        application.paid_amount,
        COALESCE((
          SELECT SUM(link.allocated_amount)
          FROM f3_legacy_payment_links_v22 AS link
          WHERE link.payment_application_id = application.id
        ), 0),
        application.paid_amount - COALESCE((
          SELECT SUM(link.allocated_amount)
          FROM f3_legacy_payment_links_v22 AS link
          WHERE link.payment_application_id = application.id
        ), 0),
        'legacy-manual-paid'
      FROM payment_applications AS application
      WHERE COALESCE(application.paid_amount, 0) > 0
    `, [F3_IMPORT_BATCH_ID])
  }
}

async function rebuildPaymentApplicationsForF3(db: MigrationDb): Promise<void> {
  if (await columnExists(db, 'payment_applications', 'biz_type'))
    return

  const available = await f3Columns(db, 'payment_applications')
  const no = available.has('no')
    ? f3Column(available, 'no', `''`)
    : f3Column(available, 'application_no', `''`)
  const applyAmount = available.has('apply_amount')
    ? f3Column(available, 'apply_amount', '0')
    : f3Column(available, 'amount', '0')
  const status = available.has('status')
    ? f3Column(available, 'status', `'draft'`)
    : f3Column(available, 'approval_status', `'draft'`)
  const project = f3Column(available, 'project_id', 'NULL')
  const contract = f3Column(available, 'contract_id', 'NULL')
  await db.execute('DROP TABLE IF EXISTS payment_applications_v22_new')
  await execScript(db, V22_PAYMENT_APPLICATIONS_TABLE)
  await db.execute(`
    INSERT INTO payment_applications_v22_new (
      id, no, name, biz_type, project_id, supplier_id, contract_id,
      cost_name, apply_amount, apply_date, applicant, invoice_state,
      pay_content, prepay_deduct, prepay_note, approved_amount,
      approval_note, status, note, external_ref, created_at, updated_at,
      deleted_at
    )
    SELECT
      ${f3Column(available, 'id', `''`)},
      COALESCE(${no}, ''),
      COALESCE(${f3Column(available, 'name', `''`)}, ''),
      COALESCE(
        NULLIF(${f3Column(available, 'biz_type', `''`)}, ''),
        CASE
          WHEN ${contract} IS NOT NULL AND TRIM(${contract}) <> '' THEN '有合同-其他'
          WHEN ${project} IS NULL OR TRIM(${project}) = '' THEN '公司付款'
          ELSE '项目费用'
        END
      ),
      NULLIF(${project}, ''),
      NULLIF(${f3Column(available, 'supplier_id', 'NULL')}, ''),
      NULLIF(${contract}, ''),
      COALESCE(${f3Column(available, 'cost_name', `''`)}, ''),
      MAX(COALESCE(${applyAmount}, 0), 0),
      COALESCE(
        NULLIF(${f3Column(available, 'apply_date', `''`)}, ''),
        SUBSTR(${f3Column(available, 'created_at', `''`)}, 1, 10),
        ''
      ),
      COALESCE(${f3Column(available, 'applicant', `''`)}, ''),
      CASE
        WHEN ${f3Column(available, 'invoice_state', `'先款后票'`)}
          IN ('先票后款', '先款后票', '无需发票')
        THEN ${f3Column(available, 'invoice_state', `'先款后票'`)}
        ELSE '先款后票'
      END,
      COALESCE(${f3Column(available, 'pay_content', `''`)}, ''),
      MAX(COALESCE(${f3Column(available, 'prepay_deduct', '0')}, 0), 0),
      COALESCE(${f3Column(available, 'prepay_note', `''`)}, ''),
      MAX(COALESCE(${f3Column(available, 'approved_amount', '0')}, 0), 0),
      COALESCE(${f3Column(available, 'approval_note', `''`)}, ''),
      COALESCE(NULLIF(${status}, ''), 'draft'),
      COALESCE(${f3Column(available, 'note', `''`)}, ''),
      COALESCE(${f3Column(available, 'external_ref', `''`)}, ''),
      COALESCE(${f3Column(available, 'created_at', `datetime('now')`)}, datetime('now')),
      COALESCE(${f3Column(available, 'updated_at', f3Column(available, 'created_at', `datetime('now')`))}, datetime('now')),
      ${f3Column(available, 'deleted_at', 'NULL')}
    FROM payment_applications AS legacy
  `)
  await db.execute('DROP TABLE payment_applications')
  await db.execute(
    'ALTER TABLE payment_applications_v22_new RENAME TO payment_applications',
  )
}

async function rebuildPaymentRecordsForF3(db: MigrationDb): Promise<void> {
  if (await columnExists(db, 'payment_records', 'confirmation_status'))
    return

  const available = await f3Columns(db, 'payment_records')
  const no = available.has('no')
    ? f3Column(available, 'no', `''`)
    : f3Column(available, 'payment_no', `''`)
  await db.execute('DROP TABLE IF EXISTS payment_records_v22_new')
  await execScript(db, V22_PAYMENT_RECORDS_TABLE)
  await db.execute(`
    INSERT INTO payment_records_v22_new (
      id, no, project_id, supplier_id, payee_name, purpose,
      payment_date, amount, payment_method, voucher_no, bank_serial_no,
      payee_account, payee_bank, payee_bank_account, handler, source,
      recognition_status, ocr_payload, field_confidence, confirmation_status,
      confirmed_by, confirmed_at, external_ref, note, created_at, updated_at, deleted_at
    )
    SELECT
      ${f3Column(available, 'id', `''`)},
      COALESCE(${no}, ''),
      NULLIF(${f3Column(available, 'project_id', 'NULL')}, ''),
      NULLIF(${f3Column(available, 'supplier_id', 'NULL')}, ''),
      COALESCE(
        NULLIF(${f3Column(available, 'payee_name', `''`)}, ''),
        ${f3Column(available, 'payee_account', `''`)},
        ''
      ),
      COALESCE(${f3Column(available, 'purpose', `''`)}, ''),
      COALESCE(${f3Column(available, 'payment_date', `''`)}, ''),
      MAX(COALESCE(${f3Column(available, 'amount', '0')}, 0), 0),
      COALESCE(${f3Column(available, 'payment_method', `''`)}, ''),
      COALESCE(${f3Column(available, 'voucher_no', `''`)}, ''),
      COALESCE(${f3Column(available, 'bank_serial_no', `''`)}, ''),
      COALESCE(${f3Column(available, 'payee_account', `''`)}, ''),
      COALESCE(${f3Column(available, 'payee_bank', `''`)}, ''),
      COALESCE(${f3Column(available, 'payee_bank_account', `''`)}, ''),
      COALESCE(${f3Column(available, 'handler', `''`)}, ''),
      CASE
        WHEN ${f3Column(available, 'source', `'manual'`)}
          IN ('manual', 'image_ocr', 'excel_import')
        THEN ${f3Column(available, 'source', `'manual'`)}
        ELSE 'manual'
      END,
      COALESCE(${f3Column(available, 'recognition_status', `'not_applicable'`)}, 'not_applicable'),
      COALESCE(${f3Column(available, 'ocr_payload', `'{}'`)}, '{}'),
      COALESCE(${f3Column(available, 'field_confidence', `'{}'`)}, '{}'),
      'needs_review',
      '',
      NULL,
      COALESCE(${f3Column(available, 'external_ref', `''`)}, ''),
      COALESCE(${f3Column(available, 'note', `''`)}, ''),
      COALESCE(${f3Column(available, 'created_at', `datetime('now')`)}, datetime('now')),
      COALESCE(${f3Column(available, 'updated_at', f3Column(available, 'created_at', `datetime('now')`))}, datetime('now')),
      ${f3Column(available, 'deleted_at', 'NULL')}
    FROM payment_records AS legacy
  `)
  await db.execute('DROP TABLE payment_records')
  await db.execute('ALTER TABLE payment_records_v22_new RENAME TO payment_records')
}

async function snapshotAndRebuildExpenseReimbursementsForF3(
  db: MigrationDb,
): Promise<void> {
  await db.execute('DROP TABLE IF EXISTS f3_legacy_reimbursement_amounts_v22')
  await db.execute(`
    CREATE TABLE f3_legacy_reimbursement_amounts_v22 (
      reimbursement_id TEXT PRIMARY KEY,
      project_id TEXT,
      amount REAL,
      issue_reason TEXT NOT NULL DEFAULT ''
    )
  `)

  if (!await f3TableExists(db, 'expense_reimbursements')) {
    await execScript(db, V22_EXPENSE_REIMBURSEMENTS_TABLE)
    await db.execute(
      'ALTER TABLE expense_reimbursements_v22_new RENAME TO expense_reimbursements',
    )
    return
  }
  if (await columnExists(db, 'expense_reimbursements', 'category'))
    return

  const available = await f3Columns(db, 'expense_reimbursements')
  const legacyAmount = f3Column(available, 'amount', 'NULL')
  const legacyApplicant = f3Column(available, 'applicant', `''`)
  const legacyDate = available.has('reimbursement_date')
    ? f3Column(available, 'reimbursement_date', `''`)
    : f3Column(available, 'date', `''`)
  await db.execute(`
    INSERT INTO f3_legacy_reimbursement_amounts_v22 (
      reimbursement_id, project_id, amount, issue_reason
    )
    SELECT
      id,
      ${f3Column(available, 'project_id', 'NULL')},
      ${legacyAmount},
      CASE
        WHEN ${legacyAmount} IS NULL OR ${legacyAmount} <= 0
          THEN 'legacy-missing-or-nonpositive-amount'
        WHEN TRIM(COALESCE(${legacyApplicant}, '')) = ''
          OR TRIM(COALESCE(${legacyDate}, '')) = ''
          THEN 'legacy-incomplete-head'
        ELSE ''
      END
    FROM expense_reimbursements AS legacy
  `)

  await db.execute('DROP TABLE IF EXISTS expense_reimbursements_v22_new')
  await execScript(db, V22_EXPENSE_REIMBURSEMENTS_TABLE)
  await db.execute(`
    INSERT INTO expense_reimbursements_v22_new (
      id, no, project_id, applicant, category, reimbursement_date,
      invoice_count, reason, status, note, external_ref,
      created_at, updated_at, deleted_at
    )
    SELECT
      ${f3Column(available, 'id', `''`)},
      COALESCE(${f3Column(available, 'no', `''`)}, ''),
      NULLIF(${f3Column(available, 'project_id', 'NULL')}, ''),
      COALESCE(${f3Column(available, 'applicant', `''`)}, ''),
      COALESCE(${f3Column(available, 'category', `''`)}, ''),
      COALESCE(
        NULLIF(${f3Column(available, 'reimbursement_date', `''`)}, ''),
        ${f3Column(available, 'date', `''`)},
        ''
      ),
      MAX(COALESCE(${f3Column(available, 'invoice_count', '0')}, 0), 0),
      COALESCE(${f3Column(available, 'reason', `''`)}, ''),
      COALESCE(NULLIF(${f3Column(available, 'status', `''`)}, ''), 'submitted'),
      COALESCE(${f3Column(available, 'note', `''`)}, ''),
      COALESCE(${f3Column(available, 'external_ref', `''`)}, ''),
      COALESCE(${f3Column(available, 'created_at', `datetime('now')`)}, datetime('now')),
      COALESCE(${f3Column(available, 'updated_at', f3Column(available, 'created_at', `datetime('now')`))}, datetime('now')),
      ${f3Column(available, 'deleted_at', 'NULL')}
    FROM expense_reimbursements AS legacy
  `)
  await db.execute('DROP TABLE expense_reimbursements')
  await db.execute(
    'ALTER TABLE expense_reimbursements_v22_new RENAME TO expense_reimbursements',
  )
}

async function migrateF3ChildFacts(db: MigrationDb): Promise<void> {
  await execScript(db, V22_F3_CHILD_TABLES)
  await db.execute(`
    INSERT OR IGNORE INTO reconciliation_issues (
      id, import_batch_id, project_id, entity_type, entity_id, field_name,
      source_value, metric_key, source_ref, excel_value, system_value,
      difference, attribution
    )
    SELECT
      'f3_payment_link_' || link.payment_record_id,
      ?,
      COALESCE(payment.project_id, application.project_id),
      'payment_records',
      link.payment_record_id,
      'payment_application_id',
      COALESCE(link.payment_application_id, ''),
      'payment_records.payment_application_id',
      'schema:v22:payment_records:' || link.payment_record_id,
      link.allocated_amount,
      0,
      link.allocated_amount,
      CASE
        WHEN payment.id IS NULL THEN 'legacy-orphan-payment-record'
        WHEN application.id IS NULL THEN 'legacy-orphan-payment-application'
        ELSE 'legacy-nonpositive-payment-allocation'
      END
    FROM f3_legacy_payment_links_v22 AS link
    LEFT JOIN payment_records AS payment
      ON payment.id = link.payment_record_id
    LEFT JOIN payment_applications AS application
      ON application.id = link.payment_application_id
    WHERE payment.id IS NULL
       OR application.id IS NULL
       OR link.allocated_amount <= 0
  `, [F3_IMPORT_BATCH_ID])
  await db.execute(`
    INSERT OR IGNORE INTO payment_record_application_allocations (
      id, payment_record_id, payment_application_id, allocated_amount, note
    )
    SELECT
      'f3_legacy_payment_allocation_' || link.payment_record_id,
      link.payment_record_id,
      link.payment_application_id,
      link.allocated_amount,
      'v22 由旧单一付款申请引用迁移'
    FROM f3_legacy_payment_links_v22 AS link
    JOIN payment_records AS payment
      ON payment.id = link.payment_record_id
    JOIN payment_applications AS application
      ON application.id = link.payment_application_id
    WHERE link.allocated_amount > 0
  `)
  await db.execute(`
    INSERT OR IGNORE INTO expense_reimbursement_lines (
      id, reimbursement_id, expense_item, amount, note
    )
    SELECT
      'f3_legacy_reimbursement_line_' || legacy.reimbursement_id,
      legacy.reimbursement_id,
      '迁移汇总',
      legacy.amount,
      'v22 由旧报销头金额迁移；后续人工拆分明细'
    FROM f3_legacy_reimbursement_amounts_v22 AS legacy
    JOIN expense_reimbursements AS reimbursement
      ON reimbursement.id = legacy.reimbursement_id
    WHERE legacy.amount > 0
  `)
  await db.execute(`
    INSERT OR IGNORE INTO reconciliation_issues (
      id, import_batch_id, project_id, entity_type, entity_id, field_name,
      source_value, metric_key, source_ref, excel_value, system_value,
      difference, attribution
    )
    SELECT
      'f3_reimbursement_amount_' || legacy.reimbursement_id,
      ?,
      legacy.project_id,
      'expense_reimbursements',
      legacy.reimbursement_id,
      'amount',
      CAST(COALESCE(legacy.amount, 0) AS TEXT),
      'expense_reimbursements.amount',
      'schema:v22:expense_reimbursements:' || legacy.reimbursement_id,
      COALESCE(legacy.amount, 0),
      CASE WHEN legacy.amount > 0 THEN legacy.amount ELSE 0 END,
      0,
      CASE
        WHEN legacy.issue_reason <> '' THEN legacy.issue_reason
        ELSE 'legacy-head-to-line'
      END
    FROM f3_legacy_reimbursement_amounts_v22 AS legacy
  `, [F3_IMPORT_BATCH_ID])
  await db.execute('DROP TABLE f3_legacy_payment_links_v22')
  await db.execute('DROP TABLE f3_legacy_reimbursement_amounts_v22')
}

async function migrateF3FinanceForms(db: MigrationDb): Promise<void> {
  await db.execute('PRAGMA foreign_keys = OFF')
  let transactionStarted = false
  try {
    await db.execute('BEGIN IMMEDIATE')
    transactionStarted = true
    await db.execute(`
      INSERT INTO import_batches (
        id, project_id, source_file, source_hash, status, completed_at
      )
      VALUES (?, NULL, 'schema:v22', 'f3-finance-forms-reconciliation', 'running', NULL)
      ON CONFLICT(id) DO UPDATE SET
        status = 'running',
        completed_at = NULL
    `, [F3_IMPORT_BATCH_ID])

    await rebuildReceiptRegistrationsForF3(db)
    await rebuildInvoiceApplicationsForF3(db)
    await migrateCurrentTransactionsForF3(db)
    await snapshotLegacyPaymentFactsForF3(db)
    await rebuildPaymentApplicationsForF3(db)
    await rebuildPaymentRecordsForF3(db)
    await snapshotAndRebuildExpenseReimbursementsForF3(db)
    await migrateF3ChildFacts(db)
    const [indexSql, ...triggerSql] = V22_F3_INDEXES_AND_TRIGGERS
      .split(/\n(?=CREATE TRIGGER)/)
    await execScript(db, indexSql ?? '')
    for (const trigger of triggerSql)
      await db.execute(trigger.trim())

    const foreignKeyIssues = await db.select<{ table: string }>(
      'PRAGMA foreign_key_check',
    )
    if (foreignKeyIssues.length > 0)
      throw new Error('[db] F3 迁移后存在无效外键')

    await db.execute(`
      UPDATE import_batches
      SET status = 'completed', completed_at = datetime('now')
      WHERE id = ?
    `, [F3_IMPORT_BATCH_ID])
    await db.execute('COMMIT')
    transactionStarted = false
  }
  catch (error) {
    if (transactionStarted) {
      try {
        await db.execute('ROLLBACK')
      }
      catch {
        // 保留原始迁移错误。
      }
    }
    throw error
  }
  finally {
    await db.execute('PRAGMA foreign_keys = ON')
  }
}

/**
 * v27 内置工序库的冻结种子。迁移是历史事实，后续调整标准工序必须新增版本，
 * 不得修改这份 v1 快照，否则旧库与新库会得到不同结果。
 */
const V27_DECORATION_PROCESS_TASKS = [
  ['setting-out', '放线及新建墙体', 30, '泥水工', '#8b5cf6', '', '[]'],
  ['plumbing', '给排水安装', 30, '水暖工', '#f59e0b', '', '[]'],
  ['waterproof', '卫生间回填及防水', 30, '防水工', '#06b6d4', 'WP-02', '["WP-WALL","WP-FLOOR"]'],
  ['wiring', '电线敷设', 30, '水电工', '#f59e0b', '', '[]'],
  ['air-conditioning', '空调安装（天花机）', 18, '水电工', '#f59e0b', '', '[]'],
  ['ceiling', '天花龙骨及封板（含楼梯）', 30, '木工', '#d97706', 'CEILING', '["DEC-CEILING"]'],
  ['leveling', '水泥沙找平', 18, '泥水工', '#6366f1', 'LEVELING', '["DEC-LEVELING"]'],
  ['gypsum-line', '石膏线安装', 18, '油漆工', '#10b981', 'GYPSUM-LINE', '["DEC-GYPSUM-LINE"]'],
  ['wall-tile', '墙砖粘贴', 50, '泥水工', '#6366f1', 'MASON-WALL', '["DEC-WALL-TILE"]'],
  ['floor-tile', '地砖铺贴', 30, '泥水工', '#4f46e5', 'MASON-FLOOR', '["DEC-FLOOR-TILE"]'],
  ['putty-1', '天花及墙身一遍腻子', 20, '油漆工', '#10b981', 'PUTTY-01', '["DEC-PUTTY"]'],
  ['putty-2', '天花及墙身二遍腻子', 20, '油漆工', '#10b981', 'PUTTY-02', '["DEC-PUTTY"]'],
  ['doors', '户内门安装', 18, '木工', '#d97706', '', '[]'],
  ['wood-floor', '木地板安装', 25, '木工', '#d97706', 'WOOD-FLOOR', '["DEC-WOOD-FLOOR"]'],
  ['latex-paint', '天花及墙身乳胶漆', 30, '油漆工', '#059669', 'LATEX-PAINT', '["DEC-LATEX-PAINT"]'],
  ['aluminum-ceiling', '铝扣板安装', 20, '干挂工', '#0ea5e9', 'ALUMINUM-CEILING', '["DEC-ALUMINUM-CEILING"]'],
  ['kitchen-cabinet', '橱柜安装', 20, '木工', '#d97706', '', '[]'],
  ['fixed-cabinet', '固装柜子安装', 25, '木工', '#d97706', '', '[]'],
  ['finishing-paint', '收口石膏线及油漆', 10, '油漆工', '#10b981', '', '[]'],
  ['switch-light', '开关插座及灯具安装', 20, '水电工', '#f59e0b', '', '[]'],
  ['sanitary-hardware', '五金洁具安装', 20, '水电工', '#f59e0b', '', '[]'],
  ['cleaning', '开荒保洁', 8, '杂工', '#9ca3af', '', '[]'],
] as const

async function migrateScheduleProcessLibraryV27(db: MigrationDb): Promise<void> {
  await execScript(db, `
    CREATE TABLE IF NOT EXISTS schedule_process_libraries (
      id          TEXT PRIMARY KEY,
      code        TEXT NOT NULL,
      name        TEXT NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      description TEXT NOT NULL DEFAULT '',
      is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at  TEXT DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS schedule_process_library_tasks (
      id              TEXT PRIMARY KEY,
      library_id      TEXT NOT NULL REFERENCES schedule_process_libraries(id),
      task_key        TEXT NOT NULL,
      name            TEXT NOT NULL,
      trade           TEXT NOT NULL DEFAULT '',
      color           TEXT NOT NULL DEFAULT '#64748b',
      duration_days   INTEGER NOT NULL DEFAULT 1 CHECK (duration_days > 0),
      stage_code      TEXT NOT NULL DEFAULT '',
      item_codes_json TEXT NOT NULL DEFAULT '[]',
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at      TEXT DEFAULT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_process_library_code_version
      ON schedule_process_libraries(code, version)
      WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_process_default
      ON schedule_process_libraries(is_default)
      WHERE deleted_at IS NULL AND is_default = 1;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_process_library_task_key
      ON schedule_process_library_tasks(library_id, task_key)
      WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_schedule_process_library_tasks_library
      ON schedule_process_library_tasks(library_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_schedule_process_libraries_deleted
      ON schedule_process_libraries(deleted_at)
      WHERE deleted_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_schedule_process_library_tasks_deleted
      ON schedule_process_library_tasks(deleted_at)
      WHERE deleted_at IS NOT NULL;
  `)

  await addColumnIfMissing(
    db,
    'schedule_groups',
    'scope_basis',
    `TEXT CHECK (scope_basis IN ('contract', 'provisional'))`,
  )
  await addColumnIfMissing(db, 'schedule_groups', 'contract_bound_at', 'TEXT')
  await addColumnIfMissing(db, 'schedule_groups', 'process_library_id', 'TEXT')
  await addColumnIfMissing(db, 'schedule_groups', 'process_library_name_snapshot', `TEXT NOT NULL DEFAULT ''`)
  await addColumnIfMissing(db, 'schedule_groups', 'process_library_version_snapshot', 'INTEGER')
  await addColumnIfMissing(db, 'schedule_tasks', 'source_library_task_id', 'TEXT')
  await addColumnIfMissing(db, 'schedule_tasks', 'source_library_version', 'INTEGER')
  await addColumnIfMissing(db, 'schedule_tasks', 'template_snapshot_json', `TEXT NOT NULL DEFAULT '{}'`)

  await db.execute(`
    UPDATE schedule_groups
    SET scope_basis = CASE WHEN contract_id IS NULL THEN 'provisional' ELSE 'contract' END
  `)

  await db.execute('DROP TRIGGER IF EXISTS trg_schedule_group_scope_insert')
  await db.execute('DROP TRIGGER IF EXISTS trg_schedule_group_scope_update')
  await db.execute(`
    CREATE TRIGGER trg_schedule_group_scope_insert
    BEFORE INSERT ON schedule_groups
    WHEN NEW.scope_basis IS NOT NULL
      AND (
        (NEW.scope_basis = 'contract' AND NEW.contract_id IS NULL)
        OR (NEW.scope_basis = 'provisional' AND NEW.contract_id IS NOT NULL)
      )
    BEGIN
      SELECT RAISE(ABORT, 'schedule scope basis mismatch');
    END
  `)
  await db.execute(`
    CREATE TRIGGER trg_schedule_group_scope_update
    BEFORE UPDATE OF scope_basis, contract_id ON schedule_groups
    WHEN NEW.scope_basis IS NOT NULL
      AND (
        (NEW.scope_basis = 'contract' AND NEW.contract_id IS NULL)
        OR (NEW.scope_basis = 'provisional' AND NEW.contract_id IS NOT NULL)
      )
    BEGIN
      SELECT RAISE(ABORT, 'schedule scope basis mismatch');
    END
  `)
  await execScript(db, `
    CREATE INDEX IF NOT EXISTS idx_schedule_groups_scope_basis
      ON schedule_groups(project_id, scope_basis);
    CREATE INDEX IF NOT EXISTS idx_schedule_groups_process_library
      ON schedule_groups(process_library_id);
  `)

  const libraryId = 'schedule_process_library_decoration_v1'
  await db.execute(`
    INSERT INTO schedule_process_libraries
      (id, code, name, version, description, is_default, sort_order)
    VALUES (?, 'decoration-standard-v1', '精装修标准工序', 1, '22 道精装修标准工序', 1, 10)
    ON CONFLICT(id) DO NOTHING
  `, [libraryId])
  for (const [index, task] of V27_DECORATION_PROCESS_TASKS.entries()) {
    const [key, name, durationDays, trade, color, stageCode, itemCodesJson] = task
    await db.execute(`
      INSERT INTO schedule_process_library_tasks
        (id, library_id, task_key, name, trade, color, duration_days,
         stage_code, item_codes_json, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `, [
      `schedule_process_library_task_${key}`,
      libraryId,
      key,
      name,
      trade,
      color,
      durationDays,
      stageCode,
      itemCodesJson,
      (index + 1) * 10,
    ])
  }

  await db.execute(`
    UPDATE schedule_groups
    SET process_library_id = ?,
        process_library_name_snapshot = '精装修标准工序',
        process_library_version_snapshot = 1
    WHERE process_library_id IS NULL
  `, [libraryId])
}

async function migratePayrollAuditV29(db: MigrationDb): Promise<void> {
  await addColumnIfMissing(
    db,
    'wage_statements',
    'format_family',
    `TEXT NOT NULL DEFAULT 'A' CHECK (format_family IN ('A', 'B', 'C1', 'C2'))`,
  )
  await addColumnIfMissing(
    db,
    'wage_statements',
    'period_kind',
    `TEXT NOT NULL DEFAULT 'monthly' CHECK (period_kind IN ('monthly', 'settlement', 'retention'))`,
  )
  await addColumnIfMissing(
    db,
    'wage_statements',
    'needs_recheck',
    `INTEGER NOT NULL DEFAULT 0 CHECK (needs_recheck IN (0, 1))`,
  )
  await addColumnIfMissing(db, 'wage_statements', 'cumulative_amount', 'REAL NOT NULL DEFAULT 0')
  await addColumnIfMissing(db, 'wage_statements', 'previously_paid', 'REAL NOT NULL DEFAULT 0')
  await addColumnIfMissing(db, 'wage_statements', 'source_version', `TEXT NOT NULL DEFAULT ''`)
  await addColumnIfMissing(db, 'wage_statements', 'source_updated_at', 'TEXT')
  await addColumnIfMissing(db, 'wage_statements', 'checked_source_version', `TEXT NOT NULL DEFAULT ''`)
  await addColumnIfMissing(db, 'wage_statements', 'adjustment_reason', `TEXT NOT NULL DEFAULT ''`)
  await addColumnIfMissing(db, 'wage_statements', 'operator_name', `TEXT NOT NULL DEFAULT ''`)
  await addColumnIfMissing(db, 'wage_statements', 'submitted_at', 'TEXT')
  await execScript(db, `
    CREATE TABLE IF NOT EXISTS wage_statement_members (
      id            TEXT PRIMARY KEY,
      statement_id  TEXT NOT NULL REFERENCES wage_statements(id),
      worker_id     TEXT NOT NULL REFERENCES workers(id),
      is_leader     INTEGER NOT NULL DEFAULT 0 CHECK (is_leader IN (0, 1)),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at    TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wage_statement_members_statement
      ON wage_statement_members(statement_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_wage_statement_member
      ON wage_statement_members(statement_id, worker_id)
      WHERE deleted_at IS NULL;
    DROP INDEX IF EXISTS uq_wage_statement_book_month;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_wage_statement_book_period
      ON wage_statements(project_id, leader_worker_id, month, format_family, period_kind)
      WHERE deleted_at IS NULL;
  `)
  await db.execute(`
    INSERT OR IGNORE INTO wage_statement_members (id, statement_id, worker_id, is_leader)
    SELECT 'wage_member_' || id, id, leader_worker_id, 1
    FROM wage_statements
    WHERE deleted_at IS NULL
  `)
}

/**
 * 全部迁移，按 version 升序执行。新增 schema 变更 = 追加一个更高 version 的条目。
 * v1 为基线：全量建表（全部 IF NOT EXISTS），对「已有表但无版本记录」的存量库同样收敛。
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'baseline-full-schema',
    async up(db) {
      await execScript(db, ALL_SCHEMA)
    },
  },
  {
    version: 2,
    name: 'soft-delete-operation-logs',
    async up(db) {
      for (const t of V2_TABLES) {
        await addColumnIfMissing(db, t, 'deleted_at', 'TEXT DEFAULT NULL')
        // 部分索引:已删记录天然稀少,隐藏集 CTE 的基础臂从全表扫描降为 O(已删数)
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_${t}_deleted ON "${t}"(deleted_at) WHERE deleted_at IS NOT NULL;`,
        )
      }
      // 自引用递归 CTE(hidden_suppliers)按父列查找,补索引
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_suppliers_parent ON suppliers(parent_supplier_id);',
      )
      await execScript(db, V2_OPERATION_LOGS)
    },
  },
  {
    version: 3,
    name: 'contracts-light-entity',
    async up(db) {
      await execScript(db, V3_CONTRACTS)
    },
  },
  {
    // 发票归属铁律(ADR-0001/#57):owner_kind 非空才允许归档(account_status='archived')。
    // contract_id 仅预留(#57 范围不做外键关联);print_count 供后续打印功能(#64)累计;
    // archived_at 与既有 confirmed_at 对称,记录归档动作的独立时间点(确认≠归档,两者是不同阶段)。
    // account_status 同轮从三态(含旧值 'confirmed')收窄为两态('none'|'archived',见 stores/invoice.ts)——
    // 存量库(Tauri 持久化 sqlite 文件,非纯内存)可能已有 'confirmed' 行,回填为 'none'（对应新语义
    // "已确认待归档"，与新代码的 reviewStatus='reviewed' 组合一致，不会丢数据/凭空从台账消失）。
    version: 4,
    name: 'invoices-owner-kind-archive',
    async up(db) {
      await addColumnIfMissing(db, 'invoices', 'owner_kind', 'TEXT DEFAULT NULL')
      await addColumnIfMissing(db, 'invoices', 'contract_id', 'TEXT DEFAULT NULL')
      await addColumnIfMissing(db, 'invoices', 'print_count', 'INTEGER DEFAULT 0')
      await addColumnIfMissing(db, 'invoices', 'archived_at', 'TEXT DEFAULT NULL')
      await db.execute(`UPDATE invoices SET account_status = 'none' WHERE account_status = 'confirmed'`)
    },
  },
  {
    // 发票识别工作台(#60):货物明细行(OCR 提取,JSON 数组,对齐 suppliers.aliases 的 JSON 文本先例)
    // + 逐字段置信度(JSON 对象 {字段名:0~1},字段校对模式的边框色/角标/✓确认 依据;
    // 全局 ocr_confidence 保留作汇总展示,两者口径不同不合并)。
    version: 5,
    name: 'invoices-items-field-confidence',
    async up(db) {
      await addColumnIfMissing(db, 'invoices', 'items', `TEXT DEFAULT '[]'`)
      await addColumnIfMissing(db, 'invoices', 'field_confidence', `TEXT DEFAULT '{}'`)
    },
  },
  {
    // 项目红圈化列表/表单(#58/#59):执行经理、施工员两个源字段(设计稿 ProjectScreen.jsx
    // 列表列 execManager/builder + 编辑表单字段)。存量库补列,新库由 v1 基线自带。
    version: 6,
    name: 'projects-exec-manager-builder',
    async up(db) {
      await addColumnIfMissing(db, 'projects', 'exec_manager', `TEXT DEFAULT ''`)
      await addColumnIfMissing(db, 'projects', 'builder', `TEXT DEFAULT ''`)
    },
  },
  {
    version: 7,
    name: 'delivery-records-pass-1',
    async up(db) {
      await execScript(db, V7_DELIVERY_RECORDS)
    },
  },
  {
    version: 8,
    name: 'project-aliases',
    async up(db) {
      await execScript(db, V8_PROJECT_ALIASES)
    },
  },
  {
    // 送货明细金额来源：自动计算行重开后继续联动；OCR/人工金额保持独立值。
    // 存量行无法可靠反推来源，统一按 manual 冻结，避免升级后静默覆盖已复核金额。
    version: 9,
    name: 'delivery-lines-amount-source',
    async up(db) {
      await addColumnIfMissing(db, 'delivery_lines', 'amount_source', `TEXT NOT NULL DEFAULT 'manual'`)
    },
  },
  {
    version: 10,
    name: 'delivery-source-file-payloads',
    async up(db) {
      await addColumnIfMissing(db, 'file_refs', 'mime_type', `TEXT DEFAULT ''`)
      await execScript(db, V10_DELIVERY_SOURCE_FILES)
    },
  },
  {
    // ADR 0005：外部旧 ID 是迁移对账/二次修正/去重键；空值不参与唯一约束。
    version: 11,
    name: 'suppliers-external-reference',
    async up(db) {
      await addColumnIfMissing(db, 'suppliers', 'external_ref', `TEXT DEFAULT ''`)
      await db.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_external_ref
        ON suppliers(external_ref)
        WHERE external_ref <> '' AND deleted_at IS NULL;
      `)
    },
  },
  {
    version: 12,
    name: 'quantity-matrix-foundation',
    async up(db) {
      await addColumnIfMissing(db, 'projects', 'matrix_archived_at', 'TEXT DEFAULT NULL')
      await execScript(db, V12_QUANTITY_FOUNDATION)
      await db.execute(V12_CREATE_WHOLE_UNIT_ROOM)
      await db.execute(V12_PROTECT_WHOLE_UNIT_ROOM)
    },
  },
  {
    version: 13,
    name: 'quantity-reporting-stage-mapping',
    async up(db) {
      await addColumnIfMissing(
        db,
        'construction_stage_items',
        'is_reporting_stage',
        'INTEGER NOT NULL DEFAULT 0 CHECK (is_reporting_stage IN (0, 1))',
      )
      // 存量库没有显式映射：一次性选择排序最末的活跃阶段作为兼容默认，之后由字段明确维护。
      await db.execute('UPDATE construction_stage_items SET is_reporting_stage = 0')
      await db.execute(`
        UPDATE construction_stage_items AS target
        SET is_reporting_stage = 1
        WHERE target.deleted_at IS NULL
          AND target.id = (
            SELECT candidate.id
            FROM construction_stage_items candidate
            JOIN construction_stages stage ON stage.id = candidate.stage_id
            JOIN items item ON item.id = candidate.item_id
            JOIN projects project ON project.id = item.project_id
            WHERE candidate.item_id = target.item_id
              AND candidate.deleted_at IS NULL
              AND stage.deleted_at IS NULL
              AND item.deleted_at IS NULL
              AND project.deleted_at IS NULL
            ORDER BY stage.sort_order DESC, stage.code DESC, candidate.id DESC
            LIMIT 1
          )
      `)
      await db.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_item_reporting
        ON construction_stage_items(item_id)
        WHERE deleted_at IS NULL AND is_reporting_stage = 1
      `)
    },
  },
  {
    version: 14,
    name: 'schedule-foundation',
    async up(db) {
      await execScript(db, V14_SCHEDULE_FOUNDATION)
    },
  },
  {
    version: 15,
    name: 'boq-change-monthly-foundation',
    async up(db) {
      // 合同域 canonical ID 已由 contracts store 持有；旧 IA 施工合同仅作为兼容迁移来源。
      await db.execute(`
        INSERT INTO contracts
          (id, no, name, kind, project_id, amount, changed, sign_date, status, created_at, updated_at)
        SELECT
          legacy.id,
          legacy.contract_no,
          legacy.name,
          '施工',
          legacy.project_id,
          legacy.amount,
          legacy.amount,
          legacy.sign_date,
          legacy.status,
          legacy.created_at,
          legacy.updated_at
        FROM construction_contracts AS legacy
        WHERE legacy.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM contracts AS canonical
            WHERE canonical.deleted_at IS NULL
              AND canonical.kind = '施工'
              AND canonical.project_id = legacy.project_id
              AND (
                (legacy.contract_no <> '' AND canonical.no = legacy.contract_no)
                OR canonical.name = legacy.name
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM contracts AS same_id WHERE same_id.id = legacy.id
          )
      `)

      await execScript(db, V15_BOQ_FOUNDATION)
      await addColumnIfMissing(
        db,
        'house_type_template_items',
        'boq_line_id',
        'TEXT REFERENCES boq_lines(id)',
      )
      await addColumnIfMissing(
        db,
        'schedule_groups',
        'contract_id',
        'TEXT REFERENCES contracts(id)',
      )
      await addColumnIfMissing(
        db,
        'task_item_map',
        'boq_line_id',
        'TEXT REFERENCES boq_lines(id)',
      )
      await addColumnIfMissing(db, 'owner_change_orders', 'source_type', `TEXT NOT NULL DEFAULT 'manual'`)
      await addColumnIfMissing(db, 'owner_change_orders', 'source_id', 'TEXT')
      await addColumnIfMissing(
        db,
        'owner_change_orders',
        'source_locked',
        'INTEGER NOT NULL DEFAULT 0 CHECK (source_locked IN (0, 1))',
      )

      await db.execute(`
        UPDATE schedule_groups
        SET contract_id = (
          SELECT MIN(contract.id)
          FROM contracts AS contract
          WHERE contract.project_id = schedule_groups.project_id
            AND contract.kind = '施工'
            AND contract.deleted_at IS NULL
        )
        WHERE contract_id IS NULL
          AND (
            SELECT COUNT(*)
            FROM contracts AS contract
            WHERE contract.project_id = schedule_groups.project_id
              AND contract.kind = '施工'
              AND contract.deleted_at IS NULL
          ) = 1
      `)

      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_hti_boq_line
          ON house_type_template_items(boq_line_id);
      `)
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_schedule_groups_contract
          ON schedule_groups(contract_id);
      `)
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_task_item_map_boq_line
          ON task_item_map(boq_line_id);
      `)
      await db.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_change_order_boq_source
          ON owner_change_orders(source_type, source_id)
          WHERE deleted_at IS NULL
            AND source_type = 'boq_change_order'
            AND source_id IS NOT NULL;
      `)
    },
  },
  {
    // v15 已发布后的变更新增行补充：审批物化为 boq_lines 时必须保留标准分项与目录语义。
    version: 16,
    name: 'boq-change-added-line-metadata',
    async up(db) {
      await addColumnIfMissing(db, 'boq_change_lines', 'item_id', 'TEXT REFERENCES items(id)')
      await addColumnIfMissing(db, 'boq_change_lines', 'section', `TEXT NOT NULL DEFAULT ''`)
      await addColumnIfMissing(db, 'boq_change_lines', 'trade', `TEXT NOT NULL DEFAULT ''`)
      await addColumnIfMissing(db, 'boq_change_lines', 'spec', `TEXT NOT NULL DEFAULT ''`)
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_boq_change_lines_item
        ON boq_change_lines(item_id);
      `)
    },
  },
  {
    version: 17,
    name: 'schedule-floor-plan-allocation',
    async up(db) {
      await execScript(db, V17_SCHEDULE_FLOOR_PLANS)
    },
  },
  {
    version: 18,
    name: 'item-unit-price-library',
    async up(db) {
      await execScript(db, V18_ITEM_UNIT_PRICES)
    },
  },
  {
    version: 19,
    name: 'f1-master-data',
    async up(db) {
      await db.execute('BEGIN IMMEDIATE')
      try {
        await execScript(db, V19_F1_TABLES)

        await addColumnIfMissing(db, 'suppliers', 'contact_title', `TEXT NOT NULL DEFAULT ''`)
        await addColumnIfMissing(db, 'suppliers', 'credential_reviewed_at', 'TEXT')
        await addColumnIfMissing(db, 'suppliers', 'credential_review_note', `TEXT NOT NULL DEFAULT ''`)

        await addColumnIfMissing(
          db,
          'crews',
          'default_pay_ratio',
          'REAL NOT NULL DEFAULT 0.95 CHECK (default_pay_ratio BETWEEN 0 AND 1)',
        )
        await addColumnIfMissing(
          db,
          'crews',
          'rent_subsidy_enabled',
          'INTEGER NOT NULL DEFAULT 0 CHECK (rent_subsidy_enabled IN (0, 1))',
        )
        await addColumnIfMissing(db, 'crews', 'rent_subsidy_price', 'REAL CHECK (rent_subsidy_price IS NULL OR rent_subsidy_price >= 0)')
        await addColumnIfMissing(
          db,
          'crews',
          'mgmt_fee_enabled',
          'INTEGER NOT NULL DEFAULT 0 CHECK (mgmt_fee_enabled IN (0, 1))',
        )
        await addColumnIfMissing(db, 'crews', 'mgmt_fee_price', 'REAL CHECK (mgmt_fee_price IS NULL OR mgmt_fee_price >= 0)')
        await addColumnIfMissing(
          db,
          'crews',
          'assignment_level',
          `TEXT NOT NULL DEFAULT 'crew' CHECK (assignment_level IN ('crew', 'worker'))`,
        )
        await addColumnIfMissing(db, 'crews', 'status', `TEXT NOT NULL DEFAULT 'draft'`)
        await addColumnIfMissing(db, 'crews', 'updated_at', `TEXT NOT NULL DEFAULT ''`)

        await addColumnIfMissing(db, 'workers', 'bank_name', `TEXT NOT NULL DEFAULT ''`)
        await addColumnIfMissing(db, 'workers', 'bank_account', `TEXT NOT NULL DEFAULT ''`)
        await addColumnIfMissing(db, 'workers', 'bank_code', `TEXT NOT NULL DEFAULT ''`)
        await addColumnIfMissing(db, 'workers', 'current_project_id', 'TEXT REFERENCES projects(id)')
        await addColumnIfMissing(db, 'workers', 'family_group_id', 'TEXT')
        await addColumnIfMissing(db, 'workers', 'status', `TEXT NOT NULL DEFAULT 'draft'`)

        await addColumnIfMissing(db, 'projects', 'customer_id', 'TEXT REFERENCES customers(id)')
        await addColumnIfMissing(db, 'projects', 'secondary_customer_id', 'TEXT REFERENCES customers(id)')
        await addColumnIfMissing(db, 'projects', 'developer_supervisor', `TEXT NOT NULL DEFAULT ''`)

        await db.execute(`
        INSERT INTO import_batches (
          id, project_id, source_file, source_hash, status, completed_at
        )
        VALUES (?, NULL, 'schema:v19', 'f1-master-data', 'running', NULL)
        ON CONFLICT(id) DO UPDATE SET
          status = 'running',
          completed_at = NULL
      `, [F1_IMPORT_BATCH_ID])

        await migrateF1ProjectCustomers(db)
        await migrateF1WorkerProjects(db)
        await recordF1SupplierHierarchy(db)

        await db.execute('DROP INDEX IF EXISTS idx_suppliers_parent')
        await dropColumnIfExists(db, 'suppliers', 'parent_supplier_id')
        await dropColumnIfExists(db, 'projects', 'developer')
        await dropColumnIfExists(db, 'projects', 'developer2')
        await dropColumnIfExists(db, 'workers', 'current_project')

        await execScript(db, V19_F1_INDEXES)
        await db.execute(`
          UPDATE import_batches
          SET status = 'completed', completed_at = datetime('now')
          WHERE id = ?
        `, [F1_IMPORT_BATCH_ID])
        await db.execute('COMMIT')
      }
      catch (error) {
        try {
          await db.execute('ROLLBACK')
        }
        catch {
          // 保留原始迁移错误。
        }
        throw error
      }
    },
  },
  {
    version: 20,
    name: 'target-cost-incomplete-drafts',
    async up(db) {
      await allowIncompleteTargetCostDrafts(db)
    },
  },
  {
    version: 21,
    name: 'f2-canonical-contracts-settlements',
    async up(db) {
      await migrateF2ContractsAndSettlements(db)
    },
  },
  {
    version: 22,
    name: 'f3-finance-forms-reconciliation',
    async up(db) {
      await migrateF3FinanceForms(db)
    },
  },
  {
    version: 23,
    name: 'f4-material-forms-inventory-facts',
    async up(db) {
      await db.execute('BEGIN IMMEDIATE')
      try {
        await execScript(db, V23_F4_MATERIAL_TABLES)
        await execScript(db, V23_F4_MATERIAL_INDEXES)
        await db.execute('COMMIT')
      }
      catch (error) {
        try {
          await db.execute('ROLLBACK')
        }
        catch {
          // 保留原始迁移错误。
        }
        throw error
      }
    },
  },
  {
    version: 24,
    name: 'f5-owner-subcontract-documents',
    async up(db) {
      await migrateF5OwnerSubcontractDocuments(db)
    },
  },
  {
    // 送货单归档即进入材料台账；打印是独立后续动作，绝不能由归档或打开打印窗口冒充成功。
    // 存量记录无法可靠判断是否已打印，统一排除出新待打印队列，避免升级后突然出现大量历史待办。
    version: 25,
    name: 'delivery-archive-print-disposition',
    async up(db) {
      await addColumnIfMissing(
        db,
        'delivery_records',
        'print_disposition',
        `TEXT NOT NULL DEFAULT 'excluded'
          CHECK (print_disposition IN ('pending', 'printed', 'excluded'))`,
      )
      await addColumnIfMissing(db, 'delivery_records', 'printed_at', 'TEXT')
      await addColumnIfMissing(db, 'delivery_records', 'print_excluded_at', 'TEXT')
      await db.execute(`
        UPDATE delivery_records
        SET stored = 1
        WHERE archived = 1
      `)
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_delivery_pending_print
        ON delivery_records(print_disposition, archived)
        WHERE deleted_at IS NULL
          AND archived = 1
          AND print_disposition = 'pending';
      `)
    },
  },
  {
    // 存量只维护单一 trade；回填为能力列表后仍保留 trade 作为主工种与旧查询兼容字段。
    version: 26,
    name: 'crew-worker-capabilities',
    async up(db) {
      for (const table of ['crews', 'workers'] as const) {
        await addColumnIfMissing(db, table, 'trade_capabilities', `TEXT NOT NULL DEFAULT '[]'`)
        await addColumnIfMissing(db, table, 'item_capabilities', `TEXT NOT NULL DEFAULT '[]'`)
        const rows = await db.select<{
          id: string
          trade: string | null
          trade_capabilities: string | null
        }>(`
          SELECT id, trade, trade_capabilities
          FROM ${table}
        `)
        for (const row of rows) {
          const primaryTrade = row.trade?.trim() ?? ''
          let configured: unknown = []
          try {
            configured = JSON.parse(row.trade_capabilities || '[]')
          }
          catch {
            configured = []
          }
          if (Array.isArray(configured) && configured.length > 0)
            continue
          await db.execute(`
            UPDATE ${table}
            SET trade_capabilities = ?
            WHERE id = ?
          `, [JSON.stringify(primaryTrade ? [primaryTrade] : []), row.id])
        }
      }
    },
  },
  {
    version: 27,
    name: 'schedule-provisional-scope-process-library',
    async up(db) {
      await migrateScheduleProcessLibraryV27(db)
    },
  },
  {
    version: 28,
    name: 'payroll-attendance-workbenches',
    async up(db) {
      await execScript(db, BATCH_5_PAYROLL_ATTENDANCE)
    },
  },
  {
    version: 29,
    name: 'payroll-audit-period-members',
    async up(db) {
      await migratePayrollAuditV29(db)
    },
  },
  {
    version: 30,
    name: 'signed-daywork-payroll-source',
    async up(db) {
      await execScript(db, `
        CREATE TABLE IF NOT EXISTS payroll_subject_configs (
          id               TEXT PRIMARY KEY,
          project_id       TEXT NOT NULL REFERENCES projects(id),
          crew_id          TEXT REFERENCES crews(id),
          leader_worker_id TEXT NOT NULL REFERENCES workers(id),
          format_family    TEXT NOT NULL DEFAULT 'C2'
                           CHECK (format_family = 'C2'),
          unit_rate        REAL NOT NULL CHECK (unit_rate > 0),
          rule_text        TEXT NOT NULL DEFAULT '',
          enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          created_at       TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
          deleted_at       TEXT DEFAULT NULL
        );
        CREATE TABLE IF NOT EXISTS signed_daywork_records (
          id             TEXT PRIMARY KEY,
          project_id     TEXT NOT NULL REFERENCES projects(id),
          crew_id        TEXT REFERENCES crews(id),
          worker_id      TEXT NOT NULL REFERENCES workers(id),
          work_date      TEXT NOT NULL,
          work_content   TEXT NOT NULL DEFAULT '',
          start_time     TEXT NOT NULL DEFAULT '',
          end_time       TEXT NOT NULL DEFAULT '',
          labor_units    REAL NOT NULL CHECK (labor_units IN (0.5, 1)),
          witness        TEXT NOT NULL DEFAULT '',
          confirmed_on   TEXT,
          status         TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'confirmed')),
          note           TEXT NOT NULL DEFAULT '',
          created_at     TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
          deleted_at     TEXT DEFAULT NULL
        );
        CREATE TABLE IF NOT EXISTS wage_statement_daywork_records (
          id                TEXT PRIMARY KEY,
          statement_id      TEXT NOT NULL REFERENCES wage_statements(id),
          daywork_record_id TEXT NOT NULL REFERENCES signed_daywork_records(id),
          created_at        TEXT NOT NULL DEFAULT (datetime('now')),
          deleted_at        TEXT DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_signed_daywork_project_date
          ON signed_daywork_records(project_id, work_date);
        CREATE INDEX IF NOT EXISTS idx_payroll_subject_configs_project
          ON payroll_subject_configs(project_id, format_family);
        CREATE INDEX IF NOT EXISTS idx_signed_daywork_worker_date
          ON signed_daywork_records(worker_id, work_date);
        CREATE INDEX IF NOT EXISTS idx_wage_daywork_statement
          ON wage_statement_daywork_records(statement_id);
        CREATE INDEX IF NOT EXISTS idx_signed_daywork_records_deleted
          ON signed_daywork_records(deleted_at) WHERE deleted_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_payroll_subject_configs_deleted
          ON payroll_subject_configs(deleted_at) WHERE deleted_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_wage_statement_daywork_records_deleted
          ON wage_statement_daywork_records(deleted_at) WHERE deleted_at IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_signed_daywork_slot
          ON signed_daywork_records(project_id, worker_id, work_date, start_time, end_time)
          WHERE deleted_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_subject_config
          ON payroll_subject_configs(project_id, leader_worker_id, format_family)
          WHERE deleted_at IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_wage_daywork_record
          ON wage_statement_daywork_records(daywork_record_id)
          WHERE deleted_at IS NULL;
      `)
      await addColumnIfMissing(
        db,
        'wage_statements',
        'subject_config_id',
        'TEXT REFERENCES payroll_subject_configs(id)',
      )
    },
  },
  {
    version: 31,
    name: 'wage-statement-member-allocations',
    async up(db) {
      await execScript(db, `
        CREATE TABLE IF NOT EXISTS wage_statement_allocations (
          id                   TEXT PRIMARY KEY,
          statement_id         TEXT NOT NULL REFERENCES wage_statements(id),
          worker_id            TEXT NOT NULL REFERENCES workers(id),
          allocated_amount_fen INTEGER NOT NULL DEFAULT 0 CHECK (allocated_amount_fen >= 0),
          created_at           TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
          deleted_at           TEXT DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wage_statement_allocations_statement
          ON wage_statement_allocations(statement_id);
        CREATE INDEX IF NOT EXISTS idx_wage_statement_allocations_deleted
          ON wage_statement_allocations(deleted_at) WHERE deleted_at IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_wage_statement_allocation_worker
          ON wage_statement_allocations(statement_id, worker_id)
          WHERE deleted_at IS NULL;
      `)
    },
  },
  {
    version: 32,
    name: 'delivery-print-batches',
    async up(db) {
      await addColumnIfMissing(
        db,
        'delivery_records',
        'print_batch_id',
        `TEXT NOT NULL DEFAULT ''`,
      )
      await db.execute(`
        UPDATE delivery_records
        SET print_batch_id = id
        WHERE trim(print_batch_id) = ''
      `)
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_delivery_pending_print_batch
        ON delivery_records(print_batch_id, print_disposition)
        WHERE deleted_at IS NULL
          AND archived = 1
          AND print_disposition = 'pending'
      `)
    },
  },
  {
    version: 33,
    name: 'ocr-recognition-settings',
    async up(db) {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS ocr_settings (
          id            TEXT PRIMARY KEY CHECK (id = 'default'),
          settings_json TEXT NOT NULL,
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)
    },
  },
  {
    version: 34,
    name: 'schedule-process-library-predecessors',
    async up(db) {
      await addColumnIfMissing(
        db,
        'schedule_process_library_tasks',
        'predecessor_task_key',
        `TEXT DEFAULT NULL`,
      )
      await db.execute(`
        UPDATE schedule_process_library_tasks AS current
        SET predecessor_task_key = (
          SELECT previous.task_key
          FROM schedule_process_library_tasks AS previous
          WHERE previous.library_id = current.library_id
            AND previous.deleted_at IS NULL
            AND (
              previous.sort_order < current.sort_order
              OR (
                previous.sort_order = current.sort_order
                AND previous.id < current.id
              )
            )
          ORDER BY previous.sort_order DESC, previous.id DESC
          LIMIT 1
        )
        WHERE current.deleted_at IS NULL
          AND current.predecessor_task_key IS NULL
      `)
      await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_schedule_process_library_predecessor
        ON schedule_process_library_tasks(library_id, predecessor_task_key)
        WHERE deleted_at IS NULL
      `)
    },
  },
  {
    version: 35,
    name: 'schedule-process-library-predecessor-disabled-repair',
    async up(db) {
      await addColumnIfMissing(
        db,
        'schedule_process_library_tasks',
        'predecessor_disabled',
        `INTEGER NOT NULL DEFAULT 0 CHECK (predecessor_disabled IN (0, 1))`,
      )
      await db.execute(`
        UPDATE schedule_process_library_tasks
        SET predecessor_disabled = 0
        WHERE predecessor_disabled IS NULL
           OR predecessor_disabled NOT IN (0, 1)
      `)
    },
  },
  {
    version: 36,
    name: 'supplier-credential-review-foundation',
    async up(db) {
      await db.execute('BEGIN IMMEDIATE')
      try {
        await addColumnIfMissing(
          db,
          'supplier_credentials',
          'file_ref_id',
          'TEXT REFERENCES file_refs(id)',
        )
        await addColumnIfMissing(
          db,
          'supplier_credentials',
          'valid_from',
          `TEXT NOT NULL DEFAULT ''`,
        )
        await addColumnIfMissing(
          db,
          'supplier_credentials',
          'expires_at',
          `TEXT NOT NULL DEFAULT ''`,
        )
        await addColumnIfMissing(
          db,
          'supplier_credentials',
          'long_term',
          `INTEGER NOT NULL DEFAULT 0 CHECK (long_term IN (0, 1))`,
        )
        await addColumnIfMissing(
          db,
          'supplier_credentials',
          'ocr_confirmed_result',
          `TEXT NOT NULL DEFAULT '{}'`,
        )
        await addColumnIfMissing(
          db,
          'supplier_credentials',
          'ocr_confirmed_at',
          'TEXT',
        )
        await addColumnIfMissing(
          db,
          'supplier_credentials',
          'ocr_review_status',
          `TEXT NOT NULL DEFAULT 'not_started'
            CHECK (ocr_review_status IN ('not_started', 'pending', 'confirmed'))`,
        )
        await db.execute(`
          UPDATE supplier_credentials
          SET ocr_review_status = CASE
            WHEN ocr_confirmed_at IS NOT NULL THEN 'confirmed'
            WHEN trim(COALESCE(ocr_result, '')) NOT IN ('', '{}') THEN 'pending'
            ELSE 'not_started'
          END
        `)
        await addColumnIfMissing(
          db,
          'suppliers',
          'taxpayer_verification_status',
          `TEXT NOT NULL DEFAULT 'not_checked'
            CHECK (taxpayer_verification_status IN (
              'not_checked', 'confirmed_general', 'not_found', 'manually_confirmed'
            ))`,
        )
        await addColumnIfMissing(
          db,
          'suppliers',
          'taxpayer_verification_source',
          `TEXT NOT NULL DEFAULT ''`,
        )
        await addColumnIfMissing(
          db,
          'suppliers',
          'taxpayer_verified_at',
          'TEXT',
        )
        await addColumnIfMissing(
          db,
          'suppliers',
          'taxpayer_verification_note',
          `TEXT NOT NULL DEFAULT ''`,
        )

        await execScript(db, `
          CREATE TABLE IF NOT EXISTS supplier_credential_requirements (
            id          TEXT PRIMARY KEY,
            supplier_id TEXT NOT NULL REFERENCES suppliers(id),
            category    TEXT NOT NULL,
            requirement TEXT NOT NULL CHECK (
              requirement IN ('not_applicable', 'optional', 'required')
            ),
            reason      TEXT NOT NULL DEFAULT '',
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            deleted_at  TEXT DEFAULT NULL
          );

          CREATE TABLE IF NOT EXISTS supplier_credential_audits (
            id                    TEXT PRIMARY KEY,
            supplier_id           TEXT NOT NULL REFERENCES suppliers(id),
            credential_id         TEXT NOT NULL REFERENCES supplier_credentials(id),
            action                TEXT NOT NULL CHECK (
              action IN (
                'credential_create', 'ocr_recognition', 'ocr_review', 'validity_update',
                'credential_delete', 'credential_restore'
              )
            ),
            category_before       TEXT NOT NULL DEFAULT '',
            category_after        TEXT NOT NULL DEFAULT '',
            changed_fields        TEXT NOT NULL DEFAULT '[]',
            valid_from_before     TEXT NOT NULL DEFAULT '',
            valid_from_after      TEXT NOT NULL DEFAULT '',
            expires_at_before     TEXT NOT NULL DEFAULT '',
            expires_at_after      TEXT NOT NULL DEFAULT '',
            long_term_before      INTEGER NOT NULL DEFAULT 0,
            long_term_after       INTEGER NOT NULL DEFAULT 0,
            confidence            REAL,
            created_at            TEXT NOT NULL DEFAULT (datetime('now'))
          );

          CREATE TABLE IF NOT EXISTS supplier_audits (
            id              TEXT PRIMARY KEY,
            supplier_id     TEXT NOT NULL REFERENCES suppliers(id),
            action          TEXT NOT NULL CHECK (
              action IN (
                'create', 'update', 'delete', 'restore',
                'credential_review', 'taxpayer_verification'
              )
            ),
            outcome         TEXT NOT NULL DEFAULT '',
            source_category TEXT NOT NULL DEFAULT '',
            changed_fields  TEXT NOT NULL DEFAULT '[]',
            note_present    INTEGER NOT NULL DEFAULT 0
                            CHECK (note_present IN (0, 1)),
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
          );

          CREATE INDEX IF NOT EXISTS idx_supplier_audits_supplier
            ON supplier_audits(supplier_id, created_at);

          CREATE INDEX IF NOT EXISTS idx_supplier_credential_audits_credential
            ON supplier_credential_audits(credential_id, created_at);

          CREATE INDEX IF NOT EXISTS idx_supplier_credential_requirements_supplier
            ON supplier_credential_requirements(supplier_id);

          CREATE INDEX IF NOT EXISTS idx_supplier_credential_requirements_deleted
            ON supplier_credential_requirements(deleted_at)
            WHERE deleted_at IS NOT NULL;

          CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_credential_requirement
            ON supplier_credential_requirements(supplier_id, category)
            WHERE deleted_at IS NULL;

          CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_credential_file_ref
            ON supplier_credentials(file_ref_id)
            WHERE file_ref_id IS NOT NULL AND deleted_at IS NULL;
        `)

        await db.execute(`
          CREATE TRIGGER IF NOT EXISTS trg_suppliers_invalidate_credential_review
          AFTER UPDATE OF
            name, unique_code, tax_no, legal_rep, address, bank, bank_account
          ON suppliers
          WHEN OLD.credential_status IN ('qualified', 'rejected')
            AND (
              NEW.name IS NOT OLD.name
              OR NEW.unique_code IS NOT OLD.unique_code
              OR NEW.tax_no IS NOT OLD.tax_no
              OR NEW.legal_rep IS NOT OLD.legal_rep
              OR NEW.address IS NOT OLD.address
              OR NEW.bank IS NOT OLD.bank
              OR NEW.bank_account IS NOT OLD.bank_account
            )
          BEGIN
            UPDATE suppliers
            SET credential_status = CASE
                  WHEN NOT EXISTS (
                    SELECT required.category
                    FROM (
                      SELECT '营业执照' AS category
                      UNION ALL SELECT '法人身份证'
                      UNION ALL SELECT '银行账户资料'
                    ) AS required
                    WHERE COALESCE((
                      SELECT requirement.requirement
                      FROM supplier_credential_requirements AS requirement
                      WHERE requirement.supplier_id = NEW.id
                        AND requirement.category = required.category
                        AND requirement.deleted_at IS NULL
                      LIMIT 1
                    ), 'required') = 'required'
                      AND NOT EXISTS (
                        SELECT 1
                        FROM supplier_credentials AS credential
                        WHERE credential.supplier_id = NEW.id
                          AND credential.category = required.category
                          AND credential.deleted_at IS NULL
                          AND (
                            credential.long_term = 1
                            OR trim(credential.expires_at) = ''
                            OR credential.expires_at >= date('now', '+8 hours')
                          )
                          AND EXISTS (
                            SELECT 1
                            FROM file_refs AS file
                            JOIN file_payloads AS payload ON payload.file_ref_id = file.id
                            WHERE file.id = credential.file_ref_id
                              AND file.owner_type = 'supplier_credential'
                              AND file.owner_id = credential.id
                              AND file.deleted_at IS NULL
                          )
                      )
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM supplier_credential_requirements AS requirement
                    WHERE requirement.supplier_id = NEW.id
                      AND requirement.requirement = 'required'
                      AND requirement.deleted_at IS NULL
                      AND NOT EXISTS (
                        SELECT 1
                        FROM supplier_credentials AS credential
                        WHERE credential.supplier_id = NEW.id
                          AND credential.category = requirement.category
                          AND credential.deleted_at IS NULL
                          AND (
                            credential.long_term = 1
                            OR trim(credential.expires_at) = ''
                            OR credential.expires_at >= date('now', '+8 hours')
                          )
                          AND EXISTS (
                            SELECT 1
                            FROM file_refs AS file
                            JOIN file_payloads AS payload ON payload.file_ref_id = file.id
                            WHERE file.id = credential.file_ref_id
                              AND file.owner_type = 'supplier_credential'
                              AND file.owner_id = credential.id
                              AND file.deleted_at IS NULL
                          )
                      )
                  )
                  THEN 'reviewing'
                  ELSE 'incomplete'
                END,
                credential_reviewed_at = NULL,
                credential_review_note = ''
            WHERE id = NEW.id;
          END;
        `)

        const sensitiveLogs = await db.select<{
          id: string
          table_name: 'suppliers' | 'supplier_credentials' | 'file_refs'
          before_data: string | null
          after_data: string | null
        }>(`
          SELECT id, table_name, before_data, after_data
          FROM operation_logs
          WHERE table_name IN ('suppliers', 'supplier_credentials')
             OR (
               table_name = 'file_refs'
               AND (
                 EXISTS (
                   SELECT 1
                   FROM file_refs AS current_file
                   WHERE current_file.id = operation_logs.record_id
                     AND current_file.owner_type = 'supplier_credential'
                 )
                 OR
                 CASE WHEN json_valid(before_data)
                   THEN json_extract(before_data, '$.owner_type')
                 END = 'supplier_credential'
                 OR CASE WHEN json_valid(after_data)
                   THEN json_extract(after_data, '$.owner_type')
                 END = 'supplier_credential'
               )
             )
        `)
        const sanitizeSensitiveSnapshot = (
          table: 'suppliers' | 'supplier_credentials' | 'file_refs',
          value: string | null,
        ): string | null => {
          if (!value)
            return null
          try {
            const source = JSON.parse(value) as Record<string, unknown>
            const sanitized: Record<string, unknown> = {}
            const allowedKeys = table === 'suppliers'
              ? [
                  'id',
                  'deleted_at',
                  'credential_status',
                  'credential_reviewed_at',
                  'approval_status',
                  'created_at',
                  'updated_at',
                ]
              : table === 'supplier_credentials'
                ? [
                    'id',
                    'supplier_id',
                    'category',
                    'file_ref_id',
                    'valid_from',
                    'expires_at',
                    'long_term',
                    'ocr_confidence',
                    'ocr_confirmed_at',
                    'ocr_review_status',
                    'verified_at',
                    'added_at',
                    'deleted_at',
                  ]
                : [
                    'id',
                    'owner_type',
                    'owner_id',
                    'uploaded_at',
                    'deleted_at',
                  ]
            for (const key of allowedKeys) {
              if (Object.hasOwn(source, key))
                sanitized[key] = source[key]
            }
            return JSON.stringify(sanitized)
          }
          catch {
            return null
          }
        }
        for (const log of sensitiveLogs) {
          await db.execute(
            `UPDATE operation_logs
             SET before_data = ?, after_data = ?
             WHERE id = ?`,
            [
              sanitizeSensitiveSnapshot(log.table_name, log.before_data),
              sanitizeSensitiveSnapshot(log.table_name, log.after_data),
              log.id,
            ],
          )
        }

        await db.execute(`
          UPDATE supplier_credentials
          SET category = CASE trim(category)
            WHEN '银行开户许可证' THEN '银行账户资料'
            WHEN '开户许可证' THEN '银行账户资料'
            WHEN '基本存款账户信息' THEN '银行账户资料'
            WHEN '基本存款账户信息表' THEN '银行账户资料'
            WHEN '品牌授权证明' THEN '品牌授权书'
            ELSE trim(category)
          END
        `)
        await db.execute(`
          INSERT OR IGNORE INTO file_refs (
            id, owner_type, owner_id, file_name, file_path, file_size,
            mime_type, category, uploader, uploaded_at
          )
          SELECT
            'file_ref_supplier_credential_' || credential.id,
            'supplier_credential',
            credential.id,
            credential.file_name,
            trim(credential.file_path),
            0,
            '',
            credential.category,
            'migration-v36',
            credential.added_at
          FROM supplier_credentials AS credential
          WHERE credential.deleted_at IS NULL
            AND trim(credential.file_path) <> ''
            AND NOT EXISTS (
              SELECT 1
              FROM file_refs AS file
              WHERE file.owner_type = 'supplier_credential'
                AND file.owner_id = credential.id
                AND file.deleted_at IS NULL
            )
        `)
        await db.execute(`
          UPDATE supplier_credentials
          SET file_ref_id = (
            SELECT file.id
            FROM file_refs AS file
            WHERE file.owner_type = 'supplier_credential'
              AND file.owner_id = supplier_credentials.id
              AND file.deleted_at IS NULL
            ORDER BY file.uploaded_at DESC, file.id DESC
            LIMIT 1
          )
          WHERE file_ref_id IS NULL
        `)

        // 旧 qualified/rejected 没有供应商级人工凭证时只能回到自动态；
        // 单条证照 verified_at 不能冒充对整个分供方作出的人工核验结论。
        await db.execute(`
          WITH suppliers_to_recalculate AS (
            SELECT supplier.id
            FROM suppliers AS supplier
            WHERE supplier.deleted_at IS NULL
              AND (
                supplier.credential_status IN ('incomplete', 'reviewing')
                OR (
                  supplier.credential_status = 'qualified'
                  AND supplier.credential_reviewed_at IS NULL
                )
                OR (
                  supplier.credential_status = 'rejected'
                  AND (
                    supplier.credential_reviewed_at IS NULL
                    OR trim(supplier.credential_review_note) = ''
                  )
                )
                OR supplier.credential_status IS NULL
                OR supplier.credential_status NOT IN (
                  'incomplete', 'reviewing', 'qualified', 'rejected'
                )
                OR (
                  supplier.credential_status IN ('qualified', 'rejected')
                  AND EXISTS (
                    SELECT required.category
                    FROM (
                      SELECT '营业执照' AS category
                      UNION ALL SELECT '法人身份证'
                      UNION ALL SELECT '银行账户资料'
                    ) AS required
                    WHERE NOT EXISTS (
                      SELECT 1
                      FROM supplier_credentials AS credential
                      WHERE credential.supplier_id = supplier.id
                        AND credential.deleted_at IS NULL
                        AND credential.category = required.category
                        AND (
                          credential.long_term = 1
                          OR trim(credential.expires_at) = ''
                          OR credential.expires_at >= date('now', '+8 hours')
                        )
                        AND EXISTS (
                          SELECT 1
                          FROM file_refs AS file
                          JOIN file_payloads AS payload ON payload.file_ref_id = file.id
                          WHERE file.id = credential.file_ref_id
                            AND file.owner_type = 'supplier_credential'
                            AND file.owner_id = credential.id
                            AND file.deleted_at IS NULL
                        )
                    )
                  )
                )
              )
          )
          UPDATE suppliers
          SET credential_status = CASE
                WHEN NOT EXISTS (
                  SELECT required.category
                  FROM (
                    SELECT '营业执照' AS category
                    UNION ALL SELECT '法人身份证'
                    UNION ALL SELECT '银行账户资料'
                  ) AS required
                  WHERE NOT EXISTS (
                    SELECT 1
                    FROM supplier_credentials AS credential
                    WHERE credential.supplier_id = suppliers.id
                      AND credential.deleted_at IS NULL
                      AND credential.category = required.category
                      AND (
                        credential.long_term = 1
                        OR trim(credential.expires_at) = ''
                        OR credential.expires_at >= date('now', '+8 hours')
                      )
                      AND EXISTS (
                        SELECT 1
                        FROM file_refs AS file
                        JOIN file_payloads AS payload ON payload.file_ref_id = file.id
                        WHERE file.id = credential.file_ref_id
                          AND file.owner_type = 'supplier_credential'
                          AND file.owner_id = credential.id
                          AND file.deleted_at IS NULL
                      )
                  )
                )
                THEN 'reviewing'
                ELSE 'incomplete'
              END,
              credential_reviewed_at = NULL,
              credential_review_note = ''
          WHERE id IN (SELECT id FROM suppliers_to_recalculate)
        `)
        await db.execute('COMMIT')
      }
      catch (error) {
        try {
          await db.execute('ROLLBACK')
        }
        catch {
          // 保留原始迁移错误。
        }
        throw error
      }
    },
  },
  {
    version: 37,
    name: 'monthly-statement-owner-lifecycle-repair',
    async up(db) {
      // 旧版 adjusted/exported 分别表示“手调过/导出过”；reported_amount 在
      // 保存草稿时也会写入，不能作为已申报证据。没有可靠审定事实时保守回草稿，
      // 由用户重新申报；只有 audited_amount 能保留为已审定。
      await db.execute(`
        UPDATE monthly_statements
        SET status = CASE
          WHEN audited_amount IS NOT NULL THEN 'exported'
          ELSE 'draft'
        END
        WHERE status IN ('adjusted', 'exported')
      `)
    },
  },
  {
    version: 38,
    name: 'schedule-provisional-floor-plan-sources',
    async up(db) {
      const invalidRows = await db.select<{ id: string }>(`
        SELECT plan.id
        FROM schedule_task_floor_plans AS plan
        LEFT JOIN boq_lines AS boq_line ON boq_line.id = plan.boq_line_id
        WHERE boq_line.item_id IS NULL
        LIMIT 1
      `)
      if (invalidRows.length) {
        throw new Error(
          `排程楼层计划 ${invalidRows[0]!.id} 缺少可回填的 BOQ 分项，无法安全升级暂估来源模型`,
        )
      }

      await db.execute('BEGIN')
      try {
        await db.execute(`
          CREATE TABLE schedule_task_floor_plans_v38_new (
            id              TEXT PRIMARY KEY,
            task_id         TEXT NOT NULL REFERENCES schedule_tasks(id),
            floor_id        TEXT NOT NULL REFERENCES floors(id),
            item_id         TEXT NOT NULL REFERENCES items(id),
            boq_line_id     TEXT REFERENCES boq_lines(id),
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
                AND provisional_qty IS NOT NULL
                AND provisional_qty >= 0
              )
            )
          )
        `)
        await db.execute(`
          INSERT INTO schedule_task_floor_plans_v38_new (
            id, task_id, floor_id, item_id, boq_line_id, source_basis,
            provisional_qty, planned_start, planned_finish, is_manual,
            note, sort_order, created_at, updated_at, deleted_at
          )
          SELECT
            plan.id,
            plan.task_id,
            plan.floor_id,
            boq_line.item_id,
            plan.boq_line_id,
            'contract',
            NULL,
            plan.planned_start,
            plan.planned_finish,
            plan.is_manual,
            plan.note,
            plan.sort_order,
            plan.created_at,
            plan.updated_at,
            plan.deleted_at
          FROM schedule_task_floor_plans AS plan
          JOIN boq_lines AS boq_line ON boq_line.id = plan.boq_line_id
        `)
        await db.execute('DROP TABLE schedule_task_floor_plans')
        await db.execute(
          'ALTER TABLE schedule_task_floor_plans_v38_new RENAME TO schedule_task_floor_plans',
        )
        await execScript(db, `
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
        `)
        await db.execute('COMMIT')
      }
      catch (error) {
        try {
          await db.execute('ROLLBACK')
        }
        catch {
          // 保留原始迁移错误。
        }
        throw error
      }
    },
  },
  {
    version: 39,
    name: 'monthly-statement-quantity-basis',
    async up(db) {
      // 旧库的报量按 field→provisional→contract 静默回退派生，无法回溯当时用的是哪一口径。
      // 存量单据统一标注为默认基准 field，新单据由生成时显式选择并冻结。
      await addColumnIfMissing(
        db,
        'monthly_statements',
        'quantity_basis',
        `TEXT NOT NULL DEFAULT 'field'
         CHECK (quantity_basis IN ('contract', 'provisional', 'field'))`,
      )
    },
  },
  {
    version: 40,
    name: 'monthly-statement-source-audit',
    async up(db) {
      // 存量报量单没有留下取数时的事实版本与申报人，无法证明用的是哪一版工程量。
      // 补审计列后由新的生成/重算/申报路径写入；旧单据留空，不追认伪造的审计值。
      await addColumnIfMissing(db, 'monthly_statements', 'source_version', `TEXT NOT NULL DEFAULT ''`)
      await addColumnIfMissing(db, 'monthly_statements', 'source_updated_at', 'TEXT DEFAULT NULL')
      await addColumnIfMissing(db, 'monthly_statements', 'operator_name', `TEXT NOT NULL DEFAULT ''`)
      await addColumnIfMissing(db, 'monthly_statements', 'submitted_at', 'TEXT DEFAULT NULL')
    },
  },
]

export const LATEST_VERSION = migrations.reduce((max, m) => Math.max(max, m.version), 0)

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT DEFAULT (datetime('now'))
);`

export async function getCurrentVersion(db: MigrationDb): Promise<number> {
  await db.execute(MIGRATIONS_TABLE)
  const rows = await db.select<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')
  return rows[0]?.v ?? 0
}

/**
 * 启动时调用：检测当前版本，按序执行缺失迁移并逐个记录版本。
 * 已在最新版本时不做任何事（幂等）。
 */
export async function runMigrations(
  db: MigrationDb,
  list: Migration[] = migrations,
): Promise<MigrateResult> {
  const versions = new Set<number>()
  for (const m of list) {
    if (versions.has(m.version)) {
      throw new Error(`[db] 迁移版本号重复: v${m.version}`)
    }
    versions.add(m.version)
  }

  const from = await getCurrentVersion(db)
  const pending = [...list].sort((a, b) => a.version - b.version).filter(m => m.version > from)

  const applied: string[] = []
  for (const m of pending) {
    await m.up(db)
    await db.execute('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name])
    applied.push(`v${m.version} ${m.name}`)
  }

  const to = applied.length ? await getCurrentVersion(db) : from
  return { from, to, applied }
}
