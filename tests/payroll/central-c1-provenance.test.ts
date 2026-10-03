import { expect, it } from 'vitest'
import { payrollC1Canonical } from '~/lib/payroll/central-c1-calculation'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'

it.each(Array.from(['0'.repeat(64), null]).map(input1 => ({ input1 })))('原考勤/个人标准/成功回执须相互证明，改两份来源仍不能复用旧指纹输出：输入案例 %#', async ({ input1: fingerprint }) => {
  const f = await createPayrollC1ServiceFixture()
  try {
    await f.attendance()
    const saved = await f.service.executeC1(f.command(await f.form(), { kind: 'save-c1-draft', draft: f.draft }))
    const id = saved.statementId!
    const form = () => f.service.c1Form({ origin: 'real' }, { statementId: id })
    await f.service.executeC1(f.command(await form(), { kind: 'check-c1' }))
    const command = f.command(await form(), { kind: 'release-c1', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 500 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] } })
    await f.service.executeC1(command)
    const output = () => f.service.c1Output({ origin: 'real' }, id)
    expect((await output()).state).toBe('available')
    const [receipt] = await f.db.select<{ command_json: string, fingerprint: string }>('SELECT command_json,fingerprint FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
    const [head] = await f.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [id])
    const [source] = await f.db.select<{ source_json: string }>('SELECT source_json FROM payroll_c1_statement_sources WHERE statement_id=?', [id])

    await f.db.execute('UPDATE payroll_command_receipts SET command_json=?,fingerprint=? WHERE command_id=?', [fingerprint === null ? null : receipt!.command_json, fingerprint ?? receipt!.fingerprint, command.commandId])
    expect((await output()).state).toBe('unavailable')
    await f.db.execute('UPDATE payroll_command_receipts SET command_json=?,fingerprint=? WHERE command_id=?', [receipt!.command_json, receipt!.fingerprint, command.commandId])
    const changedSource = JSON.parse(source!.source_json)
    const changedSnapshot = JSON.parse(head!.snapshot_json)
    changedSource.facts[0].workContent = '两份都被替换的文字'
    changedSnapshot.c1Source = changedSource
    changedSnapshot.attendance[0].workContent = changedSource.facts[0].workContent
    changedSnapshot.c1Document.attendance[0].workContent = changedSource.facts[0].workContent
    await f.db.execute('UPDATE payroll_c1_statement_sources SET source_json=? WHERE statement_id=?', [payrollC1Canonical(changedSource), id])
    await f.db.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [payrollC1Canonical(changedSnapshot), id])
    expect((await output()).state).toBe('unavailable')
    expect((await f.service.detail({ origin: 'real' }, id)).statement.snapshot.state).toBe('partial')
    await f.db.execute('UPDATE payroll_c1_statement_sources SET source_json=? WHERE statement_id=?', [source!.source_json, id])
    await f.db.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [head!.snapshot_json, id])
    expect((await output()).state).toBe('available')
    await f.db.execute('DELETE FROM payroll_c1_statement_sources WHERE statement_id=?', [id])
    expect((await output()).state).toBe('unavailable')
    expect((await f.service.detail({ origin: 'real' }, id)).statement.snapshot.raw).toBe(head!.snapshot_json)
  }
  finally { await f.close() }
})
