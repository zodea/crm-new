import type { BusinessSession } from '../../server/utils/business-session'
import type { TargetCostProjectSource } from '../../server/utils/target-cost-service'
import type { TargetCostAction, TargetCostCommand, TargetCostFormRead } from '~/lib/target-cost/central-contract'
import { afterEach, describe, expect, it } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { decodeTargetCostRead, encodeTargetCostWire, parseTargetCostCommand } from '~/lib/target-cost/central-codec'
import { createTargetCostRepository } from '~/lib/target-cost/central-repository'
import { aggregateTargetCostActual } from '../../server/utils/target-cost-actual'
import { createTargetCostService } from '../../server/utils/target-cost-service'
import { createMigratedMemoryDb } from '../helpers/memory-db'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})
async function fixture() {
  const db = await createMigratedMemoryDb()
  const coordinator = createDbCoordinator(async () => db)
  closers.push(() => coordinator.close())
  let session: BusinessSession = { workspaceId: 'w', actorId: 'a', capabilities: ['target-cost:read', 'target-cost:write'] }
  let source: TargetCostProjectSource = { projects: [{ id: 'p', code: 'P', name: '真实项目' }], version: 'p1', status: 'available' }
  let projectHook = () => { }
  const service = createTargetCostService({ session: () => session, projects: () => {
    projectHook()
    return structuredClone(source)
  }, actual: async id => aggregateTargetCostActual(id, []), transaction: work => coordinator.withTransaction(tx => work(tx, { ...session })) })
  let counter = 0
  const command = (read: TargetCostFormRead, action: TargetCostAction): TargetCostCommand => ({ commandId: `c${++counter}`, ...read.context, requiredCapability: 'target-cost:write', targetCostId: read.targetCostId, draftKey: read.draftKey ?? undefined, action })
  const create = async (name = '', baseline = false, projectId?: string) => service.execute(command(await service.form({ origin: 'real' }, null, `draft-${++counter}`), { kind: 'save-header', draft: { name, isBaseline: baseline, projectId, plannedProfit: 0 }, saveAction: 'draft' }))
  return { db, service, command, create, setSource: (next: TargetCostProjectSource) => {
    source = next
  }, setSession: (next: BusinessSession) => {
    session = next
  }, hook: (next: () => void) => {
    projectHook = next
  } }
}
describe('中央预算工作区事务', () => {
  it('版本恢复只恢复自身，不复活此前单独删除的明细与附件，项目删除后整版隐藏', async () => {
    const f = await fixture()
    const initial = await f.service.form({ origin: 'real' }, null, 'restore-graph')
    const saved = await f.service.execute(f.command(initial, { kind: 'save-header', saveAction: 'draft', draft: { name: '恢复图', projectId: 'p' }, files: { add: [{ fileName: '预算.xlsx', fileSize: 3, mimeType: 'application/octet-stream', payloadBase64: 'YWJj' }] } }))
    await f.service.execute(f.command(await f.service.form({ origin: 'real' }, saved.id), { kind: 'save-items', items: [{ category: '材料', itemName: '原行', amount: 1 }] }))
    await f.service.execute(f.command(await f.service.form({ origin: 'real' }, saved.id), { kind: 'save-items', items: [] }))
    const read = await f.service.form({ origin: 'real' }, saved.id)
    await f.service.execute(f.command(read, { kind: 'save-header', saveAction: 'draft', draft: read.draft, files: { removeIds: saved.attachmentIds } }))
    await f.service.execute(f.command(await f.service.form({ origin: 'real' }, saved.id), { kind: 'delete' }))
    await f.service.execute(f.command(await f.service.form({ origin: 'real' }, saved.id), { kind: 'restore' }))
    const restored = await f.service.detail({ origin: 'real' }, saved.id)
    expect(restored.view.items).toEqual([])
    expect(restored.files[0]?.deletedAt).not.toBeNull()
    expect(restored.history.some(row => row.tableName === 'target_cost_items' && row.operation === 'delete')).toBe(true)
    f.setSource({ projects: [], version: 'gone-project', status: 'available' })
    expect((await f.service.list({ origin: 'real' })).rows).toEqual([])
    await expect(f.service.detail({ origin: 'real' }, saved.id)).rejects.toThrow('所属项目')
  })
  async function createDecodeTargetCostReadFixture() {
    const f = await fixture()
    const result = await f.create('来源核对', false, 'p')
    await f.db.execute('INSERT INTO target_cost_items(id,target_cost_id,cost_category,item_name,qty,unit_price,amount) VALUES (?,?,?,?,?,?,?)', ['legacy-precision', result.id, '材料', '保留原数量', 0.001, null, 0])
    const wire = encodeTargetCostWire(await f.service.detail({ origin: 'real' }, result.id)) as { view: { header: Record<string, unknown>, categories: Array<{ category: string, sources: Record<string, unknown> }> } }
    const decoded = decodeTargetCostRead(wire, 'detail', { origin: 'real' }, result.id) as { view: { items: unknown[] } }
    expect(decoded.view.items[0]).toMatchObject({ qty: 0.001, unitPrice: null, amount: 0 })
    const incomplete = structuredClone(wire)
    delete incomplete.view.header.contractRevenue
    return { f, result, wire, decoded, incomplete }
  }

  it('详情边界保留旧小数数量与null金额，缺损头金额及错科目来源不进入页面', async () => {
    const { wire } = await createDecodeTargetCostReadFixture()
    const wrongSource = structuredClone(wire)
    const category = wrongSource.view.categories.find(row => row.category === '材料')!
    category.sources.contract = { kind: 'entity-list', entity: 'contract', variant: 'material', view: null, filters: { projectId: 'p', dataOrigin: 'real', costCategory: '其他' } }
  })

  it.each([
    { case: 'incomplete / \'detail\' / { origin: \'real\' } / result.id', prepare: async ({ result, incomplete }: Awaited<ReturnType<typeof createDecodeTargetCostReadFixture>>) => {
      return { input: incomplete, argument2: 'detail', argument3: { origin: 'real' }, argument4: result.id, expected: '不完整' } as const
    } },
    { case: 'wrongSource / \'detail\' / { origin: \'real\' } / result.id', prepare: async ({ result, wire }: Awaited<ReturnType<typeof createDecodeTargetCostReadFixture>>) => {
      const wrongSource = structuredClone(wire)
      const category = wrongSource.view.categories.find(row => row.category === '材料')!
      category.sources.contract = { kind: 'entity-list', entity: 'contract', variant: 'material', view: null, filters: { projectId: 'p', dataOrigin: 'real', costCategory: '其他' } }
      return { input: wrongSource, argument2: 'detail', argument3: { origin: 'real' }, argument4: result.id, expected: '不完整' } as const
    } },
  ])('详情边界保留旧小数数量与null金额，缺损头金额及错科目来源不进入页面 / decodeTargetCostRead：$case', async ({ prepare }) => {
    const fixture = await createDecodeTargetCostReadFixture()
    const { input, argument2, argument3, argument4, expected } = await prepare(fixture)
    expect(() => decodeTargetCostRead(input, argument2, argument3, argument4)).toThrow(expected)
  })
  it('无项目草稿不借工程量权限，保留null/0并读回真实附件正文', async () => {
    const f = await fixture()
    f.setSource({ projects: [], options: [], version: 'no-lookup', status: 'unavailable', optionsStatus: 'forbidden' })
    const read = await f.service.form({ origin: 'real' }, null, 'new')
    expect(read.projects).toEqual([])
    const result = await f.service.execute(f.command(read, { kind: 'save-header', saveAction: 'draft', draft: { plannedProfit: 0, contractRevenue: null }, files: { add: [{ fileName: 'budget.xlsx', fileSize: 3, mimeType: 'application/octet-stream', payloadBase64: 'YWJj' }] } }))
    const detail = await f.service.detail({ origin: 'real' }, result.id)
    expect(detail.view.header).toMatchObject({ projectId: null, plannedProfit: 0, contractRevenue: null })
    expect(detail.view.summary.settledAmount.value).toBeNull()
    expect((await f.service.file({ origin: 'real' }, result.id, result.attachmentIds[0]!)).content).toMatchObject({ state: 'available', payloadBase64: 'YWJj' })
  })
  it('唯一基准切换原子写两份日志，旧基准删除后恢复冲突不抢新基准', async () => {
    const f = await fixture()
    const a = await f.create('A', true, 'p')
    const b = await f.create('B', true, 'p')
    expect(b.affectedVersionIds).toEqual([b.id, a.id])
    expect((await f.service.form({ origin: 'real' }, a.id)).draft.isBaseline).toBe(false)
    await f.service.execute(f.command(await f.service.form({ origin: 'real' }, b.id), { kind: 'delete' }))
    await f.service.execute(f.command(await f.service.form({ origin: 'real' }, a.id), { kind: 'save-header', saveAction: 'draft', draft: { projectId: 'p', name: 'A', isBaseline: true } }))
    await expect(f.service.execute(f.command(await f.service.form({ origin: 'real' }, b.id), { kind: 'restore' }))).rejects.toMatchObject({ problem: { code: 'conflict', commandOutcome: 'not-applied' } })
    expect((await f.service.form({ origin: 'real' }, b.id)).deletedAt).not.toBeNull()
    expect((await f.service.list({ origin: 'real' })).rows).toHaveLength(2)
  })
  it('读取时版本固定，并发新写不会偷换；成功失响应按原编号重放一次', async () => {
    const f = await fixture()
    const stale = await f.service.form({ origin: 'real' }, null, 'stale')
    const command = f.command(stale, { kind: 'save-header', saveAction: 'draft', draft: { name: 'one' } })
    const result = await f.service.execute(command)
    expect(await f.service.execute(command)).toEqual(result)
    await expect(f.service.execute({ ...command, action: { kind: 'save-header', saveAction: 'draft', draft: { name: 'other' } } })).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.service.execute(f.command(stale, { kind: 'save-header', saveAction: 'draft', draft: { name: 'two' } }))).rejects.toMatchObject({ problem: { code: 'stale-source', commandOutcome: 'not-applied' } })
    expect((await f.service.list({ origin: 'real' })).rows).toHaveLength(1)
  })
  it('明细按稳定ID整份保存，空/零独立，错误行与跨版本ID均不改状态', async () => {
    const f = await fixture()
    const a = await f.create()
    const b = await f.create()
    const read = await f.service.form({ origin: 'real' }, a.id)
    await expect(f.service.execute(f.command(read, { kind: 'save-items', items: [{ category: '材料', itemName: '', amount: 0 }] }))).rejects.toMatchObject({ problem: { fieldErrors: { 'items.0.itemName': ['第 1 行分项名称为必填项'] } } })
    await f.service.execute(f.command(read, { kind: 'save-items', items: [{ category: '材料', itemName: '砂', qty: null, unitPrice: 0, amount: 300 }] }))
    const detail = await f.service.detail({ origin: 'real' }, a.id)
    expect(detail.view.items[0]).toMatchObject({ qty: null, unitPrice: 0, amount: 300 })
    await expect(f.service.execute(f.command(await f.service.form({ origin: 'real' }, b.id), { kind: 'save-items', items: [{ ...detail.view.items[0] }] }))).rejects.toThrow('不属于当前版本')
    expect((await f.service.form({ origin: 'real' }, a.id)).draft.status).toBe('draft')
  })
  it('最后来源等待期间项目删除或会话撤权，正文/回执/审计全部回滚', async () => {
    const f = await fixture()
    const read = await f.service.form({ origin: 'real' }, null, 'late')
    let calls = 0
    f.hook(() => {
      if (++calls === 2)
        f.setSource({ projects: [], version: 'gone', status: 'available' })
    })
    await expect(f.service.execute(f.command(read, { kind: 'save-header', saveAction: 'draft', draft: { projectId: 'p', name: 'late' } }))).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    expect(await f.db.select('SELECT * FROM target_costs')).toEqual([])
    f.hook(() => { })
    const next = await f.service.form({ origin: 'real' }, null, 'late2')
    calls = 0
    f.hook(() => {
      if (++calls === 2)
        f.setSession({ workspaceId: 'w', actorId: 'a', capabilities: ['target-cost:read'] })
    })
    await expect(f.service.execute(f.command(next, { kind: 'save-header', saveAction: 'draft', draft: {} }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.db.select('SELECT * FROM target_cost_command_receipts')).toEqual([])
    expect(await f.db.select('SELECT * FROM operation_logs WHERE table_name = \'target_costs\'')).toEqual([])
  })
  it('已有回执重放遇最后来源变化，不宣称原命令未写入', async () => {
    const f = await fixture()
    const read = await f.service.form({ origin: 'real' }, null, 'retry')
    const command = f.command(read, { kind: 'save-header', saveAction: 'draft', draft: {} })
    await f.service.execute(command)
    let calls = 0
    f.hook(() => {
      if (++calls === 2)
        f.setSource({ projects: [], version: 'later', status: 'available' })
    })
    await expect(f.service.execute(command)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    try {
      await f.service.execute(command)
    }
    catch (cause) {
      expect((cause as {
        problem: object
      }).problem).not.toHaveProperty('commandOutcome')
    }
    expect(await f.db.select('SELECT * FROM target_costs')).toHaveLength(1)
  })
  it('hTTP Repository金额只按MoneyDTO解码，命令数字只在受验证边界转换', async () => {
    const f = await fixture()
    const repo = createTargetCostRepository(async (url, options) => {
      if (url === '/api/commands/target-costs')
        return f.service.execute(parseTargetCostCommand(options?.body))
      if (url === '/api/read/target-costs/form')
        return encodeTargetCostWire(await f.service.form({ origin: 'real' }, null, 'http'))
      return encodeTargetCostWire(await f.service.list({ origin: 'real' }))
    })
    const read = await repo.form({ origin: 'real' }, null, 'http')
    await repo.execute(f.command(read, { kind: 'save-header', saveAction: 'draft', draft: { plannedProfit: 0, contractRevenue: null } }))
    expect((await repo.list({ origin: 'real' })).rows[0]).toMatchObject({ plannedProfit: 0, contractRevenue: null })
    const bad = createTargetCostRepository(async () => f.service.list({ origin: 'real' }))
    await expect(bad.list({ origin: 'real' })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
})
