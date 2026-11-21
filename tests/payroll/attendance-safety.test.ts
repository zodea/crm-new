import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listAttendanceRecords,
  upsertAttendanceRecord,
} from '~/lib/payroll/attendance'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMigratedMemoryDb()
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

  it('explicitly reuses the global worker in another project while preserving the master assignment and original project records', async () => {
    const before = await db.select('SELECT * FROM workers WHERE id=?', ['worker-a'])
    const first = await upsertAttendanceRecord(db, { projectId: 'project-a', crewId: 'crew-a', workerId: 'worker-a', workDate: '2026-07-03', hours: 7 })
    const second = await upsertAttendanceRecord(db, { projectId: 'project-b', crewId: 'crew-a', workerId: 'worker-a', workDate: '2026-07-03', hours: 8 })
    expect(second).not.toBe(first)
    expect(await db.select('SELECT * FROM workers WHERE id=?', ['worker-a'])).toEqual(before)
    expect(await listAttendanceRecords(db, { projectId: 'project-a', month: '2026-07' })).toEqual([expect.objectContaining({ id: first, projectId: 'project-a', workerId: 'worker-a', hours: 7 })])
    expect(await listAttendanceRecords(db, { projectId: 'project-b', month: '2026-07' })).toEqual([expect.objectContaining({ id: second, projectId: 'project-b', workerId: 'worker-a', hours: 8 })])
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

  it('a global worker with no current project can create an explicit real attendance relation without invented site responsibility', async () => {
    const before = await db.select('SELECT * FROM workers WHERE id=?', ['worker-b'])
    const saved = await upsertAttendanceRecord(db, { projectId: 'project-a', crewId: 'crew-b', workerId: 'worker-b', workDate: '2026-07-05', hours: 8 })
    expect(await listAttendanceRecords(db, { projectId: 'project-a', month: '2026-07', crewId: 'crew-b' })).toEqual([expect.objectContaining({ id: saved, workerId: 'worker-b', projectId: 'project-a' })])
    expect(await db.select('SELECT * FROM workers WHERE id=?', ['worker-b'])).toEqual(before)
    expect(await db.select('SELECT * FROM unit_assignments')).toEqual([])
    await expect(upsertAttendanceRecord(db, { projectId: 'project-a', crewId: 'crew-a', workerId: 'worker-b', workDate: '2026-07-05', hours: 8 })).rejects.toThrow('所选班组与工人档案归属不一致')
    expect((await listAttendanceRecords(db, { projectId: 'project-a', month: '2026-07', crewId: 'crew-b' }))[0]?.hours).toBe(8)
  })
})
