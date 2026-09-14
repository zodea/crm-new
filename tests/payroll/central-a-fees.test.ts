import { describe, expect, it } from 'vitest'
import { payrollACanonical } from '../../app/lib/payroll/central-a-calculation'
import { decodePayrollARead, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { decodePayrollAFeeConfigRead } from '../../app/lib/payroll/central-a-fees-codec'
import { hasPayrollAFeesForm } from '../../app/lib/payroll/central-a-fees-contract'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'

describe('p5 公开配置与现场量费用核算', () => {
  it('费用表单和配置响应的用途/修订/动作资格缺损不能通过读取解码', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      await f.saveFees([f.fee()])
      const input = { statementId: null, draftKey: 'draft', draft: { ...f.draft, book: f.ordinary } }
      const form = await f.service.aForm({ origin: 'real' }, input)
      expect(() => decodePayrollARead(encodePayrollAWire(form), 'form', { origin: 'real' }, input)).not.toThrow()
      const broken = structuredClone(form) as unknown as Record<string, unknown>
      delete broken.bookProof
      expect(() => decodePayrollARead(encodePayrollAWire(broken), 'form', { origin: 'real' }, input)).toThrow()
      const config = await f.feeConfig()
      expect(() => decodePayrollAFeeConfigRead(encodePayrollAWire(config), { origin: 'real' }, config.scope)).not.toThrow()
      const poisoned = structuredClone(config)
      Object.assign(poisoned.fees[0]!, { unitPrice: 'free' })
      expect(() => decodePayrollAFeeConfigRead(encodePayrollAWire(poisoned), { origin: 'real' }, config.scope)).toThrow()
    }
    finally { await f.close() }
  })
  it('同簿已发月费用只读，但同人该月仍可显式建立独立管理簿', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      await f.saveFees([f.fee()])
      const draft = { ...f.draft, book: f.ordinary, payRatio: 1 }
      const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
      await f.release(saved.statementId!, 3730)
      const read = await f.feeConfig()
      await expect(f.service.executeFees(f.feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [f.fee({ name: '追加费用' })], remove: [] }))).rejects.toThrow('已发')
      const manager = await f.management()
      expect((await manager.start()).statementId).toBeTruthy()
    }
    finally { await f.close() }
  })
  it('未来配置不能回溯生效，重复修订同一费用会整批回滚', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.saveFees([f.fee({ unitPrice: 0 })])
      const next = await f.feeConfig(f.ordinary, '2026-09')
      const old = next.fees[0]!
      const edit = f.fee({ feeId: old.feeId, baseRevisionId: old.id, effectiveMonth: '2026-08', unitPrice: 2 })
      await expect(f.service.executeFees(f.feeCommand(next, { kind: 'save-a-fees', baseVersion: next.baseVersion, fees: [edit], remove: [] }))).rejects.toThrow('此前月份')
      edit.effectiveMonth = '2026-09'
      await expect(f.service.executeFees(f.feeCommand(next, { kind: 'save-a-fees', baseVersion: next.baseVersion, fees: [edit, edit], remove: [] }))).rejects.toThrow('重复')
      expect((await f.feeConfig()).fees).toHaveLength(1)
      expect((await f.feeConfig()).fees[0]!.unitPrice).toBe(0)
      const removeRead = await f.feeConfig(f.ordinary, '2026-09')
      const removed = await f.service.executeFees(f.feeCommand(removeRead, { kind: 'save-a-fees', baseVersion: removeRead.baseVersion, fees: [], remove: [{ feeId: old.feeId, baseRevisionId: old.id }] }))
      expect((await f.feeConfig()).fees.find(r => removed.feeRevisionIds.includes(r.id))).toMatchObject({ effectiveMonth: '2026-09', removed: true })
    }
    finally { await f.close() }
  })
  it('伪造班组默认不能作为已采用来源，回执SQL故障不留下任何配置半写', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      const read = await f.feeConfig()
      const fake = f.fee({ adoptedDefault: { kind: 'crew-rent', fact: { crewId: 'crew', sourceVersion: 'invented', rentEnabled: { state: 'value', value: true }, rentUnitPrice: { state: 'value', value: 1.3 }, managementEnabled: { state: 'missing' }, managementUnitPrice: { state: 'missing' } } } })
      await expect(f.saveFees([fake])).rejects.toThrow('默认')
      await f.db.execute('CREATE TRIGGER fail_fee_receipt BEFORE INSERT ON payroll_command_receipts BEGIN SELECT RAISE(ABORT,\'receipt failure\'); END')
      const tables = ['payroll_a_fee_revisions', 'operation_logs', 'payroll_command_receipts', 'payroll_revision']
      const snapshot = async () => payrollACanonical(await Promise.all(tables.map(t => f.db.select(`SELECT * FROM ${t}`))))
      const before = await snapshot()
      await expect(f.service.executeFees(f.feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [f.fee()], remove: [] }))).rejects.toThrow('receipt failure')
      expect(await snapshot()).toBe(before)
    }
    finally { await f.close() }
  })
  it('100㎡墙砖原工资3600，独立房补130，不把30套并入平方米', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      await f.saveFees([f.fee()])
      const read = await f.form({ payRatio: 1, book: f.ordinary })
      expect(read.totals.workAmount.value).toBe(3600)
      expect('fees' in read && read.fees?.totals.subsidyAmount.value).toBe(130)
      expect(read.totals.grossAmount.value).toBe(3730)
      const config = await f.feeConfig()
      expect(config.fees).toHaveLength(1)
      expect(config.fees[0]?.revision).toBe(1)
    }
    finally { await f.close() }
  })
  it('冻结费用合计同改 source/doc 仍须与逐条费用计算相符', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      await f.saveFees([f.fee()])
      const draft = { ...f.draft, book: f.ordinary, payRatio: 1 }
      const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
      await f.release(saved.statementId!, 3730)
      const [row] = await f.db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM wage_statements WHERE id=?', [saved.statementId])
      const snapshot = JSON.parse(row!.snapshot_json)
      for (const fees of [snapshot.fees, snapshot.aDocument.fees, snapshot.aSource.fees]) fees.totals.subsidyAmount = { value: 999, knownValue: 999, state: 'known', reasons: [] }
      await f.db.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [JSON.stringify(snapshot), saved.statementId])
      await f.db.execute('UPDATE payroll_a_statement_sources SET source_json=? WHERE statement_id=?', [JSON.stringify(snapshot.aSource), saved.statementId])
      expect((await f.service.aOutput({ origin: 'real' }, saved.statementId!)).state).toBe('unavailable')
    }
    finally { await f.close() }
  })
  it('最后一次身份等待后撤权，费用修订/审计/回执/版本全部回滚', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      const read = await f.feeConfig()
      const tables = ['payroll_a_fee_revisions', 'operation_logs', 'payroll_command_receipts', 'payroll_revision']
      const state = async () => payrollACanonical(await Promise.all(tables.map(table => f.db.select(`SELECT * FROM ${table}`))))
      const before = await state()
      let count = 0
      f.setIdentityHook(() => {
        if (++count === 2)
          f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
      })
      await expect(f.service.executeFees(f.feeCommand(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [f.fee()], remove: [] }))).rejects.toThrow('权限')
      expect(await state()).toBe(before)
    }
    finally { await f.close() }
  })
  it('管理费1500先纳入负价-600，再按80%减同簿此前200得520；次月仍含原负价', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.db.execute('UPDATE house_type_template_items SET field_qty=CASE item_id WHEN \'wall\' THEN 400 WHEN \'floor\' THEN 200 ELSE field_qty END')
      await f.db.execute('UPDATE unit_stage_completions SET completed_at=\'2026-07-05\'')
      const m = await f.management('2026-07')
      const first = await m.start()
      await f.release(first.statementId!, 200)
      const second = await m.start('2026-08')
      const read = () => f.service.aForm({ origin: 'real' }, { statementId: second.statementId! })
      const before = await read()
      if (!hasPayrollAFeesForm(before))
        throw new Error('缺少费用表单')
      const scope = { assignments: m.scope.assignments.map(a => ({ ...a, cells: a.cells.filter(c => c.itemId === 'shower') })).filter(a => a.cells.length) }
      await f.service.executeFees(f.feeCommand(before, { kind: 'save-a-negative-lines', baseVersion: before.context.sourceVersion, lines: [{ lineId: null, baseRevisionId: null, label: '淋浴板未收尾代付', quantity: 30, unit: '套', unitPrice: -20, scope, reason: '未收尾', evidenceNote: '经办核实30套', actualRef: null }], remove: [] }))
      expect((await read()).totals.grossAmount.value).toBe(520)
      await f.release(second.statementId!, 520)
      expect((await f.service.aOutput({ origin: 'real' }, second.statementId!)).state).toBe('available')
      const third = await m.start('2026-09')
      const next = await f.service.aForm({ origin: 'real' }, { statementId: third.statementId! })
      expect(next.totals.grossAmount.value).toBe(0)
      expect(hasPayrollAFeesForm(next) && next.fees?.negativeLines[0]?.statementId).toBe(second.statementId)
    }
    finally { await f.close() }
  })
  it('215元两项补贴经公开核对发放冻结，当前改价不重写原输出', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      await f.saveFees([f.fee({ basis: { kind: 'completed-field-quantity', itemIds: ['wall', 'floor'], scope: { kind: 'project' } } }), f.fee({ kind: 'subsidy', name: '独立补贴', unitPrice: 0.2 })])
      const draft = { ...f.draft, book: f.ordinary, payRatio: 1 }
      const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
      const read = () => f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
      expect((await read()).totals.grossAmount.value).toBe(3815)
      await f.service.execute(f.command(await read(), { kind: 'check-a' }))
      expect((await f.service.execute(f.command(await read(), { kind: 'release-a', release: { actualAmount: 3815, allocations: [{ workerId: 'w', amount: 3815 }, { workerId: 'zero', amount: 0 }] } }))).outcome).toBe('released')
      const output = await f.service.aOutput({ origin: 'real' }, saved.statementId!)
      expect(output.state).toBe('available')
      expect(output.document?.actualAmount).toBe(3815)
      expect(await f.db.select<{ source_json: string }>('SELECT source_json FROM payroll_a_statement_sources WHERE statement_id=?', [saved.statementId])).toEqual([expect.objectContaining({ source_json: expect.stringContaining('"schemaVersion":2') })])
      await f.db.execute('UPDATE house_type_template_items SET field_qty=999')
      const frozenRead = await read()
      expect(frozenRead.totals.grossAmount.value).toBe(3815)
      expect(frozenRead.eligibility.canOutput).toBe(true)
      expect(frozenRead.eligibility.canSaveDraft).toBe(false)
    }
    finally { await f.close() }
  })
})
