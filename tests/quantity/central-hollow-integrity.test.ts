import { describe, expect, it, vi } from 'vitest'
import { isQuantityHollowFact } from '~/lib/quantity/central-hollow-codec'
import { QUANTITY_HOLLOW_TABLES } from '~/lib/quantity/central-hollow-schema'
import { loadQuantityHollowFacts } from '../../server/utils/quantity-hollow-facts'
import { createQuantityHollowFixture } from '../helpers/quantity-hollow-fixture'

async function inspected() {
  const f = await createQuantityHollowFixture()
  const initial = await f.service.hollow(f.scope)
  const command = f.command(initial, { kind: 'create-hollow-inspection', target: initial.data.targets[0]!.target, input: { inspectedOn: '2026-09-15', count: 19, note: '首次排查' } })
  const created = await f.service.executeHollow(command)
  return { f, command, created }
}

describe('空鼓来源原件与事务边界', () => {
  it('原回执冷重放不重复整改；同键异正文拒绝，冻结前缀不被后来修订覆盖', async () => {
    const { f, command, created } = await inspected()
    try {
      const before = await f.service.hollow(f.scope)
      const fixCommand = f.command(before, { kind: 'rectify-hollow-inspection', recordId: created.id, expectedRevisionId: created.hollow.revisionId, rectifiedOn: '2026-09-15', count: 4, note: '整改四处' })
      const fixed = await f.service.executeHollow(fixCommand)
      const after = await f.service.hollow(f.scope)
      await f.service.executeHollow(f.command(after, { kind: 'revise-hollow-inspection', recordId: created.id, expectedRevisionId: created.hollow.revisionId, input: { inspectedOn: '2026-09-15', count: 20, note: '补记同次检查' }, reason: '漏记一处' }))
      expect(await f.reload().executeHollow(command)).toEqual(created)
      expect(await f.reload().executeHollow(fixCommand)).toEqual(fixed)
      await expect(f.service.executeHollow({ ...fixCommand, action: { ...fixCommand.action, note: '更换正文' } } as never)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      const current = await f.reload().hollow(f.scope)
      expect(current.data.records[0]).toMatchObject({ remainingCount: 16, rectifiedCount: 4 })
      const frozen = await f.coordinator.withTransaction(tx => loadQuantityHollowFacts(tx, { projectId: f.scope.projectId, selection: { kind: 'frozen', refs: [created.hollow.proof, fixed.hollow.proof] } }))
      expect(frozen.records.map(row => row.remainingCount)).toEqual([19, 15])
      const forged = await f.coordinator.withTransaction(tx => loadQuantityHollowFacts(tx, { projectId: f.scope.projectId, selection: { kind: 'frozen', refs: [{ ...fixed.hollow.proof, rectificationIds: [] }] } }))
      expect(forged.records).toEqual([])
      expect(forged.unavailable).toContainEqual(expect.objectContaining({ recordId: created.id }))
      expect(await f.db.select('SELECT * FROM quantity_hollow_rectifications')).toHaveLength(1)
      expect(await f.db.select('SELECT * FROM unit_stage_completions')).toEqual([])
    }
    finally { await f.close() }
  })

  it('来源保存提交前撤权和末步 SQL 失败均回滚五表，恢复权限可用原命令重试', async () => {
    const f = await createQuantityHollowFixture()
    const session = f.session()
    try {
      const initial = await f.service.hollow(f.scope)
      const command = f.command(initial, { kind: 'create-hollow-inspection', target: initial.data.targets[0]!.target, input: { inspectedOn: '2026-09-15', count: 19, note: '' } })
      const execute = f.db.execute.bind(f.db)
      let revoke = true
      const fault = vi.spyOn(f.db, 'execute').mockImplementation(async (sql, params) => {
        await execute(sql, params)
        if (revoke && sql.startsWith('UPDATE quantity_hollow_command_receipts'))
          f.setSession({ ...session, capabilities: session.capabilities.filter(capability => capability !== 'quantity:write') })
      })
      await expect(f.service.executeHollow(command)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
      for (const table of QUANTITY_HOLLOW_TABLES)
        expect(await f.db.select(`SELECT * FROM ${table}`)).toEqual([])
      revoke = false
      f.setSession(session)
      fault.mockImplementation(async (sql, params) => {
        if (sql.startsWith('UPDATE quantity_hollow_command_receipts'))
          throw new Error('receipt-storage-failed')
        await execute(sql, params)
      })
      await expect(f.service.executeHollow(command)).rejects.toThrow('receipt-storage-failed')
      for (const table of QUANTITY_HOLLOW_TABLES)
        expect(await f.db.select(`SELECT * FROM ${table}`)).toEqual([])
      fault.mockRestore()
      expect((await f.service.executeHollow(command)).hollow.kind).toBe('create-hollow-inspection')
      expect((await f.reload().hollow(f.scope)).data.records).toHaveLength(1)
    }
    finally {
      vi.restoreAllMocks()
      await f.close()
    }
  })

  it('等待队列期间身份变化拒绝；两个窗口共享旧版本仅一个成功', async () => {
    const f = await createQuantityHollowFixture()
    try {
      const initial = await f.service.hollow(f.scope)
      const command = f.command(initial, { kind: 'create-hollow-inspection', target: initial.data.targets[0]!.target, input: { inspectedOn: '2026-09-15', count: 0, note: '' } })
      let release!: () => void
      let entered!: () => void
      const ready = new Promise<void>((resolve) => {
        entered = resolve
      })
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      const lock = f.coordinator.withTransaction(async () => {
        entered()
        await pending
      })
      await ready
      const first = f.service.executeHollow(command)
      const failed = expect(first).rejects.toMatchObject({ problem: { code: 'forbidden' } })
      f.setSession({ ...f.session(), actorId: 'replacement-actor' })
      release()
      await lock
      await failed
      const latest = await f.service.hollow(f.scope)
      const one = f.command(latest, command.action)
      const two = f.command(latest, command.action)
      const results = await Promise.allSettled([f.service.executeHollow(one), f.service.executeHollow(two)])
      expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
      expect(results[1]).toMatchObject({ reason: { problem: { code: 'stale-source' } } })
      expect((await f.reload().hollow(f.scope)).data.records).toHaveLength(1)
    }
    finally { await f.close() }
  })

  it('初建责任缺少原指派或细分审计时不可供选择，也不能保存为已知零', async () => {
    const f = await createQuantityHollowFixture()
    try {
      const initial = await f.service.hollow(f.scope)
      const target = initial.data.targets[0]!.target
      await f.db.execute('DELETE FROM operation_logs WHERE table_name=\'unit_assignment_scopes\'')
      const damaged = await f.service.hollow(f.scope)
      expect(damaged.data.targets).toEqual([])
      expect(damaged.data.unavailable.length).toBeGreaterThan(0)
      await expect(f.service.executeHollow(f.command(damaged, { kind: 'create-hollow-inspection', target, input: { inspectedOn: '2026-09-15', count: 0, note: '' } }))).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
      expect(await f.db.select('SELECT * FROM quantity_hollow_records')).toEqual([])
    }
    finally { await f.close() }
  })

  it('公开替换责任人后历史仍归原人，原人退出当前名册也可继续如实整改', async () => {
    const { f, created } = await inspected()
    try {
      const previous = (await f.quantity.assignments(f.scope, f.session())).data.assignments[0]!
      f.people.push({ ...f.people[0]!, id: 'replacement-worker', name: '新施工责任人' })
      await f.executeQuantity({ kind: 'save-assignments', draft: { projectId: f.scope.projectId, trade: previous.trade, assigneeKind: 'worker', assigneeId: 'replacement-worker', unitIds: [f.scope.unitId], expectedAssignments: [{ unitId: f.scope.unitId, assignmentId: previous.id, fingerprint: previous.fingerprint }], scopes: previous.scopes.map(scope => ({ unitId: f.scope.unitId, roomId: scope.roomId, itemId: scope.itemId })), note: '', allowReplacement: true } })
      f.people.splice(0, 1)
      const current = await f.reload().hollow(f.scope)
      expect(current.data.targets[0]!.originalParty).toEqual({ kind: 'worker', workerId: 'replacement-worker' })
      expect(current.data.records[0]).toMatchObject({ originalParty: { kind: 'worker', workerId: 'hollow-worker' }, originalPartyName: '施工责任人', target: { assignmentId: previous.id }, remainingCount: 19 })
      await f.service.executeHollow(f.command(current, { kind: 'rectify-hollow-inspection', recordId: created.id, expectedRevisionId: created.hollow.revisionId, rectifiedOn: '2026-09-16', count: 19, note: '原记录全数复核整改' }))
      const fixed = await f.reload().hollow(f.scope)
      expect(fixed.data.records[0]).toMatchObject({ remainingCount: 0, rectifiedCount: 19, originalPartyName: '施工责任人', eligibility: { rectify: { allowed: false } } })
      await expect(f.service.executeHollow(f.command(fixed, { kind: 'rectify-hollow-inspection', recordId: created.id, expectedRevisionId: created.hollow.revisionId, rectifiedOn: '2026-09-16', count: 1, note: '' }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      await expect(f.service.executeHollow(f.command(fixed, { kind: 'revise-hollow-inspection', recordId: created.id, expectedRevisionId: created.hollow.revisionId, input: { inspectedOn: '2026-09-15', count: 18, note: '' }, reason: '少报一处' }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      expect(await f.db.select('SELECT * FROM unit_stage_completions')).toEqual([])
    }
    finally { await f.close() }
  })

  it('物理检查数被改写时冷读明确不可证明，不能重放回执或视为零', async () => {
    const { f, command, created } = await inspected()
    try {
      await f.db.execute('UPDATE quantity_hollow_revisions SET count=0 WHERE id=?', [created.hollow.revisionId])
      const damaged = await f.reload().hollow(f.scope)
      expect(damaged.data.records).toEqual([])
      expect(damaged.data.unavailable).toContainEqual(expect.objectContaining({ recordId: created.id, code: 'record-unproven' }))
      await expect(f.service.executeHollow(command)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      const facts = await f.coordinator.withTransaction(tx => loadQuantityHollowFacts(tx, { projectId: f.scope.projectId, selection: { kind: 'frozen', refs: [created.hollow.proof] } }))
      expect(facts.records).toEqual([])
      expect(facts.unavailable.length).toBeGreaterThan(0)
    }
    finally { await f.close() }
  })

  it('纯事实合同也拒绝将当前修订伪装成旧日志端点', async () => {
    const { f, created } = await inspected()
    try {
      const before = await f.service.hollow(f.scope)
      await f.service.executeHollow(f.command(before, { kind: 'revise-hollow-inspection', recordId: created.id, expectedRevisionId: created.hollow.revisionId, input: { inspectedOn: '2026-09-15', count: 20, note: '' }, reason: '复核补记' }))
      const facts = await f.coordinator.withTransaction(tx => loadQuantityHollowFacts(tx, { projectId: f.scope.projectId, selection: { kind: 'current' } }))
      const fact = facts.records[0]!
      expect(isQuantityHollowFact(fact)).toBe(true)
      expect(isQuantityHollowFact({ ...fact, proof: { ...fact.proof, headLogId: created.hollow.logId } })).toBe(false)
    }
    finally { await f.close() }
  })
})
