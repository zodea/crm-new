import type { TestDb } from '../helpers/memory-db'
import { afterEach, describe, expect, it } from 'vitest'
import {
  migrations,
  runMigrations,
} from '~/lib/db/migrations'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

afterEach(() => db?.close())

describe('monthly statement owner lifecycle migration', () => {
  it('只以真实申报和审定金额保留历史 adjusted/exported 状态', async () => {
    db = await createMemoryDb()
    await runMigrations(db, migrations.filter(migration => migration.version <= 36))
    await db.execute(`INSERT INTO customers (id, name) VALUES ('customer-1', '甲方')`)
    await db.execute(`
      INSERT INTO projects (id, name, customer_id)
      VALUES ('project-1', '迁移项目', 'customer-1')
    `)
    await db.execute(`
      INSERT INTO contracts (id, name, kind, project_id, customer_id)
      VALUES ('contract-1', '迁移合同', '施工', 'project-1', 'customer-1')
    `)
    await db.execute(`
      INSERT INTO monthly_statements (
        id, project_id, contract_id, month, status, reported_amount, audited_amount
      )
      VALUES
        ('manual-adjust', 'project-1', 'contract-1', '2026-01', 'adjusted', NULL, NULL),
        ('export-only', 'project-1', 'contract-1', '2026-02', 'exported', NULL, NULL),
        ('reported-draft', 'project-1', 'contract-1', '2026-03', 'exported', 100, NULL),
        ('audited', 'project-1', 'contract-1', '2026-04', 'adjusted', 100, 96)
    `)

    const result = await runMigrations(db)
    expect(result.applied).toContain('v37 monthly-statement-owner-lifecycle-repair')
    await expect(db.select(`
      SELECT id, status
      FROM monthly_statements
      ORDER BY month
    `)).resolves.toEqual([
      { id: 'manual-adjust', status: 'draft' },
      { id: 'export-only', status: 'draft' },
      { id: 'reported-draft', status: 'draft' },
      { id: 'audited', status: 'exported' },
    ])
  })
})
