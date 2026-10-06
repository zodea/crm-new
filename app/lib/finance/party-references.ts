import type { FinanceReferenceResolver } from './reference'
import type { TransactionDb } from '~/lib/db/coordinator'
import { normalizeSqlDefinition } from '../db/schema-evidence'

export interface FinancePartyInput {
  workerId?: string | null
  supplierId?: string | null
  nameSnapshot?: string | null
}
export interface FinancePartySnapshot {
  workerId: string | null
  supplierId: string | null
  nameSnapshot: string | null
}

/** 名称只作采用时快照；稳定身份始终来自同一资料库的明示选择。 */
export async function financePartySnapshot(
  db: Pick<TransactionDb, 'select'>,
  input: FinancePartyInput,
  previous?: FinancePartySnapshot,
  references?: FinanceReferenceResolver,
): Promise<FinancePartySnapshot> {
  const workerId = input.workerId?.trim() || null
  const supplierId = input.supplierId?.trim() || null
  if (workerId && supplierId)
    throw new Error('工人与分供方身份不能同时选择')
  if (!workerId && !supplierId)
    return { workerId: null, supplierId: null, nameSnapshot: null }
  if (previous?.workerId === workerId && previous.supplierId === supplierId && previous.nameSnapshot)
    return previous
  const table = workerId ? 'workers' : 'suppliers'
  const row = references
    ? await references.read<{ id: string, name: string }>(table, (workerId ?? supplierId)!)
    : (await db.select<{ id: string, name: string }>(
        `SELECT id,name FROM "${table}" WHERE id = ? AND deleted_at IS NULL`,
        [workerId ?? supplierId],
      ))[0]
  if (!row || !row.name.trim())
    throw new Error('所选工人或分供方不存在或已删除，请重新核实')
  return { workerId, supplierId, nameSnapshot: row.name }
}

export const FINANCE_EXPENSE_PARTY_GUARDS = [
  ...(['INSERT', 'UPDATE'] as const).map(action => ({ name: `expense_applicant_identity_${action.toLowerCase()}`, sql: `CREATE TRIGGER IF NOT EXISTS expense_applicant_identity_${action.toLowerCase()}
      BEFORE ${action} ON expense_reimbursements
      WHEN NEW.applicant_worker_id IS NOT NULL AND NEW.applicant_supplier_id IS NOT NULL
      BEGIN SELECT RAISE(ABORT, '工人与分供方报销身份不能同时选择'); END` })),
  { name: 'expense_referenced_party_preserve', sql: `CREATE TRIGGER IF NOT EXISTS expense_referenced_party_preserve
    BEFORE UPDATE OF applicant_worker_id,applicant_supplier_id,applicant_name_snapshot ON expense_reimbursements
    WHEN (NEW.applicant_worker_id IS NOT OLD.applicant_worker_id OR NEW.applicant_supplier_id IS NOT OLD.applicant_supplier_id
      OR NEW.applicant_name_snapshot IS NOT OLD.applicant_name_snapshot)
      AND EXISTS (SELECT 1 FROM expense_reimbursement_lines AS original
        JOIN expense_reimbursement_lines AS adopted ON adopted.original_expense_line_id = original.id
        WHERE original.reimbursement_id = OLD.id)
    BEGIN SELECT RAISE(ABORT, '已被采用的费用垫付身份不可改写'); END` },
  { name: 'expense_referenced_counterparty_preserve', sql: `CREATE TRIGGER IF NOT EXISTS expense_referenced_counterparty_preserve
    BEFORE UPDATE OF counterparty_supplier_id,counterparty_name_snapshot ON expense_reimbursement_lines
    WHEN (NEW.counterparty_supplier_id IS NOT OLD.counterparty_supplier_id OR NEW.counterparty_name_snapshot IS NOT OLD.counterparty_name_snapshot)
      AND EXISTS (SELECT 1 FROM expense_reimbursement_lines WHERE original_expense_line_id = OLD.id)
    BEGIN SELECT RAISE(ABORT, '已被采用的费用交易方不可改写'); END` },
] as const
export async function validateFinanceExpensePartyGuards(db: Pick<TransactionDb, 'select'>) {
  for (const guard of FINANCE_EXPENSE_PARTY_GUARDS) {
    const actual = (await db.select<{ type: string, sql: string }>('SELECT type,sql FROM sqlite_schema WHERE name=?', [guard.name]))[0]
    if (!actual || actual.type !== 'trigger' || typeof actual.sql !== 'string' || normalizeSqlDefinition(actual.sql) !== normalizeSqlDefinition(guard.sql))
      throw new Error('费用真实身份与冻结保护结构不完整，请保留原库并核对迁移')
  }
}

export async function migrateFinancePartyReferences(db: TransactionDb): Promise<void> {
  const targets = [
    ['current_transactions', 'supplier_id', 'TEXT REFERENCES suppliers(id)'],
    ['current_transactions', 'counterparty_name_snapshot', 'TEXT'],
    ['expense_reimbursements', 'applicant_worker_id', 'TEXT REFERENCES workers(id)'],
    ['expense_reimbursements', 'applicant_supplier_id', 'TEXT REFERENCES suppliers(id)'],
    ['expense_reimbursements', 'applicant_name_snapshot', 'TEXT'],
    ['expense_reimbursement_lines', 'counterparty_supplier_id', 'TEXT REFERENCES suppliers(id)'],
    ['expense_reimbursement_lines', 'counterparty_name_snapshot', 'TEXT'],
  ] as const
  for (const [table, column, definition] of targets) {
    const columns = await db.select<{ name: string }>('SELECT name FROM pragma_table_info(?)', [table])
    if (!columns.some(item => item.name === column))
      await db.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
  }
  for (const guard of FINANCE_EXPENSE_PARTY_GUARDS)
    await db.execute(guard.sql)
  await validateFinanceExpensePartyGuards(db)
}
