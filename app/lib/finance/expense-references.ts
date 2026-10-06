import type { TransactionDb } from '~/lib/db/coordinator'
import { normalizeSqlDefinition } from '../db/schema-evidence'

export const EXPENSE_REFERENCE_GUARDS = [
  `CREATE TRIGGER IF NOT EXISTS expense_original_reference_insert
    BEFORE INSERT ON expense_reimbursement_lines
    WHEN NEW.original_expense_line_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM expense_reimbursement_lines AS original
        JOIN expense_reimbursements AS owner ON owner.id = original.reimbursement_id
        JOIN expense_reimbursements AS current_owner ON current_owner.id = NEW.reimbursement_id
        WHERE original.id = NEW.original_expense_line_id
          AND original.deleted_at IS NULL AND owner.deleted_at IS NULL AND owner.status = 'confirmed'
          AND original.original_expense_line_id IS NULL AND original.reimbursement_id <> NEW.reimbursement_id
          AND owner.project_id IS current_owner.project_id
      ) THEN RAISE(ABORT, '原费用引用必须为同归属的已确认独立费用') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS expense_original_reference_update
    BEFORE UPDATE OF original_expense_line_id,reimbursement_id ON expense_reimbursement_lines
    WHEN NEW.original_expense_line_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM expense_reimbursement_lines AS original
        JOIN expense_reimbursements AS owner ON owner.id = original.reimbursement_id
        JOIN expense_reimbursements AS current_owner ON current_owner.id = NEW.reimbursement_id
        WHERE original.id = NEW.original_expense_line_id
          AND original.deleted_at IS NULL AND owner.deleted_at IS NULL AND owner.status = 'confirmed'
          AND original.original_expense_line_id IS NULL AND original.reimbursement_id <> NEW.reimbursement_id
          AND owner.project_id IS current_owner.project_id
      ) THEN RAISE(ABORT, '原费用引用必须为同归属的已确认独立费用') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS expense_adopted_reference_preserve
    BEFORE UPDATE OF original_expense_line_id ON expense_reimbursement_lines
    WHEN OLD.original_expense_line_id IS NOT NULL AND NEW.original_expense_line_id IS NOT OLD.original_expense_line_id
    BEGIN SELECT RAISE(ABORT, '已采用的原费用引用须保全，修正请保留原行并新增'); END`,
  `CREATE TRIGGER IF NOT EXISTS expense_adopted_reference_delete
    BEFORE DELETE ON expense_reimbursement_lines
    WHEN OLD.original_expense_line_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT, '已采用的原费用引用历史不可删除'); END`,
  `CREATE TRIGGER IF NOT EXISTS expense_referenced_source_update
    BEFORE UPDATE ON expense_reimbursement_lines
    WHEN EXISTS (SELECT 1 FROM expense_reimbursement_lines WHERE original_expense_line_id = OLD.id)
      AND (NEW.reimbursement_id IS NOT OLD.reimbursement_id OR NEW.expense_item IS NOT OLD.expense_item
        OR NEW.expense_date IS NOT OLD.expense_date OR NEW.amount IS NOT OLD.amount
        OR NEW.original_expense_line_id IS NOT OLD.original_expense_line_id OR NEW.deleted_at IS NOT OLD.deleted_at)
    BEGIN SELECT RAISE(ABORT, '已被原费用引用采用的事实不可改写或删除'); END`,
  `CREATE TRIGGER IF NOT EXISTS expense_referenced_source_delete
    BEFORE DELETE ON expense_reimbursement_lines
    WHEN EXISTS (SELECT 1 FROM expense_reimbursement_lines WHERE original_expense_line_id = OLD.id)
    BEGIN SELECT RAISE(ABORT, '已被原费用引用采用的事实不可删除'); END`,
  `CREATE TRIGGER IF NOT EXISTS expense_referenced_owner_update
    BEFORE UPDATE OF project_id,status,deleted_at ON expense_reimbursements
    WHEN (NEW.project_id IS NOT OLD.project_id OR NEW.status IS NOT OLD.status OR NEW.deleted_at IS NOT OLD.deleted_at)
      AND EXISTS (
        SELECT 1 FROM expense_reimbursement_lines AS original
        JOIN expense_reimbursement_lines AS reference ON reference.original_expense_line_id = original.id
        WHERE original.reimbursement_id = OLD.id
      )
    BEGIN SELECT RAISE(ABORT, '已被原费用引用采用的归属和确认事实不可改写'); END`,
  `CREATE TRIGGER IF NOT EXISTS expense_referenced_owner_delete
    BEFORE DELETE ON expense_reimbursements
    WHEN EXISTS (
      SELECT 1 FROM expense_reimbursement_lines AS original
      JOIN expense_reimbursement_lines AS reference ON reference.original_expense_line_id = original.id
      WHERE original.reimbursement_id = OLD.id
    )
    BEGIN SELECT RAISE(ABORT, '已被原费用引用采用的报销原事实不可删除'); END`,
  `CREATE TRIGGER IF NOT EXISTS expense_reference_owner_update
    BEFORE UPDATE OF project_id ON expense_reimbursements
    WHEN NEW.project_id IS NOT OLD.project_id
      AND EXISTS (SELECT 1 FROM expense_reimbursement_lines WHERE reimbursement_id = OLD.id AND original_expense_line_id IS NOT NULL)
    BEGIN SELECT RAISE(ABORT, '已采用的原费用引用不可更换项目或公司归属'); END`,
] as const

/** Read-only proof of the original-fee identity and immutable adopted history. */
export async function validateFinanceExpenseReferenceGuards(db: Pick<TransactionDb, 'select'>): Promise<void> {
  for (const definition of EXPENSE_REFERENCE_GUARDS) {
    const name = /^CREATE TRIGGER IF NOT EXISTS (\w+)/.exec(definition)?.[1]
    const actual = (await db.select<{ type: string, sql: string }>('SELECT type,sql FROM sqlite_schema WHERE name=?', [name]))[0]
    if (!actual || actual.type !== 'trigger' || typeof actual.sql !== 'string' || normalizeSqlDefinition(actual.sql) !== normalizeSqlDefinition(definition))
      throw new Error('原费用引用与冻结保护结构损坏，请保留原库并核对迁移')
  }
}

/** 既有费用行是原费用身份；本模块只建立明示引用，不创建人员或交易方目录。 */
export async function migrateExpenseReferences(db: TransactionDb): Promise<void> {
  const columns = await db.select<{ name: string }>('SELECT name FROM pragma_table_info(?)', ['expense_reimbursement_lines'])
  if (!columns.some(column => column.name === 'original_expense_line_id')) {
    await db.execute(`ALTER TABLE expense_reimbursement_lines
      ADD COLUMN original_expense_line_id TEXT REFERENCES expense_reimbursement_lines(id)
      CHECK(original_expense_line_id IS NULL OR original_expense_line_id <> id)`)
  }
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_expense_original_reference
    ON expense_reimbursement_lines(original_expense_line_id) WHERE original_expense_line_id IS NOT NULL`)
  for (const statement of EXPENSE_REFERENCE_GUARDS)
    await db.execute(statement)
  await validateFinanceExpenseReferenceGuards(db)
}

export interface OriginalExpenseReference {
  id: string
  reimbursementId: string
  projectId: string | null
  item: string
  amount: number
  applicant: string
}

export async function originalExpenseReference(db: Pick<TransactionDb, 'select'>, id: string): Promise<OriginalExpenseReference | null> {
  const [row] = await db.select<OriginalExpenseReference>(`
    SELECT line.id, line.reimbursement_id AS reimbursementId, owner.project_id AS projectId,
      line.expense_item AS item, line.amount, owner.applicant
    FROM expense_reimbursement_lines AS line
    JOIN expense_reimbursements AS owner ON owner.id = line.reimbursement_id
    LEFT JOIN projects AS project ON project.id = owner.project_id
    WHERE line.id = ? AND line.deleted_at IS NULL AND owner.deleted_at IS NULL
      AND owner.status = 'confirmed' AND line.original_expense_line_id IS NULL
      AND (owner.project_id IS NULL OR (project.id IS NOT NULL AND project.deleted_at IS NULL))
  `, [id])
  return row ?? null
}
