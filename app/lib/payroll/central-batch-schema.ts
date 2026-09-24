import type { TransactionDb } from '../db/coordinator'

/** P7 协调表只保存不可变计划、原命令及执行证明，不构成第二套工资现金事实。 */
export async function initializePayrollBatchSchema(tx: TransactionDb): Promise<void> {
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_batch_plans (
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
  )`)
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_batch_attempts (
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
  )`)
  await tx.execute('CREATE UNIQUE INDEX IF NOT EXISTS payroll_batch_one_prepared_per_plan ON payroll_batch_attempts(plan_id) WHERE state=\'prepared\'')
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_batch_command_receipts (
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
  )`)
}
