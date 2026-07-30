import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  listAttendanceRecords,
  upsertAttendanceRecord,
} from '~/lib/payroll/attendance'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await db.execute(`
    INSERT INTO projects (id, name, code)
    VALUES
      ('project-a', '项目甲', 'PA'),
      ('project-b', '项目乙', 'PB')
  `)
  await db.execute(`
    INSERT INTO crews (id, name, trade)
    VALUES
      ('crew-a', '泥水班', '泥水工'),
      ('crew-b', '油漆班', '油漆工')
  `)
  await db.execute(`
    INSERT INTO workers (id, crew_id, name, trade, current_project_id)
    VALUES
      ('worker-a', 'crew-a', '张师傅', '泥水工', 'project-a'),
      ('worker-b', 'crew-b', '李师傅', '油漆工', NULL)
  `)
})

afterEach(() => db.close())

describe('attendance write boundary', () => {
  it('always derives the saved crew from the worker profile in the all-crews view', async () => {
    await upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-01',
      hours: 8,
    })

    expect(await listAttendanceRecords(db, {
      projectId: 'project-a',
      month: '2026-07',
      crewId: 'crew-a',
    })).toEqual([
      expect.objectContaining({
        workerId: 'worker-a',
        crewId: 'crew-a',
      }),
    ])
  })

  it('rejects an arbitrary caller crew instead of overwriting the worker profile crew', async () => {
    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-a',
      crewId: 'crew-b',
      workerId: 'worker-a',
      workDate: '2026-07-02',
      hours: 8,
    })).rejects.toThrow('所选班组与工人档案归属不一致')

    expect(await listAttendanceRecords(db, {
      projectId: 'project-a',
      month: '2026-07',
    })).toEqual([])
  })

  it('rejects a worker whose current project conflicts with the selected project', async () => {
    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-b',
      crewId: 'crew-a',
      workerId: 'worker-a',
      workDate: '2026-07-03',
      hours: 8,
    })).rejects.toThrow('该工人不属于当前项目')
  })

  it('rejects deleted workers, projects, and profile crews', async () => {
    await db.execute(`
      UPDATE workers SET deleted_at = datetime('now') WHERE id = 'worker-a'
    `)
    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-04',
      hours: 8,
    })).rejects.toThrow('工人不存在')

    await db.execute(`
      UPDATE workers SET deleted_at = NULL WHERE id = 'worker-a'
    `)
    await db.execute(`
      UPDATE projects SET deleted_at = datetime('now') WHERE id = 'project-a'
    `)
    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-04',
      hours: 8,
    })).rejects.toThrow('项目不存在')

    await db.execute(`
      UPDATE projects SET deleted_at = NULL WHERE id = 'project-a'
    `)
    await db.execute(`
      UPDATE crews SET deleted_at = datetime('now') WHERE id = 'crew-a'
    `)
    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-a',
      workDate: '2026-07-04',
      hours: 8,
    })).rejects.toThrow('档案班组不存在或已停用')
  })

  it('rejects an unassigned worker until current project or site responsibility is configured', async () => {
    await expect(upsertAttendanceRecord(db, {
      projectId: 'project-a',
      workerId: 'worker-b',
      workDate: '2026-07-05',
      hours: 8,
    })).rejects.toThrow('不属于当前项目')

    expect(await listAttendanceRecords(db, {
      projectId: 'project-a',
      month: '2026-07',
      crewId: 'crew-b',
    })).toEqual([])
  })
})
