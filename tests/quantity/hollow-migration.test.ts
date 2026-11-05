import { expect, it } from 'vitest'
import { initializeQuantityHollowSchema } from '~/lib/quantity/central-hollow-schema'
import { proveQuantityHollowMigrationGraph } from '~/lib/quantity/hollow-migration-proof'
import { parseQuantityMigrationGraph } from '~/lib/quantity/migration-graph'
import { isQuantitySourceIdentity } from '~/lib/quantity/migration-identity'
import { mapQuantityMigrationGraph } from '~/lib/quantity/migration-mapping'
import { readQuantityMigrationGraphs } from '~/lib/quantity/migration-source'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createQuantityHollowFixture } from '../helpers/quantity-hollow-fixture'

it('空鼓来源只出现部分新表时拒绝导出，不将检查记录静默丢回旧工程量图', async () => {
  const database = await createMigratedMemoryDb()
  try {
    await database.execute('INSERT INTO projects(id,name) VALUES (?,?)', ['hollow-project', '检查来源工程'])
    await database.execute('INSERT INTO buildings(id,project_id,code,name) VALUES (?,?,?,?)', ['hollow-building', 'hollow-project', 'B', '一栋'])
    expect((await readQuantityMigrationGraphs(database))[0]!.graph.version).toBe(1)
    await database.execute('CREATE TABLE quantity_hollow_records(id TEXT PRIMARY KEY)')
    await expect(readQuantityMigrationGraphs(database)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch', message: expect.stringContaining('空鼓') } })
  }
  finally {
    database.close()
  }
})

it('真实公开检查及整改导出保原 JSON，typed 映射保指纹并拒绝原件缺口', async () => {
  const f = await createQuantityHollowFixture()
  try {
    const initial = await f.service.hollow(f.scope)
    const created = await f.service.executeHollow(f.command(initial, { kind: 'create-hollow-inspection', target: initial.data.targets[0]!.target, input: { inspectedOn: '2026-09-15', count: 19, note: '原文保留 hollow-worker 与 0/null 字样' } }))
    const before = await f.service.hollow(f.scope)
    await f.service.executeHollow(f.command(before, { kind: 'rectify-hollow-inspection', recordId: created.id, expectedRevisionId: created.hollow.revisionId, rectifiedOn: '2026-09-15', count: 4, note: '原整改四处' }))
    const graph = (await readQuantityMigrationGraphs(f.db))[0]!.graph
    expect(graph.version).toBe(2)
    if (graph.version !== 2)
      throw new Error('未导出空鼓原件')
    const original = await proveQuantityHollowMigrationGraph(graph.hollow, graph.projectId)
    expect(original.histories.get(created.id)?.fact.remainingCount).toBe(15)
    const mapped = mapQuantityMigrationGraph(graph, { namespace: 'core-quantity_projects-123456789012345678901234', projectId: 'central-project', workers: new Map([['hollow-worker', 'central-worker']]), crews: new Map(), boqLineIds: new Set() }).graph
    if (mapped.version !== 2)
      throw new Error('迁入遗漏子图')
    const proved = await proveQuantityHollowMigrationGraph(mapped.hollow, 'central-project')
    const history = [...proved.histories.values()][0]!
    expect(history.fact).toMatchObject({ remainingCount: 15, originalParty: { workerId: 'central-worker' }, proof: { fingerprint: original.histories.get(created.id)!.fact.proof.fingerprint } })
    expect(mapped.hollow.origins).toEqual(graph.hollow.origins)
    expect(mapped.hollow.tables.quantity_hollow_command_receipts.map(row => row.request_json)).toEqual(graph.hollow.tables.quantity_hollow_command_receipts.map(row => row.request_json))
    expect(mapped.hollow.tables.quantity_hollow_command_receipts[0]!.command_id).not.toBe(graph.hollow.tables.quantity_hollow_command_receipts[0]!.command_id)
    const missing = structuredClone(mapped.hollow)
    missing.origins = []
    await expect(proveQuantityHollowMigrationGraph(missing)).rejects.toThrow('原件映射缺失、重复或无所属原件')
    const changed = structuredClone(mapped.hollow)
    changed.tables.quantity_hollow_rectifications[0]!.count = 5
    await expect(proveQuantityHollowMigrationGraph(changed)).rejects.toThrow('映射后的物理行与原件不一致')
  }
  finally { await f.close() }
})

it('新来源五表完整时输出独立 v2 子图，旧 v1 仍拒绝额外新字段', async () => {
  const database = await createMigratedMemoryDb()
  try {
    await database.execute('INSERT INTO projects(id,name) VALUES (?,?)', ['hollow-project', '检查来源工程'])
    await database.execute('INSERT INTO buildings(id,project_id,code,name) VALUES (?,?,?,?)', ['hollow-building', 'hollow-project', 'B', '一栋'])
    const old = (await readQuantityMigrationGraphs(database))[0]!.graph
    await initializeQuantityHollowSchema(database)
    const current = (await readQuantityMigrationGraphs(database))[0]!.graph
    expect(current.version).toBe(2)
    if (current.version !== 2)
      throw new Error('新图未携带空鼓来源')
    expect(current.hollow.origins).toEqual([])
    expect(() => parseQuantityMigrationGraph({ ...old, hollow: current.hollow })).toThrow('项目、版本或表结构无效')
    expect(() => parseQuantityMigrationGraph({ ...current, hollow: { ...current.hollow, surprise: [] } })).toThrow('子图必须具备五表、扁平原件、映射及逐行归属')
    expect(isQuantitySourceIdentity('core-quantity_projects-123456789012345678901234:quantity_hollow_records:old%3Aid', 'quantity_hollow_records')).toBe(true)
    expect(isQuantitySourceIdentity('core-quantity_projects-123456789012345678901234:quantity_hollow_records:old%3Aid', 'quantity_hollow_revisions')).toBe(false)
    expect(isQuantitySourceIdentity('core-quantity_projects-123456789012345678901234:quantity_hollow_records:old-id', 'quantity_hollow_revisions')).toBe(false)
  }
  finally { database.close() }
})
