/** Full payroll participant. Native bootstrap and read-time initializers are never used by this upgrade. */
export const PRODUCTION_PAYROLL_TABLES = [
  'payroll_subject_configs',
  'wage_statements',
  'wage_statement_lines',
  'wage_statement_members',
  'attendance_records',
  'signed_daywork_records',
  'wage_statement_daywork_records',
  'wage_statement_allocations',
  'payroll_revision',
  'payroll_migration_evidence',
  'payroll_a_subject_configs',
  'payroll_a_price_revisions',
  'payroll_a_statement_sources',
  'payroll_command_receipts',
  'payroll_c1_rate_revisions',
  'payroll_c1_statement_sources',
  'payroll_c2_statement_sources',
  'payroll_adjustments',
  'payroll_actual_events',
  'payroll_actual_allocations',
  'payroll_adjustment_applications',
  'payroll_a_adjustment_coverage',
  'payroll_a_management_books',
  'payroll_a_management_book_revisions',
  'payroll_a_fee_revisions',
  'payroll_a_statement_books',
  'payroll_a_negative_lines',
  'payroll_a_management_ownership',
  'payroll_a_rounding_revisions',
  'payroll_hollow_policy_revisions',
  'payroll_hollow_starts',
  'payroll_hollow_adoptions',
  'payroll_batch_plans',
  'payroll_batch_attempts',
  'payroll_batch_command_receipts',
  'payroll_numbering_settings',
  'payroll_official_issues',
  'payroll_workbook_archives',
  'payroll_workbook_receipts',
  'payroll_workbook_references',
  'payroll_publication_migration_proofs',
  'payroll_command_journal',
  'payroll_command_intents',
  'payroll_source_imports',
] as const

export const PRODUCTION_PAYROLL_SCHEMA = `
CREATE TABLE payroll_subject_configs (
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

CREATE TABLE wage_statements (
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

CREATE TABLE wage_statement_lines (
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

CREATE TABLE wage_statement_members (
  id            TEXT PRIMARY KEY,
  statement_id  TEXT NOT NULL REFERENCES wage_statements(id),
  worker_id     TEXT NOT NULL REFERENCES workers(id),
  is_leader     INTEGER NOT NULL DEFAULT 0 CHECK (is_leader IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT DEFAULT NULL
);

CREATE TABLE attendance_records (
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

CREATE TABLE signed_daywork_records (
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

CREATE TABLE wage_statement_daywork_records (
  id                TEXT PRIMARY KEY,
  statement_id      TEXT NOT NULL REFERENCES wage_statements(id),
  daywork_record_id TEXT NOT NULL REFERENCES signed_daywork_records(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT DEFAULT NULL
);

CREATE TABLE wage_statement_allocations (
  id                   TEXT PRIMARY KEY,
  statement_id         TEXT NOT NULL REFERENCES wage_statements(id),
  worker_id            TEXT NOT NULL REFERENCES workers(id),
  allocated_amount_fen INTEGER NOT NULL DEFAULT 0 CHECK (allocated_amount_fen >= 0),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at           TEXT DEFAULT NULL
);

CREATE INDEX idx_wage_statements_project_month
  ON wage_statements(project_id, month);
CREATE INDEX idx_payroll_subject_configs_project
  ON payroll_subject_configs(project_id, format_family);
CREATE INDEX idx_wage_statement_lines_statement
  ON wage_statement_lines(statement_id);
CREATE INDEX idx_wage_statement_members_statement
  ON wage_statement_members(statement_id);
CREATE INDEX idx_attendance_project_date
  ON attendance_records(project_id, work_date);
CREATE INDEX idx_attendance_worker_date
  ON attendance_records(worker_id, work_date);
CREATE INDEX idx_signed_daywork_project_date
  ON signed_daywork_records(project_id, work_date);
CREATE INDEX idx_signed_daywork_worker_date
  ON signed_daywork_records(worker_id, work_date);
CREATE INDEX idx_wage_daywork_statement
  ON wage_statement_daywork_records(statement_id);
CREATE INDEX idx_wage_statement_allocations_statement
  ON wage_statement_allocations(statement_id);
CREATE INDEX idx_wage_statements_deleted
  ON wage_statements(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_payroll_subject_configs_deleted
  ON payroll_subject_configs(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_wage_statement_lines_deleted
  ON wage_statement_lines(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_wage_statement_members_deleted
  ON wage_statement_members(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_attendance_records_deleted
  ON attendance_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_signed_daywork_records_deleted
  ON signed_daywork_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_wage_statement_daywork_records_deleted
  ON wage_statement_daywork_records(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_wage_statement_allocations_deleted
  ON wage_statement_allocations(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE UNIQUE INDEX uq_payroll_subject_config
  ON payroll_subject_configs(project_id, leader_worker_id, format_family)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_wage_statement_member
  ON wage_statement_members(statement_id, worker_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_attendance_worker_day
  ON attendance_records(project_id, worker_id, work_date)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_signed_daywork_slot
  ON signed_daywork_records(project_id, worker_id, work_date, start_time, end_time)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_wage_daywork_record
  ON wage_statement_daywork_records(daywork_record_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_wage_statement_allocation_worker
  ON wage_statement_allocations(statement_id, worker_id)
  WHERE deleted_at IS NULL;


CREATE TABLE payroll_revision (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), revision INTEGER NOT NULL);
INSERT OR IGNORE INTO payroll_revision(singleton, revision) VALUES (1, 0);
CREATE TABLE payroll_migration_evidence (
    entity_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, batch_id TEXT NOT NULL,
    source_graph_json TEXT NOT NULL, diagnostics_json TEXT NOT NULL, mapping_json TEXT NOT NULL);
CREATE TABLE payroll_a_subject_configs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), crew_id TEXT REFERENCES crews(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id), initial_pay_ratio REAL,
    revision INTEGER NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
    UNIQUE(project_id, leader_worker_id));
CREATE TABLE payroll_a_price_revisions (
    id TEXT PRIMARY KEY, price_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
    crew_id TEXT REFERENCES crews(id), leader_worker_id TEXT NOT NULL REFERENCES workers(id),
    item_id TEXT NOT NULL REFERENCES items(id), unit TEXT, mode TEXT NOT NULL,
    worker_id TEXT REFERENCES workers(id), effective_month TEXT NOT NULL, unit_price REAL,
    scope_json TEXT NOT NULL, revision INTEGER NOT NULL, operator_id TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(price_id, revision));
CREATE TABLE payroll_a_statement_sources (
    statement_id TEXT PRIMARY KEY REFERENCES wage_statements(id), project_id TEXT NOT NULL REFERENCES projects(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id), source_json TEXT NOT NULL);
CREATE TABLE payroll_command_receipts (
    command_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, project_id TEXT NOT NULL,
    statement_id TEXT, config_scope_json TEXT, action TEXT NOT NULL, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL,
    command_json TEXT);
CREATE TABLE payroll_c1_rate_revisions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), worker_id TEXT NOT NULL REFERENCES workers(id),
    effective_month TEXT NOT NULL, daily_wage REAL, overtime_rate REAL, revision INTEGER NOT NULL,
    operator_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id,worker_id,revision));
CREATE TABLE payroll_c1_statement_sources (
    statement_id TEXT PRIMARY KEY REFERENCES wage_statements(id), project_id TEXT NOT NULL REFERENCES projects(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id), source_json TEXT NOT NULL);
CREATE TABLE payroll_c2_statement_sources (
    statement_id TEXT PRIMARY KEY REFERENCES wage_statements(id), project_id TEXT NOT NULL REFERENCES projects(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id), source_json TEXT NOT NULL);
CREATE TABLE payroll_adjustments (
    id TEXT PRIMARY KEY, root_adjustment_id TEXT NOT NULL, corrects_adjustment_id TEXT,
    original_statement_id TEXT NOT NULL REFERENCES wage_statements(id), project_id TEXT NOT NULL REFERENCES projects(id),
    format_family TEXT NOT NULL CHECK(format_family IN ('A','C1','C2')),
    status TEXT NOT NULL CHECK(status IN ('draft','confirmed')), reason TEXT NOT NULL, evidence_note TEXT NOT NULL,
    basis_json TEXT NOT NULL, signed_delta_fen INTEGER, confirmed_snapshot_json TEXT,
    created_by TEXT NOT NULL, confirmed_by TEXT, confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE payroll_actual_events (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL CHECK(kind IN ('supplement','refund','recording-reversal')), occurred_on TEXT NOT NULL,
    signed_amount_fen INTEGER NOT NULL, proof_json TEXT NOT NULL, confirmed_snapshot_json TEXT NOT NULL,
    reverses_kind TEXT, reverses_id TEXT,
    confirmed_by TEXT NOT NULL, confirmed_at TEXT NOT NULL);
CREATE UNIQUE INDEX payroll_unique_recording_reversal ON payroll_actual_events(reverses_kind,reverses_id) WHERE kind='recording-reversal';
CREATE TABLE payroll_actual_allocations (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES payroll_actual_events(id), worker_id TEXT NOT NULL REFERENCES workers(id),
    signed_amount_fen INTEGER NOT NULL, proof_json TEXT NOT NULL, UNIQUE(event_id,worker_id));
CREATE TABLE payroll_adjustment_applications (
    id TEXT PRIMARY KEY, adjustment_id TEXT NOT NULL REFERENCES payroll_adjustments(id), root_adjustment_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('actual-payment','later-release','recording-reversal')),
    signed_applied_fen INTEGER NOT NULL, actual_event_id TEXT REFERENCES payroll_actual_events(id),
    released_statement_id TEXT REFERENCES wage_statements(id), balance_version TEXT NOT NULL, proof_json TEXT NOT NULL,
    CHECK((actual_event_id IS NOT NULL AND released_statement_id IS NULL) OR (actual_event_id IS NULL AND released_statement_id IS NOT NULL)));
CREATE TABLE payroll_a_adjustment_coverage (
    id TEXT PRIMARY KEY, adjustment_id TEXT NOT NULL REFERENCES payroll_adjustments(id),
    statement_id TEXT NOT NULL REFERENCES wage_statements(id), component_key TEXT NOT NULL,
    command_id TEXT NOT NULL, source_version TEXT NOT NULL, coverage_json TEXT NOT NULL,
    UNIQUE(statement_id,adjustment_id,component_key));
CREATE TABLE payroll_a_management_books (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    manager_worker_id TEXT REFERENCES workers(id),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE payroll_a_management_book_revisions (
    id TEXT PRIMARY KEY,
    management_book_id TEXT NOT NULL REFERENCES payroll_a_management_books(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    revision INTEGER NOT NULL CHECK(revision > 0),
    effective_month TEXT NOT NULL,
    management_mode TEXT NOT NULL CHECK(management_mode IN ('crew-managed','company-managed')),
    scope_json TEXT NOT NULL,
    initial_pay_ratio REAL CHECK(initial_pay_ratio IS NULL OR (initial_pay_ratio >= 0 AND initial_pay_ratio <= 1)),
    evidence_note TEXT NOT NULL, source_version TEXT NOT NULL,
    operator_id TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(management_book_id,revision));
CREATE TABLE payroll_a_fee_revisions (
    id TEXT PRIMARY KEY, fee_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    crew_id TEXT REFERENCES crews(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id),
    book_purpose TEXT NOT NULL CHECK(book_purpose IN ('ordinary','management')),
    management_book_id TEXT REFERENCES payroll_a_management_books(id),
    kind TEXT NOT NULL CHECK(kind IN ('housing','subsidy','management')),
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    unit_price REAL CHECK(unit_price IS NULL OR unit_price >= 0),
    unit TEXT, basis_json TEXT NOT NULL, effective_month TEXT NOT NULL,
    adopted_default_json TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0),
    removed INTEGER NOT NULL CHECK(removed IN (0,1)),
    operator_id TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK((book_purpose='ordinary' AND management_book_id IS NULL AND kind IN ('housing','subsidy'))
      OR (book_purpose='management' AND management_book_id IS NOT NULL AND kind='management')),
    UNIQUE(fee_id,revision));
CREATE TABLE payroll_a_statement_books (
    statement_id TEXT PRIMARY KEY REFERENCES wage_statements(id) DEFERRABLE INITIALLY DEFERRED,
    project_id TEXT NOT NULL REFERENCES projects(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id),
    book_purpose TEXT NOT NULL CHECK(book_purpose IN ('ordinary','management')),
    management_book_id TEXT REFERENCES payroll_a_management_books(id),
    month TEXT NOT NULL,
    period_kind TEXT NOT NULL CHECK(period_kind IN ('monthly','settlement','retention')),
    CHECK((book_purpose='ordinary' AND management_book_id IS NULL)
      OR (book_purpose='management' AND management_book_id IS NOT NULL)));
CREATE UNIQUE INDEX payroll_a_ordinary_book_period
    ON payroll_a_statement_books(project_id,leader_worker_id,month,period_kind) WHERE book_purpose='ordinary';
CREATE UNIQUE INDEX payroll_a_management_book_period
    ON payroll_a_statement_books(management_book_id,month,period_kind) WHERE book_purpose='management';
CREATE TABLE payroll_a_negative_lines (
    id TEXT PRIMARY KEY, line_id TEXT NOT NULL,
    statement_id TEXT NOT NULL REFERENCES wage_statements(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    management_book_id TEXT NOT NULL REFERENCES payroll_a_management_books(id),
    management_revision_id TEXT NOT NULL REFERENCES payroll_a_management_book_revisions(id),
    revision INTEGER NOT NULL CHECK(revision > 0),
    label TEXT NOT NULL,
    quantity REAL CHECK(quantity IS NULL OR quantity >= 0),
    unit TEXT,
    unit_price REAL CHECK(unit_price IS NULL OR unit_price < 0),
    signed_amount_fen INTEGER CHECK(signed_amount_fen IS NULL OR (typeof(signed_amount_fen)='integer' AND signed_amount_fen <= 0)),
    scope_json TEXT NOT NULL, reason TEXT NOT NULL, evidence_note TEXT NOT NULL,
    actual_ref_json TEXT NOT NULL,
    removed INTEGER NOT NULL CHECK(removed IN (0,1)),
    operator_id TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(line_id,revision));
CREATE TABLE payroll_a_management_ownership (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    ownership_key TEXT NOT NULL,
    management_book_id TEXT NOT NULL REFERENCES payroll_a_management_books(id),
    first_statement_id TEXT NOT NULL REFERENCES wage_statements(id),
    proof_json TEXT NOT NULL,
    UNIQUE(project_id,ownership_key));
CREATE UNIQUE INDEX uq_wage_statement_non_a_book_period
    ON wage_statements(project_id,leader_worker_id,month,format_family,period_kind)
    WHERE deleted_at IS NULL AND format_family <> 'A';
CREATE TRIGGER payroll_a_book_period_insert
      BEFORE INSERT ON wage_statements
      WHEN NEW.format_family='A' AND (NEW.deleted_at IS NULL OR NEW.status='released')
      BEGIN
        SELECT RAISE(ABORT,'同一 A 请款簿月份与档位已有工资单') WHERE EXISTS (
          SELECT 1 FROM wage_statements w
          LEFT JOIN payroll_a_statement_books b ON b.statement_id=w.id
          LEFT JOIN payroll_a_statement_books n ON n.statement_id=NEW.id
          WHERE w.id<>NEW.id AND w.project_id=NEW.project_id AND w.leader_worker_id=NEW.leader_worker_id
            AND w.month=NEW.month AND w.format_family='A' AND w.period_kind=NEW.period_kind
            AND (w.deleted_at IS NULL OR w.status='released')
            AND COALESCE(b.book_purpose,'ordinary')=COALESCE(n.book_purpose,'ordinary')
            AND (COALESCE(n.book_purpose,'ordinary')='ordinary' OR b.management_book_id=n.management_book_id)
        );
      END;
CREATE TRIGGER payroll_a_book_period_update
      BEFORE UPDATE ON wage_statements
      WHEN NEW.format_family='A' AND (NEW.deleted_at IS NULL OR NEW.status='released')
      BEGIN
        SELECT RAISE(ABORT,'同一 A 请款簿月份与档位已有工资单') WHERE EXISTS (
          SELECT 1 FROM wage_statements w
          LEFT JOIN payroll_a_statement_books b ON b.statement_id=w.id
          LEFT JOIN payroll_a_statement_books n ON n.statement_id=NEW.id
          WHERE w.id<>NEW.id AND w.project_id=NEW.project_id AND w.leader_worker_id=NEW.leader_worker_id
            AND w.month=NEW.month AND w.format_family='A' AND w.period_kind=NEW.period_kind
            AND (w.deleted_at IS NULL OR w.status='released')
            AND COALESCE(b.book_purpose,'ordinary')=COALESCE(n.book_purpose,'ordinary')
            AND (COALESCE(n.book_purpose,'ordinary')='ordinary' OR b.management_book_id=n.management_book_id)
        );
      END;
CREATE TABLE payroll_a_rounding_revisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id),
    book_purpose TEXT NOT NULL CHECK(book_purpose IN ('ordinary','management')),
    management_book_id TEXT,
    effective_month TEXT NOT NULL,
    revision INTEGER NOT NULL,
    rule_json TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK((book_purpose='ordinary' AND management_book_id IS NULL) OR (book_purpose='management' AND management_book_id IS NOT NULL))
  );
CREATE UNIQUE INDEX payroll_a_rounding_revision_unique ON payroll_a_rounding_revisions(project_id,leader_worker_id,book_purpose,COALESCE(management_book_id,''),revision);
CREATE TABLE payroll_hollow_policy_revisions (
    id TEXT PRIMARY KEY, policy_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    crew_id TEXT REFERENCES crews(id), leader_worker_id TEXT NOT NULL REFERENCES workers(id),
    format_family TEXT NOT NULL CHECK(format_family IN ('A','C1','C2')),
    book_purpose TEXT CHECK(book_purpose IN ('ordinary','management')),
    management_book_id TEXT REFERENCES payroll_a_management_books(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    previous_revision_id TEXT REFERENCES payroll_hollow_policy_revisions(id),
    effective_month TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    unit_amount REAL CHECK(unit_amount IS NULL OR unit_amount >= 0),
    command_id TEXT NOT NULL,
    revision_json TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    CHECK((format_family='A' AND book_purpose IS NOT NULL AND book_purpose='ordinary' AND management_book_id IS NULL)
      OR (format_family='A' AND book_purpose IS NOT NULL AND book_purpose='management' AND management_book_id IS NOT NULL)
      OR (format_family IN ('C1','C2') AND book_purpose IS NULL AND management_book_id IS NULL)));
CREATE UNIQUE INDEX payroll_hollow_policy_root ON payroll_hollow_policy_revisions(policy_id) WHERE previous_revision_id IS NULL;
CREATE UNIQUE INDEX payroll_hollow_policy_successor ON payroll_hollow_policy_revisions(previous_revision_id) WHERE previous_revision_id IS NOT NULL;
CREATE TABLE payroll_hollow_starts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    statement_id TEXT NOT NULL REFERENCES wage_statements(id),
    previous_start_id TEXT REFERENCES payroll_hollow_starts(id),
    command_id TEXT NOT NULL,
    start_json TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX payroll_hollow_start_root ON payroll_hollow_starts(statement_id) WHERE previous_start_id IS NULL;
CREATE UNIQUE INDEX payroll_hollow_start_successor ON payroll_hollow_starts(previous_start_id) WHERE previous_start_id IS NOT NULL;
CREATE TABLE payroll_hollow_adoptions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    statement_id TEXT NOT NULL REFERENCES wage_statements(id),
    start_id TEXT NOT NULL REFERENCES payroll_hollow_starts(id),
    record_id TEXT NOT NULL REFERENCES quantity_hollow_records(id),
    command_id TEXT NOT NULL,
    adoption_json TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(record_id));
CREATE TABLE payroll_batch_plans (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    origin TEXT NOT NULL CHECK(origin='real'),
    project_id TEXT NOT NULL REFERENCES projects(id),
    month TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK(purpose IN ('check','release')),
    schema_version INTEGER NOT NULL CHECK(schema_version=1),
    plan_json TEXT NOT NULL,
    plan_hash TEXT NOT NULL,
    base_payroll_revision INTEGER NOT NULL,
    expected_payroll_revision INTEGER NOT NULL,
    next_item_index INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL CHECK(state IN ('ready','prepared','needs-recheck','complete','unavailable')),
    created_at TEXT NOT NULL,
    confirmed_at TEXT NOT NULL
  );
CREATE TABLE payroll_batch_attempts (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES payroll_batch_plans(id),
    item_id TEXT NOT NULL,
    attempt_no INTEGER NOT NULL,
    prepare_command_id TEXT NOT NULL UNIQUE,
    execute_command_id TEXT NOT NULL UNIQUE,
    payroll_command_id TEXT NOT NULL UNIQUE,
    command_json TEXT NOT NULL,
    command_hash TEXT NOT NULL,
    execute_json TEXT NOT NULL,
    execute_hash TEXT NOT NULL,
    basis_hash TEXT NOT NULL,
    before_payroll_revision INTEGER NOT NULL,
    after_payroll_revision INTEGER,
    state TEXT NOT NULL CHECK(state IN ('prepared','checked','released','needs-recheck','not-applied','unavailable')),
    result_json TEXT,
    problem_json TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    UNIQUE(plan_id,item_id,attempt_no)
  );
CREATE UNIQUE INDEX payroll_batch_one_prepared_per_plan ON payroll_batch_attempts(plan_id) WHERE state='prepared';
CREATE TABLE payroll_batch_command_receipts (
    command_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    plan_id TEXT NOT NULL REFERENCES payroll_batch_plans(id),
    action TEXT NOT NULL CHECK(action IN ('confirm-batch','prepare-batch-item','execute-batch-original')),
    command_json TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
CREATE TABLE payroll_numbering_settings (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
    first_number INTEGER NOT NULL CHECK(first_number>0), next_number INTEGER NOT NULL CHECK(next_number>=first_number),
    evidence_note TEXT NOT NULL, initialized_at TEXT NOT NULL, operator_id TEXT NOT NULL);
CREATE TABLE payroll_official_issues (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    statement_id TEXT NOT NULL UNIQUE REFERENCES wage_statements(id), format_family TEXT NOT NULL,
    official_number TEXT NOT NULL, document_hash TEXT NOT NULL,
    issued_at TEXT NOT NULL, operator_id TEXT NOT NULL, command_id TEXT NOT NULL,
    UNIQUE(project_id,official_number));
CREATE TABLE payroll_workbook_archives(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scope_key TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, migration_batch_id TEXT, UNIQUE(scope_key,version));
CREATE TABLE payroll_workbook_receipts(command_id TEXT NOT NULL, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, project_id TEXT NOT NULL, fingerprint TEXT NOT NULL, command_json TEXT, result_json TEXT, archive_id TEXT, PRIMARY KEY(workspace_id,actor_id,command_id));
CREATE TABLE payroll_workbook_references(archive_id TEXT NOT NULL, table_name TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY(archive_id,table_name,record_id));
CREATE TABLE payroll_publication_migration_proofs(table_name TEXT NOT NULL,record_id TEXT NOT NULL,proof_json TEXT NOT NULL,PRIMARY KEY(table_name,record_id));
CREATE TABLE payroll_command_journal(workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,family TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT,scope_id TEXT NOT NULL,fingerprint TEXT NOT NULL,command_json TEXT,outcome TEXT NOT NULL CHECK(outcome IN ('applied','not-applied')),result_json TEXT,created_at TEXT NOT NULL,PRIMARY KEY(workspace_id,actor_id,command_id));
CREATE TABLE payroll_command_intents(workspace_id TEXT NOT NULL,actor_id TEXT NOT NULL,command_id TEXT NOT NULL,method TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT,command_json TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(workspace_id,actor_id,command_id));
CREATE TABLE payroll_source_imports(source_sha256 TEXT PRIMARY KEY,schema_version INTEGER NOT NULL,source_graph_json TEXT NOT NULL,evidence_json TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TRIGGER payroll_a_price_revisions_immutable_update BEFORE UPDATE ON payroll_a_price_revisions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_price_revisions_immutable_delete BEFORE DELETE ON payroll_a_price_revisions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_c1_rate_revisions_immutable_update BEFORE UPDATE ON payroll_c1_rate_revisions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_c1_rate_revisions_immutable_delete BEFORE DELETE ON payroll_c1_rate_revisions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_management_book_revisions_immutable_update BEFORE UPDATE ON payroll_a_management_book_revisions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_management_book_revisions_immutable_delete BEFORE DELETE ON payroll_a_management_book_revisions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_fee_revisions_immutable_update BEFORE UPDATE ON payroll_a_fee_revisions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_fee_revisions_immutable_delete BEFORE DELETE ON payroll_a_fee_revisions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_negative_lines_immutable_update BEFORE UPDATE ON payroll_a_negative_lines BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_negative_lines_immutable_delete BEFORE DELETE ON payroll_a_negative_lines BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_management_ownership_immutable_update BEFORE UPDATE ON payroll_a_management_ownership BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_management_ownership_immutable_delete BEFORE DELETE ON payroll_a_management_ownership BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_actual_events_immutable_update BEFORE UPDATE ON payroll_actual_events BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_actual_events_immutable_delete BEFORE DELETE ON payroll_actual_events BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_actual_allocations_immutable_update BEFORE UPDATE ON payroll_actual_allocations BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_actual_allocations_immutable_delete BEFORE DELETE ON payroll_actual_allocations BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_adjustment_applications_immutable_update BEFORE UPDATE ON payroll_adjustment_applications BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_adjustment_applications_immutable_delete BEFORE DELETE ON payroll_adjustment_applications BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_adjustment_coverage_immutable_update BEFORE UPDATE ON payroll_a_adjustment_coverage BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_a_adjustment_coverage_immutable_delete BEFORE DELETE ON payroll_a_adjustment_coverage BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_hollow_policy_revisions_immutable_update BEFORE UPDATE ON payroll_hollow_policy_revisions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_hollow_policy_revisions_immutable_delete BEFORE DELETE ON payroll_hollow_policy_revisions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_hollow_starts_immutable_update BEFORE UPDATE ON payroll_hollow_starts BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_hollow_starts_immutable_delete BEFORE DELETE ON payroll_hollow_starts BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_hollow_adoptions_immutable_update BEFORE UPDATE ON payroll_hollow_adoptions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_hollow_adoptions_immutable_delete BEFORE DELETE ON payroll_hollow_adoptions BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_official_issues_immutable_update BEFORE UPDATE ON payroll_official_issues BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_official_issues_immutable_delete BEFORE DELETE ON payroll_official_issues BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_command_receipts_immutable_update BEFORE UPDATE ON payroll_command_receipts BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_command_receipts_immutable_delete BEFORE DELETE ON payroll_command_receipts BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_batch_command_receipts_immutable_update BEFORE UPDATE ON payroll_batch_command_receipts BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_batch_command_receipts_immutable_delete BEFORE DELETE ON payroll_batch_command_receipts BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_workbook_archives_immutable_update BEFORE UPDATE ON payroll_workbook_archives BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_workbook_archives_immutable_delete BEFORE DELETE ON payroll_workbook_archives BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_workbook_receipts_immutable_update BEFORE UPDATE ON payroll_workbook_receipts BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_workbook_receipts_immutable_delete BEFORE DELETE ON payroll_workbook_receipts BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_workbook_references_immutable_update BEFORE UPDATE ON payroll_workbook_references BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_workbook_references_immutable_delete BEFORE DELETE ON payroll_workbook_references BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_publication_migration_proofs_immutable_update BEFORE UPDATE ON payroll_publication_migration_proofs BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_publication_migration_proofs_immutable_delete BEFORE DELETE ON payroll_publication_migration_proofs BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_command_journal_immutable_update BEFORE UPDATE ON payroll_command_journal BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_command_journal_immutable_delete BEFORE DELETE ON payroll_command_journal BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_source_imports_immutable_update BEFORE UPDATE ON payroll_source_imports BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_source_imports_immutable_delete BEFORE DELETE ON payroll_source_imports BEGIN SELECT RAISE(ABORT,'Frozen payroll history cannot be replaced'); END;
CREATE TRIGGER payroll_released_head_update BEFORE UPDATE ON wage_statements WHEN OLD.status='released' BEGIN SELECT RAISE(ABORT,'Released payroll cannot be replaced'); END;
CREATE TRIGGER payroll_released_head_delete BEFORE DELETE ON wage_statements WHEN OLD.status='released' BEGIN SELECT RAISE(ABORT,'Released payroll cannot be deleted'); END;
CREATE TRIGGER wage_statement_lines_released_update BEFORE UPDATE ON wage_statement_lines WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER wage_statement_lines_released_delete BEFORE DELETE ON wage_statement_lines WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER wage_statement_members_released_update BEFORE UPDATE ON wage_statement_members WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER wage_statement_members_released_delete BEFORE DELETE ON wage_statement_members WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER wage_statement_allocations_released_update BEFORE UPDATE ON wage_statement_allocations WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER wage_statement_allocations_released_delete BEFORE DELETE ON wage_statement_allocations WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER wage_statement_daywork_records_released_update BEFORE UPDATE ON wage_statement_daywork_records WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER wage_statement_daywork_records_released_delete BEFORE DELETE ON wage_statement_daywork_records WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER payroll_a_statement_sources_released_update BEFORE UPDATE ON payroll_a_statement_sources WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER payroll_a_statement_sources_released_delete BEFORE DELETE ON payroll_a_statement_sources WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER payroll_c1_statement_sources_released_update BEFORE UPDATE ON payroll_c1_statement_sources WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER payroll_c1_statement_sources_released_delete BEFORE DELETE ON payroll_c1_statement_sources WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER payroll_c2_statement_sources_released_update BEFORE UPDATE ON payroll_c2_statement_sources WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER payroll_c2_statement_sources_released_delete BEFORE DELETE ON payroll_c2_statement_sources WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER payroll_a_statement_books_released_update BEFORE UPDATE ON payroll_a_statement_books WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER payroll_a_statement_books_released_delete BEFORE DELETE ON payroll_a_statement_books WHEN EXISTS(SELECT 1 FROM wage_statements WHERE id=OLD.statement_id AND status='released') BEGIN SELECT RAISE(ABORT,'Released payroll evidence cannot be replaced'); END;
CREATE TRIGGER payroll_command_intents_immutable_update BEFORE UPDATE ON payroll_command_intents BEGIN SELECT RAISE(ABORT,'Frozen payroll intent cannot be replaced'); END;
CREATE TRIGGER payroll_command_intents_immutable_delete BEFORE DELETE ON payroll_command_intents BEGIN SELECT RAISE(ABORT,'Frozen payroll intent cannot be deleted'); END;
CREATE TRIGGER payroll_batch_plan_original_update BEFORE UPDATE ON payroll_batch_plans WHEN NEW.plan_json<>OLD.plan_json OR NEW.plan_hash<>OLD.plan_hash OR NEW.workspace_id<>OLD.workspace_id OR NEW.actor_id<>OLD.actor_id OR NEW.project_id<>OLD.project_id OR NEW.created_at<>OLD.created_at BEGIN SELECT RAISE(ABORT,'Frozen payroll plan cannot be replaced'); END;
CREATE TRIGGER payroll_batch_attempt_original_update BEFORE UPDATE ON payroll_batch_attempts WHEN NEW.command_json<>OLD.command_json OR NEW.command_hash<>OLD.command_hash OR NEW.execute_json<>OLD.execute_json OR NEW.execute_hash<>OLD.execute_hash OR NEW.payroll_command_id<>OLD.payroll_command_id OR NEW.execute_command_id<>OLD.execute_command_id OR NEW.prepare_command_id<>OLD.prepare_command_id OR NEW.plan_id<>OLD.plan_id BEGIN SELECT RAISE(ABORT,'Frozen payroll original attempt cannot be replaced'); END;
INSERT INTO production_participants VALUES('payroll',1);
`
