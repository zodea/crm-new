import { describe, expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { createMemoryDb } from '../helpers/memory-db'

const CAPABILITY_MIGRATION_VERSION = 26

describe('v26 班组/工人能力迁移', () => {
  it('把存量单一主工种回填为可承接能力并保留原字段', async () => {
    const db = await createMemoryDb()
    await runMigrations(
      db,
      migrations.filter(migration => migration.version < CAPABILITY_MIGRATION_VERSION),
    )
    await db.execute(`
      INSERT INTO crews (id, name, trade)
      VALUES ('crew-legacy-cap', '存量泥水班', '泥水工')
    `)
    await db.execute(`
      INSERT INTO workers (id, name, trade)
      VALUES ('worker-legacy-cap', '存量泥水工', '泥水工')
    `)

    const result = await runMigrations(
      db,
      migrations.filter(migration => migration.version === CAPABILITY_MIGRATION_VERSION),
    )
    const [crew] = await db.select<{
      trade: string
      trade_capabilities: string
      item_capabilities: string
    }>(`
      SELECT trade, trade_capabilities, item_capabilities
      FROM crews
      WHERE id = 'crew-legacy-cap'
    `)
    const [worker] = await db.select<{
      trade: string
      trade_capabilities: string
      item_capabilities: string
    }>(`
      SELECT trade, trade_capabilities, item_capabilities
      FROM workers
      WHERE id = 'worker-legacy-cap'
    `)

    expect(result.applied).toEqual(['v26 crew-worker-capabilities'])
    expect(crew).toEqual({
      trade: '泥水工',
      trade_capabilities: '["泥水工"]',
      item_capabilities: '[]',
    })
    expect(worker).toEqual(crew)
    db.close()
  })
})
