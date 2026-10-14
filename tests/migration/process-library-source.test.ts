import type { TestDb } from '../helpers/memory-db'
import { afterEach, describe, expect, it } from 'vitest'
import { parseProcessLibraryMigrationGraph, readProcessLibraryMigrationGraphs } from '~/lib/migration/process-library-source'
import { createMigratedMemoryDb } from '../helpers/memory-db'

const at = '2026-09-12 08:00:00'
function rows() {
  return {
    libraries: [{ id: 'old-library', code: 'decoration', name: '旧标准库', version: 1, description: '旧版说明', is_default: 0, sort_order: 20, created_at: at, updated_at: at, deleted_at: null as string | null }],
    tasks: [
      { id: 'old-task-a', library_id: 'old-library', task_key: 'a', name: '原工序甲', trade: '木工', color: '#64748b', duration_days: 2, stage_code: 'stage-a', item_codes_json: '["item-a"]', sort_order: 10, predecessor_task_key: null as string | null, predecessor_disabled: 0, created_at: at, updated_at: at, deleted_at: null as string | null },
      { id: 'old-task-b', library_id: 'old-library', task_key: 'b', name: '原工序乙', trade: '木工', color: '#64748b', duration_days: 3, stage_code: '', item_codes_json: '[]', sort_order: 20, predecessor_task_key: 'a' as string | null, predecessor_disabled: 0, created_at: at, updated_at: at, deleted_at: null as string | null },
    ],
  }
}
function source(data = rows()) {
  return { select: async <T>(sql: string): Promise<T[]> => structuredClone(sql.includes('FROM schedule_process_library_tasks') ? data.tasks : data.libraries) as T[] }
}

describe('工序库物理源导出', () => {
  let db: TestDb | undefined
  afterEach(() => db?.close())

  it('读取真实 v49 SQLite，保全软删头/任务、前置禁用、原始映射与时间', async () => {
    db = await createMigratedMemoryDb()
    await db.execute('UPDATE schedule_process_libraries SET deleted_at = ?, sort_order = 73, updated_at = ?', [at, at])
    const [task] = await db.select<{ id: string }>('SELECT id FROM schedule_process_library_tasks WHERE predecessor_task_key IS NOT NULL ORDER BY id LIMIT 1')
    await db.execute('UPDATE schedule_process_library_tasks SET deleted_at = ?, predecessor_disabled = 1, item_codes_json = ?, updated_at = ? WHERE id = ?', [at, '["原分项", "item-a"]', at, task!.id])
    const [library] = await db.select<{ id: string }>('SELECT id FROM schedule_process_libraries')
    await db.execute('INSERT INTO projects (id, name) VALUES (?, ?)', ['legacy-project', '已有排程项目'])
    await db.execute('INSERT INTO schedule_groups (id, project_id, name, process_library_id, process_library_version_snapshot) VALUES (?, ?, ?, ?, ?)', ['legacy-group', 'legacy-project', '既有组', library!.id, 1])
    await db.execute('INSERT INTO schedule_tasks (id, project_id, group_id, name, planned_start, planned_finish, manual_progress, source_library_task_id, source_library_version, template_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['legacy-wbs-task', 'legacy-project', 'legacy-group', '冻结工序名称', '2026-09-12', '2026-09-13', 0.5, task!.id, 1, '{"name":"冻结原版"}'])
    const wbsBefore = await db.select('SELECT * FROM schedule_tasks')
    const groupsBefore = await db.select('SELECT * FROM schedule_groups')
    const entities = await readProcessLibraryMigrationGraphs(db)
    expect(entities).toHaveLength(1)
    const graph = parseProcessLibraryMigrationGraph(JSON.parse(String(entities[0]!.attributes!.graphJson)), entities[0]!.legacyId)
    expect(graph.library).toMatchObject({ id: entities[0]!.legacyId, sort_order: 73, deleted_at: '2026-09-12T08:00:00.000Z', updated_at: '2026-09-12T08:00:00.000Z' })
    expect(graph.tasks.find(row => row.id === task!.id)).toMatchObject({ predecessor_disabled: 1, item_codes_json: '["原分项", "item-a"]', deleted_at: '2026-09-12T08:00:00.000Z' })
    expect(graph.tasks.length).toBe((await db.select<{ count: number }>('SELECT COUNT(*) AS count FROM schedule_process_library_tasks'))[0]!.count)
    expect(await db.select('SELECT * FROM schedule_tasks')).toEqual(wbsBefore)
    expect(await db.select('SELECT * FROM schedule_groups')).toEqual(groupsBefore)
  })

  it('保留错序但已置灰的前置 key，不重新启用或丢弃历史', async () => {
    const data = rows()
    data.tasks[1]!.sort_order = 0
    data.tasks[1]!.predecessor_disabled = 1
    const [entity] = await readProcessLibraryMigrationGraphs(source(data))
    const graph = parseProcessLibraryMigrationGraph(JSON.parse(String(entity!.attributes!.graphJson)))
    expect(graph.tasks[0]).toMatchObject({ task_key: 'b', predecessor_task_key: 'a', predecessor_disabled: 1, sort_order: 0 })
  })

  it.each(['not-json', '{}', '[1]', '["item-a", "item-a"]', '[""]'])('映射 JSON %s 损坏时阻断，不能降为 []', async (mapping) => {
    const data = rows()
    data.tasks[0]!.item_codes_json = mapping
    await expect(readProcessLibraryMigrationGraphs(source(data))).rejects.toThrow(/映射/)
  })

  it('阻断孤儿任务，即使它已软删', async () => {
    const data = rows()
    data.tasks[0]!.library_id = 'missing'
    data.tasks[0]!.deleted_at = at
    await expect(readProcessLibraryMigrationGraphs(source(data))).rejects.toThrow(/父库/)
  })

  it('阻断包括软删历史在内的重复 code/version 和任务 key', async () => {
    const data = rows()
    data.libraries.push({ ...data.libraries[0]!, id: 'other-old-library', deleted_at: at })
    await expect(readProcessLibraryMigrationGraphs(source(data))).rejects.toThrow(/编码.*版本.*重复/)
    data.libraries.pop()
    data.tasks.push({ ...data.tasks[0]!, id: 'old-task-duplicate', deleted_at: at })
    await expect(readProcessLibraryMigrationGraphs(source(data))).rejects.toThrow(/工序编码重复/)
  })

  it.each(['missing', 'self', 'cycle', 'deleted', 'wrong-order'] as const)('阻断 %s 前置关系，置灰也不能隐藏循环', async (kind) => {
    const data = rows()
    if (kind === 'missing')
      data.tasks[1]!.predecessor_task_key = 'not-here'
    if (kind === 'self')
      data.tasks[1]!.predecessor_task_key = 'b'
    if (kind === 'cycle') {
      data.tasks[0]!.predecessor_task_key = 'b'
      data.tasks[0]!.predecessor_disabled = 1
    }
    if (kind === 'deleted')
      data.tasks[0]!.deleted_at = at
    if (kind === 'wrong-order')
      data.tasks[1]!.sort_order = 0
    await expect(readProcessLibraryMigrationGraphs(source(data))).rejects.toThrow(/前置|循环/)
  })

  it('同一物理任务 ID 不得跨库复用', async () => {
    const data = rows()
    data.libraries.push({ ...data.libraries[0]!, id: 'second', code: 'second' })
    data.tasks.push({ ...data.tasks[0]!, library_id: 'second' })
    await expect(readProcessLibraryMigrationGraphs(source(data))).rejects.toThrow(/任务.*身份.*重复/)
  })
})
