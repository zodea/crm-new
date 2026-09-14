import { describe, expect, it } from 'vitest'
import { decodePayrollARead, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { hasPayrollAFeesForm } from '../../app/lib/payroll/central-a-fees-contract'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'

describe('p5 已发费用完整性与管理主体', () => {
  it('已发后额外插入负价破坏原证明，不能吸入后月累计', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      const m = await f.management()
      const first = await m.start()
      const read = await f.service.aForm({ origin: 'real' }, { statementId: first.statementId! })
      if (!hasPayrollAFeesForm(read))
        throw new Error('缺少费用读取')
      const scope = { assignments: m.scope.assignments.map(a => ({ ...a, cells: a.cells.filter(c => c.itemId === 'shower') })).filter(a => a.cells.length) }
      await f.service.executeFees(f.feeCommand(read, { kind: 'save-a-negative-lines', baseVersion: read.context.sourceVersion, lines: [{ lineId: null, baseRevisionId: null, label: '原负价', quantity: 1, unit: '套', unitPrice: -1, scope, reason: '原施工未收尾', evidenceNote: '经办确认', actualRef: null }], remove: [] }))
      await f.release(first.statementId!, 100)
      expect((await f.service.aOutput({ origin: 'real' }, first.statementId!)).state).toBe('available')
      await f.db.execute('INSERT INTO payroll_a_negative_lines SELECT \'rogue-revision\',\'rogue-line\',statement_id,project_id,management_book_id,management_revision_id,1,label,100,unit,-1,-10000,scope_json,reason,evidence_note,actual_ref_json,removed,operator_id,created_at FROM payroll_a_negative_lines LIMIT 1')
      expect.soft((await f.service.aOutput({ origin: 'real' }, first.statementId!)).state).toBe('unavailable')
      const input = { statementId: null, draftKey: 'unproven-negative', draft: { ...f.draft, memberWorkerIds: ['w'], month: '2026-09', book: m.book } }
      const next = await f.service.aForm({ origin: 'real' }, input)
      expect.soft(() => decodePayrollARead(encodePayrollAWire(next), 'form', { origin: 'real' }, input)).not.toThrow()
      expect.soft(next.totals.grossAmount.value).toBeNull()
      expect.soft(next.eligibility.canSaveDraft).toBe(false)
      expect.soft(hasPayrollAFeesForm(next) && next.fees?.negativeLines.some(n => n.id === 'rogue-revision')).toBe(false)
      await expect(m.start('2026-09')).rejects.toThrow()
    }
    finally { await f.close() }
  })

  it('管理费用行按已授权真实完成事实提供来源返回，冻结金额证明不依赖来源按钮', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write', 'quantity:read'] })
      const m = await f.management()
      const saved = await m.start()
      const read = await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
      expect(hasPayrollAFeesForm(read) && read.fees?.lines.find(l => l.itemId === 'wall')?.sources[0]).toMatchObject({ kind: 'entity-detail', subject: { entity: 'quantity-unit', id: 'fee-unit' }, filters: { projectId: 'p', completionId: 'fee-completion', itemId: 'wall' } })
      await f.release(saved.statementId!, 100)
      expect((await f.service.aOutput({ origin: 'real' }, saved.statementId!)).state).toBe('available')
    }
    finally { await f.close() }
  })

  it('管理草稿不能把费用主体班组改成null再发放不可读工资', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      const m = await f.management()
      const first = await m.start()
      const read = await f.service.aForm({ origin: 'real' }, { statementId: first.statementId! })
      const draft = { ...read.draft, crewId: null }
      const edited = await f.service.aForm({ origin: 'real' }, { statementId: first.statementId!, draft })
      expect.soft(edited.eligibility.canSaveDraft).toBe(false)
      await expect(f.service.execute(f.command(edited, { kind: 'save-a-draft', draft }))).rejects.toThrow()
      await f.release(first.statementId!, 100)
      expect((await f.service.aOutput({ origin: 'real' }, first.statementId!)).state).toBe('available')
    }
    finally { await f.close() }
  })

  it.each(['snapshot', 'book-relation'])('同管理簿已发原件%s损坏后此前实付明确未知，不能丢成0重新领取', async (damaged) => {
    const f = await createPayrollAFeesFixture()
    try {
      const m = await f.management()
      const first = await m.start()
      await f.release(first.statementId!, 100)
      if (damaged === 'snapshot')
        await f.db.execute('UPDATE wage_statements SET snapshot_json=\'{}\' WHERE id=?', [first.statementId])
      else await f.db.execute('DELETE FROM payroll_a_statement_books WHERE statement_id=?', [first.statementId])
      const next = await f.service.aForm({ origin: 'real' }, { statementId: null, draftKey: 'unproven-history', draft: { ...f.draft, memberWorkerIds: ['w'], month: '2026-09', book: m.book } })
      expect.soft(next.totals.previouslyPaid.value).toBeNull()
      expect.soft(next.totals.grossAmount.value).toBeNull()
      expect.soft(next.eligibility.canSaveDraft).toBe(false)
      await expect(m.start('2026-09')).rejects.toThrow()
    }
    finally { await f.close() }
  })
})
