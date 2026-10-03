import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { runMigrations } from '~/lib/db/migrations'
import { loadQuantityStageWorkspace, parseQuantityStageAction, persistQuantityStageAction, validateQuantityStageParent } from '~/lib/quantity/central-stages'
import { createMemoryDb } from '../helpers/memory-db'

let memory: TestDb
let database: ReturnType<typeof createDbCoordinator>
const projectId = 'stage-project'
const draft = {
  id: null,
  code: 'PUTTY-01',
  name: '一遍腻子',
  trade: '油漆工',
  completionMode: 'unit',
  sortOrder: 10,
  itemIds: ['putty'],
}

async function save(value: unknown) {
  const action = parseQuantityStageAction(value)
  if (!action)
    throw new Error('不是阶段动作')
  return database.withTransaction(tx => persistQuantityStageAction(tx, projectId, action))
}

beforeEach(async () => {
  memory = await createMemoryDb()
  await runMigrations(memory)
  database = createDbCoordinator(async () => ({ ...memory, close: async () => memory.close() }))
  await memory.execute('INSERT INTO projects (id, code, name) VALUES (?, \'STAGE\', \'当前中央项目\'), (\'other-project\', \'OTHER\', \'其他项目\')', [projectId])
  await memory.execute(`INSERT INTO items (id, project_id, code, name, trade, unit) VALUES
    ('putty', ?, 'DEC-PUTTY', '腻子', '油漆工', '㎡'),
    ('tile', ?, 'DEC-TILE', '墙砖', '泥水工', '㎡'),
    ('foreign', 'other-project', 'DEC-OTHER', '其他分项', '油漆工', '㎡')`, [projectId, projectId])
})
afterEach(() => memory.close())

describe('项目阶段目录与显式报量映射', () => {
  it('新项目显式建立阶段与同工种分项映射，默认未指定报量，不产生责任或完成', async () => {
    expect((await loadQuantityStageWorkspace(memory, projectId)).stages).toEqual([])
    const result = await save({ kind: 'save-stage', draft, allowArchivedEdit: false })
    const workspace = await loadQuantityStageWorkspace(memory, projectId)
    expect(workspace.stages).toEqual([expect.objectContaining({ id: result.id, code: 'PUTTY-01', name: '一遍腻子' })])
    expect(workspace.items.map(item => item.id)).toEqual(['putty', 'tile'])
    expect(workspace.mappings).toEqual([expect.objectContaining({ stageId: result.id, itemId: 'putty', isReportingStage: false })])
    expect(result.logIds).toHaveLength(2)
    expect(await memory.select('SELECT id FROM unit_assignments')).toEqual([])
    expect(await memory.select('SELECT id FROM unit_stage_completions')).toEqual([])
  })

  it('同分项关联两阶段只由显式选择决定报量，改排序不变更选择且可以清空', async () => {
    const first = await save({ kind: 'save-stage', draft, allowArchivedEdit: false })
    const second = await save({ kind: 'save-stage', draft: { ...draft, code: 'PUTTY-02', name: '二遍腻子', sortOrder: 20 }, allowArchivedEdit: false })
    await save({ kind: 'set-reporting-stage', itemId: 'putty', stageId: second.id, allowArchivedEdit: false })
    await save({ kind: 'save-stage', draft: { ...draft, id: first.id, name: '第一遍腻子', sortOrder: 99 }, allowArchivedEdit: false })
    let workspace = await loadQuantityStageWorkspace(memory, projectId)
    expect(workspace.mappings.filter(row => row.isReportingStage).map(row => row.stageId)).toEqual([second.id])
    expect(workspace.stages.find(row => row.id === first.id)).toMatchObject({ name: '第一遍腻子', sortOrder: 99 })
    await save({ kind: 'set-reporting-stage', itemId: 'putty', stageId: first.id, allowArchivedEdit: false })
    workspace = await loadQuantityStageWorkspace(memory, projectId)
    expect(workspace.mappings.filter(row => row.isReportingStage).map(row => row.stageId)).toEqual([first.id])
    await save({ kind: 'set-reporting-stage', itemId: 'putty', stageId: null, allowArchivedEdit: false })
    expect((await loadQuantityStageWorkspace(memory, projectId)).mappings.some(row => row.isReportingStage)).toBe(false)
  })

  it.each(['foreign', 'tile', 'missing'])('分项 %s 错项目、工种或已不存在时拒绝保存且不留下阶段或日志', async (itemId) => {
    await expect(save({ kind: 'save-stage', draft: { ...draft, itemIds: [itemId] }, allowArchivedEdit: false })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    expect(await memory.select('SELECT id FROM construction_stages')).toEqual([])
    expect(await memory.select('SELECT id FROM operation_logs')).toEqual([])
  })

  it('不可见分项和不可见项目不能变成新阶段关系', async () => {
    await memory.execute('UPDATE items SET deleted_at = datetime(\'now\') WHERE id = \'putty\'')
    await expect(save({ kind: 'save-stage', draft, allowArchivedEdit: false })).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await memory.execute('UPDATE projects SET deleted_at = datetime(\'now\') WHERE id = ?', [projectId])
    await expect(loadQuantityStageWorkspace(memory, projectId)).rejects.toMatchObject({ problem: { code: 'not-found' } })
  })

  it('重复编码、重复映射、非法排序及对象形式的模式均给稳定业务错误', async () => {
    await save({ kind: 'save-stage', draft, allowArchivedEdit: false })
    await expect(save({ kind: 'save-stage', draft, allowArchivedEdit: false })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await loadQuantityStageWorkspace(memory, projectId)).stages).toHaveLength(1)
  })

  it.each(Array.from([{ itemIds: ['putty', 'putty'] }, { sortOrder: Number.NaN }, { completionMode: { toString: null } }]).map(input => ({ input })))('重复编码、重复映射、非法排序及对象形式的模式均给稳定业务错误：输入组合 1 案例 %#', async ({ input: patch }) => {
    await save({ kind: 'save-stage', draft, allowArchivedEdit: false })
    await expect(save({ kind: 'save-stage', draft, allowArchivedEdit: false })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(save({ kind: 'save-stage', draft: { ...draft, ...patch }, allowArchivedEdit: false })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  })

  it('归档只在明确确认后保存，取消不会写入或产生完成', async () => {
    await memory.execute('UPDATE projects SET matrix_archived_at = \'2026-09-11\' WHERE id = ?', [projectId])
    await expect(save({ kind: 'save-stage', draft, allowArchivedEdit: false })).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await loadQuantityStageWorkspace(memory, projectId)).stages).toEqual([])
    await save({ kind: 'save-stage', draft, allowArchivedEdit: true })
    expect((await loadQuantityStageWorkspace(memory, projectId)).stages).toHaveLength(1)
  })

  it('报量切换在审计/写入中途失败时原选择与审计完整回滚', async () => {
    const first = await save({ kind: 'save-stage', draft, allowArchivedEdit: false })
    const second = await save({ kind: 'save-stage', draft: { ...draft, code: 'PUTTY-02', name: '二遍' }, allowArchivedEdit: false })
    await save({ kind: 'set-reporting-stage', itemId: 'putty', stageId: first.id, allowArchivedEdit: false })
    const logs = await memory.select('SELECT * FROM operation_logs ORDER BY id')
    await memory.execute(`CREATE TRIGGER fail_reporting BEFORE UPDATE OF is_reporting_stage ON construction_stage_items
      WHEN NEW.is_reporting_stage = 1 BEGIN SELECT RAISE(ABORT, '切换中断'); END`)
    await expect(save({ kind: 'set-reporting-stage', itemId: 'putty', stageId: second.id, allowArchivedEdit: false })).rejects.toThrow('切换中断')
    expect((await loadQuantityStageWorkspace(memory, projectId)).mappings.filter(row => row.isReportingStage).map(row => row.stageId)).toEqual([first.id])
    expect(await memory.select('SELECT * FROM operation_logs ORDER BY id')).toEqual(logs)
  })

  it('隐藏阶段仍占有报量唯一键时明确冲突，不静默改写其映射', async () => {
    const first = await save({ kind: 'save-stage', draft, allowArchivedEdit: false })
    const second = await save({ kind: 'save-stage', draft: { ...draft, code: 'PUTTY-02', name: '二遍' }, allowArchivedEdit: false })
    await save({ kind: 'set-reporting-stage', itemId: 'putty', stageId: first.id, allowArchivedEdit: false })
    await memory.execute('UPDATE construction_stages SET deleted_at = datetime(\'now\') WHERE id = ?', [first.id])
    await expect(save({ kind: 'set-reporting-stage', itemId: 'putty', stageId: second.id, allowArchivedEdit: false })).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await memory.select('SELECT stage_id FROM construction_stage_items WHERE is_reporting_stage = 1')).toEqual([{ stage_id: first.id }])
  })

  it('父级复验不比较已改变的旧显示名/标记，但重验当前分项可见性', async () => {
    const created = await save({ kind: 'save-stage', draft, allowArchivedEdit: false })
    const action = parseQuantityStageAction({ kind: 'save-stage', draft: { ...draft, id: created.id }, allowArchivedEdit: false })!
    await save({ kind: 'save-stage', draft: { ...draft, id: created.id, name: '新显示名' }, allowArchivedEdit: false })
    await expect(validateQuantityStageParent(memory, projectId, action)).resolves.toBeUndefined()
    await memory.execute('UPDATE items SET deleted_at = datetime(\'now\') WHERE id = \'putty\'')
    await expect(validateQuantityStageParent(memory, projectId, action)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
  })

  it('编辑阶段不能因当前分项不可见而隐式删除旧映射或释放报量选择', async () => {
    const created = await save({ kind: 'save-stage', draft, allowArchivedEdit: false })
    await save({ kind: 'set-reporting-stage', itemId: 'putty', stageId: created.id, allowArchivedEdit: false })
    await memory.execute('UPDATE items SET deleted_at = datetime(\'now\') WHERE id = \'putty\'')
    expect((await loadQuantityStageWorkspace(memory, projectId)).mappings).toEqual([])
    const beforeStages = await memory.select('SELECT * FROM construction_stages')
    const beforeMappings = await memory.select('SELECT * FROM construction_stage_items')
    const beforeLogs = await memory.select('SELECT * FROM operation_logs ORDER BY id')
    await expect(save({ kind: 'save-stage', draft: { ...draft, id: created.id, name: '修改后的显示名', itemIds: [] }, allowArchivedEdit: false }))
      .rejects
      .toMatchObject({ problem: { code: 'conflict' } })
    expect(await memory.select('SELECT * FROM construction_stages')).toEqual(beforeStages)
    expect(await memory.select('SELECT * FROM construction_stage_items')).toEqual(beforeMappings)
    expect(await memory.select('SELECT * FROM operation_logs ORDER BY id')).toEqual(beforeLogs)
  })
})
