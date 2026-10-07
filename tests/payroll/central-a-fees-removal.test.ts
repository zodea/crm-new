import { describe, expect, it } from 'vitest'
import { hasPayrollAFeesForm } from '../../app/lib/payroll/central-a-fees-contract'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'

describe('p5 移除追加原文墓碑，不要求失效来源重新取得计价资格', () => {
  it('墓碑生效后截断同费项此前所有未来计划，之后明确新修订才可重开', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      await f.saveFees([f.fee({ effectiveMonth: '2026-10' })])
      const first = (await f.feeConfig()).fees[0]!
      await f.saveFees([f.fee({ feeId: first.feeId, baseRevisionId: first.id, unitPrice: 2, effectiveMonth: '2026-09' })])
      const read = await f.feeConfig(f.ordinary, '2026-09')
      const second = read.fees.find(r => r.revision === 2)!
      const removed = await f.service.executeFees(f.feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [], remove: [{ feeId: second.feeId, baseRevisionId: second.id }] }))
      const subsidy = async (month: string) => {
        const form = await f.form({ book: f.ordinary, month, payRatio: 1 })
        if (!hasPayrollAFeesForm(form))
          throw new Error('缺少费用表单')
        return form.fees!.totals.subsidyAmount.value
      }
      expect(await subsidy('2026-09')).toBe(0)
      expect.soft(await subsidy('2026-10')).toBe(0)
      await f.saveFees([f.fee({ feeId: first.feeId, baseRevisionId: removed.feeRevisionIds[0], unitPrice: 1.5, effectiveMonth: '2026-11' })], f.ordinary, '2026-09')
      expect.soft(await subsidy('2026-10')).toBe(0)
      expect(await subsidy('2026-11')).toBe(150)
    }
    finally { await f.close() }
  })

  const feeRejection = {
    'ordinary-unit': '费用分项、单位或细分范围不一致',
    'management-scope': '管理费用须属于当前有效管理簿与管理人',
  } as const
  it.each(['ordinary-unit', 'management-scope'] as const)('费用来源变化 %s 后仍能移除，新增修改继续拒绝', async (change) => {
    const f = await createPayrollAFeesFixture()
    try {
      const book = change === 'management-scope' ? (await f.management()).book : f.ordinary
      if (change === 'ordinary-unit')
        await f.saveFees([f.fee()])
      const old = (await f.feeConfig(book)).fees[0]!
      const [physical] = await f.db.select<Record<string, unknown>>('SELECT * FROM payroll_a_fee_revisions WHERE id=?', [old.id])
      if (change === 'ordinary-unit')
        await f.db.execute('UPDATE items SET unit=\'m\' WHERE id=\'wall\'')
      else await f.db.execute('UPDATE unit_assignments SET deleted_at=\'2026-08-06\' WHERE id=\'fee-assignment\'')
      const read = await f.feeConfig(book)
      const item = f.fee({ bookPurpose: old.bookPurpose, managementBookId: old.managementBookId, kind: old.kind, name: old.name, unitPrice: old.unitPrice, unit: old.unit, basis: old.basis, effectiveMonth: old.effectiveMonth, adoptedDefault: old.adoptedDefault, feeId: old.feeId, baseRevisionId: old.id })
      await expect(f.service.executeFees(f.feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [item], remove: [] }))).rejects.toThrow(feeRejection[change])
      const command = f.feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [], remove: [{ feeId: old.feeId, baseRevisionId: old.id }] })
      const result = await f.service.executeFees(command)
      expect(await f.service.executeFees(command)).toEqual(result)
      expect(await f.db.select('SELECT * FROM payroll_a_fee_revisions WHERE id=?', [old.id])).toEqual([physical])
      const [removed] = await f.db.select<Record<string, unknown>>('SELECT * FROM payroll_a_fee_revisions WHERE id=?', [result.feeRevisionIds[0]])
      expect(removed).toEqual({ ...physical, id: result.feeRevisionIds[0], revision: 2, removed: 1, created_at: expect.any(String) })
    }
    finally { await f.close() }
  })

  const negativeRejection = {
    'unit': '负价数量的单位与所选原分项范围不一致',
    'scope': '负价依据超出原管理范围或已失效',
    'actual-ref': '负价所引用实际事实未获证明或不属于本项目',
  } as const
  it.each(['unit', 'scope', 'actual-ref'] as const)('负价依据 %s 失效后保原全文移除，不重新采用失效依据', async (change) => {
    const f = await createPayrollAFeesFixture()
    try {
      let actualRef: { kind: 'released-statement', statementId: string } | null = null
      if (change === 'actual-ref') {
        await f.prices()
        const draft = { ...f.draft, book: f.ordinary, payRatio: 1 }
        const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
        await f.release(saved.statementId!, 100)
        actualRef = { kind: 'released-statement', statementId: saved.statementId! }
      }
      const m = await f.management()
      const first = await m.start()
      const form = async () => {
        const read = await f.service.aForm({ origin: 'real' }, { statementId: first.statementId! })
        if (!hasPayrollAFeesForm(read))
          throw new Error('缺少费用表单')
        return read
      }
      const before = await form()
      const scope = { assignments: m.scope.assignments.map(a => ({ ...a, cells: a.cells.filter(c => c.itemId === 'shower') })).filter(a => a.cells.length) }
      const line = { lineId: null, baseRevisionId: null, label: '待收尾代付', quantity: 30, unit: '套', unitPrice: -1, scope, reason: '原收尾记录', evidenceNote: '原经办确认', actualRef }
      const saved = await f.service.executeFees(f.feeCommand(before, { kind: 'save-a-negative-lines', baseVersion: before.context.sourceVersion, lines: [line], remove: [] }))
      const [physical] = await f.db.select<Record<string, unknown>>('SELECT * FROM payroll_a_negative_lines WHERE id=?', [saved.negativeLineRevisionIds[0]])
      if (change === 'unit')
        await f.db.execute('UPDATE items SET unit=\'m\' WHERE id=\'shower\'')
      else if (change === 'scope')
        await f.db.execute('UPDATE unit_assignment_scopes SET deleted_at=\'2026-08-06\' WHERE id=\'fee-scope-shower\'')
      else await f.db.execute('UPDATE wage_statements SET snapshot_json=\'{}\' WHERE id=?', [actualRef!.statementId])
      const read = await form()
      await expect(f.service.executeFees(f.feeCommand(read, { kind: 'save-a-negative-lines', baseVersion: read.context.sourceVersion, lines: [line], remove: [] }))).rejects.toThrow(negativeRejection[change])
      const command = f.feeCommand(read, { kind: 'save-a-negative-lines', baseVersion: read.context.sourceVersion, lines: [], remove: [{ lineId: String(physical!.line_id), baseRevisionId: String(physical!.id) }] })
      const result = await f.service.executeFees(command)
      expect(await f.service.executeFees(command)).toEqual(result)
      expect(await f.db.select('SELECT * FROM payroll_a_negative_lines WHERE id=?', [physical!.id])).toEqual([physical])
      const [removed] = await f.db.select<Record<string, unknown>>('SELECT * FROM payroll_a_negative_lines WHERE id=?', [result.negativeLineRevisionIds[0]])
      expect(removed).toEqual({ ...physical, id: result.negativeLineRevisionIds[0], revision: 2, removed: 1, created_at: expect.any(String) })
      if (change === 'unit') {
        await f.db.execute('UPDATE items SET unit=\'套\' WHERE id=\'shower\'')
        await f.release(first.statementId!, 100)
        expect((await f.service.aOutput({ origin: 'real' }, first.statementId!)).state).toBe('available')
      }
    }
    finally { await f.close() }
  })

  it('未来费用的移除与原生效月一致，旧版本、异主和重复移除整批不写入', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      await f.saveFees([f.fee({ effectiveMonth: '2026-10' })])
      const first = (await f.feeConfig()).fees[0]!
      await f.saveFees([f.fee({ feeId: first.feeId, baseRevisionId: first.id, unitPrice: 1.4, effectiveMonth: '2026-10' })])
      const read = await f.feeConfig()
      const latest = read.fees.find(r => r.revision === 2)!
      const state = () => Promise.all(['payroll_a_fee_revisions', 'operation_logs', 'payroll_command_receipts', 'payroll_revision'].map(table => f.db.select(`SELECT * FROM ${table}`)))
      const before = await state()
      const remove = { feeId: latest.feeId, baseRevisionId: latest.id }
      await expect(f.service.executeFees(f.feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [], remove: [{ ...remove, baseRevisionId: first.id }] }))).rejects.toThrow('修订')
      await expect(f.service.executeFees(f.feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [], remove: [remove, remove] }))).rejects.toThrow('重复')
      const other = await f.service.aFeeConfig({ origin: 'real' }, { ...read.scope, leaderWorkerId: 'other' })
      await expect(f.service.executeFees(f.feeCommand(other, { kind: 'save-a-fees', baseVersion: other.baseVersion, fees: [], remove: [remove] }))).rejects.toThrow('身份')
      expect(await state()).toEqual(before)
      const command = f.feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [], remove: [remove] })
      f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
      await expect(f.service.executeFees(command)).rejects.toThrow('权限')
      expect(await state()).toEqual(before)
      f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write'] })
      await f.service.executeFees(command)
      expect((await f.feeConfig()).fees.find(r => r.revision === 3)).toMatchObject({ effectiveMonth: '2026-10', removed: true })
      const form = await f.form({ book: f.ordinary, month: '2026-10' })
      expect(hasPayrollAFeesForm(form) && form.fees!.lines).toEqual([])
    }
    finally { await f.close() }
  })

  it('已发费用与已发负价不能借移除修改原历史，旧读取版本仍拒绝', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      const m = await f.management()
      const first = await m.start()
      const form = async () => {
        const read = await f.service.aForm({ origin: 'real' }, { statementId: first.statementId! })
        if (!hasPayrollAFeesForm(read))
          throw new Error('缺少费用表单')
        return read
      }
      const before = await form()
      const scope = { assignments: m.scope.assignments.map(a => ({ ...a, cells: a.cells.filter(c => c.itemId === 'shower') })).filter(a => a.cells.length) }
      await f.service.executeFees(f.feeCommand(before, { kind: 'save-a-negative-lines', baseVersion: before.context.sourceVersion, lines: [{ lineId: null, baseRevisionId: null, label: '原负价', quantity: 1, unit: '套', unitPrice: -1, scope, reason: '原原因', evidenceNote: '原依据', actualRef: null }], remove: [] }))
      const current = await form()
      const line = current.negativeLineRevisions[0]!
      await expect(f.service.executeFees(f.feeCommand(before, { kind: 'save-a-negative-lines', baseVersion: before.context.sourceVersion, lines: [], remove: [{ lineId: line.lineId, baseRevisionId: line.id }] }))).rejects.toThrow('变化')
      await f.release(first.statementId!, 100)
      const state = () => Promise.all(['payroll_a_negative_lines', 'payroll_a_fee_revisions', 'wage_statements', 'operation_logs', 'payroll_command_receipts', 'payroll_revision'].map(table => f.db.select(`SELECT * FROM ${table}`)))
      const frozen = await state()
      const released = await form()
      await expect(f.service.executeFees(f.feeCommand(released, { kind: 'save-a-negative-lines', baseVersion: released.context.sourceVersion, lines: [], remove: [{ lineId: line.lineId, baseRevisionId: line.id }] }))).rejects.toThrow('已发')
      const config = await f.feeConfig(m.book)
      const fee = config.fees[0]!
      await expect(f.service.executeFees(f.feeCommand(config, { kind: 'save-a-fees', baseVersion: config.baseVersion, fees: [], remove: [{ feeId: fee.feeId, baseRevisionId: fee.id }] }))).rejects.toThrow('已发')
      expect(await state()).toEqual(frozen)
    }
    finally { await f.close() }
  })
})
