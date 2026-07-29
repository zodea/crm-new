// schema 版本由 migrations.ts 的迁移数组派生（LATEST_VERSION），此文件只保留基线建表 SQL
export const BATCH_1_NO_DEPS = `
-- ═══════ 第 1 批：无外键依赖 ═══════

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  contract_name   TEXT DEFAULT '',
  code            TEXT DEFAULT '',
  address         TEXT DEFAULT '',
  region          TEXT DEFAULT '',
  type            TEXT DEFAULT '',
  area            REAL,
  contract_amount REAL,
  overview        TEXT DEFAULT '',
  operation_type  TEXT DEFAULT '',

  start_date      TEXT DEFAULT '',
  planned_end     TEXT DEFAULT '',
  actual_end      TEXT DEFAULT '',
  planned_duration INTEGER,
  status          TEXT DEFAULT '筹备中',

  developer       TEXT DEFAULT '',
  developer2      TEXT DEFAULT '',
  supervisor      TEXT DEFAULT '',
  designer        TEXT DEFAULT '',
  contractor      TEXT DEFAULT '',

  manager         TEXT DEFAULT '',
  manager_phone   TEXT DEFAULT '',
  exec_manager    TEXT DEFAULT '',
  builder         TEXT DEFAULT '',
  site_leader     TEXT DEFAULT '',
  site_leader_phone TEXT DEFAULT '',

  risk_level      TEXT DEFAULT '',
  approval_status TEXT DEFAULT '',
  acceptance_date TEXT DEFAULT '',
  filing_date     TEXT DEFAULT '',

  note            TEXT DEFAULT '',
  description     TEXT DEFAULT '',
  source          TEXT DEFAULT 'manual',
  created_by      TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now')),
  updated_by      TEXT DEFAULT '',
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  external_ref        TEXT DEFAULT '',
  aliases             TEXT DEFAULT '[]',
  unique_code         TEXT DEFAULT '',
  tax_no              TEXT DEFAULT '',

  business_type       TEXT DEFAULT '',
  supplier_category   TEXT DEFAULT '',
  rating              TEXT DEFAULT '',
  parent_supplier_id  TEXT,

  legal_rep           TEXT DEFAULT '',
  registered_capital  REAL,
  registered_date     TEXT DEFAULT '',
  address             TEXT DEFAULT '',
  taxpayer_type       TEXT DEFAULT '',
  main_business       TEXT DEFAULT '',

  invoice_name        TEXT DEFAULT '',
  invoice_address     TEXT DEFAULT '',
  bank                TEXT DEFAULT '',
  bank_account        TEXT DEFAULT '',
  phone               TEXT DEFAULT '',

  contact             TEXT DEFAULT '',
  contact_phone       TEXT DEFAULT '',

  credential_status   TEXT DEFAULT 'incomplete',
  approval_status     TEXT DEFAULT 'draft',

  source              TEXT DEFAULT 'manual',
  note                TEXT DEFAULT '',
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  file_name       TEXT DEFAULT '',
  file_path       TEXT DEFAULT '',
  file_size       TEXT DEFAULT '',
  page_count      INTEGER DEFAULT 0,
  invoice_type    TEXT DEFAULT '',
  invoice_number  TEXT DEFAULT '',
  invoice_date    TEXT DEFAULT '',
  buyer           TEXT DEFAULT '',
  buyer_tax_no    TEXT DEFAULT '',
  seller          TEXT DEFAULT '',
  seller_tax_no   TEXT DEFAULT '',
  amount          REAL DEFAULT 0,
  tax_amount      REAL DEFAULT 0,
  total_amount    REAL DEFAULT 0,
  tax_rate        TEXT DEFAULT '',
  remark          TEXT DEFAULT '',
  project_id      TEXT,
  project_name    TEXT DEFAULT '',
  supplier_id     TEXT,
  ocr_status      TEXT DEFAULT 'pending',
  review_status   TEXT DEFAULT 'unreviewed',
  account_status  TEXT DEFAULT 'none',
  dup_status      TEXT DEFAULT 'normal',
  source          TEXT DEFAULT 'scan',
  print_rotation  INTEGER DEFAULT 0,
  ocr_confidence  REAL,
  confirmed_at    TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crews (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  trade          TEXT DEFAULT '',
  trade_capabilities TEXT NOT NULL DEFAULT '[]',
  item_capabilities  TEXT NOT NULL DEFAULT '[]',
  contact_name   TEXT DEFAULT '',
  contact_phone  TEXT DEFAULT '',
  note           TEXT DEFAULT '',
  created_at     TEXT DEFAULT (datetime('now'))
);
`

export const BATCH_2_DEPS_1 = `
-- ═══════ 第 2 批：依赖第 1 批 ═══════

CREATE TABLE IF NOT EXISTS supplier_credentials (
  id              TEXT PRIMARY KEY,
  supplier_id     TEXT NOT NULL REFERENCES suppliers(id),
  category        TEXT NOT NULL,
  file_name       TEXT DEFAULT '',
  file_path       TEXT DEFAULT '',
  ocr_result      TEXT DEFAULT '{}',
  ocr_confidence  REAL,
  verified_at     TEXT,
  added_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_suppliers (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  status      TEXT DEFAULT 'collecting',
  reviewer_id TEXT,
  note        TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS phase_tasks (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  phase_index   INTEGER NOT NULL,
  task_index    INTEGER NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  responsible   TEXT DEFAULT '',
  status        TEXT DEFAULT 'pending',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS construction_contracts (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  name            TEXT NOT NULL,
  contract_no     TEXT DEFAULT '',
  amount          REAL DEFAULT 0,
  status          TEXT DEFAULT '',
  sign_date       TEXT DEFAULT '',
  category        TEXT DEFAULT '',
  signed_amount   REAL DEFAULT 0,
  tax_rate        REAL DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS owner_change_orders (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  change_no        TEXT DEFAULT '',
  contract_name    TEXT DEFAULT '',
  tax_inc_amount   REAL DEFAULT 0,
  tax_exc_amount   REAL DEFAULT 0,
  applied_amount   REAL DEFAULT 0,
  approval_date    TEXT DEFAULT '',
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenditure_contracts (
  id                      TEXT PRIMARY KEY,
  project_id              TEXT NOT NULL REFERENCES projects(id),
  supplier_id             TEXT REFERENCES suppliers(id),
  name                    TEXT NOT NULL,
  contract_no             TEXT DEFAULT '',
  approval_status         TEXT DEFAULT '',
  tax_inc_total           REAL DEFAULT 0,
  effective_date          TEXT DEFAULT '',
  accumulated_settlement  REAL DEFAULT 0,
  signed_amount           REAL DEFAULT 0,
  contract_type           TEXT DEFAULT '',
  tax_rate                REAL DEFAULT 0,
  payment_method          TEXT DEFAULT '',
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_applications (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  name          TEXT DEFAULT '',
  amount        REAL DEFAULT 0,
  tax_rate      REAL DEFAULT 0,
  tax_amount    REAL DEFAULT 0,
  status        TEXT DEFAULT '',
  invoice_date  TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receipt_registrations (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id),
  receipt_no            TEXT DEFAULT '',
  receipt_date          TEXT DEFAULT '',
  amount                REAL DEFAULT 0,
  payment_method        TEXT DEFAULT '',
  payer_unit            TEXT DEFAULT '',
  cumulative_receivable REAL DEFAULT 0,
  created_at            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS current_receipts (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  receipt_no   TEXT DEFAULT '',
  receipt_date TEXT DEFAULT '',
  amount       REAL DEFAULT 0,
  payer        TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS current_payments (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  payment_no      TEXT DEFAULT '',
  approval_status TEXT DEFAULT '',
  payment_date    TEXT DEFAULT '',
  payee           TEXT DEFAULT '',
  amount          REAL DEFAULT 0,
  payment_method  TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_records (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL REFERENCES projects(id),
  payment_application_id TEXT,
  payment_no             TEXT DEFAULT '',
  payment_date           TEXT DEFAULT '',
  amount                 REAL DEFAULT 0,
  payment_method         TEXT DEFAULT '',
  payee_account          TEXT DEFAULT '',
  payee_bank             TEXT DEFAULT '',
  payee_bank_account     TEXT DEFAULT '',
  voucher_no             TEXT DEFAULT '',
  created_at             TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workers (
  id                 TEXT PRIMARY KEY,
  crew_id            TEXT REFERENCES crews(id),
  name               TEXT NOT NULL,
  gender             TEXT DEFAULT '',
  id_card            TEXT DEFAULT '',
  phone              TEXT DEFAULT '',
  hometown           TEXT DEFAULT '',
  emergency_contact  TEXT DEFAULT '',
  emergency_phone    TEXT DEFAULT '',
  trade              TEXT DEFAULT '',
  trade_capabilities TEXT NOT NULL DEFAULT '[]',
  item_capabilities  TEXT NOT NULL DEFAULT '[]',
  skill_level        TEXT DEFAULT '',
  daily_wage         REAL,
  current_project    TEXT DEFAULT '',
  project_status     TEXT DEFAULT '在场',
  entry_date         TEXT DEFAULT '',
  exit_date          TEXT DEFAULT '',
  linked_worker_id   TEXT,
  safety_education   INTEGER DEFAULT 0,
  certs              TEXT DEFAULT '[]',
  note               TEXT DEFAULT '',
  source             TEXT DEFAULT 'manual',
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);
`

export const BATCH_3_DEPS_2 = `
-- ═══════ 第 3 批：依赖第 2 批 ═══════

CREATE TABLE IF NOT EXISTS settlements (
  id                   TEXT PRIMARY KEY,
  project_supplier_id  TEXT NOT NULL REFERENCES project_suppliers(id),
  date                 TEXT DEFAULT '',
  final_amount         REAL DEFAULT 0,
  pdf_file             TEXT DEFAULT '',
  note                 TEXT DEFAULT '',
  created_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplement_agreements (
  id          TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES construction_contracts(id),
  name        TEXT NOT NULL,
  amount      REAL DEFAULT 0,
  sign_date   TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_line_items (
  id           TEXT PRIMARY KEY,
  contract_id  TEXT NOT NULL REFERENCES expenditure_contracts(id),
  item_name    TEXT DEFAULT '',
  spec         TEXT DEFAULT '',
  brand        TEXT DEFAULT '',
  unit         TEXT DEFAULT '',
  unit_price   REAL DEFAULT 0,
  quantity     REAL DEFAULT 0,
  tax_amount   REAL DEFAULT 0,
  sort_order   INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_registrations (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  supplier_id   TEXT REFERENCES suppliers(id),
  contract_id   TEXT REFERENCES expenditure_contracts(id),
  invoice_code  TEXT DEFAULT '',
  invoice_no    TEXT DEFAULT '',
  amount_type   TEXT DEFAULT '',
  contract_name TEXT DEFAULT '',
  amount        REAL DEFAULT 0,
  tax_rate      REAL DEFAULT 0,
  tax_amount    REAL DEFAULT 0,
  invoice_type  TEXT DEFAULT '',
  invoice_date  TEXT DEFAULT '',
  status        TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_applications (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  supplier_id     TEXT REFERENCES suppliers(id),
  contract_id     TEXT REFERENCES expenditure_contracts(id),
  application_no  TEXT DEFAULT '',
  name            TEXT DEFAULT '',
  approval_status TEXT DEFAULT '',
  applicant       TEXT DEFAULT '',
  amount          REAL DEFAULT 0,
  approved_amount REAL DEFAULT 0,
  paid_amount     REAL DEFAULT 0,
  payment_method  TEXT DEFAULT '',
  actual_payment  REAL DEFAULT 0,
  payment_status  TEXT DEFAULT '',
  acceptor        TEXT DEFAULT '',
  note            TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
`

export const BATCH_4_POLYMORPHIC = `
-- ═══════ 第 4 批：多态关联 ═══════

CREATE TABLE IF NOT EXISTS file_refs (
  id          TEXT PRIMARY KEY,
  owner_type  TEXT NOT NULL,
  owner_id    TEXT NOT NULL,
  file_name   TEXT DEFAULT '',
  file_path   TEXT DEFAULT '',
  file_size   INTEGER DEFAULT 0,
  category    TEXT DEFAULT '',
  uploader    TEXT DEFAULT '',
  uploaded_at TEXT DEFAULT (datetime('now'))
);
`

export const BATCH_5_PAYROLL_ATTENDANCE = `
-- ═══════ 工资与考勤（负责人请款簿制） ═══════

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

CREATE TABLE IF NOT EXISTS wage_statements (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL REFERENCES projects(id),
  crew_id            TEXT REFERENCES crews(id),
  leader_worker_id   TEXT NOT NULL REFERENCES workers(id),
  subject_config_id  TEXT REFERENCES payroll_subject_configs(id),
  month              TEXT NOT NULL,
  format_family      TEXT NOT NULL DEFAULT 'A'
                     CHECK (format_family IN ('A', 'B', 'C1', 'C2')),
  period_kind        TEXT NOT NULL DEFAULT 'monthly'
                     CHECK (period_kind IN ('monthly', 'settlement', 'retention')),
  purpose            TEXT NOT NULL DEFAULT 'advance'
                     CHECK (purpose IN ('advance', 'final')),
  quantity_source    TEXT NOT NULL
                     CHECK (quantity_source IN ('provisional', 'field')),
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'checked', 'released')),
  needs_recheck      INTEGER NOT NULL DEFAULT 0 CHECK (needs_recheck IN (0, 1)),
  pay_ratio          REAL NOT NULL DEFAULT 1 CHECK (pay_ratio >= 0 AND pay_ratio <= 1),
  cumulative_amount  REAL NOT NULL DEFAULT 0,
  previously_paid    REAL NOT NULL DEFAULT 0,
  gross_amount       REAL NOT NULL DEFAULT 0,
  actual_amount      REAL,
  source_version     TEXT NOT NULL DEFAULT '',
  source_updated_at  TEXT,
  checked_source_version TEXT NOT NULL DEFAULT '',
  adjustment_reason  TEXT NOT NULL DEFAULT '',
  operator_name      TEXT NOT NULL DEFAULT '',
  snapshot_json      TEXT,
  checked_at         TEXT,
  submitted_at       TEXT,
  released_at        TEXT,
  note               TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS wage_statement_lines (
  id            TEXT PRIMARY KEY,
  statement_id  TEXT NOT NULL REFERENCES wage_statements(id),
  worker_id     TEXT NOT NULL REFERENCES workers(id),
  item_id       TEXT,
  item_name     TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT '',
  quantity      REAL NOT NULL DEFAULT 0,
  unit_price    REAL NOT NULL DEFAULT 0,
  amount        REAL NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS wage_statement_members (
  id            TEXT PRIMARY KEY,
  statement_id  TEXT NOT NULL REFERENCES wage_statements(id),
  worker_id     TEXT NOT NULL REFERENCES workers(id),
  is_leader     INTEGER NOT NULL DEFAULT 0 CHECK (is_leader IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  crew_id        TEXT REFERENCES crews(id),
  worker_id      TEXT NOT NULL REFERENCES workers(id),
  work_date      TEXT NOT NULL,
  hours          REAL NOT NULL DEFAULT 0 CHECK (hours >= 0 AND hours <= 24),
  overtime_hours REAL NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0 AND overtime_hours <= 24),
  work_content   TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT DEFAULT NULL,
  CHECK (hours + overtime_hours <= 24)
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

CREATE TABLE IF NOT EXISTS wage_statement_allocations (
  id                   TEXT PRIMARY KEY,
  statement_id         TEXT NOT NULL REFERENCES wage_statements(id),
  worker_id            TEXT NOT NULL REFERENCES workers(id),
  allocated_amount_fen INTEGER NOT NULL DEFAULT 0 CHECK (allocated_amount_fen >= 0),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at           TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_wage_statements_project_month
  ON wage_statements(project_id, month);
CREATE INDEX IF NOT EXISTS idx_payroll_subject_configs_project
  ON payroll_subject_configs(project_id, format_family);
CREATE INDEX IF NOT EXISTS idx_wage_statement_lines_statement
  ON wage_statement_lines(statement_id);
CREATE INDEX IF NOT EXISTS idx_wage_statement_members_statement
  ON wage_statement_members(statement_id);
CREATE INDEX IF NOT EXISTS idx_attendance_project_date
  ON attendance_records(project_id, work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_worker_date
  ON attendance_records(worker_id, work_date);
CREATE INDEX IF NOT EXISTS idx_signed_daywork_project_date
  ON signed_daywork_records(project_id, work_date);
CREATE INDEX IF NOT EXISTS idx_signed_daywork_worker_date
  ON signed_daywork_records(worker_id, work_date);
CREATE INDEX IF NOT EXISTS idx_wage_daywork_statement
  ON wage_statement_daywork_records(statement_id);
CREATE INDEX IF NOT EXISTS idx_wage_statement_allocations_statement
  ON wage_statement_allocations(statement_id);
CREATE INDEX IF NOT EXISTS idx_wage_statements_deleted
  ON wage_statements(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_subject_configs_deleted
  ON payroll_subject_configs(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wage_statement_lines_deleted
  ON wage_statement_lines(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wage_statement_members_deleted
  ON wage_statement_members(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_records_deleted
  ON attendance_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signed_daywork_records_deleted
  ON signed_daywork_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wage_statement_daywork_records_deleted
  ON wage_statement_daywork_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wage_statement_allocations_deleted
  ON wage_statement_allocations(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wage_statement_book_period
  ON wage_statements(project_id, leader_worker_id, month, format_family, period_kind)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_subject_config
  ON payroll_subject_configs(project_id, leader_worker_id, format_family)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wage_statement_member
  ON wage_statement_members(statement_id, worker_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_worker_day
  ON attendance_records(project_id, worker_id, work_date)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_signed_daywork_slot
  ON signed_daywork_records(project_id, worker_id, work_date, start_time, end_time)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wage_daywork_record
  ON wage_statement_daywork_records(daywork_record_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wage_statement_allocation_worker
  ON wage_statement_allocations(statement_id, worker_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ocr_settings (
  id            TEXT PRIMARY KEY CHECK (id = 'default'),
  settings_json TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`

export const INDEXES = `
-- ═══════ 索引 ═══════

CREATE INDEX IF NOT EXISTS idx_project_suppliers_proj ON project_suppliers(project_id);
CREATE INDEX IF NOT EXISTS idx_project_suppliers_sup ON project_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_expenditure_contracts_proj ON expenditure_contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_expenditure_contracts_sup ON expenditure_contracts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_proj ON payment_applications(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_sup ON payment_applications(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ticket_registrations_proj ON ticket_registrations(project_id);
CREATE INDEX IF NOT EXISTS idx_ticket_registrations_sup ON ticket_registrations(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_credentials_sup ON supplier_credentials(supplier_id);
CREATE INDEX IF NOT EXISTS idx_file_refs_owner ON file_refs(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_supplement_agreements_contract ON supplement_agreements(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_line_items_contract ON contract_line_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_phase_tasks_proj ON phase_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_construction_contracts_proj ON construction_contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_owner_change_orders_proj ON owner_change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_invoice_applications_proj ON invoice_applications(project_id);
CREATE INDEX IF NOT EXISTS idx_receipt_registrations_proj ON receipt_registrations(project_id);
CREATE INDEX IF NOT EXISTS idx_current_receipts_proj ON current_receipts(project_id);
CREATE INDEX IF NOT EXISTS idx_current_payments_proj ON current_payments(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_proj ON payment_records(project_id);
CREATE INDEX IF NOT EXISTS idx_workers_crew ON workers(crew_id);
CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_invoices_ocr_status ON invoices(ocr_status);
`

export const ALL_SCHEMA = [
  BATCH_1_NO_DEPS,
  BATCH_2_DEPS_1,
  BATCH_3_DEPS_2,
  BATCH_4_POLYMORPHIC,
  BATCH_5_PAYROLL_ATTENDANCE,
  INDEXES,
].join('\n')
