import type { TransactionDb } from '../db/coordinator'

export async function initializePayrollAdjustmentSchema(tx: TransactionDb) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_adjustments (
    id TEXT PRIMARY KEY, root_adjustment_id TEXT NOT NULL, corrects_adjustment_id TEXT,
    original_statement_id TEXT NOT NULL REFERENCES wage_statements(id), project_id TEXT NOT NULL REFERENCES projects(id),
    format_family TEXT NOT NULL CHECK(format_family IN ('A','C1','C2')),
    status TEXT NOT NULL CHECK(status IN ('draft','confirmed')), reason TEXT NOT NULL, evidence_note TEXT NOT NULL,
    basis_json TEXT NOT NULL, signed_delta_fen INTEGER, confirmed_snapshot_json TEXT,
    created_by TEXT NOT NULL, confirmed_by TEXT, confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_actual_events (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL CHECK(kind IN ('supplement','refund','recording-reversal')), occurred_on TEXT NOT NULL,
    signed_amount_fen INTEGER NOT NULL, proof_json TEXT NOT NULL, confirmed_snapshot_json TEXT NOT NULL,
    reverses_kind TEXT, reverses_id TEXT,
    confirmed_by TEXT NOT NULL, confirmed_at TEXT NOT NULL)`)
  const eventColumns = await tx.select<{ name: string }>('PRAGMA table_info(payroll_actual_events)')
  for (const name of ['reverses_kind', 'reverses_id']) {
    if (!eventColumns.some(c => c.name === name))
      await tx.execute(`ALTER TABLE payroll_actual_events ADD COLUMN ${name} TEXT`)
  }
  await tx.execute('CREATE UNIQUE INDEX IF NOT EXISTS payroll_unique_recording_reversal ON payroll_actual_events(reverses_kind,reverses_id) WHERE kind=\'recording-reversal\'')
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_actual_allocations (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES payroll_actual_events(id), worker_id TEXT NOT NULL REFERENCES workers(id),
    signed_amount_fen INTEGER NOT NULL, proof_json TEXT NOT NULL, UNIQUE(event_id,worker_id))`)
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_adjustment_applications (
    id TEXT PRIMARY KEY, adjustment_id TEXT NOT NULL REFERENCES payroll_adjustments(id), root_adjustment_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('actual-payment','later-release','recording-reversal')),
    signed_applied_fen INTEGER NOT NULL, actual_event_id TEXT REFERENCES payroll_actual_events(id),
    released_statement_id TEXT REFERENCES wage_statements(id), balance_version TEXT NOT NULL, proof_json TEXT NOT NULL,
    CHECK((actual_event_id IS NOT NULL AND released_statement_id IS NULL) OR (actual_event_id IS NULL AND released_statement_id IS NOT NULL)))`)
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_adjustment_coverage (
    id TEXT PRIMARY KEY, adjustment_id TEXT NOT NULL REFERENCES payroll_adjustments(id),
    statement_id TEXT NOT NULL REFERENCES wage_statements(id), component_key TEXT NOT NULL,
    command_id TEXT NOT NULL, source_version TEXT NOT NULL, coverage_json TEXT NOT NULL,
    UNIQUE(statement_id,adjustment_id,component_key))`)
}
