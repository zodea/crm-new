import { describe, expect, it } from 'vitest'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'

describe('管理草稿统一沿同簿A比例默认', () => {
  it.each([{ periodKind: 'settlement' as const, expected: 0.95 }, { periodKind: 'retention' as const, expected: 1 }])('$periodKind 使用对应档位默认$expected而非管理初始比例', async ({ periodKind, expected }) => {
    const f = await createPayrollAFeesFixture()
    try {
      const m = await f.management()
      const config = await f.feeConfig(m.book)
      const created = await f.service.executeFees(f.feeCommand(config, { kind: 'start-a-management-draft', baseVersion: config.baseVersion, managementBookId: m.book.managementBookId!, managementRevisionId: config.managementBooks.find(b => b.book.id === m.book.managementBookId)!.revision!.id, month: config.scope.month, periodKind }))
      const read = await f.service.aForm({ origin: 'real' }, { statementId: created.statementId! })
      expect(read.draft.payRatio).toBe(expected)
      await f.release(created.statementId!, 100)
      expect((await f.service.aOutput({ origin: 'real' }, created.statementId!)).document?.payRatio).toBe(expected)
    }
    finally { await f.close() }
  })

  it('月度首单用管理初始比例、后月沿管理上月明确比例，同人普通簿不泄漏', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      const ordinaryDraft = { ...f.draft, payRatio: 0.3, book: f.ordinary }
      const ordinary = await f.service.execute(f.command(await f.form(ordinaryDraft), { kind: 'save-a-draft', draft: ordinaryDraft }))
      await f.release(ordinary.statementId!, 100)
      const m = await f.management()
      const first = await m.start()
      const read = () => f.service.aForm({ origin: 'real' }, { statementId: first.statementId! })
      expect((await read()).draft.payRatio).toBe(0.8)
      await f.service.execute(f.command(await read(), { kind: 'set-a-pay-ratio', payRatio: 0.6 }))
      await f.release(first.statementId!, 100)
      const next = await m.start('2026-09')
      const nextRead = await f.service.aForm({ origin: 'real' }, { statementId: next.statementId! })
      expect(nextRead.draft.payRatio).toBe(0.6)
      expect(nextRead.ratioDefault).toMatchObject({ source: 'previous-statement', statementId: first.statementId, value: 0.6 })
      await f.release(next.statementId!, 50)
      expect((await f.service.aOutput({ origin: 'real' }, next.statementId!)).document?.payRatio).toBe(0.6)
    }
    finally { await f.close() }
  })
})
