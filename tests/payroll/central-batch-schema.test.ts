import { afterEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../app/lib/db/migrations'
import { initializePayrollARoundingSchema } from '../../app/lib/payroll/central-a-rounding-schema'
import { initializePayrollBatchSchema } from '../../app/lib/payroll/central-batch-schema'
import { createMemoryDb } from '../helpers/memory-db'

const closers: Array<() => Promise<void>> = []
afterEach(async () => Promise.all(closers.splice(0).map(close => close())))

describe('central payroll batch schema', () => {
  it('creates durable immutable plans, one prepared attempt and idempotent coordination receipts', async () => {
    const db = await createMemoryDb()
    closers.push(() => db.close())
    await runMigrations(db)
    await initializePayrollBatchSchema(db)

    const tables = (await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name LIKE \'payroll_batch_%\' ORDER BY name')).map(row => row.name)
    expect(tables).toEqual(['payroll_batch_attempts', 'payroll_batch_command_receipts', 'payroll_batch_plans'])
    expect((await db.select<{ name: string }>('PRAGMA table_info(payroll_batch_plans)')).map(row => row.name)).toEqual([
      'id',
      'workspace_id',
      'actor_id',
      'origin',
      'project_id',
      'month',
      'purpose',
      'schema_version',
      'plan_json',
      'plan_hash',
      'base_payroll_revision',
      'expected_payroll_revision',
      'next_item_index',
      'revision',
      'state',
      'created_at',
      'confirmed_at',
    ])
    expect((await db.select<{ name: string }>('PRAGMA table_info(payroll_batch_attempts)')).map(row => row.name)).toEqual([
      'id',
      'plan_id',
      'item_id',
      'attempt_no',
      'prepare_command_id',
      'execute_command_id',
      'payroll_command_id',
      'command_json',
      'command_hash',
      'execute_json',
      'execute_hash',
      'basis_hash',
      'before_payroll_revision',
      'after_payroll_revision',
      'state',
      'result_json',
      'problem_json',
      'created_at',
      'finished_at',
    ])
    const indexes = await db.select<{ name: string, sql: string }>('SELECT name,sql FROM sqlite_master WHERE type=\'index\' AND tbl_name=\'payroll_batch_attempts\'')
    expect(indexes).toContainEqual(expect.objectContaining({ name: 'payroll_batch_one_prepared_per_plan', sql: expect.stringContaining('WHERE state=\'prepared\'') }))
  })

  it('stores explicit A rounding revisions without giving C formats a default', async () => {
    const db = await createMemoryDb()
    closers.push(() => db.close())
    await runMigrations(db)
    await initializePayrollARoundingSchema(db)
    expect((await db.select<{ name: string }>('PRAGMA table_info(payroll_a_rounding_revisions)')).map(row => row.name)).toEqual([
      'id',
      'project_id',
      'leader_worker_id',
      'book_purpose',
      'management_book_id',
      'effective_month',
      'revision',
      'rule_json',
      'operator_id',
      'created_at',
    ])
  })
})
