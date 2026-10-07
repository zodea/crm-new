import { describe, expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { columnNames, createMemoryDb, createMigratedMemoryDb, listTables } from '../helpers/memory-db'

const PROCESS_LIBRARY_MIGRATION_VERSION = 27
const PREDECESSOR_MIGRATION_VERSION = 34
const PREDECESSOR_DISABLED_REPAIR_VERSION = 35

describe('标准工序库与内部暂估排程迁移', () => {
  it('建立可复用标准库、冻结快照列并迁移既有分组', async () => {
    const db = await createMemoryDb()
    await runMigrations(
      db,
      migrations.filter(migration => migration.version < PROCESS_LIBRARY_MIGRATION_VERSION),
    )
    await db.execute(`INSERT INTO projects (id, name) VALUES ('p1', '存量项目')`)
    await db.execute(`INSERT INTO contracts (id, project_id, kind, name)
      VALUES ('c1', 'p1', '施工', '存量施工合同')`)
    await db.execute(`INSERT INTO schedule_groups (id, project_id, contract_id, name)
      VALUES ('g-contract', 'p1', 'c1', '合同分组')`)
    await db.execute(`INSERT INTO schedule_groups (id, project_id, name)
      VALUES ('g-provisional', 'p1', '暂估分组')`)

    await runMigrations(
      db,
      migrations.filter(migration => migration.version <= PROCESS_LIBRARY_MIGRATION_VERSION),
    )

    expect(await listTables(db)).toEqual(expect.arrayContaining([
      'schedule_process_libraries',
      'schedule_process_library_tasks',
    ]))
    expect(await columnNames(db, 'schedule_groups')).toEqual(expect.arrayContaining([
      'scope_basis',
      'process_library_id',
      'process_library_name_snapshot',
      'process_library_version_snapshot',
    ]))
    expect(await columnNames(db, 'schedule_tasks')).toEqual(expect.arrayContaining([
      'source_library_task_id',
      'source_library_version',
      'template_snapshot_json',
    ]))
    expect(await db.select(`
      SELECT id, scope_basis, contract_id
      FROM schedule_groups
      ORDER BY id
    `)).toEqual([
      { id: 'g-contract', scope_basis: 'contract', contract_id: 'c1' },
      { id: 'g-provisional', scope_basis: 'provisional', contract_id: null },
    ])
    expect(await db.select(`
      SELECT code, name, version, is_default
      FROM schedule_process_libraries
    `)).toEqual([{
      code: 'decoration-standard-v1',
      name: '精装修标准工序',
      version: 1,
      is_default: 1,
    }])
    expect(await db.select<{ total: number }>(`
      SELECT COUNT(*) AS total
      FROM schedule_process_library_tasks
    `)).toEqual([{ total: 22 }])
    db.close()
  })

  it('数据库拒绝合同依据与合同外键互相矛盾', async () => {
    const db = await createMigratedMemoryDb()
    await db.execute(`INSERT INTO projects (id, name) VALUES ('p1', '规则项目')`)
    await db.execute(`INSERT INTO contracts (id, project_id, kind, name)
      VALUES ('c1', 'p1', '施工', '施工合同')`)

    await expect(db.execute(`INSERT INTO schedule_groups
      (id, project_id, contract_id, scope_basis, name)
      VALUES ('bad-contract', 'p1', NULL, 'contract', '错误合同组')`))
      .rejects
      .toThrow(/scope basis/i)
    await expect(db.execute(`INSERT INTO schedule_groups
      (id, project_id, contract_id, scope_basis, name)
      VALUES ('bad-provisional', 'p1', 'c1', 'provisional', '错误暂估组')`))
      .rejects
      .toThrow(/scope basis/i)
    db.close()
  })

  it('从已记录 v34 且仅有前置键的数据库补齐禁用状态列', async () => {
    const db = await createMemoryDb()
    await runMigrations(
      db,
      migrations.filter(migration => migration.version < PREDECESSOR_MIGRATION_VERSION),
    )
    await db.execute(`
      ALTER TABLE schedule_process_library_tasks
      ADD COLUMN predecessor_task_key TEXT DEFAULT NULL
    `)
    await db.execute(
      'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
      [PREDECESSOR_MIGRATION_VERSION, 'schedule-process-library-predecessors'],
    )

    expect(await columnNames(db, 'schedule_process_library_tasks'))
      .not
      .toContain('predecessor_disabled')

    const result = await runMigrations(
      db,
      migrations.filter(migration => migration.version <= PREDECESSOR_DISABLED_REPAIR_VERSION),
    )

    expect(result).toEqual({
      from: PREDECESSOR_MIGRATION_VERSION,
      to: PREDECESSOR_DISABLED_REPAIR_VERSION,
      applied: ['v35 schedule-process-library-predecessor-disabled-repair'],
    })
    expect(await columnNames(db, 'schedule_process_library_tasks'))
      .toContain('predecessor_disabled')
    expect(await db.select<{ invalid: number }>(`
      SELECT COUNT(*) AS invalid
      FROM schedule_process_library_tasks
      WHERE predecessor_disabled IS NULL
         OR predecessor_disabled NOT IN (0, 1)
    `)).toEqual([{ invalid: 0 }])
    db.close()
  })
})
