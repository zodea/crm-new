import type { TransactionDb } from '../db/coordinator'

/** 外层工资graph新版本的 deductions 子图；旧central/fees名单和原文保持原合同。 */
export const PAYROLL_HOLLOW_DEDUCTION_COLUMNS = {
  payroll_hollow_policy_revisions: ['id', 'policy_id', 'project_id', 'crew_id', 'leader_worker_id', 'format_family', 'book_purpose', 'management_book_id', 'item_id', 'previous_revision_id', 'effective_month', 'enabled', 'unit_amount', 'command_id', 'revision_json', 'created_by', 'created_at'],
  payroll_hollow_starts: ['id', 'project_id', 'statement_id', 'previous_start_id', 'command_id', 'start_json', 'created_by', 'created_at'],
  payroll_hollow_adoptions: ['id', 'project_id', 'statement_id', 'start_id', 'record_id', 'command_id', 'adoption_json', 'created_by', 'created_at'],
} as const

export type PayrollHollowDeductionTable = keyof typeof PAYROLL_HOLLOW_DEDUCTION_COLUMNS
export const PAYROLL_HOLLOW_DEDUCTION_TABLES = Object.keys(PAYROLL_HOLLOW_DEDUCTION_COLUMNS) as PayrollHollowDeductionTable[]
export const PAYROLL_HOLLOW_DEDUCTION_SCHEMA_VERSION = 1 as const

/**
 * JSON原文分别为PolicyRevision、Start、Adoption，均严格逐字段与SQL及命令回执交叉证明。
 * native命令共用payroll_command_receipts与operation_logs；迁入只映SQL身份，原JSON不改。
 * 全部记录不可变追加，无deleted_at，也不通过业务页面物理删除。源恢复保护另走候选库。
 */
export async function initializePayrollHollowDeductionSchema(tx: TransactionDb) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_hollow_policy_revisions (
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
      OR (format_family IN ('C1','C2') AND book_purpose IS NULL AND management_book_id IS NULL)))`)
  await tx.execute('CREATE UNIQUE INDEX IF NOT EXISTS payroll_hollow_policy_root ON payroll_hollow_policy_revisions(policy_id) WHERE previous_revision_id IS NULL')
  await tx.execute('CREATE UNIQUE INDEX IF NOT EXISTS payroll_hollow_policy_successor ON payroll_hollow_policy_revisions(previous_revision_id) WHERE previous_revision_id IS NOT NULL')

  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_hollow_starts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    statement_id TEXT NOT NULL REFERENCES wage_statements(id),
    previous_start_id TEXT REFERENCES payroll_hollow_starts(id),
    command_id TEXT NOT NULL,
    start_json TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL)`)
  await tx.execute('CREATE UNIQUE INDEX IF NOT EXISTS payroll_hollow_start_root ON payroll_hollow_starts(statement_id) WHERE previous_start_id IS NULL')
  await tx.execute('CREATE UNIQUE INDEX IF NOT EXISTS payroll_hollow_start_successor ON payroll_hollow_starts(previous_start_id) WHERE previous_start_id IS NOT NULL')

  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_hollow_adoptions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    statement_id TEXT NOT NULL REFERENCES wage_statements(id),
    start_id TEXT NOT NULL REFERENCES payroll_hollow_starts(id),
    record_id TEXT NOT NULL REFERENCES quantity_hollow_records(id),
    command_id TEXT NOT NULL,
    adoption_json TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(record_id))`)
}
