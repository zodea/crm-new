import type { CoreMigrationSnapshotDTO } from '~/lib/migration/core-contract'
import type { ProcessLibraryMigrationGraph } from '~/lib/migration/process-library-source'
import { describe, expect, it } from 'vitest'
import { prepareProcessLibraryMigration } from '../../server/utils/process-library-migration'

const at = '2026-09-12T08:00:00.000Z'
function graph(): ProcessLibraryMigrationGraph {
  return {
    schemaVersion: 1,
    library: { id: 'old-version', code: 'decoration', version: 1, name: '旧版标准库', description: '不可变旧版本', sort_order: 50, is_default: 0, created_at: at, updated_at: at, deleted_at: null },
    tasks: [
      { id: 'old-task-a', library_id: 'old-version', task_key: 'a', name: '后续工序', trade: '木工', color: '#64748b', duration_days: 3, stage_code: 'stage-a', item_codes_json: '["item-a"]', sort_order: 10, predecessor_task_key: 'b', predecessor_disabled: 1, created_at: at, updated_at: at, deleted_at: null },
      { id: 'old-task-b', library_id: 'old-version', task_key: 'b', name: '原前置工序', trade: '泥水工', color: '#64748b', duration_days: 2, stage_code: '', item_codes_json: '[]', sort_order: 30, predecessor_task_key: null, predecessor_disabled: 0, created_at: at, updated_at: at, deleted_at: null },
      { id: 'deleted-task', library_id: 'old-version', task_key: 'deleted', name: '已删除历史工序', trade: '', color: '#64748b', duration_days: 1, stage_code: '', item_codes_json: '[]', sort_order: 20, predecessor_task_key: 'b', predecessor_disabled: 1, created_at: at, updated_at: at, deleted_at: at },
    ],
  }
}
function snapshot(source = graph()): CoreMigrationSnapshotDTO {
  return {
    authority: 'central',
    activeBatchId: 'batch-one',
    entities: [{ entityType: 'process_libraries', id: 'central-version', legacyId: source.library.id, name: source.library.name, references: {}, quantity: null, amount: null, attributes: { graphJson: JSON.stringify(source) }, deletedAt: source.library.deleted_at, batchId: 'batch-one' }],
  }
}
const rollback: CoreMigrationSnapshotDTO = { authority: 'local', activeBatchId: null, entities: [] }

describe('工序库迁入候选与恢复', () => {
  it('保全头与全部任务身份、删除边界、映射、禁用关系，中央使用量保持未知', () => {
    const prepared = prepareProcessLibraryMigration([], snapshot())
    expect(prepared.changed).toBe(true)
    expect(prepared.versions).toHaveLength(1)
    const version = prepared.versions[0]!
    expect(version).toMatchObject({ id: 'central-version', legacyId: 'old-version', code: 'decoration', version: 1, sourceVersion: '1', sourceVersionId: null, dataOrigin: 'real', usageCount: null, taskCount: 2, sortOrder: 50, createdAt: at, updatedAt: at, migrationBatchId: 'batch-one' })
    expect(version.tasks).toHaveLength(3)
    expect(version.tasks.find(row => row.key === 'a')).toMatchObject({ legacyId: 'old-task-a', libraryId: version.id, libraryVersion: 1, predecessorKey: 'b', predecessorDisabled: true, stageCode: 'stage-a', itemCodes: ['item-a'], sortOrder: 10, createdAt: at, updatedAt: at })
    expect(version.tasks.find(row => row.key === 'deleted')).toMatchObject({ legacyId: 'deleted-task', deletedAt: at, predecessorKey: 'b', predecessorDisabled: true })
    expect(version.tasks.every(row => !['old-task-a', 'old-task-b', 'deleted-task'].includes(row.id))).toBe(true)
  })

  it('重复确认返回相同稳定身份且不再变更；返回数组与原状态隔离', () => {
    const first = prepareProcessLibraryMigration([], snapshot())
    const second = prepareProcessLibraryMigration(first.versions, snapshot())
    expect(second).toEqual({ versions: first.versions, changed: false })
    second.versions[0]!.tasks[0]!.name = '候选被修改'
    expect(first.versions[0]!.tasks[0]!.name).toBe('后续工序')
  })

  it('同批次同身份内容被替换时拒绝，不覆盖已经确认的不可变版本', () => {
    const current = prepareProcessLibraryMigration([], snapshot()).versions
    const original = structuredClone(current)
    const changed = graph()
    changed.tasks[0]!.duration_days = 9
    expect(() => prepareProcessLibraryMigration(current, snapshot(changed))).toThrow(/内容.*变化|不可变/)
    expect(current).toEqual(original)
  })

  it('新建版本独立于迁入来源，撤回只删除批次迁入版本', () => {
    const imported = prepareProcessLibraryMigration([], snapshot()).versions[0]!
    const independent = { ...structuredClone(imported), id: 'new-central', legacyId: null, code: 'new-code', migrationBatchId: null, tasks: [] }
    expect(prepareProcessLibraryMigration([imported, independent], rollback)).toEqual({ versions: [independent], changed: true })
  })

  it('已有基于迁入旧版新建的独立新版时阻断撤回，保留两版全部事实', () => {
    const imported = prepareProcessLibraryMigration([], snapshot()).versions[0]!
    const next = { ...structuredClone(imported), id: 'new-version', version: 2, sourceVersion: '2', sourceVersionId: imported.id, migrationBatchId: null, legacyId: null, tasks: [] }
    const current = [imported, next]
    const before = structuredClone(current)
    expect(() => prepareProcessLibraryMigration(current, rollback)).toThrow(/撤回.*来源|回滚.*来源/)
    expect(current).toEqual(before)
  })

  it('中央独立同编码同版本不被迁入覆盖，软删除也不隐藏冲突', () => {
    const independent = prepareProcessLibraryMigration([], snapshot()).versions[0]!
    independent.id = 'independent'
    independent.migrationBatchId = null
    independent.legacyId = null
    independent.deletedAt = at
    independent.tasks = []
    expect(() => prepareProcessLibraryMigration([independent], snapshot())).toThrow(/编码.*版本.*冲突/)
  })

  it.each(['batch', 'legacy', 'name', 'delete', 'json', 'reference'] as const)('拒绝 %s 错配，不产生部分候选', (kind) => {
    const candidate = snapshot()
    const entity = candidate.entities[0]!
    if (kind === 'batch')
      entity.batchId = 'other'
    if (kind === 'legacy')
      entity.legacyId = 'other'
    if (kind === 'name')
      entity.name = '伪造同名'
    if (kind === 'delete')
      entity.deletedAt = at
    if (kind === 'json')
      entity.attributes.graphJson = '{'
    if (kind === 'reference')
      entity.references.projectId = 'project'
    expect(() => prepareProcessLibraryMigration([], candidate)).toThrow()
  })

  function createInvalidProcessTaskGraph() {
    const source = graph()
    source.tasks[0]!.item_codes_json = '{}'
    return { source }
  }

  it.each([
    { case: '[] / snapshot(source)', prepare: ({ source }: ReturnType<typeof createInvalidProcessTaskGraph>) => {
      return { input: [], argument2: snapshot(source), expected: /映射/ } as const
    } },
    { case: '[] / snapshot(source)', prepare: ({ source }: ReturnType<typeof createInvalidProcessTaskGraph>) => {
      source.tasks[0]!.item_codes_json = '[]'
      source.tasks[0]!.predecessor_task_key = 'missing'
      return { input: [], argument2: snapshot(source), expected: /前置/ } as const
    } },
  ])('服务端再次拒绝无效前置和损坏映射，不信任来源客户端 / prepareProcessLibraryMigration：$case', ({ prepare }) => {
    const fixture = createInvalidProcessTaskGraph()
    const { input, argument2, expected } = prepare(fixture)
    expect(() => prepareProcessLibraryMigration(input, argument2)).toThrow(expected)
  })

  function createDuplicateProcessLibrarySnapshot() {
    const candidate = snapshot()
    const other = structuredClone(candidate.entities[0]!)
    other.id = 'another-central'
    candidate.entities.push(other)
    return { candidate, other }
  }

  it.each([
    { case: '重复旧库', prepare: ({ candidate }: ReturnType<typeof createDuplicateProcessLibrarySnapshot>) => {
      return { input: [], argument2: candidate, expected: /重复/ } as const
    } },
    { case: '重复编码和版本', prepare: ({ candidate, other }: ReturnType<typeof createDuplicateProcessLibrarySnapshot>) => {
      const otherGraph = graph()
      otherGraph.library.id = 'another-old'
      for (const task of otherGraph.tasks)
        task.library_id = 'another-old'
      other.legacyId = 'another-old'
      other.attributes.graphJson = JSON.stringify(otherGraph)
      return { input: [], argument2: candidate, expected: /编码.*版本/ } as const
    } },
    { case: '跨库重复任务身份', prepare: ({ candidate, other }: ReturnType<typeof createDuplicateProcessLibrarySnapshot>) => {
      const otherGraph = graph()
      otherGraph.library.id = 'another-old'
      for (const task of otherGraph.tasks)
        task.library_id = 'another-old'
      other.legacyId = 'another-old'
      other.attributes.graphJson = JSON.stringify(otherGraph)
      otherGraph.library.code = 'another-code'
      other.attributes.graphJson = JSON.stringify(otherGraph)
      return { input: [], argument2: candidate, expected: /任务.*身份.*重复/ } as const
    } },
  ])('一批次中拒绝重复旧库、code/version 或跨库旧任务身份 / prepareProcessLibraryMigration：$case', ({ prepare }) => {
    const fixture = createDuplicateProcessLibrarySnapshot()
    const { input, argument2, expected } = prepare(fixture)
    expect(() => prepareProcessLibraryMigration(input, argument2)).toThrow(expected)
  })

  it('整个已删除库仍完整保留隐藏子任务，不反推来源版或 WBS 使用量', () => {
    const source = graph()
    source.library.deleted_at = at
    source.tasks[1]!.deleted_at = at
    const version = prepareProcessLibraryMigration([], snapshot(source)).versions[0]!
    expect(version).toMatchObject({ deletedAt: at, sourceVersionId: null, usageCount: null })
    expect(version.tasks).toHaveLength(3)
  })
})
