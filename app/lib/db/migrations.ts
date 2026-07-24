import { ALL_SCHEMA } from './schema'

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
