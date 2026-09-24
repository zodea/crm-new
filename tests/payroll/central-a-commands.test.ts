import type { PayrollDetailRead } from '~/lib/payroll/central-contract'
import { afterEach, describe, expect, it } from 'vitest'
import { decodePayrollRead, encodePayrollWire } from '~/lib/payroll/central-codec'
import { createPayrollAServiceFixture } from '../helpers/payroll-a-service-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})
describe('中央 A 配置、核对与冻结发放事务', () => {
  it('明确工资价格形成草稿，真实分配含零，原键重放不再发；发放冻结后不能改比例', async () => {
    const f = await createPayrollAServiceFixture()
    closers.push(f.close)
    const config = await f.config()
    await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
    await f.service.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 200, scope: { kind: 'project' } }] }))
    const form = await f.form()
    const saved = await f.service.execute(f.command(form, { kind: 'save-a-draft', draft: f.draft }))
    expect(saved.statementId).toBeTruthy()
    const read = () => f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    const release = f.command(await read(), { kind: 'release-a', release: { actualAmount: 1200, allocations: [{ workerId: 'w', amount: 1200 }, { workerId: 'zero', amount: 0 }] } })
    const result = await f.service.execute(release)
    expect(result.outcome).toBe('released')
    expect(await f.service.execute(release)).toEqual(result)
    const detail = await f.service.detail({ origin: 'real' }, saved.statementId!)
    expect(detail.statement).toMatchObject({ actualAmount: 1200, status: 'released' })
    expect(detail.statement.allocations.map(row => row.amount)).toEqual([1200, 0])
    expect(detail.statement.snapshot).toMatchObject({ state: 'complete', issues: [] })
    expect(detail.statement.snapshot.data?.aSource).toMatchObject({ schemaVersion: 2, book: { bookPurpose: 'ordinary', managementBookId: null }, subject: { projectId: 'p', memberWorkerIds: ['w', 'zero'] } })
    expect(detail.statement.snapshot.data).not.toHaveProperty('dayworkRecords')
    expect(detail.statement.diagnostics.map(diagnostic => diagnostic.code)).not.toContain('source-unproven')
    const decoded = decodePayrollRead<PayrollDetailRead>(encodePayrollWire(detail), 'detail', { origin: 'real' }, saved.statementId!)
    expect(decoded.statement.snapshot).toEqual(detail.statement.snapshot)
    expect((await f.service.aOutput({ origin: 'real' }, saved.statementId!)).state).toBe('available')
    await expect(f.service.execute(f.command(await read(), { kind: 'set-a-pay-ratio', payRatio: 1 }))).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const [receipt] = await f.db.select<{ result_json: string }>('SELECT result_json FROM payroll_command_receipts WHERE command_id=?', [release.commandId])
    const [source] = await f.db.select<{ source_json: string }>('SELECT source_json FROM payroll_a_statement_sources WHERE statement_id=?', [saved.statementId])
    const assertUnproven = async () => {
      const history = await f.service.detail({ origin: 'real' }, saved.statementId!)
      expect(history.statement.snapshot.state).toBe('partial')
      expect(history.statement.snapshot.raw).toBe(detail.statement.snapshot.raw)
      expect(history.statement.diagnostics.map(diagnostic => diagnostic.code)).toContain('source-unproven')
      expect((await f.service.aOutput({ origin: 'real' }, saved.statementId!)).state).toBe('unavailable')
    }
    // 有回执但目标已损坏不能证明本单；只有仿同结构快照也不能冒充中央发放。
    await f.db.execute('UPDATE payroll_command_receipts SET result_json=? WHERE command_id=?', [JSON.stringify({ ...result, statementId: 'other-statement' }), release.commandId])
    await assertUnproven()
    await f.db.execute('UPDATE payroll_command_receipts SET result_json=? WHERE command_id=?', [receipt!.result_json, release.commandId])
    await f.db.execute('UPDATE payroll_a_statement_sources SET source_json=? WHERE statement_id=?', [JSON.stringify({ ...JSON.parse(source!.source_json), facts: [] }), saved.statementId])
    await assertUnproven()
    await f.db.execute('UPDATE payroll_a_statement_sources SET source_json=? WHERE statement_id=?', [source!.source_json, saved.statementId])
    await f.db.execute('DELETE FROM payroll_command_receipts WHERE command_id=?', [release.commandId])
    await assertUnproven()
  })
})
