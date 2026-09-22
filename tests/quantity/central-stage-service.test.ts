import type { TestDb } from '../helpers/memory-db'
import type { QuantityCommand } from '~/lib/quantity/central-contract'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { runMigrations } from '~/lib/db/migrations'
import { createQuantityRepository } from '~/lib/quantity/central-repository'
import { createQuantityService } from '~/lib/quantity/central-service'
import { createMemoryDb } from '../helpers/memory-db'

let memory: TestDb
const context = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['project:list:read', 'quantity:read', 'quantity:write'] }
const query = { projectId: 'project', origin: 'real' as const, includeDemo: false }

beforeEach(async () => {
  memory = await createMemoryDb()
  await runMigrations(memory)
  await memory.execute('INSERT INTO projects (id, name) VALUES (?, ?)', ['project', '正式项目'])
  await memory.execute('INSERT INTO items (id, project_id, code, name, trade, unit) VALUES (?, ?, ?, ?, ?, ?)', ['item', 'project', 'I', '腻子', '油漆工', null])
})
afterEach(() => memory.close())

function setup() {
  const service = createQuantityService({
    workspaceId: context.workspaceId,
    database: createDbCoordinator(async () => ({ ...memory, close: async () => memory.close() })),
    project: async id => ({ id, name: '正式项目', code: 'P' }),
  })
  const repository = createQuantityRepository(async (url, options) => {
    if (url === '/api/read/quantity/stages')
      return service.stages(options!.query as typeof query, context)
    if (url === '/api/commands/quantity')
      return service.execute(options!.body!, context)
    throw new Error(`未预期端点：${url}`)
  })
  const save = async (action: QuantityCommand['action']) => {
    const before = await repository.stages(query)
    const command: QuantityCommand = { ...context, ...query, requiredCapability: 'quantity:write', commandId: crypto.randomUUID(), baseVersion: before.sourceVersion, action }
    const result = await repository.execute(command)
    expect(await repository.execute(command)).toEqual(result)
    return { command, result }
  }
  return { repository, save }
}

it('阶段配置走中央命令与同源回读，新映射不自动报量，显式切换原子且可重试', async () => {
  const { repository, save } = setup()
  const stage = async (code: string) => (await save({ kind: 'save-stage', allowArchivedEdit: false, draft: { id: null, code, name: code, trade: '油漆工', completionMode: 'unit', sortOrder: 1, itemIds: ['item'] } })).result.id
  const first = await stage('第一遍')
  const second = await stage('第二遍')
  let workspace = await repository.stages(query)
  expect(workspace.data.items[0]!.unit).toBeNull()
  expect(workspace.data.mappings.every(row => !row.isReportingStage)).toBe(true)
  await save({ kind: 'set-reporting-stage', itemId: 'item', stageId: first, allowArchivedEdit: false })
  const switchStage = await save({ kind: 'set-reporting-stage', itemId: 'item', stageId: second, allowArchivedEdit: false })
  workspace = await repository.stages(query)
  expect(workspace.data.mappings.filter(row => row.isReportingStage).map(row => row.stageId)).toEqual([second])
  expect(await memory.select('SELECT DISTINCT operator FROM operation_logs')).toEqual([{ operator: context.actorId }])
  await memory.execute('UPDATE construction_stages SET deleted_at = ? WHERE id = ?', ['2026-09-11', second])
  await expect(repository.execute(switchStage.command)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
})

it('阶段回读拒绝跨工种映射和同分项多个报量阶段', async () => {
  const envelope = { dataOrigin: 'real', sourceVersion: 'q:1', asOf: '2026-09-11T00:00:00.000Z', capabilities: ['quantity:read'] }
  const data = {
    projectId: query.projectId,
    matrixArchivedAt: null,
    stages: [{ id: 'one', code: 'S1', name: '一遍', trade: '油漆工', completionMode: 'unit', sortOrder: 1 }, { id: 'two', code: 'S2', name: '二遍', trade: '油漆工', completionMode: 'unit', sortOrder: 2 }],
    items: [{ id: 'item', code: 'I', name: '腻子', trade: '油漆工', unit: null }],
    mappings: [{ id: 'map-one', stageId: 'one', itemId: 'item', isReportingStage: true }],
  }
  for (const invalid of [
    { ...data, items: [{ ...data.items[0], trade: '木工' }] },
    { ...data, mappings: [...data.mappings, { id: 'map-two', stageId: 'two', itemId: 'item', isReportingStage: true }] },
  ]) {
    await expect(createQuantityRepository(async () => ({ ...envelope, data: invalid })).stages(query)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
  }
})

it('矩阵归档与解除走相同版本和审计，归档后普通修改被拒且明确授权才可编辑', async () => {
  const { repository, save } = setup()
  const before = await repository.stages(query)
  await save({ kind: 'set-archived', archived: true })
  const archived = await repository.stages(query)
  expect(archived.data.matrixArchivedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
  expect(archived.sourceVersion).not.toBe(before.sourceVersion)
  const action = { kind: 'save-stage' as const, allowArchivedEdit: false, draft: { id: null, code: '手工', name: '手工', trade: '油漆工', completionMode: 'manual' as const, sortOrder: 1, itemIds: [] } }
  await expect(save(action)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  await save({ ...action, allowArchivedEdit: true })
  await save({ kind: 'set-archived', archived: false })
  expect((await repository.stages(query)).data.matrixArchivedAt).toBeNull()
  expect(await memory.select('SELECT COUNT(*) AS count FROM operation_logs WHERE table_name = ?', ['projects'])).toEqual([{ count: 2 }])
})
