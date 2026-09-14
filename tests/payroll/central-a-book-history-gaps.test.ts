import { expect, it } from 'vitest'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'

it('管理已领用途关系及两份原件同时缺损时，不借旧A兼容分支变成零已领', async () => {
  const f = await createPayrollAFeesFixture()
  try {
    const management = await f.management()
    const first = await management.start()
    await f.release(first.statementId!, 100)
    await f.db.execute('DELETE FROM payroll_a_statement_books WHERE statement_id=?', [first.statementId])
    await f.db.execute('UPDATE payroll_a_statement_sources SET source_json=\'{}\' WHERE statement_id=?', [first.statementId])
    await f.db.execute('UPDATE wage_statements SET snapshot_json=\'{}\' WHERE id=?', [first.statementId])
    expect((await f.service.aOutput({ origin: 'real' }, first.statementId!)).state).toBe('unavailable')
    const next = await f.service.aForm({ origin: 'real' }, { statementId: null, draftKey: 'combined-history-gap', draft: { ...f.draft, memberWorkerIds: ['w'], month: '2026-09', book: management.book } })
    expect.soft(next.totals.previouslyPaid.value).toBeNull()
    expect.soft(next.totals.grossAmount.value).toBeNull()
    expect.soft(next.eligibility.canSaveDraft).toBe(false)
    await expect(management.start('2026-09')).rejects.toThrow()
  }
  finally { await f.close() }
})
