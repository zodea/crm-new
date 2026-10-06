import type { TransactionDb } from '../db/coordinator'
import { normalizeSqlDefinition } from '../db/schema-evidence'

/** Existing v22 inner-owner protection, shared by Native and the formal finance owner. */
export const FINANCE_PAYMENT_ALLOCATION_GUARDS = `
CREATE TRIGGER IF NOT EXISTS trg_payment_confirmation_balanced
BEFORE UPDATE OF confirmation_status ON payment_records
WHEN NEW.confirmation_status = 'confirmed'
  AND OLD.confirmation_status <> 'confirmed'
BEGIN
  SELECT CASE
    WHEN ABS(
      COALESCE((
        SELECT SUM(allocation.allocated_amount)
        FROM payment_record_application_allocations AS allocation
        WHERE allocation.payment_record_id = NEW.id
          AND allocation.deleted_at IS NULL
      ), 0) - NEW.amount
    ) > 0.0001
    THEN RAISE(ABORT, '支付分摊合计必须等于支付金额')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_confirmed_payment_allocation_insert
BEFORE INSERT ON payment_record_application_allocations
WHEN EXISTS (
  SELECT 1 FROM payment_records
  WHERE id = NEW.payment_record_id
    AND confirmation_status = 'confirmed'
    AND deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, '已确认支付需先撤回再修改分摊');
END;

CREATE TRIGGER IF NOT EXISTS trg_confirmed_payment_allocation_update
BEFORE UPDATE ON payment_record_application_allocations
WHEN EXISTS (
  SELECT 1 FROM payment_records
  WHERE id = NEW.payment_record_id
    AND confirmation_status = 'confirmed'
    AND deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, '已确认支付需先撤回再修改分摊');
END;

CREATE TRIGGER IF NOT EXISTS trg_confirmed_payment_allocation_delete
BEFORE DELETE ON payment_record_application_allocations
WHEN EXISTS (
  SELECT 1 FROM payment_records
  WHERE id = OLD.payment_record_id
    AND confirmation_status = 'confirmed'
    AND deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, '已确认支付需先撤回再修改分摊');
END;
`

export async function validateFinancePaymentAllocationGuards(db: Pick<TransactionDb, 'select'>): Promise<void> {
  const definitions = FINANCE_PAYMENT_ALLOCATION_GUARDS.match(/CREATE TRIGGER[\s\S]+?^END;/gm) ?? []
  for (const definition of definitions) {
    const name = /^CREATE TRIGGER IF NOT EXISTS (\w+)/.exec(definition)?.[1]
    const actual = (await db.select<{ type: string, sql: string }>('SELECT type,sql FROM sqlite_schema WHERE name=?', [name]))[0]
    if (!actual || actual.type !== 'trigger' || normalizeSqlDefinition(actual.sql) !== normalizeSqlDefinition(definition))
      throw new Error('支付确认与分摊保护结构损坏，请保留原库并核对迁移')
  }
}
