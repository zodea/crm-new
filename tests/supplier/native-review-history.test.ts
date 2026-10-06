import initSqlJs from 'sql.js'
import { expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { INFRA_TABLES, softDelete } from '~/lib/db/soft-delete'
import { createMemoryDb } from '../helpers/memory-db'

it('native v50→51保留真实凭证；中途失败重试、关键编辑、再次核验及冷打开不丢失身份正文', async () => {
  const db = await createMemoryDb()
  const upgrade = migrations.filter(item => item.version <= 51)
  try {
    await runMigrations(db, migrations.filter(item => item.version <= 50))
    await db.execute(`INSERT INTO suppliers(id,name,credential_status,credential_reviewed_at,credential_review_note)
      VALUES('native-supplier','合成供应商','qualified','2026-09-12 08:00:00','旧人工原文，不伪造核验人')`)
    const actual = { ...db, execute: async (sql: string, values?: unknown[]) => {
      if (sql.includes('CREATE TRIGGER IF NOT EXISTS supplier_review_history_preserve'))
        throw new Error('合成升级中断')
      await db.execute(sql, values)
    } }
    await expect(runMigrations(actual, upgrade)).rejects.toThrow('合成升级中断')
    const archived = await db.select('SELECT * FROM supplier_credential_review_history')
    expect(archived).toEqual([expect.objectContaining({ supplier_id: 'native-supplier', decision: 'qualified', reviewed_at: '2026-09-12 08:00:00', note: '旧人工原文，不伪造核验人', actor_id: null })])
    await runMigrations(db, upgrade)
    expect(await db.select('SELECT * FROM supplier_credential_review_history')).toEqual(archived)
    // 沿原可达主档 AFTER trigger 撤销资格；BEFORE trigger须先保住旧证明。
    await db.execute(`UPDATE suppliers SET name='合成工商更正' WHERE id='native-supplier'`)
    expect(await db.select('SELECT credential_reviewed_at,credential_review_note FROM suppliers')).toEqual([{ credential_reviewed_at: null, credential_review_note: '' }])
    expect(await db.select('SELECT * FROM supplier_credential_review_history')).toEqual(archived)
    await db.execute(`UPDATE suppliers SET credential_status='rejected',credential_reviewed_at='2026-09-13 09:00:00',credential_review_note='真实退回原因' WHERE id='native-supplier'`)
    await db.execute(`UPDATE suppliers SET credential_status='reviewing',credential_reviewed_at=NULL,credential_review_note='' WHERE id='native-supplier'`)
    const history = await db.select('SELECT * FROM supplier_credential_review_history ORDER BY reviewed_at')
    expect(history).toHaveLength(2)
    expect(history[0]).toEqual(archived[0])
    expect(history[1]).toMatchObject({ decision: 'rejected', reviewed_at: '2026-09-13 09:00:00', note: '真实退回原因', actor_id: null })
    expect(INFRA_TABLES).toContain('supplier_credential_review_history')
    await expect(softDelete(db, 'supplier_credential_review_history', 'unreachable-id')).rejects.toThrow('未登记的业务表')
    await expect(db.execute('UPDATE supplier_credential_review_history SET note=?', ['覆盖原文'])).rejects.toThrow('immutable')
    await expect(db.execute('DELETE FROM supplier_credential_review_history')).rejects.toThrow('immutable')
    const serialized = db.raw.export()
    const SQL = await initSqlJs()
    const cold = new SQL.Database(serialized)
    try {
      const statement = cold.prepare('SELECT * FROM supplier_credential_review_history ORDER BY reviewed_at')
      const restored = []
      while (statement.step()) restored.push(statement.getAsObject())
      statement.free()
      expect(restored).toEqual(history)
    }
    finally { cold.close() }
  }
  finally { db.close() }
})
