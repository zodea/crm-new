import type { PayrollAStatementSourceSnapshot } from '~/lib/payroll/central-a-contract'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { payrollACanonical } from '~/lib/payroll/central-a-calculation'
import { createPayrollAServiceFixture } from '../helpers/payroll-a-service-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})

async function releasedFixture() {
  const f = await createPayrollAServiceFixture()
  closers.push(f.close)
  const config = await f.config()
  await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
  await f.service.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 200, scope: { kind: 'project' } }] }))
  const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
  const id = saved.statementId!
  const read = () => f.service.aForm({ origin: 'real' }, { statementId: id })
  await f.service.execute(f.command(await read(), { kind: 'check-a' }))
  const command = f.command(await read(), { kind: 'release-a', release: { actualAmount: 1200, allocations: [{ workerId: 'w', amount: 1200 }, { workerId: 'zero', amount: 0 }] } })
  await f.service.execute(command)
  expect((await f.service.aOutput({ origin: 'real' }, id)).state).toBe('available')
  return { ...f, id, command }
}

it.each(['fingerprint', 'price-amount', 'price-unit', 'price-scope'] as const)('公开发放后单独损坏可证明依据，详情和输出都须降级：%s', async (damage) => {
  const f = await releasedFixture()
  if (damage === 'fingerprint') {
    await f.db.execute('UPDATE payroll_command_receipts SET fingerprint=? WHERE command_id=?', ['a'.repeat(64), f.command.commandId])
  }
  else {
    const [stored] = await f.db.select<{ source_json: string }>('SELECT source_json FROM payroll_a_statement_sources WHERE statement_id=?', [f.id])
    const [head] = await f.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [f.id])
    const source: PayrollAStatementSourceSnapshot = JSON.parse(stored!.source_json)
    const price = source.priceRevisions[0]!
    if (damage === 'price-amount')
      price.unitPrice = 999
    if (damage === 'price-unit')
      price.unit = 'm'
    if (damage === 'price-scope')
      price.scope = { kind: 'cells', cells: [{ unitId: 'other-unit', roomId: 'r', itemId: 'item' }] }
    // 来源表与快照中的来源同时损坏但 ID 不变，不能仅比较 ID 或两份来源 JSON 自洽。
    await f.db.execute('UPDATE payroll_a_statement_sources SET source_json=? WHERE statement_id=?', [JSON.stringify(source), f.id])
    await f.db.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [JSON.stringify({ ...JSON.parse(head!.snapshot_json), aSource: source }), f.id])
  }
  const detail = await f.service.detail({ origin: 'real' }, f.id)
  expect(detail.statement.snapshot.state).toBe('partial')
  expect(detail.statement.diagnostics.map(diagnostic => diagnostic.code)).toContain('source-unproven')
  expect((await f.service.aOutput({ origin: 'real' }, f.id)).state).toBe('unavailable')
})

it.each(['missing-body', 'actual', 'allocation'] as const)('原回执正文未知或与冻结发放不符不能输出；原键恢复不补造历史：%s', async (damage) => {
  const f = await releasedFixture()
  const [receipt] = await f.db.select<{ result_json: string, command_json: string }>('SELECT result_json,command_json FROM payroll_command_receipts WHERE command_id=?', [f.command.commandId])
  expect(receipt!.command_json).toBe(payrollACanonical(f.command))
  if (damage === 'missing-body') {
    await f.db.execute('UPDATE payroll_command_receipts SET command_json=NULL WHERE command_id=?', [f.command.commandId])
    expect(await f.service.execute(f.command)).toEqual(JSON.parse(receipt!.result_json))
    expect((await f.db.select<{ command_json: string | null }>('SELECT command_json FROM payroll_command_receipts WHERE command_id=?', [f.command.commandId]))[0]?.command_json).toBeNull()
  }
  else {
    const changed = structuredClone(f.command)
    if (changed.action.kind !== 'release-a')
      throw new Error('测试必须取真实发放原命令')
    if (damage === 'actual')
      changed.action.release.actualAmount = 1199
    if (damage === 'allocation')
      changed.action.release.allocations = [{ workerId: 'w', amount: 1199 }, { workerId: 'zero', amount: 1 }]
    const body = payrollACanonical(changed)
    await f.db.execute('UPDATE payroll_command_receipts SET command_json=?,fingerprint=? WHERE command_id=?', [body, createHash('sha256').update(body).digest('hex'), f.command.commandId])
  }
  const detail = await f.service.detail({ origin: 'real' }, f.id)
  expect(detail.statement.snapshot.state).toBe('partial')
  expect(detail.statement.actualAmount).toBe(1200)
  expect(detail.statement.allocations.map(allocation => allocation.amount)).toEqual([1200, 0])
  expect((await f.service.aOutput({ origin: 'real' }, f.id)).state).toBe('unavailable')
})

it('旧无正文列的回执升级只增加NULL字段，保原回执全部已知内容', async () => {
  const f = await createPayrollAServiceFixture()
  closers.push(f.close)
  await f.db.execute(`CREATE TABLE payroll_command_receipts (
    command_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,project_id TEXT NOT NULL,statement_id TEXT,
    config_scope_json TEXT,action TEXT NOT NULL,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL)`)
  await f.db.execute('INSERT INTO payroll_command_receipts VALUES (\'old-command\',\'actor\',\'p\',\'old-statement\',NULL,\'release-a\',\'old-fingerprint\',\'{"old":true}\')')
  const [before] = await f.db.select('SELECT * FROM payroll_command_receipts')
  await f.service.list({ origin: 'real' })
  expect(await f.db.select('SELECT * FROM payroll_command_receipts')).toEqual([{ ...before!, command_json: null }])
})
