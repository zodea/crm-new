import type { PayrollAdjustmentAction, PayrollAdjustmentFormRead } from '../../app/lib/payroll/central-adjustment-contract'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createPayrollAWorkbook } from '../../app/lib/payroll/a-export'
import { decodePayrollARead, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { encodePayrollAdjustmentWire, parsePayrollAdjustmentFormInput } from '../../app/lib/payroll/central-adjustment-wire'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'

describe('工资分项比例的中央保存与冻结', () => {
  it('按分项累计和费用覆盖核算，保存后读取并保留实际发放与冻结比例', async () => {
    const fixture = await createPayrollAFeesFixture()
    try {
      await fixture.prices()
      await fixture.saveFees([fixture.fee()])
      const config = await fixture.feeConfig()
      const feeId = config.fees[0]!.feeId
      const ratioPlan = { schemaVersion: 1 as const, itemRatios: [{ itemId: 'floor', ratio: 0.2 }, { itemId: 'shower', ratio: 0.3 }, { itemId: 'wall', ratio: 0.5 }], feeRatios: [{ kind: 'fee' as const, id: feeId, ratio: 0.2 }] }
      const draft = { ...fixture.draft, book: fixture.ordinary, payRatio: 0.8, ratioPlan }
      const preview = await fixture.form(draft)
      expect(preview.totals.cumulativeAmount.value).toBe(1826)
      expect(preview.totals.previouslyPaid.value).toBe(0)
      const saved = await fixture.service.execute(fixture.command(preview, { kind: 'save-a-draft', draft }))
      const read = () => fixture.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
      expect((await read()).draft.ratioPlan).toEqual(ratioPlan)
      await fixture.service.execute(fixture.command(await read(), { kind: 'check-a' }))
      const checked = await read()
      await fixture.service.execute(fixture.command(checked, { kind: 'release-a', release: { actualAmount: 100, allocations: checked.members.map(member => ({ workerId: member.id, amount: member.id === 'w' ? 100 : 0 })) } }))
      const output = await fixture.service.aOutput({ origin: 'real' }, saved.statementId!)
      expect(output.state).toBe('available')
      if (output.state === 'available') {
        expect(output.document).toMatchObject({ cumulativeAmount: 1826, previouslyPaid: 0, grossAmount: 1826, actualAmount: 100, ratioPlan })
        const workbook = XLSX.read(createPayrollAWorkbook(output.document).data, { type: 'array' })
        expect(XLSX.utils.sheet_to_json(workbook.Sheets.工资明细!)).toContainEqual(expect.objectContaining({ 分项: expect.stringContaining('墙砖'), 分项支付比例: 0.5 }))
        expect(XLSX.utils.sheet_to_json(workbook.Sheets.费用单独比例!)).toContainEqual(expect.objectContaining({ 名称: '房补', 单独比例: 0.2 }))
        expect(XLSX.utils.sheet_to_json(workbook.Sheets.发放汇总!)).toContainEqual(expect.objectContaining({ 费用默认比例: 0.8, 本次实际发放: 100 }))
      }
      const next = await fixture.form({ ...draft, month: '2026-09', ratioPlan: undefined }, 'next-month')
      expect(next.draft.ratioPlan).toEqual(ratioPlan)
      expect(next.totals).toMatchObject({ cumulativeAmount: { value: 1826 }, previouslyPaid: { value: 100 }, grossAmount: { value: 1726 } })
      await fixture.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(?,?,?,?,?,?)', ['new-work', 'p', 'new-work', '新增分项', '泥工', '㎡'])
      await fixture.db.execute('INSERT INTO house_type_template_items(id,room_id,item_id,field_qty) VALUES(?,?,?,?)', ['new-work-line', 'fee-room', 'new-work', 2])
      await fixture.db.execute('INSERT INTO construction_stage_items(id,stage_id,item_id,is_reporting_stage) VALUES(?,?,?,1)', ['new-work-stage', 'fee-stage', 'new-work'])
      await fixture.db.execute('INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES(?,?,?,?)', ['new-work-scope', 'fee-assignment', 'fee-room', 'new-work'])
      const withNew = await fixture.form({ ...draft, month: '2026-09', ratioPlan: undefined }, 'next-with-new')
      expect(withNew.draft.ratioPlan?.itemRatios.find(item => item.itemId === 'new-work')?.ratio).toBeNull()
      expect(withNew.totals.cumulativeAmount.value).toBeNull()
      expect(withNew.blockers.some(blocker => blocker.code === 'item-ratio-incomplete' && blocker.message.includes('新增分项'))).toBe(true)
    }
    finally { await fixture.close() }
  })

  it('新增工作缺比例时明确阻止核算，不把未知当成零', async () => {
    const fixture = await createPayrollAFeesFixture()
    try {
      await fixture.prices()
      const ratioPlan = { schemaVersion: 1 as const, itemRatios: [{ itemId: 'wall', ratio: 0.5 }, { itemId: 'floor', ratio: 0.2 }, { itemId: 'shower', ratio: null }], feeRatios: [] }
      const draft = { ...fixture.draft, book: fixture.ordinary, ratioPlan }
      const preview = await fixture.form(draft)
      expect(preview.totals.cumulativeAmount.value).toBeNull()
      expect(preview.blockers.some(blocker => blocker.code === 'item-ratio-incomplete' && blocker.message.includes('淋浴板'))).toBe(true)
      expect(preview.eligibility.canSaveDraft).toBe(false)
      await expect(fixture.service.execute(fixture.command(preview, { kind: 'save-a-draft', draft }))).rejects.toThrow('淋浴板 尚未填写比例')
    }
    finally { await fixture.close() }
  })

  it('核对后的单独比例变更要求重新核对并保存完整计划', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      const ratioPlan = { schemaVersion: 1 as const, itemRatios: [{ itemId: 'floor', ratio: 0.2 }, { itemId: 'shower', ratio: 0.3 }, { itemId: 'wall', ratio: 0.5 }], feeRatios: [] }
      const draft = { ...f.draft, book: f.ordinary, ratioPlan }
      const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
      const read = () => f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
      await f.service.execute(f.command(await read(), { kind: 'check-a' }))
      const changed = { ...ratioPlan, itemRatios: ratioPlan.itemRatios.map(row => row.itemId === 'wall' ? { ...row, ratio: 0.4 } : row) }
      expect((await f.service.execute(f.command(await read(), { kind: 'set-a-ratio-plan', ratioPlan: changed }))).outcome).toBe('needs-recheck')
      const after = await read()
      expect(after.draft.ratioPlan).toEqual(changed)
      expect(after.needsRecheck).toBe(true)
      expect(after.eligibility.canRelease).toBe(false)
      expect(after.totals.cumulativeAmount.value).toBe(1440)
      await f.service.execute(f.command(after, { kind: 'check-a' }))
      expect((await read()).eligibility.canRelease).toBe(true)
    }
    finally { await f.close() }
  })

  it('旧版未发草稿的普通簿可证明时要求明确分项比例后继续，不回填历史比例', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      const ratioPlan = { schemaVersion: 1 as const, itemRatios: [{ itemId: 'floor', ratio: 0.2 }, { itemId: 'shower', ratio: 0.3 }, { itemId: 'wall', ratio: 0.5 }], feeRatios: [] }
      const draft = { ...f.draft, book: f.ordinary, ratioPlan }
      const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
      const [row] = await f.db.select<{ source_json: string }>('SELECT source_json FROM payroll_a_statement_sources WHERE statement_id=?', [saved.statementId!])
      const old = JSON.parse(row!.source_json)
      await f.db.execute('UPDATE payroll_a_statement_sources SET source_json=? WHERE statement_id=?', [JSON.stringify({ schemaVersion: 1, subject: old.subject, facts: old.facts, priceRevisions: old.priceRevisions }), saved.statementId!])
      await f.db.execute('DELETE FROM payroll_a_statement_books WHERE statement_id=?', [saved.statementId!])
      const read = await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
      expect(read.draft.book).toEqual(f.ordinary)
      expect(read.draft.ratioPlan?.itemRatios.every(row => row.ratio === null)).toBe(true)
      expect(read.eligibility.canCheck).toBe(false)
      const complete = { ...read.draft, ratioPlan } as typeof draft
      const preview = await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId!, draft: complete })
      await f.service.execute(f.command(preview, { kind: 'save-a-draft', draft: complete }))
      expect((await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })).draft.ratioPlan).toEqual(ratioPlan)
    }
    finally { await f.close() }
  })

  it('更正仅作用于原分项比例并在后月按同一分项证明包含关系', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      const ratioPlan = { schemaVersion: 1 as const, itemRatios: [{ itemId: 'floor', ratio: 0.2 }, { itemId: 'shower', ratio: 0.3 }, { itemId: 'wall', ratio: 0.5 }], feeRatios: [] }
      const draft = { ...f.draft, book: f.ordinary, payRatio: 0.8, ratioPlan }
      const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
      await f.release(saved.statementId!, 100)
      const target = { adjustmentId: null, draftKey: 'item-correction', originalStatementId: saved.statementId! } as const
      const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
      if (initial.draft.basis?.formatFamily !== 'A' || !initial.draft.basis.ratioPlan)
        throw new Error('未读取原分项比例')
      const basis = structuredClone(initial.draft.basis)
      basis.ratioPlan!.itemRatios.find(row => row.itemId === 'wall')!.ratio = 0.6
      const correction = { ...initial.draft, reason: '核对墙面比例', evidenceNote: '按已确认的原单协议核对', basis }
      const wire = encodePayrollAdjustmentWire({ target, draft: correction }) as { draft: { basis: { ratioPlan: { itemRatios: Array<{ ratio: unknown }> } } } }
      expect(wire.draft.basis.ratioPlan.itemRatios.find(row => row.ratio === '0.6')).toBeDefined()
      expect(parsePayrollAdjustmentFormInput(wire)).toEqual({ target, draft: correction })
      let sequence = 0
      const command = (read: PayrollAdjustmentFormRead, action: PayrollAdjustmentAction) => ({ commandId: `item-correction-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: 'p', target: read.target, action })
      const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft: correction })
      expect(preview.preview.delta.value).toBe(360)
      const changed = await f.service.executeAdjustment(command(preview, { kind: 'save-adjustment-draft', draft: correction }))
      const confirmation = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: changed.adjustmentId! } })
      await f.service.executeAdjustment(command(confirmation, { kind: 'confirm-adjustment' }))
      const next = await f.form({ ...draft, month: '2026-09' }, 'corrected-next')
      expect(next.adjustmentReconciliation?.reasons).toEqual([])
      expect(next.adjustmentReconciliation?.effectiveCumulative.value).toBe(2160)
      expect(next.totals.grossAmount.value).toBe(2060)
      expect(() => decodePayrollARead(encodePayrollAWire(next), 'form', { origin: 'real' }, { statementId: null, draftKey: 'corrected-next' })).not.toThrow()
      const laterDraft = { ...draft, month: '2026-09' }
      const laterSaved = await f.service.execute(f.command(next, { kind: 'save-a-draft', draft: laterDraft }))
      const later = () => f.service.aForm({ origin: 'real' }, { statementId: laterSaved.statementId! })
      await f.service.execute(f.command(await later(), { kind: 'check-a' }))
      const checked = await later()
      const releasePreview = await f.service.releaseAdjustmentPreview({ origin: 'real' }, { statementId: laterSaved.statementId! })
      const candidate = releasePreview.candidates.find(row => row.adjustmentId === changed.adjustmentId)!
      expect(candidate.embeddedInCalculation).toBe(360)
      await f.service.execute(f.command(checked, { kind: 'release-a', release: { actualAmount: 2060, allocations: checked.members.map(member => ({ workerId: member.id, amount: member.id === 'w' ? 2060 : 0 })), adjustmentApplications: [{ adjustmentId: candidate.adjustmentId, amount: 360, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion }] } }))
      expect((await f.service.aOutput({ origin: 'real' }, laterSaved.statementId!)).state).toBe('available')
      expect((await f.service.aOutput({ origin: 'real' }, saved.statementId!))).toMatchObject({ state: 'available', document: { cumulativeAmount: 1800, ratioPlan } })
    }
    finally { await f.close() }
  })

  it('费用单独比例更正只作用于同一原费项并保留其他分项比例', async () => {
    const f = await createPayrollAFeesFixture()
    try {
      await f.prices()
      await f.saveFees([f.fee()])
      const feeId = (await f.feeConfig()).fees[0]!.feeId
      const ratioPlan = { schemaVersion: 1 as const, itemRatios: [{ itemId: 'floor', ratio: 0.2 }, { itemId: 'shower', ratio: 0.3 }, { itemId: 'wall', ratio: 0.5 }], feeRatios: [{ kind: 'fee' as const, id: feeId, ratio: 0.2 }] }
      const draft = { ...f.draft, book: f.ordinary, payRatio: 0.8, ratioPlan }
      const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
      await f.release(saved.statementId!, 100)
      const target = { adjustmentId: null, draftKey: 'fee-ratio-correction', originalStatementId: saved.statementId! } as const
      const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
      if (initial.draft.basis?.formatFamily !== 'A' || !initial.draft.basis.ratioPlan)
        throw new Error('未读取原费用比例')
      const basis = structuredClone(initial.draft.basis)
      basis.ratioPlan!.feeRatios[0]!.ratio = 0.3
      const correction = { ...initial.draft, reason: '核对房补比例', evidenceNote: '经办人核对原房补比例', basis }
      let sequence = 0
      const command = (read: PayrollAdjustmentFormRead, action: PayrollAdjustmentAction) => ({ commandId: `fee-ratio-correction-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: 'p', target: read.target, action })
      const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft: correction })
      expect(preview.preview.delta.value).toBe(13)
      const changed = await f.service.executeAdjustment(command(preview, { kind: 'save-adjustment-draft', draft: correction }))
      await f.service.executeAdjustment(command(await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: changed.adjustmentId! } }), { kind: 'confirm-adjustment' }))
      const next = await f.form({ ...draft, month: '2026-09' }, 'fee-corrected-next')
      expect(next.adjustmentReconciliation?.reasons).toEqual([])
      expect(next.adjustmentReconciliation?.effectiveCumulative.value).toBe(1839)
      expect(next.totals.grossAmount.value).toBe(1739)
      expect(next.adjustmentReconciliation?.effectiveBasis.ratioPlan?.itemRatios).toEqual(ratioPlan.itemRatios)
      expect(() => decodePayrollARead(encodePayrollAWire(next), 'form', { origin: 'real' }, { statementId: null, draftKey: 'fee-corrected-next' })).not.toThrow()
    }
    finally { await f.close() }
  })
})
