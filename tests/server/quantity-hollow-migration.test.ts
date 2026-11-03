import { expect, it } from 'vitest'
import { QUANTITY_HOLLOW_TABLES } from '~/lib/quantity/central-hollow-schema'
import { readQuantityMigrationGraphs } from '~/lib/quantity/migration-source'
import { loadQuantityHollowFacts } from '../../server/utils/quantity-hollow-facts'
import { loadQuantityHollowMigratedProof } from '../../server/utils/quantity-hollow-migrated-proof'
import { createQuantityHollowFixture } from '../helpers/quantity-hollow-fixture'
import { cloneQuantityHollowSnapshot, importQuantityHollowFixture } from '../helpers/quantity-hollow-migration-fixture'

async function original() {
  const f = await createQuantityHollowFixture()
  const read = await f.service.hollow(f.scope)
  const created = await f.service.executeHollow(f.command(read, { kind: 'create-hollow-inspection', target: read.data.targets[0]!.target, input: { inspectedOn: '2026-09-15', count: 19, note: '迁入链原件十九处' } }))
  const next = await f.service.hollow(f.scope)
  await f.service.executeHollow(f.command(next, { kind: 'rectify-hollow-inspection', recordId: created.id, expectedRevisionId: created.hollow.revisionId, rectifiedOn: '2026-09-15', count: 4, note: '原生已复核四处' }))
  return f
}

it('公开迁入冷读保余15处，中央追加整改后仍可重试原命令且恢复受保护', async () => {
  const native = await original()
  let target: Awaited<ReturnType<typeof importQuantityHollowFixture>> | null = null
  try {
    target = await importQuantityHollowFixture(native.db)
    const before = await target.reload().hollow(target.scope)
    expect(before.data.unavailable).toEqual([])
    expect(before.data.records[0]).toMatchObject({ remainingCount: 15, rectifiedCount: 4 })
    const command = target.command(before, { kind: 'rectify-hollow-inspection', recordId: target.recordId, expectedRevisionId: before.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-15', count: 3, note: '中央追加复核三处' })
    const receipt = await target.service.executeHollow(command)
    expect(await target.reload().executeHollow(command)).toEqual(receipt)
    const after = await target.reload().hollow(target.scope)
    expect(after.data.records[0]).toMatchObject({ remainingCount: 12, rectifiedCount: 7 })
    await expect(target.rollback()).rejects.toThrow('迁入空鼓检查已有独立追加的修订、整改或回执；已阻止恢复并保留原件')
    expect((await target.service.hollow(target.scope)).data).toEqual(after.data)
    expect(target.core.snapshot(target.session).authority).toBe('central')
  }
  finally {
    await target?.close()
    await native.close()
  }
}, 30_000)

it('真实迁入后原生续链再导出再迁入，扁平原件不递归复制且旧冻结前缀仍可证明', async () => {
  const native = await original()
  let first: Awaited<ReturnType<typeof importQuantityHollowFixture>> | null = null
  let second: Awaited<ReturnType<typeof importQuantityHollowFixture>> | null = null
  let restored: Awaited<ReturnType<typeof cloneQuantityHollowSnapshot>> | null = null
  try {
    first = await importQuantityHollowFixture(native.db)
    const before = await first.reload().hollow(first.scope)
    const frozen = before.data.records[0]!.proof
    await first.service.executeHollow(first.command(before, { kind: 'rectify-hollow-inspection', recordId: first.recordId, expectedRevisionId: before.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-15', count: 3, note: '第一次迁入后追加三处' }))
    const bytes = await first.instance.exportSnapshotBytes()
    expect(await first.instance.withWorkspaceTransaction(tx => tx.select('PRAGMA foreign_keys'))).toEqual([{ foreign_keys: 1 }])
    restored = await cloneQuantityHollowSnapshot(bytes)
    const graph = (await readQuantityMigrationGraphs(restored))[0]!.graph
    if (graph.version !== 2)
      throw new Error('续链导出缺子图')
    expect(graph.hollow.origins).toHaveLength(2)
    const [firstEvidence] = await first.instance.withWorkspaceTransaction(tx => tx.select<{ mapped_package_json: string }>('SELECT mapped_package_json FROM quantity_hollow_migration_evidence'))
    expect(graph.hollow.origins[0]!.bodyJson).toBe(JSON.parse(firstEvidence!.mapped_package_json).origins[0].bodyJson)
    expect(graph.hollow.origins.every(origin => !origin.bodyJson.includes('source_package_json'))).toBe(true)
    second = await importQuantityHollowFixture(restored)
    const next = await second.reload().hollow(second.scope)
    expect(next.data.unavailable).toEqual([])
    expect(next.data.records[0]).toMatchObject({ remainingCount: 12, rectifiedCount: 7 })
    const proof = await second.instance.withWorkspaceTransaction(tx => loadQuantityHollowMigratedProof(tx, second!.scope.projectId))
    const history = proof.histories.get(second.recordId)!
    const mappedFrozen = history.steps.find(step => step.proof.fingerprint === frozen.fingerprint)!.proof
    const old = await second.instance.withWorkspaceTransaction(tx => loadQuantityHollowFacts(tx, { projectId: second!.scope.projectId, selection: { kind: 'frozen', refs: [mappedFrozen] } }, { migratedProof: loadQuantityHollowMigratedProof }))
    expect(old.records[0]).toMatchObject({ remainingCount: 15, rectifiedCount: 4 })
    await second.service.executeHollow(second.command(next, { kind: 'rectify-hollow-inspection', recordId: second.recordId, expectedRevisionId: next.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-15', count: 2, note: '再次迁入后追加两处' }))
    expect((await second.reload().hollow(second.scope)).data.records[0]).toMatchObject({ remainingCount: 10, rectifiedCount: 9 })
  }
  finally {
    await second?.close()
    restored?.close()
    await first?.close()
    await native.close()
  }
}, 30_000)

it('迁入命令键不可被本地领取；完整原件未变化时公开恢复只删除本批次五表', async () => {
  const native = await original()
  let target: Awaited<ReturnType<typeof importQuantityHollowFixture>> | null = null
  try {
    target = await importQuantityHollowFixture(native.db)
    const current = await target.service.hollow(target.scope)
    const [receipt] = await target.instance.withWorkspaceTransaction(tx => tx.select<{ command_id: string, request_json: string }>('SELECT command_id,request_json FROM quantity_hollow_command_receipts ORDER BY id'))
    expect(receipt!.command_id).not.toBe(JSON.parse(receipt!.request_json).commandId)
    await expect(target.service.executeHollow({ ...target.command(current, { kind: 'rectify-hollow-inspection', recordId: target.recordId, expectedRevisionId: current.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-15', count: 1, note: '不能领取原回执' }), commandId: receipt!.command_id })).rejects.toThrow()
    expect((await target.reload().hollow(target.scope)).data).toEqual(current.data)
    await target.rollback()
    const rows = await target.instance.withWorkspaceTransaction(async tx => Promise.all(QUANTITY_HOLLOW_TABLES.map(table => tx.select(`SELECT * FROM ${table}`))))
    expect(rows.every(table => table.length === 0)).toBe(true)
    expect(target.core.snapshot(target.session).authority).toBe('local')
  }
  finally {
    await target?.close()
    await native.close()
  }
}, 30_000)

it('已经冷读成功的来源仍逐次核物理原件，改整改原备注不可冒充当前余量', async () => {
  const native = await original()
  let target: Awaited<ReturnType<typeof importQuantityHollowFixture>> | null = null
  try {
    target = await importQuantityHollowFixture(native.db)
    const current = await target.service.hollow(target.scope)
    const frozen = current.data.records[0]!.proof
    const load = () => target!.instance.withWorkspaceTransaction(tx => loadQuantityHollowFacts(tx, { projectId: target!.scope.projectId, selection: { kind: 'frozen', refs: [frozen] } }, { migratedProof: loadQuantityHollowMigratedProof }))
    expect((await load()).records[0]!.remainingCount).toBe(15)
    await target.instance.withWorkspaceTransaction(tx => tx.execute('UPDATE quantity_hollow_rectifications SET note=?', ['改动原四处备注']))
    expect((await load()).records).toEqual([])
    expect((await load()).unavailable).not.toEqual([])
    await expect(target.rollback()).rejects.toThrow()
  }
  finally {
    await target?.close()
    await native.close()
  }
}, 30_000)

it.each([true, false])('恢复核对独立原生检查与本批次责任人的关系（引用本批次=%s），明确零处仍是事实', async (related) => {
  const native = await original()
  let target: Awaited<ReturnType<typeof importQuantityHollowFixture>> | null = null
  try {
    target = await importQuantityHollowFixture(native.db)
    const independent = await target.createIndependent(related)
    expect(independent.read.data.records[0]).toMatchObject({ remainingCount: 0, inspection: { input: { count: 0 } } })
    if (related) {
      await expect(target.rollback()).rejects.toThrow('独立空鼓检查原件仍引用本批次项目、责任或施工主体；已阻止恢复并保留全部当前事实')
      expect(target.core.snapshot(target.session).authority).toBe('central')
    }
    else {
      await target.rollback()
      expect(target.core.snapshot(target.session).authority).toBe('local')
    }
    expect((await target.reload().hollow(independent.scope)).data).toEqual(independent.read.data)
  }
  finally {
    await target?.close()
    await native.close()
  }
}, 30_000)
