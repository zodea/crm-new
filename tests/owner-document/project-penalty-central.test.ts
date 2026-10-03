import { describe, expect, it } from 'vitest'
import { createHttpOwnerCommercialDocumentCommandRepository, createHttpOwnerCommercialDocumentReadRepository } from '~/lib/owner-document/central-http-repository'
import { parseOwnerCommercialDocumentCommandRequest as parse } from '../../server/utils/owner-commercial-document-command-request'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { createOwnerCommercialDocumentReadTestInstance } from '../../server/utils/owner-commercial-document-read-test-instance'

const session = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['subcontract-document:read', 'subcontract-document:write'] }
function instance() {
  return createOwnerCommercialDocumentCommandTestInstance({
    projects: [{ id: 'p329', name: '罚扣测试项目', customerId: null }],
    suppliers: [{ id: 's329', name: '罚扣测试分供方' }],
    subcontractContracts: [{ id: 'c329', no: 'FB329', name: '测试合同', projectId: 'p329', supplierId: 's329' }],
  })
}
function request(overrides: Record<string, unknown> = {}) {
  return parse({ ...session, requiredCapability: 'subcontract-document:write', commandId: 'penalty329', kind: 'project_penalty', action: 'submit', id: null, baseVersion: null, draft: { no: 'FK329', projectId: 'p329', supplierId: 's329', contractId: 'c329', amount: 1000, penaltyDate: '2026-09-05', reason: '成品保护整改', deductionMethod: '结算抵扣', deadline: '2026-09-10', rectificationNote: '待修复', note: '测试备注' }, attachments: {}, ...overrides })
}

describe('aX03 项目罚扣中央链', () => {
  it('hTTP 适配完整读取罚扣详情、表单及上下文，拒绝畸形余额', async () => {
    const commands = instance()
    const saved = await commands.execute(request(), session)
    const read = createOwnerCommercialDocumentReadTestInstance(() => session.capabilities, commands)
    const detail = read.detail('project_penalty', saved.id, { origin: 'real' })
    const query = { kind: 'project_penalty' as const, id: saved.id, origin: 'real' as const, includeDemo: false }
    await expect(createHttpOwnerCommercialDocumentReadRepository({ fetcher: async () => detail }).get(query)).resolves.toMatchObject({ document: { id: saved.id } })
    await expect(createHttpOwnerCommercialDocumentCommandRepository({ fetcher: async () => commands.form('project_penalty', saved.id, session) }).loadForm('project_penalty', saved.id)).resolves.toMatchObject({ draft: { reason: '成品保护整改' } })
    await expect(createHttpOwnerCommercialDocumentCommandRepository({ fetcher: async () => commands.context(session, undefined, 'project_penalty') }).context('project_penalty')).resolves.toMatchObject({ workspaceId: session.workspaceId })
    const malformed = structuredClone(detail)
    if (malformed.document.amounts.kind === 'project_penalty')
      malformed.document.amounts.remaining = 'NaN'
    await expect(createHttpOwnerCommercialDocumentReadRepository({ fetcher: async () => malformed }).get(query)).rejects.toThrow('格式')
  })
  it('只有项目或班组而没有 canonical 合同/分供方不能猜接结算', async () => {
    const commands = instance()
    const penalty = await commands.execute(request({ draft: { projectId: 'p329', amount: 100, reason: '仅项目罚扣', penaltyDate: '2026-09-05' } }), session)
    const settlement = await commands.execute(request({ kind: 'sub_settlement', commandId: 'settlement329', draft: { projectId: 'p329', supplierId: 's329', contractId: 'c329', name: '真实结算', totalAmount: 2000, settlementDate: '2026-09-05' } }), session)
    await expect(commands.execute(request({ action: 'deduct-penalty', commandId: 'guess329', id: penalty.id, baseVersion: penalty.version, settlementId: settlement.id, settlementVersion: settlement.version, amount: 10, note: '' }), session)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
  })
  it('提交后整改追加审计，不能改写罚扣金额且失败不改变版本', async () => {
    const commands = instance()
    const saved = await commands.execute(request(), session)
    const updated = await commands.execute(request({ action: 'rectify-penalty', commandId: 'rectify329', id: saved.id, baseVersion: saved.version, deadline: '2026-09-12', note: '复验完成' }), session)
    const read = createOwnerCommercialDocumentReadTestInstance(() => session.capabilities, commands)
    expect(read.detail('project_penalty', saved.id, { origin: 'real' })).toMatchObject({ penaltyFacts: { deadline: '2026-09-12', rectificationNote: '复验完成' }, penaltyRectifications: [expect.objectContaining({ note: '复验完成', actorId: session.actorId })] })
    await expect(commands.execute(request({ action: 'save', commandId: 'rewrite329', id: saved.id, baseVersion: updated.version }), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(commands.form('project_penalty', saved.id, session).version).toBe(updated.version)
  })
  it('两次部分抵扣按独立事实归集，重试幂等且拒绝旧版本与超额', async () => {
    const commands = instance()
    const penalty = await commands.execute(request(), session)
    const settlement = await commands.execute(request({ kind: 'sub_settlement', commandId: 'settlement329', draft: { projectId: 'p329', supplierId: 's329', contractId: 'c329', name: '真实结算', totalAmount: 2000, settlementDate: '2026-09-05' } }), session)
    const deduction = request({ action: 'deduct-penalty', commandId: 'deduct329', id: penalty.id, baseVersion: penalty.version, settlementId: settlement.id, settlementVersion: settlement.version, amount: 400, note: '第一笔抵扣' })
    const first = await commands.execute(deduction, session)
    expect(await commands.execute(deduction, session)).toEqual(first)
    const read = createOwnerCommercialDocumentReadTestInstance(() => session.capabilities, commands)
    expect(read.detail('project_penalty', penalty.id, { origin: 'real' })).toMatchObject({ document: { status: 'pending', amounts: { deducted: '400.00', remaining: '600.00' } }, penaltyDeductions: [expect.objectContaining({ settlementId: settlement.id, amount: '400.00', actorId: 'actor-default', note: '第一笔抵扣' })] })
    expect(read.detail('sub_settlement', settlement.id, { origin: 'real' }).document.amounts).toMatchObject({ deductions: '400.00', netSettlement: '1600.00' })
    await expect(commands.execute(request({ ...deduction, commandId: 'stale329' }), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const version = read.detail('sub_settlement', settlement.id, { origin: 'real' }).document.version
    await expect(commands.execute(request({ ...deduction, commandId: 'over329', baseVersion: first.version, settlementVersion: version, amount: 601 }), session)).rejects.toThrow('剩余')
    await commands.execute(request({ ...deduction, commandId: 'rest329', baseVersion: first.version, settlementVersion: version, amount: 600 }), session)
    expect(read.detail('project_penalty', penalty.id, { origin: 'real' })).toMatchObject({ document: { status: 'deducted', amounts: { deducted: '1000.00', remaining: '0.00' } }, penaltyDeductions: expect.any(Array) })
    expect(read.detail('project_penalty', penalty.id, { origin: 'real' }).penaltyDeductions).toHaveLength(2)
  })
  it('拒绝无权限、伪造身份、缺失目标、错误来源及过期结算版本，失败不落抵扣', async () => {
    const commands = instance()
    const penalty = await commands.execute(request(), session)
    const settlement = await commands.execute(request({ kind: 'sub_settlement', commandId: 'settlement-safety', draft: { projectId: 'p329', supplierId: 's329', contractId: 'c329', name: '安全结算', totalAmount: 50, settlementDate: '2026-09-05' } }), session)
    const action = { action: 'deduct-penalty', id: penalty.id, baseVersion: penalty.version, settlementId: settlement.id, settlementVersion: settlement.version, amount: 10, note: '' }
    await expect(commands.execute(request({ ...action, commandId: 'no-capability' }), { ...session, capabilities: [] })).rejects.toBeDefined()
    expect(commands.rows().find(row => row.id === penalty.id)?.penaltyDeductions).toEqual([])
    expect(commands.form('project_penalty', penalty.id, session).version).toBe(penalty.version)
  })

  it.each(Array.from([{ amount: 0 }, { amount: -1 }, { amount: 0.001 }, { amount: 51 }, { settlementVersion: 'stale' }, { settlementId: 'missing' }, { actorId: 'spoof' }, { workspaceId: 'another' }].entries()))('拒绝无权限、伪造身份、缺失目标、错误来源及过期结算版本，失败不落抵扣：输入组合 1 案例 %#', async (index, override) => {
    const commands = instance()
    const penalty = await commands.execute(request(), session)
    const settlement = await commands.execute(request({ kind: 'sub_settlement', commandId: 'settlement-safety', draft: { projectId: 'p329', supplierId: 's329', contractId: 'c329', name: '安全结算', totalAmount: 50, settlementDate: '2026-09-05' } }), session)
    const action = { action: 'deduct-penalty', id: penalty.id, baseVersion: penalty.version, settlementId: settlement.id, settlementVersion: settlement.version, amount: 10, note: '' }
    await expect(commands.execute(request({ ...action, commandId: `invalid-${index}`, ...override }), session)).rejects.toBeDefined()
  })
  it('班组候选随中央来源替换，删除的旧身份不能继续选择', () => {
    let rows = [{ id: 'old-crew', name: '责任班组' }]
    const commands = createOwnerCommercialDocumentCommandTestInstance({ crewSource: { crewRows: () => rows as import('~/lib/crew-worker/read-contract').CrewSourceRow[] } })
    expect(commands.context(session, undefined, 'project_penalty').crews).toHaveLength(1)
    rows = [{ id: 'new-crew', name: '责任班组' }]
    expect(commands.context(session, undefined, 'project_penalty').crews).toEqual([{ id: 'new-crew', label: '责任班组' }])
  })
  it('待抵扣视图包含旧整改状态，已抵扣视图只含全部抵扣', async () => {
    const commands = instance()
    await commands.execute(request(), session)
    const template = commands.rows()[0]!
    commands.importExisting(['draft', 'repairing', 'repaired_self', 'repaired_other', 'deducted'].map(status => ({ ...template, id: `legacy-${status}`, status })))
    const read = createOwnerCommercialDocumentReadTestInstance(() => session.capabilities, commands)
    expect(read.list('project_penalty', { status: 'pending' }).pagination.total).toBe(4)
    expect(read.list('project_penalty', { status: 'done' }).pagination.total).toBe(1)
  })
  it('提交罚扣后由同一中央读写接口保留整改事实与稳定关系', async () => {
    const commands = instance()
    const saved = await commands.execute(request(), session)
    expect(await commands.execute(request(), session)).toEqual(saved)
    expect(commands.form('project_penalty', saved.id, session).draft).toMatchObject({ amount: 1000, status: 'pending', rectificationNote: '待修复', deadline: '2026-09-10', contractId: 'c329' })
    const read = createOwnerCommercialDocumentReadTestInstance(() => session.capabilities, commands)
    expect(read.detail('project_penalty', saved.id, { origin: 'real' }).document.amounts).toMatchObject({ kind: 'project_penalty', amount: '1000.00', deducted: '0.00', remaining: '1000.00' })
  })
})
