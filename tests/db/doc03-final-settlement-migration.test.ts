import { describe, expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { columnNames, createMemoryDb } from '../helpers/memory-db'

describe('v45 甲方最终结算审定事实迁移', () => {
  it('只增加可空审定事实列，既有记录不做推断回填', async () => {
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(migration => migration.version <= 44))
    await db.execute(`
      INSERT INTO owner_final_settlements (
        id, no, name, settlement_amount, submission_date, status, note
      ) VALUES (
        'final-settlement-legacy-325', 'JS-LEGACY-325', '既有甲方最终结算',
        1020000, '2026-08-23', 'submitted', '等待甲方审定'
      )
    `)

    const result = await runMigrations(db)

    expect(result.applied).toContain('v45 owner-final-settlement-audit-facts')
    expect(await columnNames(db, 'owner_final_settlements')).toEqual(expect.arrayContaining([
      'audited_amount',
      'audited_date',
    ]))
    expect(await db.select(`
      SELECT audited_amount, audited_date
      FROM owner_final_settlements
      WHERE id = 'final-settlement-legacy-325'
    `)).toEqual([{ audited_amount: null, audited_date: null }])
    db.close()
  })
})
