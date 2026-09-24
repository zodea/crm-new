import { afterEach, describe, expect, it } from 'vitest'
import { createPayrollAServiceFixture, payrollAFact } from '../helpers/payroll-a-service-fixture'

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
