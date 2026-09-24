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

  it('同人普通簿实付1000、管理簿实付100后，后月分别沿30%与60%核算80与125', async () => {
    // 条件：普通施工3600元按30%实付1000；管理费150㎡×2.5元，首月80%改60%后实付100。
    // 动作：分别建立九月管理单和普通单，并再次发放；结果：管理225−100=125，普通1080−1000=80。
    // 防止按负责人合并两簿历史实付/比例，或把普通施工额带入管理清单。
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      const ordinaryDraft = { ...f.draft, payRatio: 0.3, book: f.ordinary }
      const ordinary = await f.service.execute(f.command(await f.form(ordinaryDraft), { kind: 'save-a-draft', draft: ordinaryDraft }))
      await f.release(ordinary.statementId!, 1000)
      const m = await f.management()
      const first = await m.start()
      const read = () => f.service.aForm({ origin: 'real' }, { statementId: first.statementId! })
      expect((await read()).draft.payRatio).toBe(0.8)
      expect((await read()).totals).toMatchObject({ workAmount: { value: 0 }, cumulativeAmount: { value: 300 }, previouslyPaid: { value: 0 }, grossAmount: { value: 300 } })
      await f.service.execute(f.command(await read(), { kind: 'set-a-pay-ratio', payRatio: 0.6 }))
      await f.release(first.statementId!, 100)
      const next = await m.start('2026-09')
      const nextRead = await f.service.aForm({ origin: 'real' }, { statementId: next.statementId! })
      expect(nextRead.draft.payRatio).toBe(0.6)
      expect(nextRead.ratioDefault).toMatchObject({ source: 'previous-statement', statementId: first.statementId, value: 0.6 })
      expect(nextRead.totals).toMatchObject({ workAmount: { value: 0 }, cumulativeAmount: { value: 225 }, previouslyPaid: { value: 100 }, grossAmount: { value: 125 } })
      await f.release(next.statementId!, 50)
      expect((await f.service.aOutput({ origin: 'real' }, next.statementId!)).document).toMatchObject({
        payRatio: 0.6,
        cumulativeAmount: 225,
        previouslyPaid: 100,
        grossAmount: 125,
        actualAmount: 50,
        previousPayments: [{ statementId: first.statementId, month: '2026-08', amount: 100 }],
      })

      const ordinaryNext = await f.form({ book: f.ordinary, month: '2026-09', payRatio: undefined }, 'ordinary-september')
      expect(ordinaryNext.ratioDefault).toMatchObject({ source: 'previous-statement', statementId: ordinary.statementId, value: 0.3 })
      expect(ordinaryNext.totals).toMatchObject({ workAmount: { value: 3600 }, cumulativeAmount: { value: 1080 }, previouslyPaid: { value: 1000 }, grossAmount: { value: 80 } })
      const saved = await f.service.execute(f.command(ordinaryNext, { kind: 'save-a-draft', draft: { ...ordinaryDraft, month: '2026-09' } }))
      await f.release(saved.statementId!, 80)
      expect((await f.service.aOutput({ origin: 'real' }, saved.statementId!)).document).toMatchObject({
        payRatio: 0.3,
        cumulativeAmount: 1080,
        previouslyPaid: 1000,
        grossAmount: 80,
        actualAmount: 80,
        previousPayments: [{ statementId: ordinary.statementId, month: '2026-08', amount: 1000 }],
      })
    }
    finally { await f.close() }
  })
})
