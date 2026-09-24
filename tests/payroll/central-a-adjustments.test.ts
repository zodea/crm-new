import type { PayrollAdjustmentAction, PayrollAdjustmentFormRead } from '~/lib/payroll/central-adjustment-contract'
import { expect, it } from 'vitest'
import { createPayrollAServiceFixture } from '../helpers/payroll-a-service-fixture'

it('a 更正按原施工责任、现场量、价和比例重新核算；原签名与原施工完成不改', async () => {
  const f = await createPayrollAServiceFixture()
  try {
    f.facts.rows[0]!.fieldQty = 10
    f.facts.rows[0]!.fieldFormula = '2*5'
    await f.config()
    await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
    await f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 100, scope: { kind: 'project' } }] }))
    const draft = { ...f.draft, payRatio: 1 }
    const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
    const statementId = saved.statementId!
    const read = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    await f.service.execute(f.command(await read(), { kind: 'release-a', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'zero', amount: 0 }] } }))
    const frozen = await f.service.aOutput({ origin: 'real' }, statementId)
    const target = { adjustmentId: null, draftKey: 'a-correction', originalStatementId: statementId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    expect(initial.draft.basis?.formatFamily).toBe('A')
    if (initial.draft.basis?.formatFamily !== 'A')
      throw new Error('应取得 A 原施工责任、量价及比例')
    const correction = { ...initial.draft, reason: '原现场核量多记一平方米', evidenceNote: '负责人和经办人复核本户墙砖实际9平方米', basis: { ...initial.draft.basis, components: initial.draft.basis.components.map(c => ({ ...c, quantity: 9 })) } }
    let sequence = 0
    const command = (read: PayrollAdjustmentFormRead, action: PayrollAdjustmentAction) => ({ commandId: `a-adjustment-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: 'p', target: read.target, action })
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft: correction })
    expect(preview.preview).toMatchObject({ beforeAmount: { value: 1000 }, afterAmount: { value: 900 }, delta: { value: -100 } })
    const savedCorrection = await f.service.executeAdjustment(command(preview, { kind: 'save-adjustment-draft', draft: correction }))
    await f.service.executeAdjustment(command(await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: savedCorrection.adjustmentId! } }), { kind: 'confirm-adjustment' }))
    expect((await f.service.adjustmentDetail({ origin: 'real' }, savedCorrection.adjustmentId!)).balance.remainingDelta.value).toBe(-100)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1000)
    expect(f.facts.rows[0]!.fieldQty).toBe(10)
    expect(await f.service.aOutput({ origin: 'real' }, statementId)).toMatchObject({ state: 'available', document: frozen.document })
  }
  finally { await f.close() }
}, 30_000)
