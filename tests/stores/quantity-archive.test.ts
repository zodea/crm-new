import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteQuantityTemplate, persistQuantityTemplate } from '~/lib/quantity/template'
import { useNativeQuantityStore as useQuantityStore } from '~/stores/quantity-native'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
  withTransaction: async <T>(work: (tx: TestDb) => Promise<T>) => {
    await mem.execute('BEGIN')
    try {
      const result = await work(mem)
      await mem.execute('COMMIT')
      return result
    }
    catch (error) {
      await mem.execute('ROLLBACK')
      throw error
    }
  },
}))

beforeEach(async () => {
  mem = await createMigratedMemoryDb()
  await mem.execute(`INSERT INTO projects (id, name, code) VALUES ('p1', '项目一', 'P1')`)
  await mem.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES
    ('t1', 'p1', 'A', 'A户型')`)
  setActivePinia(createPinia())
})

afterEach(() => mem.close())

function templateDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    projectId: 'p1',
    code: 'A',
    name: 'A户型改',
    copiedFromTemplateId: null,
    sortOrder: 0,
    expectedUpdatedAt: null,
    // v12 trigger 会为模板自动生成整户范围房间，编辑草稿必须保留它。
    rooms: [{ key: 'whole', id: 't1:whole_unit', code: '__whole_unit__', name: '整户范围', kind: 'whole_unit', sortOrder: -1 }],
    newItems: [],
    lines: [],
    ...overrides,
  }
}

describe('quantity matrix archive：归档独立 action 与全域写入门控', () => {
  it('archiveMatrix 独立写归档列并落 projects update 日志，unarchive 可逆', async () => {
    const store = useQuantityStore()

    const archiveLogId = await store.archiveMatrix('p1')
    expect(archiveLogId).toBeTruthy()
    expect(await mem.select(`SELECT matrix_archived_at FROM projects WHERE id = 'p1'`))
      .toEqual([{ matrix_archived_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }])
    expect(await mem.select(
      `SELECT table_name, record_id, action FROM operation_logs ORDER BY rowid`,
    )).toEqual([
      { table_name: 'projects', record_id: 'p1', action: 'update' },
    ])

    const unarchiveLogId = await store.unarchiveMatrix('p1')
    expect(unarchiveLogId).toBeTruthy()
    expect(await mem.select(`SELECT matrix_archived_at FROM projects WHERE id = 'p1'`))
      .toEqual([{ matrix_archived_at: null }])
  })

  it('归档态重复归档幂等返回 null，不落冗余日志', async () => {
    const store = useQuantityStore()
    await store.archiveMatrix('p1')
    const again = await store.archiveMatrix('p1')
    expect(again).toBeNull()
    expect(await mem.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM operation_logs WHERE table_name = 'projects'`,
    )).toEqual([{ n: 1 }])
  })

  it('归档后模板保存与删除被拦截，显式授权后放行', async () => {
    await mem.execute(`UPDATE projects SET matrix_archived_at = '2026-07-20T00:00:00.000Z' WHERE id = 'p1'`)
    const [template] = await mem.select<{ updated_at: string }>(
      `SELECT updated_at FROM house_type_templates WHERE id = 't1'`,
    )

    await expect(persistQuantityTemplate(mem, templateDraft())).rejects.toThrow('已归档')
    await expect(deleteQuantityTemplate(mem, 'p1', 't1')).rejects.toThrow('已归档')

    const saved = await persistQuantityTemplate(mem, templateDraft({
      allowArchivedEdit: true,
      expectedUpdatedAt: template!.updated_at,
    }))
    expect(saved.templateId).toBe('t1')
    const logId = await deleteQuantityTemplate(mem, 'p1', 't1', { allowArchivedEdit: true })
    expect(logId).toBeTruthy()
  })

  it('普通项目字段更新不清空矩阵归档列', async () => {
    const store = useQuantityStore()
    await store.archiveMatrix('p1')
    await mem.execute(`UPDATE projects SET name = '项目一改' WHERE id = 'p1'`)
    const [row] = await mem.select<{ matrix_archived_at: string | null }>(
      `SELECT matrix_archived_at FROM projects WHERE id = 'p1'`,
    )
    expect(row?.matrix_archived_at).not.toBeNull()
  })
})
