import { describe, expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { columnNames, createMemoryDb, createMigratedMemoryDb, listTables } from '../helpers/memory-db'

describe('v44 验收—保修 canonical 生命周期迁移', () => {
  it('只扩展 project_acceptances 并建立独立审计表，不创建第二张保修业务表', async () => {
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(migration => migration.version <= 43))
    await db.execute(`
      INSERT INTO project_acceptances (
        id, no, type, name, document_date, acceptor, warranty_owner,
        conclusion, status, note
      ) VALUES (
        'acceptance-legacy-324', 'YS-LEGACY-324', 'warranty', '既有验收保修记录',
        '2026-07-18', '周验收', '瑞航建设工程有限公司',
        '历史结论', 'warranty', '旧字段原样保留'
      )
    `)

    const result = await runMigrations(db)

    expect(result.applied).toContain('v44 acceptance-warranty-canonical-lifecycle')
    expect(await columnNames(db, 'project_acceptances')).toEqual(expect.arrayContaining([
      'acceptance_organization',
      'acceptance_date',
      'acceptance_conclusion',
      'warranty_start_date',
      'warranty_end_date',
      'warranty_confirmation_organization',
      'warranty_confirmation_date',
      'warranty_confirmation_note',
    ]))
    const tables = await listTables(db)
    expect(tables).toContain('project_acceptance_lifecycle_events')
    expect(tables).not.toContain('project_warranties')
    expect(await db.select(`
      SELECT id, type, document_date, acceptor, warranty_owner, conclusion,
             acceptance_date, warranty_start_date, warranty_confirmation_date
      FROM project_acceptances
      WHERE id = 'acceptance-legacy-324'
    `)).toEqual([{
      id: 'acceptance-legacy-324',
      type: 'warranty',
      document_date: '2026-07-18',
      acceptor: '周验收',
      warranty_owner: '瑞航建设工程有限公司',
      conclusion: '历史结论',
      acceptance_date: null,
      warranty_start_date: null,
      warranty_confirmation_date: null,
    }])
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([])
    db.close()
  })

  it('审计表拒绝重复状态事实和跨记录引用', async () => {
    const db = await createMigratedMemoryDb()
    await db.execute(`INSERT INTO project_acceptances (id, status) VALUES ('acceptance-324', 'submitted')`)
    await db.execute(`
      INSERT INTO project_acceptance_lifecycle_events (
        id, acceptance_id, action, from_status, to_status, actor_id, actor_name, occurred_at
      ) VALUES (
        'event-accepted-324', 'acceptance-324', 'accept', 'submitted', 'accepted',
        'actor-324', '周经办', '2026-08-25T02:00:00.000Z'
      )
    `)
    await expect(db.execute(`
      INSERT INTO project_acceptance_lifecycle_events (
        id, acceptance_id, action, from_status, to_status, actor_id, actor_name, occurred_at
      ) VALUES (
        'event-accepted-repeat-324', 'acceptance-324', 'accept', 'submitted', 'accepted',
        'actor-324', '周经办', '2026-08-25T02:01:00.000Z'
      )
    `)).rejects.toThrow()
    await expect(db.execute(`
      INSERT INTO project_acceptance_lifecycle_events (
        id, acceptance_id, action, from_status, to_status, actor_id, actor_name, occurred_at
      ) VALUES (
        'event-orphan-324', 'missing-acceptance-324', 'accept', 'submitted', 'accepted',
        'actor-324', '周经办', '2026-08-25T02:00:00.000Z'
      )
    `)).rejects.toThrow()
    db.close()
  })
})
