import { afterEach, describe, expect, it } from 'vitest'
import { decodePayrollARead, encodePayrollAWire } from '../../app/lib/payroll/central-a-codec'
import { decodePayrollHollowConfigRead, encodePayrollHollowWire } from '../../app/lib/payroll/central-hollow-deduction-codec'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})

describe('真实户记录到工资扣款', () => {
  it('公开检查19整改4后只列示15，明确启动后工资1000扣450并冻结现金550', async () => {
    const f = await createPayrollHollowFixture()
    closers.push(f.close)
    const initial = await f.form()
    expect(initial.totals.grossAmount.value).toBe(1000)
    expect(initial.hollow?.rows).toHaveLength(1)
    expect(initial.hollow?.rows[0]?.fact).toMatchObject({ recordId: f.recordId, remainingCount: 15, rectifiedCount: 4 })
    expect(initial.hollow?.snapshot?.start).toBeNull()
    expect(decodePayrollARead(encodePayrollAWire(initial), 'form', { origin: 'real' }, { statementId: null, draftKey: 'hollow-new-a', draft: f.draft })).toEqual(initial)
    const saved = await f.service.execute(f.command(initial, { kind: 'save-a-draft', draft: f.draft }))
    const statementId = saved.statementId!
    let read = await f.service.aForm({ origin: 'real' }, { statementId })
    const command = f.startCommand(read.hollow!)
    const started = await f.service.executeHollow(command)
    expect(await f.service.executeHollow(command)).toEqual(started)
    read = await f.service.aForm({ origin: 'real' }, { statementId })
    expect(read.hollow?.snapshot?.start?.id).toBe(started.startId)
    expect(read.totals.grossAmount.value).toBe(550)
    expect(read.hollow?.totals.currentDeduction.value).toBe(450)
    await f.service.execute(f.command(read, { kind: 'check-a' }))
    read = await f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.execute(f.command(read, { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const output = await f.service.aOutput({ origin: 'real' }, statementId)
    expect(output.state).toBe('available')
    if (output.state !== 'available')
      throw new Error(output.reasons.join('; '))
    expect(output.document.actualAmount).toBe(550)
    expect(output.document.hollow?.totals.currentDeduction.value).toBe(450)
    expect(decodePayrollARead(encodePayrollAWire(output), 'output', { origin: 'real' }, statementId)).toEqual(output)
    expect(await f.db.select('SELECT record_id,statement_id FROM payroll_hollow_adoptions')).toEqual([{ record_id: f.recordId, statement_id: statementId }])
    expect((await f.form({ month: '2026-09' }, 'hollow-next-month')).totals.grossAmount.value).toBe(0)
    const current = await f.quantityService.hollow(f.scope)
    await f.quantityService.executeHollow(f.hollowCommand(current, { kind: 'rectify-hollow-inspection', recordId: f.recordId, expectedRevisionId: current.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-01', count: 15, note: '后期全部修复' }))
    const scope = output.document.hollow!.scope
    const configQuery = { scope, month: '2026-09' }
    const config = await f.service.hollowConfig({ origin: 'real' }, configQuery)
    await f.service.executeHollow({ commandId: 'hollow-price-after-release', workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: config.context.sourceVersion, projectId: f.draft.projectId, target: null, config: configQuery, action: { kind: 'save-hollow-policies', policies: [{ policyId: null, baseRevisionId: null, itemId: f.target.itemId, enabled: true, unitAmount: 45, effectiveMonth: '2026-09' }] } })
    const laterOutput = await f.service.aOutput({ origin: 'real' }, statementId)
    expect(laterOutput.state === 'available' ? laterOutput.document : null).toEqual(output.document)
    expect((await f.form({ month: '2026-09' }, 'hollow-next-month')).totals.grossAmount.value).toBe(0)
    const frozenForm = await f.service.aForm({ origin: 'real' }, { statementId })
    expect(frozenForm.hollow?.snapshot).toEqual(output.document.hollow)
    expect(frozenForm.hollow?.rows[0]?.fact.remainingCount).toBe(15)
    expect(frozenForm.hollow?.current?.rows[0]?.fact).toMatchObject({ recordId: f.recordId, remainingCount: 0, rectifiedCount: 19 })
    expect(frozenForm.hollow?.rows[0]?.policy.unitAmount).toBe(30)
    expect(frozenForm.hollow?.current?.rows[0]?.policy.unitAmount).toBe(45)
    expect(frozenForm.hollow?.totals).toEqual(output.document.hollow?.totals)
    expect(decodePayrollARead(encodePayrollAWire(frozenForm), 'form', { origin: 'real' }, { statementId })).toEqual(frozenForm)
    interface HollowWire { hollow: { current: { rows: Array<{ fact: { location: { projectId: string } } }> } } }
    const duplicateCurrent = structuredClone(encodePayrollAWire(frozenForm)) as HollowWire
    duplicateCurrent.hollow.current.rows.push(structuredClone(duplicateCurrent.hollow.current.rows[0]!))
    expect(() => decodePayrollARead(duplicateCurrent, 'form', { origin: 'real' }, { statementId })).toThrow()
    const crossProjectCurrent = structuredClone(encodePayrollAWire(frozenForm)) as HollowWire
    crossProjectCurrent.hollow.current.rows[0]!.fact.location.projectId = 'other-project'
    expect(() => decodePayrollARead(crossProjectCurrent, 'form', { origin: 'real' }, { statementId })).toThrow()
  }, 30_000)

  it('配置逐分项保留零价、关闭与缺价，原修订和配置回执不互相覆盖', async () => {
    const f = await createPayrollHollowFixture()
    closers.push(f.close)
    const scope = { projectId: f.draft.projectId, crewId: f.draft.crewId, leaderWorkerId: f.draft.leaderWorkerId, formatFamily: 'A' as const, book: f.draft.book! }
    const query = { scope, month: f.draft.month }
    let config = await f.service.hollowConfig({ origin: 'real' }, query)
    expect(config.policies[0]).toMatchObject({ source: 'default', enabled: true, unitAmount: 30 })
    let revisionId: string | null = null
    let policyId: string | null = null
    for (const [index, values] of [{ enabled: true, unitAmount: 0 }, { enabled: false, unitAmount: null }, { enabled: true, unitAmount: null }].entries()) {
      const command = { commandId: `hollow-config-${index}`, workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: config.context.sourceVersion, projectId: f.draft.projectId, target: null, config: query, action: { kind: 'save-hollow-policies' as const, policies: [{ policyId, baseRevisionId: revisionId, itemId: f.target.itemId, effectiveMonth: query.month, ...values }] } }
      const result = await f.service.executeHollow(command)
      expect(await f.service.executeHollow(command)).toEqual(result)
      config = await f.service.hollowConfig({ origin: 'real' }, query)
      revisionId = result.policyRevisionIds[0]!
      policyId = config.revisions.find(revision => revision.id === revisionId)!.policyId
      expect(config.policies.find(policy => policy.itemId === f.target.itemId)).toMatchObject({ ...values, source: 'configured', revisionId })
      expect(decodePayrollHollowConfigRead(encodePayrollHollowWire(config), { origin: 'real' }, query)).toEqual(config)
    }
    expect(config.revisions).toHaveLength(3)
    const form = await f.form()
    expect(form.hollow?.rows[0]?.state).toBe('unknown')
    expect(form.hollow?.rows[0]?.amount.value).toBeNull()
    expect(form.hollow?.eligibility.canStart).toBe(false)
  }, 30_000)

  it('完整扣款450恰好抵完工资450时可明确实发0，采用原件而不制造现金', async () => {
    const f = await createPayrollHollowFixture()
    closers.push(f.close)
    const draft = { ...f.draft, payRatio: 0.3 }
    const initial = await f.form({ payRatio: draft.payRatio })
    expect(initial.totals.grossAmount.value).toBe(450)
    const saved = await f.service.execute(f.command(initial, { kind: 'save-a-draft', draft }))
    const statementId = saved.statementId!
    const form = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand((await form()).hollow!))
    expect((await form()).totals.grossAmount.value).toBe(0)
    await f.service.execute(f.command(await form(), { kind: 'check-a' }))
    const checked = await form()
    expect(checked.eligibility.canRelease).toBe(true)
    await f.service.execute(f.command(checked, { kind: 'release-a', release: { actualAmount: 0, allocations: [{ workerId: draft.leaderWorkerId, amount: 0 }] } }))
    const output = await f.service.aOutput({ origin: 'real' }, statementId)
    expect(output.state).toBe('available')
    if (output.state !== 'available')
      throw new Error(output.reasons.join('; '))
    expect(output.document.actualAmount).toBe(0)
    expect(output.document.hollow?.adoptions).toHaveLength(1)
    expect(output.document.hollow?.totals.currentDeduction.value).toBe(450)
    expect(decodePayrollARead(encodePayrollAWire(output), 'output', { origin: 'real' }, statementId)).toEqual(output)
    const actual = await f.service.actualLedger({ origin: 'real' }, { projectId: draft.projectId })
    expect(actual.netAmount.value).toBe(0)
    expect((await f.form({ month: '2026-09', payRatio: 0.3 }, 'hollow-zero-next')).totals.grossAmount.value).toBe(0)
  }, 30_000)
})
