import { afterEach, describe, expect, it } from 'vitest'
import { LATEST_VERSION, runMigrations } from '~/lib/db/migrations'
import { createMemoryDb } from '../helpers/memory-db'

describe('cT03 施工合同实际竣工事实迁移', () => {
  const databases: Array<Awaited<ReturnType<typeof createMemoryDb>>> = []

  afterEach(() => {
    for (const db of databases.splice(0))
      db.close()
  })

  it('给 canonical contracts 增加可空实际竣工日期，存量合同不以结束日期回填', async () => {
    const db = await createMemoryDb()
    databases.push(db)
    const beforeCt03 = await runMigrations(db, [])
    expect(beforeCt03.to).toBe(0)

    await runMigrations(db)
    const columns = await db.select<{ name: string, notnull: number }>('PRAGMA table_info(contracts)')
    expect(columns).toContainEqual(expect.objectContaining({ name: 'actual_completion_date', notnull: 0 }))
    expect(LATEST_VERSION).toBeGreaterThanOrEqual(42)
  })
})
