import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { parseQuantityMigrationGraph, quantityMigrationTimestamp } from '~/lib/quantity/migration-graph'
import { mapQuantityMigrationGraph } from '~/lib/quantity/migration-mapping'
import { readQuantityMigrationGraphs } from '~/lib/quantity/migration-source'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let memory: TestDb
beforeEach(async () => {
  memory = await createMigratedMemoryDb()
  await memory.execute('INSERT INTO projects (id, name) VALUES (?, ?)', ['p', '工程量项目'])
  await memory.execute('INSERT INTO buildings (id, project_id, code, name) VALUES (?, ?, ?, ?)', ['b', 'p', 'B', '一栋'])
  await memory.execute('INSERT INTO floors (id, building_id, code, name) VALUES (?, ?, ?, ?)', ['f', 'b', 'F', '一层'])
  await memory.execute('INSERT INTO house_type_templates (id, project_id, code, name) VALUES (?, ?, ?, ?)', ['t', 'p', 'T', '户型'])
  await memory.execute('INSERT INTO units (id, floor_id, house_type_template_id, code) VALUES (?, ?, ?, ?)', ['u', 'f', 't', '101'])
  await memory.execute('INSERT INTO rooms (id, template_id, code, name) VALUES (?, ?, ?, ?)', ['r', 't', 'R', '客厅'])
  await memory.execute('INSERT INTO items (id, project_id, code, name, trade) VALUES (?, ?, ?, ?, ?)', ['i', 'p', 'I', '腻子', '油漆工'])
  await memory.execute('INSERT INTO house_type_template_items (id, room_id, item_id, recognized_contract_qty, contract_qty, provisional_qty, field_formula, field_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ['l', 'r', 'i', 8, 0, 6, null, null])
})
afterEach(() => memory.close())

it('迁移时间不把不存在的日期滚动到下一月，也不接收含糊时间格式', () => {
  expect(quantityMigrationTimestamp('2026-09-11 00:00:00', '创建')).toBe('2026-09-11T00:00:00.000Z')
})

it.each([
  { case: '\'2026-02-30 00:00:00\' / \'创建\'', input: '2026-02-30 00:00:00', argument2: '创建' },
  { case: '\'09/11/2026\' / \'创建\'', input: '09/11/2026', argument2: '创建' },
])('迁移时间不把不存在的日期滚动到下一月，也不接收含糊时间格式 / quantityMigrationTimestamp：$case', ({ input, argument2 }) => {
  expect(() => quantityMigrationTimestamp(input, argument2)).toThrow()
})

it('真实SQLite工程量源保留三量空零、稳定区域模板与删除边界，空项目不造数据', async () => {
  await memory.execute('INSERT INTO projects (id, name) VALUES (?, ?)', ['empty', '空项目'])
  await memory.execute('UPDATE buildings SET deleted_at = ? WHERE id = ?', ['2026-09-11 00:00:00', 'b'])
  const sources = await readQuantityMigrationGraphs(memory)
  expect(sources).toHaveLength(1)
  expect(sources[0]!.graph.tables.buildings[0]!.deleted_at).toBe('2026-09-11T00:00:00.000Z')
  expect(sources[0]!.graph.tables.units.map(row => row.id)).toEqual(['u'])
  expect(sources[0]!.graph.tables.house_type_template_items).toMatchObject([{ id: 'l', recognized_contract_qty: 8, contract_qty: 0, field_formula: null, field_qty: null }])
})

it('跨项目父关系、未知列和重复身份均显式拒绝，不按名称猜接', async () => {
  const graph = (await readQuantityMigrationGraphs(memory))[0]!.graph
  const mutate = (change: (copy: typeof graph) => void) => {
    const copy = structuredClone(graph)
    change(copy)
    expect(() => parseQuantityMigrationGraph(copy)).toThrow()
  }
  mutate((copy) => {
    copy.tables.units[0]!.floor_id = '其他楼层'
  })
  mutate((copy) => {
    copy.tables.items[0]!.project_id = 'other'
  })
  mutate((copy) => {
    copy.tables.items[0]!.unexpected = '不可悄悄吞掉'
  })
  mutate((copy) => {
    copy.tables.units.push(copy.tables.units[0]!)
  })
  await memory.execute('PRAGMA foreign_keys = OFF')
  await memory.execute('UPDATE floors SET building_id = ? WHERE id = ?', ['不存在楼栋', 'f'])
  await expect(readQuantityMigrationGraphs(memory)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
})

it.each([
  (copy: ReturnType<typeof parseQuantityMigrationGraph>) => { copy.tables.construction_stage_items[0]!.is_reporting_stage = null },
  (copy: ReturnType<typeof parseQuantityMigrationGraph>) => { copy.tables.file_payloads[0]!.content = 'AQIE=' },
  (copy: ReturnType<typeof parseQuantityMigrationGraph>) => { copy.tables.file_refs[0]!.file_size = 4 },
  (copy: ReturnType<typeof parseQuantityMigrationGraph>) => { copy.tables.file_refs[0]!.mime_type = 'application/pdf' },
  (copy: ReturnType<typeof parseQuantityMigrationGraph>) => { copy.tables.operation_logs[0]!.action = 'execute-sql' },
])('区域、责任、完成、照片和审计快照按稳定旧ID整体映射，重复映射确定且原稿不变：输入案例 %#', async (change) => {
  await memory.execute('INSERT INTO crews (id, name, trade) VALUES (?, ?, ?)', ['crew', '原班组', '油漆工'])
  await memory.execute('INSERT INTO construction_stages (id, project_id, code, name, trade) VALUES (?, ?, ?, ?, ?)', ['stage', 'p', 'S', '腻子', '油漆工'])
  await memory.execute('INSERT INTO construction_stage_items (id, stage_id, item_id, is_reporting_stage) VALUES (?, ?, ?, ?)', ['mapping', 'stage', 'i', 1])
  await memory.execute('INSERT INTO unit_assignments (id, unit_id, trade, crew_id) VALUES (?, ?, ?, ?)', ['assignment', 'u', '油漆工', 'crew'])
  await memory.execute('INSERT INTO unit_assignment_scopes (id, assignment_id, room_id, item_id) VALUES (?, ?, ?, ?)', ['scope', 'assignment', 'r', 'i'])
  await memory.execute('INSERT INTO unit_stage_completions (id, unit_id, stage_id, assignment_id, status, completed_at) VALUES (?, ?, ?, ?, ?, ?)', ['done', 'u', 'stage', 'assignment', 'completed', '2026-09-11'])
  await memory.execute('INSERT INTO file_refs (id, owner_type, owner_id, file_name, file_size, mime_type, category) VALUES (?, ?, ?, ?, ?, ?, ?)', ['file', 'unit_stage_completion', 'done', '验收.png', 3, 'image/png', 'acceptance_photo'])
  await memory.execute('INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES (?, ?, ?)', ['file', 'base64', 'AQID'])
  const [oldCompletion] = await memory.select('SELECT * FROM unit_stage_completions WHERE id = ?', ['done'])
  await memory.execute('INSERT INTO operation_logs (id, table_name, record_id, action, after_data, operator) VALUES (?, ?, ?, ?, ?, ?)', ['audit', 'unit_stage_completions', 'done', 'create', JSON.stringify(oldCompletion), '历史操作者'])
  const source = (await readQuantityMigrationGraphs(memory))[0]!.graph
  const bindings = { namespace: 'batch-project', projectId: 'central-project', crews: new Map([['crew', 'central-crew']]), workers: new Map<string, string>(), boqLineIds: new Set<string>() }
  const mapped = mapQuantityMigrationGraph(source, bindings)
  expect(mapQuantityMigrationGraph(source, bindings)).toEqual(mapped)
  expect(source.tables.unit_stage_completions[0]!.id).toBe('done')
  expect(mapped.graph.projectId).toBe('central-project')
  expect(mapped.graph.tables.unit_assignments[0]!.crew_id).toBe('central-crew')
  const done = mapped.graph.tables.unit_stage_completions[0]!
  expect(done.unit_id).toBe(mapped.graph.tables.units[0]!.id)
  expect(done.assignment_id).toBe(mapped.graph.tables.unit_assignments[0]!.id)
  expect(mapped.graph.tables.file_refs[0]!.owner_id).toBe(done.id)
  expect(mapped.graph.tables.file_payloads[0]!.file_ref_id).toBe(mapped.graph.tables.file_refs[0]!.id)
  const audit = mapped.graph.tables.operation_logs[0]!
  expect(audit.record_id).toBe(done.id)
  expect(JSON.parse(String(audit.after_data))).toEqual(done)
  expect(audit.operator).toBe('历史操作者')
  expect(() => mapQuantityMigrationGraph(source, { ...bindings, crews: new Map() })).toThrow('班组缺少显式旧 ID')
  const historicalTime = structuredClone(source)
  historicalTime.tables.unit_stage_completions[0]!.completed_at = '2026-06-20T09:00:00.000Z'
  expect(parseQuantityMigrationGraph(historicalTime).tables.unit_stage_completions[0]!.completed_at).toBe('2026-06-20T09:00:00.000Z')
  expect(mapped.identities).toContainEqual({ table: 'file_payloads', legacyId: 'file', id: mapped.graph.tables.file_refs[0]!.id })

  const copy = structuredClone(source)
  change(copy)
  expect(() => parseQuantityMigrationGraph(copy)).toThrow()
  const noBody = structuredClone(source)
  noBody.tables.file_payloads = []
  expect(parseQuantityMigrationGraph(noBody).tables.file_refs).toHaveLength(1)
})
