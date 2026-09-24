import { expect, it } from 'vitest'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'

it('两个窗口争用同一剩余，只有一笔退款及其分配、余额处理和回执成功', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    await f.refund(correction.adjustment.id, 40)
    const first = await f.refundCommand(correction.adjustment.id, 60)
    const second = await f.refundCommand(correction.adjustment.id, 60)
    const results = await Promise.allSettled([f.service.executeAdjustment(first), f.service.executeAdjustment(second)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { problem: { code: 'stale-source', commandOutcome: 'not-applied' } } })
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(900)
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBe(0)
    expect(await f.db.select('SELECT id FROM payroll_actual_events')).toHaveLength(2)
    expect(await f.db.select('SELECT id FROM payroll_actual_allocations')).toHaveLength(2)
    expect(await f.db.select('SELECT id FROM payroll_adjustment_applications')).toHaveLength(2)
    const winner = results[0]?.status === 'fulfilled' ? first : second
    await f.service.executeAdjustment(winner)
    await expect(f.service.executeAdjustment({ ...winner, action: { ...winner.action, payment: { ...winner.action.payment, evidenceNote: '另一份正文' } } })).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.db.select('SELECT id FROM payroll_actual_events')).toHaveLength(2)
  }
  finally { await f.close() }
})

it('退款所有写入后最后等待撤权，完整回滚事实、余额、日志、版本及回执', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const command = await f.refundCommand(correction.adjustment.id, 100)
    const tables = ['wage_statements', 'wage_statement_allocations', 'payroll_actual_events', 'payroll_actual_allocations', 'payroll_adjustment_applications', 'payroll_adjustments', 'operation_logs', 'payroll_command_receipts', 'payroll_revision']
    // SQLite 的完整导出避免只检查主表而漏掉日志与回执的半次提交。
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, await f.db.select(`SELECT * FROM ${table}`)])))
    const before = await snapshot()
    let reads = 0
    f.setIdentityHook(() => {
      if (++reads === 2)
        f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    })
    await expect(f.service.executeAdjustment(command)).rejects.toMatchObject({ problem: { code: 'forbidden', commandOutcome: 'not-applied' } })
    f.setIdentityHook(null)
    expect(await snapshot()).toEqual(before)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1000)
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBe(-100)
  }
  finally { await f.close() }
})

it('真实 SQL 提交失败不发布半笔补退，原编号重试后只确认一次', async () => {
  const f = await createPayrollAdjustmentFixture()
  const execute = f.db.execute.bind(f.db)
  try {
    const correction = await f.correct()
    const command = await f.refundCommand(correction.adjustment.id, 100)
    const tables = ['wage_statements', 'wage_statement_allocations', 'payroll_actual_events', 'payroll_actual_allocations', 'payroll_adjustment_applications', 'payroll_adjustments', 'operation_logs', 'payroll_command_receipts', 'payroll_revision']
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, await f.db.select(`SELECT * FROM ${table}`)])))
    const before = await snapshot()
    // 真实 SQLite 已完成所有候选写入，驱动在提交边界注入一次故障。
    f.db.execute = async (sql, params) => {
      if (sql === 'COMMIT')
        throw new Error('模拟 SQLite 提交中断')
      await execute(sql, params)
    }
    await expect(f.service.executeAdjustment(command)).rejects.toThrow('模拟 SQLite 提交中断')
    f.db.execute = execute
    expect(await snapshot()).toEqual(before)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1000)
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBe(-100)
    const result = await f.service.executeAdjustment(command)
    expect(await f.service.executeAdjustment(command)).toEqual(result)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(900)
    expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBe(0)
  }
  finally {
    f.db.execute = execute
    await f.close()
  }
})
