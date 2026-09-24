import type { OtherSettlementStored } from '../../server/utils/other-settlement-instance'
import { describe, expect, it } from 'vitest'
import { createAuxiliaryContractTestInstance } from '../../server/utils/auxiliary-contract-test-instance'
import { createOtherSettlementInstance } from '../../server/utils/other-settlement-instance'
import { projectSupplierFacts } from '../../server/utils/supplier-fact-source'

function sources(): Parameters<typeof projectSupplierFacts>[0] {
  const contract = { dataOrigin: 'real' as const, supplierId: 'supplier', projectId: 'project', no: '合同号', name: '合同名称', signDate: null, status: '生效' }
  return {
    material: [{ ...contract, id: 'material', kind: '材采', amount: 10, supplementAmount: 2 }],
    materialFacts: { settlements: [{ dataOrigin: 'real', id: 'material-settlement', contractId: 'material', no: '', name: '', amount: 8, date: null, status: 'confirmed' }] },
    subcontract: [{ ...contract, id: 'subcontract', kind: '分包', amount: 100 }],
    subcontractFacts: { supplements: [
      { dataOrigin: 'real', id: 'valid', contractId: 'subcontract', no: '', name: '', amount: 20, date: null, status: '生效' },
      { dataOrigin: 'real', id: 'draft', contractId: 'subcontract', no: '', name: '', amount: 900, date: null, status: '草稿' },
      { dataOrigin: 'real', id: 'cancelled', contractId: 'subcontract', no: '', name: '', amount: 800, date: null, status: 'cancelled' },
      { dataOrigin: 'demo', id: 'same-id', contractId: 'subcontract', no: '', name: '', amount: 700, date: null, status: '生效' },
    ] },
    auxiliary: [{ dataOrigin: 'real', id: 'other', kind: 'other_expense', draft: { kind: 'other_expense', supplierId: 'supplier', projectId: 'project', name: '其他合同', status: '生效' }, amounts: { contract: '30.00', changed: '35.00' } }],
    ownerDocuments: [
      { dataOrigin: 'real', id: 'sub-settlement', kind: 'sub_settlement', supplierId: 'supplier', projectId: 'project', contractId: 'subcontract', no: '', name: '', documentType: 'progress', amount: 40, applicationDate: null, status: 'confirmed' },
      { dataOrigin: 'real', id: 'wrong-supplier', kind: 'sub_settlement', supplierId: 'other-supplier', projectId: 'project', contractId: 'subcontract', no: '', name: '', documentType: 'progress', amount: 900, applicationDate: null, status: 'confirmed' },
      { dataOrigin: 'demo', id: 'wrong-origin', kind: 'sub_settlement', supplierId: 'supplier', projectId: 'project', contractId: 'subcontract', no: '', name: '', documentType: 'progress', amount: 900, applicationDate: null, status: 'confirmed' },
    ],
    otherSettlements: [{ dataOrigin: 'real', id: 'other-settlement', draft: { supplierId: 'supplier', projectId: 'project', contractId: 'other', status: 'confirmed' }, amounts: { total: '9.00' } }],
  }
}

describe('分供方跨领域事实投影', () => {
  it('只组合真实稳定关系下的材料、分包及其他支出，排除无效增补和错关系结算', () => {
    const result = projectSupplierFacts(sources())
    expect(result.contracts.map(row => [row.kind, row.amount, row.supplementAmount])).toEqual([
      ['材采', 10, 2],
      ['分包', 100, 20],
      ['other_expense', 30, 5],
    ])
    expect(result.settlements.map(row => [row.id, row.supplierId, row.totalAmount])).toEqual([
      ['material-settlement', 'supplier', 8],
      ['sub-settlement', 'supplier', 40],
      ['other-settlement', 'supplier', 9],
    ])
  })

  it('保留真实源单缺金额，不把未知增补或结算转成零', () => {
    const source = sources()
    source.subcontractFacts.supplements[0]!.amount = null
    source.auxiliary[0]!.amounts.changed = null
    source.otherSettlements[0]!.amounts.total = null
    const result = projectSupplierFacts(source)
    expect(result.contracts.find(row => row.kind === '分包')?.supplementAmount).toBeNull()
    expect(result.contracts.find(row => row.kind === 'other_expense')?.supplementAmount).toBeNull()
    expect(result.settlements.find(row => row.id === 'other-settlement')?.totalAmount).toBeNull()
  })

  it('新增未分页读源跟随保存且按 workspace 隔离，不把公司合同作为分供方合同', async () => {
    let nextId = 0
    const session = { workspaceId: 'workspace-a', actorId: 'actor', capabilities: ['auxiliary-contract:read', 'auxiliary-contract:write'] }
    const contracts = createAuxiliaryContractTestInstance({ createId: () => `contract-${++nextId}`, projects: [{ id: 'project', name: '项目' }], suppliers: [{ id: 'supplier', name: '分供方' }] })
    for (let index = 0; index < 105; index++) {
      await contracts.execute({ ...session, requiredCapability: 'auxiliary-contract:write', commandId: `create-${index}`, baseVersion: null, action: 'draft', draft: { kind: 'other_expense', supplierId: 'supplier', projectId: 'project' }, attachments: {} }, session)
    }
    await contracts.execute({ ...session, requiredCapability: 'auxiliary-contract:write', commandId: 'company', baseVersion: null, action: 'draft', draft: { kind: 'company_expense' }, attachments: {} }, session)
    const snapshot = contracts.supplierReadSource(session.workspaceId)
    expect(snapshot.rows).toHaveLength(105)
    expect(snapshot.rows.every(row => row.kind === 'other_expense')).toBe(true)
    expect(contracts.supplierReadSource('workspace-b').rows).toEqual([])
    const record: OtherSettlementStored = {
      id: 'settlement',
      workspaceId: session.workspaceId,
      version: 1,
      migrationBatchId: null,
      draft: { projectId: 'project', supplierId: 'supplier', contractId: 'contract-1', status: 'confirmed', totalAmount: null },
      attachments: [],
      facts: [],
      audit: { createdBy: null, updatedBy: null, createdAt: null, updatedAt: null, responsible: null, department: null },
    }
    const settlements = createOtherSettlementInstance({ records: [record], identities: () => ({ projects: [{ id: 'project', label: '项目' }], suppliers: [{ id: 'supplier', label: '分供方' }], contracts: [] }) })
    expect(settlements.supplierReadSource(session.workspaceId).rows[0]?.amounts.total).toBeNull()
    expect(settlements.supplierReadSource('workspace-b').rows).toEqual([])
  })
})
