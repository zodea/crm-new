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
  INDEXES,
].join('\n')
