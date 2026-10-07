import type { PayrollABookRef } from '~/lib/payroll/central-a-fees-contract'
import { expect, it } from 'vitest'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { createPayrollAFeeAdjustmentFixture } from '../helpers/payroll-a-fee-adjustment-fixture'

type Fixture = Awaited<ReturnType<typeof createPayrollAFeeAdjustmentFixture>>

async function managementBook(f: Fixture, managerWorkerId: string, month = '2026-08') {
  const initial = await f.feeConfig(f.ordinary, month)
  const scope = { assignments: initial.responsibilityOptions.map(o => ({ assignmentId: o.assignmentId, scopeIds: o.scopeIds, cells: o.cells })) }
  const saved = await f.service.executeFees(f.feeCommand(initial, { kind: 'save-a-management-book', baseVersion: initial.baseVersion, management: { managementBookId: null, baseRevisionId: null, managerWorkerId, effectiveMonth: month, managementMode: 'crew-managed', scope, initialPayRatio: 0.8, evidenceNote: '明确同一原责任的管理范围，用于核验领取归属' } }))
  const book: PayrollABookRef = { bookPurpose: 'management', managementBookId: saved.managementBookId! }
  const config = () => f.service.aFeeConfig({ origin: 'real' }, { ...initial.scope, leaderWorkerId: managerWorkerId, book })
  const read = await config()
  await f.service.executeFees(f.feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [f.fee({ ...book, kind: 'management', name: '独立管理费', unitPrice: 2.5, effectiveMonth: month, basis: { kind: 'completed-field-quantity', itemIds: ['wall', 'floor'], scope: { kind: 'project' } } })], remove: [] }))
  const startCommand = async () => {
    const read = await config()
    return f.feeCommand(read, { kind: 'start-a-management-draft', baseVersion: read.baseVersion, managementBookId: book.managementBookId!, managementRevisionId: read.managementBooks.find(m => m.book.id === book.managementBookId)!.revision!.id, month, periodKind: 'monthly' })
  }
  return { book, startCommand, start: async () => f.service.executeFees(await startCommand()) }
}

it('双窗发起同簿同月只保留一个草稿，重新读取定位原单；双窗发放只有一份实付', async () => {
  const f = await createPayrollAFeeAdjustmentFixture()
  try {
    const m = await managementBook(f, 'w')
    const first = await m.startCommand()
    const second = await m.startCommand()
    const started = await Promise.allSettled([f.service.executeFees(first), f.service.executeFees(second)])
    expect(started.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const located = await m.start()
    expect(located.locatedExistingDraft).toBe(true)
    const id = located.statementId!
    expect(await f.db.select('SELECT id FROM wage_statements')).toEqual([{ id }])
    const read = () => f.service.aForm({ origin: 'real' }, { statementId: id })
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    const checked = await read()
    const release = { kind: 'release-a' as const, release: { actualAmount: 300, allocations: [{ workerId: 'w', amount: 300 }] } }
    const attempts = await Promise.allSettled([f.service.execute(f.command(checked, release)), f.service.execute(f.command(checked, release))])
    expect(attempts.filter(r => r.status === 'fulfilled' && r.value.outcome === 'released')).toHaveLength(1)
    const actual = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    expect(actual.rows).toHaveLength(1)
    expect(actual.netAmount.value).toBe(300)
    expect((await f.service.aOutput({ origin: 'real' }, id)).state).toBe('available')
  }
  finally { await f.close() }
}, 30_000)

it('两个同名管理人不同簿争用同一原量，仅一簿可发放，另一簿不能用自身用途绕过归属', async () => {
  const f = await createPayrollAFeeAdjustmentFixture()
  try {
    f.source.workers.find(w => w.id === 'other')!.name = f.source.workers.find(w => w.id === 'w')!.name
    const books = [await managementBook(f, 'w'), await managementBook(f, 'other')]
    const ids = [(await books[0]!.start()).statementId!, (await books[1]!.start()).statementId!]
    for (const id of ids)
      await f.service.execute(f.command(await f.service.aForm({ origin: 'real' }, { statementId: id }), { kind: 'check-a' }))
    const commands = await Promise.all(ids.map(async (id) => {
      const read = await f.service.aForm({ origin: 'real' }, { statementId: id })
      return f.command(read, { kind: 'release-a', release: { actualAmount: 300, allocations: [{ workerId: read.draft.leaderWorkerId!, amount: 300 }] } })
    }))
    const attempts = await Promise.allSettled(commands.map(command => f.service.execute(command)))
    const winners = attempts.flatMap((r, i) => r.status === 'fulfilled' && r.value.outcome === 'released' ? [i] : [])
    expect(winners).toHaveLength(1)
    const winner = winners[0]!
    const loser = await f.service.aForm({ origin: 'real' }, { statementId: ids[1 - winner]! })
    expect(loser.eligibility.canRelease).toBe(false)
    expect(loser.blockers).toContainEqual(expect.objectContaining({ code: 'management-already-owned' }))
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(300)
    const claims = await f.db.select<{ management_book_id: string }>('SELECT management_book_id FROM payroll_a_management_ownership')
    expect(claims).toHaveLength(2)
    expect(claims.every(c => c.management_book_id === books[winner]!.book.managementBookId)).toBe(true)
  }
  finally { await f.close() }
}, 30_000)

it.each(['w', 'other'])('退款、软删原单及重建completion均不释放原责任，管理人%s新建簿也不能重领', async (managerWorkerId) => {
  const f = await createPayrollAFeeAdjustmentFixture()
  try {
    const original = await f.management()
    const first = await original.start()
    await f.release(first.statementId!, 300)
    const output = await f.service.aOutput({ origin: 'real' }, first.statementId!)
    const correction = await f.correct(first.statementId!, (basis) => {
      for (const component of basis.fees!.components)
        component.unitPrice = 0
    })
    expect(correction.adjustment.delta).toBe(-300)
    await f.pay(correction.adjustment.id, -300)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(0)
    const sameBookInput = { memberWorkerIds: ['w'], month: '2026-09', book: original.book }
    expect((await f.form(sameBookInput, 'refunded-original-book')).totals.grossAmount.value).toBe(0)
    await f.db.execute('UPDATE wage_statements SET deleted_at=\'2026-09-01\' WHERE id=?', [first.statementId])
    expect((await f.form(sameBookInput, 'archived-original-book')).totals.grossAmount.value).toBe(0)
    await f.db.execute('UPDATE unit_stage_completions SET id=\'fee-completion-recreated\' WHERE id=\'fee-completion\'')
    const before = await f.db.select('SELECT * FROM payroll_a_management_ownership ORDER BY id')
    const replacement = await managementBook(f, managerWorkerId, '2026-09')
    const draft = { ...f.draft, leaderWorkerId: managerWorkerId, memberWorkerIds: [managerWorkerId], month: '2026-09', book: replacement.book }
    const read = await f.form(draft, 'replacement-manager')
    expect(read.facts.every(fact => fact.completionId === 'fee-completion-recreated')).toBe(true)
    expect(read.blockers).toContainEqual(expect.objectContaining({ code: 'management-already-owned' }))
    expect(read.eligibility.canSaveDraft).toBe(false)
    await expect(replacement.start()).rejects.toThrow('原施工责任已有其他管理簿领取，换管理人或重建单据不能再次领取')
    expect(await f.db.select('SELECT * FROM payroll_a_management_ownership ORDER BY id')).toEqual(before)
    expect(await f.service.aOutput({ origin: 'real' }, first.statementId!)).toMatchObject({ state: 'available', document: output.document })
    const sameBook = await f.form(sameBookInput, 'same-book-after-refund')
    expect(hasPayrollAFeesForm(sameBook)).toBe(true)
    // 原完成身份重建后更正沿革无法完整证明，只能明确未知，不能把退款重新变成可领。
    expect(sameBook.totals.grossAmount.value).toBeNull()
    expect(sameBook.eligibility.canSaveDraft).toBe(false)
    expect(sameBook.blockers).toContainEqual(expect.objectContaining({ code: 'adjustment-source-unproven' }))
    expect(await f.db.select('SELECT id FROM wage_statements')).toEqual([{ id: first.statementId }])
  }
  finally { await f.close() }
}, 30_000)
