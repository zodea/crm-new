import type { TransactionDb } from '../db/coordinator'

/**
 * B 迁移扩展 fees:{schemaVersion:1,tables:{...}} 的唯一白名单。
 * 外层 graph V3 承接本扩展；原 central V1 十二表及外层 V1/V2 合同不扩必填表。
 * 所有 *_json 原文逐字运输；仅 SQL 身份列单独映射，不递归替换原 JSON。
 */
export const PAYROLL_A_FEES_MIGRATION_COLUMNS = {
  payroll_a_management_books: ['id', 'project_id', 'manager_worker_id', 'created_by', 'created_at', 'deleted_at'],
  payroll_a_management_book_revisions: ['id', 'management_book_id', 'project_id', 'revision', 'effective_month', 'management_mode', 'scope_json', 'initial_pay_ratio', 'evidence_note', 'source_version', 'operator_id', 'created_at'],
  payroll_a_fee_revisions: ['id', 'fee_id', 'project_id', 'crew_id', 'leader_worker_id', 'book_purpose', 'management_book_id', 'kind', 'name', 'enabled', 'unit_price', 'unit', 'basis_json', 'effective_month', 'adopted_default_json', 'revision', 'removed', 'operator_id', 'created_at'],
  payroll_a_statement_books: ['statement_id', 'project_id', 'leader_worker_id', 'book_purpose', 'management_book_id', 'month', 'period_kind'],
  payroll_a_negative_lines: ['id', 'line_id', 'statement_id', 'project_id', 'management_book_id', 'management_revision_id', 'revision', 'label', 'quantity', 'unit', 'unit_price', 'signed_amount_fen', 'scope_json', 'reason', 'evidence_note', 'actual_ref_json', 'removed', 'operator_id', 'created_at'],
  payroll_a_management_ownership: ['id', 'project_id', 'ownership_key', 'management_book_id', 'first_statement_id', 'proof_json'],
} as const

export type PayrollAFeesMigrationTable = keyof typeof PAYROLL_A_FEES_MIGRATION_COLUMNS
export const PAYROLL_A_FEES_MIGRATION_TABLES = Object.keys(PAYROLL_A_FEES_MIGRATION_COLUMNS) as PayrollAFeesMigrationTable[]

export function payrollAFeesPrimaryKey(table: PayrollAFeesMigrationTable): string {
  return table === 'payroll_a_statement_books' ? 'statement_id' : 'id'
}

/**
 * JSON 字段的唯一合同均定义于 central-a-fees-contract.ts：
 * - management_book_revisions.scope_json = PayrollAManagementScope。
 * - fee_revisions.basis_json = PayrollAFeeBasis；adopted_default_json = PayrollAFeeDefaultAdoption|null（JSON 文本）。
 * - negative_lines.scope_json = PayrollAManagementScope；actual_ref_json = PayrollActualRef|null（JSON 文本）。
 * - management_ownership.proof_json = PayrollAManagementOwnershipProof；SQL 归属与原证明逐项相符。
 * 新单仍在 payroll_a_statement_sources.source_json 保存 PayrollAStatementSourceSnapshotV2；旧 V1 不改写。
 * 新命令共用 payroll_command_receipts：command_json = PayrollAFeesCommand 原正文，config_scope_json = PayrollAFeeConfigScope|null。
 * 审计仍使用原 change_logs。恢复必须检查本六表、旧中央表、P4 引用和 receipt，不只检查已发工资头。
 *
 * revision 行是追加事实；removed 修订保留正文，不物理删除。statement_books 在首次存稿原子落库，
 * 同簿/期间唯一性含软删头，不能因移除工资头或退款而解除。旧无用途证据的头不自动补 ordinary。
 * project/owner/revision 同源、范围非空、JSON 白名单、分精度及权限由同事务命令严格验证。
 */
export async function initializePayrollAFeesSchema(tx: TransactionDb) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_management_books (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    manager_worker_id TEXT REFERENCES workers(id),
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT)`)

  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_management_book_revisions (
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
    UNIQUE(management_book_id,revision))`)

  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_fee_revisions (
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
    UNIQUE(fee_id,revision))`)

  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_statement_books (
    statement_id TEXT PRIMARY KEY REFERENCES wage_statements(id) DEFERRABLE INITIALLY DEFERRED,
    project_id TEXT NOT NULL REFERENCES projects(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id),
    book_purpose TEXT NOT NULL CHECK(book_purpose IN ('ordinary','management')),
    management_book_id TEXT REFERENCES payroll_a_management_books(id),
    month TEXT NOT NULL,
    period_kind TEXT NOT NULL CHECK(period_kind IN ('monthly','settlement','retention')),
    CHECK((book_purpose='ordinary' AND management_book_id IS NULL)
      OR (book_purpose='management' AND management_book_id IS NOT NULL)))`)

  await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS payroll_a_ordinary_book_period
    ON payroll_a_statement_books(project_id,leader_worker_id,month,period_kind) WHERE book_purpose='ordinary'`)
  await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS payroll_a_management_book_period
    ON payroll_a_statement_books(management_book_id,month,period_kind) WHERE book_purpose='management'`)

  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_negative_lines (
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
    UNIQUE(line_id,revision))`)

  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_management_ownership (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    ownership_key TEXT NOT NULL,
    management_book_id TEXT NOT NULL REFERENCES payroll_a_management_books(id),
    first_statement_id TEXT NOT NULL REFERENCES wage_statements(id),
    proof_json TEXT NOT NULL,
    UNIQUE(project_id,ownership_key))`)

  // 原索引无法跨表识别用途。非 A 原约束不变；A 在关系先行的同事务内按真实簿检查。
  await tx.execute('DROP INDEX IF EXISTS uq_wage_statement_book_period')
  await tx.execute(`CREATE UNIQUE INDEX IF NOT EXISTS uq_wage_statement_non_a_book_period
    ON wage_statements(project_id,leader_worker_id,month,format_family,period_kind)
    WHERE deleted_at IS NULL AND format_family <> 'A'`)
  for (const action of ['INSERT', 'UPDATE'] as const) {
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS payroll_a_book_period_${action.toLowerCase()}
      BEFORE ${action} ON wage_statements
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
      END`)
  }
}
