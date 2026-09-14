import { expect, it } from 'vitest'
import { createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

it('核减原已发C2的一百元只产生待处理，不改变原签名或实际一千元', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 1000, ruleText: '' } }))
    await f.daywork({ status: 'confirmed', witness: '现场证明', confirmedOn: '2026-08-02' })
    const saved = await f.service.executeC2(f.c2Command(await f.c2Form(), { kind: 'save-c2-draft', draft: f.draft }))
    const originalStatementId = saved.statementId!
    const original = () => f.service.c2Form({ origin: 'real' }, { statementId: originalStatementId })
    await f.service.executeC2(f.c2Command(await original(), { kind: 'check-c2' }))
    await f.service.executeC2(f.c2Command(await original(), { kind: 'release-c2', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] } }))
    const frozen = await f.service.c2Output({ origin: 'real' }, originalStatementId)
    const target = { adjustmentId: null, draftKey: 'c2-correction', originalStatementId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    if (initial.draft.basis?.formatFamily !== 'C2')
      throw new Error('更正预览应读取原 C2 依据')
    const draft = { ...initial.draft, reason: '核对原负责人单价记录，应为900元；原实际已付1000元', evidenceNote: '经办人与负责人逐项核对原主体配置及当日签工', basis: { ...initial.draft.basis, unitRate: 900 } }
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
    expect(preview.preview.delta.value).toBe(-100)
    const stored = await f.service.executeAdjustment({ commandId: 'save-correction', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: preview.context.sourceVersion, projectId: 'p', target, action: { kind: 'save-adjustment-draft', draft } })
    const read = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: stored.adjustmentId! } })
    expect(read.preview.delta.value).toBe(-100)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1000)
    await f.service.executeAdjustment({ commandId: 'confirm-correction', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: 'p', target: read.target, action: { kind: 'confirm-adjustment' } })
    const detail = await f.service.adjustmentDetail({ origin: 'real' }, stored.adjustmentId!)
    expect(detail.adjustment).toMatchObject({ status: 'confirmed', delta: -100 })
    expect(detail.balance.remainingDelta.value).toBe(-100)
    expect(detail.original.originalSignatureAmount.value).toBe(1000)
    const actual = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    expect(actual.netAmount.value).toBe(1000)
    expect(actual.rows).toHaveLength(1)
    expect(actual.rows[0]).toMatchObject({ kind: 'initial-release', ref: { kind: 'released-statement', statementId: originalStatementId }, signedAmount: { value: 1000 } })
    const reread = await f.service.c2Output({ origin: 'real' }, originalStatementId)
    expect(reread).toMatchObject({ state: 'available', document: frozen.document })
  }
  finally {
    await f.close()
  }
}, 30_000)
