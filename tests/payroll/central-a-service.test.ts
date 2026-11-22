import { afterEach, describe, expect, it } from 'vitest'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'
import { createPayrollAServiceFixture, payrollAFact } from '../helpers/payroll-a-service-fixture'

describe('a 工资服务', () => {
  const closers: Array<() => Promise<void>> = []
  afterEach(async () => {
    await Promise.all(closers.splice(0).map(close => close()))
  })

  describe('中央 A 完成现场量及明确工资配置', () => {
    it('无任何工资的正式项目经A新建预览取得候选；不扩历史目录也不产生工资', async () => {
      const f = await createPayrollAServiceFixture()
      closers.push(f.close)
      const listing = await f.service.list({ origin: 'real', projectId: 'p' })
      expect(listing.rows).toEqual([])
      expect(listing.projects).toEqual([])
      const input = { statementId: null, draftKey: 'quantity-entry', draft: { projectId: 'p' } } as const
      const candidate = await f.service.aForm({ origin: 'real' }, input)
      expect(candidate.options.projects.map(project => project.id)).toEqual(['p'])
      expect(candidate.statementId).toBeNull()
      expect(candidate.draftKey).toBe('quantity-entry')
      expect(await f.db.select('SELECT * FROM wage_statements')).toEqual([])
      f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
      expect((await f.service.aForm({ origin: 'real' }, input)).context.readonly).toBe(true)
      f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: [] })
      await expect(f.service.aForm({ origin: 'real' }, input)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    })
    it('8/null/0 原格保留，缺现场量和缺工资价阻断新单，不能补零或漏零', async () => {
      const f = await createPayrollAServiceFixture()
      closers.push(f.close)
      f.facts.rows.push(payrollAFact({ ownershipKey: 'missing', unitId: 'u-null', fieldQty: null }), payrollAFact({ ownershipKey: 'zero', unitId: 'u-zero', fieldQty: 0 }))
      const read = await f.form()
      expect(read.facts.map(fact => fact.fieldQty)).toEqual([8, null, 0])
      expect(read.lines[0]?.unitPrice).toBeNull()
      expect(read.eligibility.canSaveDraft).toBe(false)
      await expect(f.service.execute(f.command(read, { kind: 'save-a-draft', draft: f.draft }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      expect((await f.service.list({ origin: 'real' })).rows).toEqual([])
    })
  })
})

describe('历史证据缺口', () => {
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
      await expect(management.start('2026-09')).rejects.toThrow('此前实际发放金额存在历史缺口，不能作为零继续核算')
    }
    finally { await f.close() }
  })
})
