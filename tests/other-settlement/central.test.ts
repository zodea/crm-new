import type { OtherSettlementStored } from '../../server/utils/other-settlement-instance'
import { describe, expect, it } from 'vitest'
import { createOtherSettlementInstance } from '../../server/utils/other-settlement-instance'

const session = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['other-settlement:read', 'other-settlement:write'] }
const contracts = [
  { id: 'c1', kind: 'other_expense', name: '检测合同', projectId: 'p1', supplierId: 's1', status: '已签订', amount: '10600.00', changedAmount: '10600.00' },
  { id: 'draft', kind: 'other_expense', name: '草稿合同', projectId: 'p1', supplierId: 's1', status: '草稿', amount: null, changedAmount: null },
  { id: 'wrong', kind: 'company_expense', name: '公司合同', projectId: null, supplierId: null, status: '已签订', amount: null, changedAmount: null },
]
function setup() {
  return createOtherSettlementInstance({ identities: () => ({ projects: [{ id: 'p1', label: '项目一' }], suppliers: [{ id: 's1', label: '检测单位' }], contracts }) })
}
function command(patch: Record<string, unknown> = {}) {
  return { ...session, requiredCapability: 'other-settlement:write', commandId: 'save-331', baseVersion: null, action: 'save', draft: { name: '九月检测结算', no: 'JS-331', projectId: 'p1', contractId: 'c1', totalAmount: 1060, taxRate: 6, settlementDate: '2026-09-06', settlementType: '过程结算' }, attachments: {}, ...patch }
}
describe('aX05 其他支出结算中央命令', () => {
  it('状态多选作用于完整集合，与项目条件相交，兼容单值和空数组', () => {
    const records: OtherSettlementStored[] = ['draft', 'pending', 'confirmed'].map(status => ({
      id: status,
      version: 1,
      workspaceId: session.workspaceId,
      migrationBatchId: null,
      draft: { ...command().draft, supplierId: 's1', status },
      attachments: [],
      facts: [],
      audit: { createdAt: null, updatedAt: null, createdBy: null, updatedBy: null, responsible: null, department: null },
    }))
    const service = createOtherSettlementInstance({ identities: () => ({ projects: [{ id: 'p1', label: '项目' }], suppliers: [{ id: 's1', label: '单位' }], contracts }), records })
    expect(service.list({ status: ['draft', 'pending'] }, session).pagination.total).toBe(2)
    expect(service.list({ status: ['draft', 'pending'], projectId: 'other' }, session).pagination.total).toBe(0)
    expect(service.list({ status: 'confirmed' }, session).pagination.total).toBe(1)
    expect(service.list({ status: [] }, session).pagination.total).toBe(3)
  })
  it('前期金额不纳入晚于本单日期的已确认结算，历史缺失审计不在编辑时伪造', async () => {
    const base: OtherSettlementStored = { id: 'current', version: 1, workspaceId: session.workspaceId, migrationBatchId: null, draft: { ...command().draft, supplierId: 's1', status: 'draft' }, attachments: [], facts: [], audit: { createdAt: null, updatedAt: null, createdBy: null, updatedBy: null, responsible: null, department: null } }
    const records = [base, { ...base, id: 'prior', draft: { ...base.draft, totalAmount: 100, status: 'confirmed', settlementDate: '2026-09-01' } }, { ...base, id: 'future', draft: { ...base.draft, totalAmount: 200, status: 'confirmed', settlementDate: '2026-09-10' } }]
    const service = createOtherSettlementInstance({ identities: () => ({ projects: [{ id: 'p1', label: '项目' }], suppliers: [{ id: 's1', label: '单位' }], contracts }), records })
    expect(service.detail('current', {}, session).settlement.amounts.prior).toBe('100.00')
    await service.execute(command({ id: 'current', baseVersion: '1' }), session)
    expect(service.detail('current', {}, session).settlement.audit).toMatchObject({ createdAt: null, createdBy: null, updatedBy: session.actorId })
  })
  it('未知事实集合编辑后仍未知；提交、确认后不可修改；无权限拒绝读写', async () => {
    const row: OtherSettlementStored = { id: 'unknown', version: 1, workspaceId: session.workspaceId, migrationBatchId: null, draft: { ...command().draft, supplierId: 's1', status: 'draft' }, attachments: [], facts: null, audit: { createdAt: null, updatedAt: null, createdBy: null, updatedBy: null, responsible: null, department: null } }
    const service = createOtherSettlementInstance({ identities: () => ({ projects: [{ id: 'p1', label: '项目' }], suppliers: [{ id: 's1', label: '单位' }], contracts }), records: [row] })
    const saved = await service.execute(command({ id: row.id, baseVersion: '1', action: 'submit' }), session)
    expect(service.detail(row.id, {}, session).facts).toBeNull()
    const confirmed = await service.execute(command({ id: row.id, baseVersion: saved.version, action: 'confirm', commandId: 'confirm' }), session)
    expect(service.detail(row.id, {}, session).settlement.draft.status).toBe('confirmed')
    await expect(service.execute(command({ id: row.id, baseVersion: confirmed.version, commandId: 'locked' }), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(() => service.detail(row.id, {}, { ...session, capabilities: [] })).toThrow()
    await expect(service.execute(command(), { ...session, capabilities: [] })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })
  it('只按有效抵扣、申请及已确认支付计算，未知金额和多源支付不按比例猜测', () => {
    const base = { settlementId: 'settlement', projectId: 'p1', contractId: 'c1', supplierId: 's1', no: '', name: '测试事实', date: null, parentId: null, effective: true, attribution: 'exact' as const }
    const row: OtherSettlementStored = { id: 'settlement', version: 1, workspaceId: session.workspaceId, migrationBatchId: null, draft: { ...command().draft, supplierId: 's1', status: 'confirmed' }, attachments: [], audit: { createdAt: null, updatedAt: null, createdBy: null, updatedBy: null, responsible: null, department: null }, facts: [
      { ...base, id: 'd', sourceId: 'penalty1', kind: 'penalty', amount: '60.00', status: 'executed' },
      { ...base, id: 'a', sourceId: 'application1', kind: 'application', amount: '800.00', status: 'approved' },
      { ...base, id: 'draft', sourceId: 'draft1', kind: 'application', amount: '900.00', status: 'draft' },
      { ...base, id: 'p', sourceId: 'payment1', parentId: 'application1', kind: 'payment', amount: '300.00', status: 'confirmed' },
      { ...base, id: 'unconfirmed', sourceId: 'payment2', kind: 'payment', amount: '999.00', status: 'draft' },
    ] }
    const service = createOtherSettlementInstance({ identities: () => ({ projects: [{ id: 'p1', label: '项目' }], suppliers: [{ id: 's1', label: '分供方' }], contracts }), records: [row] })
    expect(service.detail(row.id, {}, session).settlement.amounts).toMatchObject({ deductions: '60.00', net: '1000.00', applied: '800.00', applicable: '200.00', paid: '300.00', unpaid: '700.00' })
    row.facts![3]!.attribution = 'unknown'
    const unknown = createOtherSettlementInstance({ identities: () => ({ projects: [{ id: 'p1', label: '项目' }], suppliers: [{ id: 's1', label: '分供方' }], contracts }), records: [row] })
    expect(unknown.detail(row.id, {}, session).settlement.amounts).toMatchObject({ paid: null, unpaid: null })
  })
  it('失效合同或错配事实不能继续产生可申请及已付金额，真实空集合为零而未知集合为 null', () => {
    const record = { id: 'settlement', version: 1, workspaceId: session.workspaceId, migrationBatchId: null, draft: { ...command().draft, supplierId: 's1', status: 'confirmed' }, attachments: [], audit: { createdAt: null, updatedAt: null, createdBy: null, updatedBy: null, responsible: null, department: null }, facts: [] }
    const service = createOtherSettlementInstance({ identities: () => ({ projects: [], suppliers: [], contracts: [] }), records: [record] })
    expect(service.detail(record.id, {}, session).settlement.amounts).toMatchObject({ total: '1060.00', applied: null, paid: null, applicable: null, unpaid: null })
  })
  it('只选择同项目非草稿真实其他支出合同，保存后读回稳定关系并幂等保护版本', async () => {
    const service = setup()
    expect(service.context(session).contracts.map(row => row.id)).toEqual(['c1'])
    const saved = await service.execute(command(), session)
    expect(await service.execute(command(), session)).toEqual(saved)
    expect(service.detail(saved.id, { origin: 'real' }, session).settlement).toMatchObject({ id: saved.id, draft: { contractId: 'c1', projectId: 'p1', supplierId: 's1', totalAmount: 1060 }, amounts: { total: '1060.00', taxExclusive: '1000.00', tax: '60.00' } })
    expect(service.list({}, session).pagination.total).toBe(1)
    await expect(service.execute(command({ id: saved.id, commandId: 'stale', baseVersion: '0' }), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    for (const contractId of ['draft', 'wrong', 'missing'])
      await expect(service.execute(command({ commandId: contractId, draft: { ...command().draft, contractId } }), session)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
  })
})
