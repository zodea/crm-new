import { afterEach, describe, expect, it, vi } from 'vitest'
import { auxiliaryContractInstance, resetAuxiliaryContractInstance } from '../../server/utils/auxiliary-contract-runtime'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { MATERIAL_CONTRACT_CHAIN_SUPPLIER, prepareMaterialContractChainIdentityFixtures } from '../../server/utils/material-contract-chain-test-fixture'
import { MATERIAL_CONTRACT_EXISTING_RECORD, materialContractCommandTestInstance } from '../../server/utils/material-contract-command-test-instance'
import { materialContractReadTestInstance } from '../../server/utils/material-contract-read-test-instance'
import { otherSettlementInstance, resetOtherSettlementInstance } from '../../server/utils/other-settlement-runtime'
import { ownerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { ownerCommercialDocumentReadTestInstance } from '../../server/utils/owner-commercial-document-read-test-instance'
import { projectCommandTestInstance } from '../../server/utils/project-command-test-instance'
import { createProjectReadTestInstance, projectReadTestInstance } from '../../server/utils/project-read-test-instance'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { subcontractContractCommandTestInstance } from '../../server/utils/subcontract-contract-command-test-instance'
import { supplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'
import { loadTargetCostActual } from '../../server/utils/target-cost-actual-sources'
import { targetCostProjectSource, targetCostService } from '../../server/utils/target-cost-runtime'
import { prepareVerifiedSignatory } from '../helpers/verified-signatory'

const sessionId = 'target-cost-runtime'
afterEach(async () => {
  vi.restoreAllMocks()
  projectCommandTestInstance.reset(sessionId)
  supplierCommandTestInstance.reset(sessionId)
  materialContractCommandTestInstance.reset(sessionId)
  materialContractReadTestInstance.reset('ready', sessionId)
  projectReadTestInstance.reset('ready', sessionId)
  subcontractContractCommandTestInstance.reset()
  ownerCommercialDocumentCommandTestInstance.reset(sessionId)
  await quantityTestInstance.close()
  await resetAuxiliaryContractInstance(sessionId, 'empty')
  await resetOtherSettlementInstance(sessionId, 'empty')
})
describe('预算实际中央来源与公开项目选项', () => {
  it('合同后来作废只移除当前签约金额，已确认结算和有明确分摊的真实支付仍按历史源保留', async () => {
    prepareMaterialContractChainIdentityFixtures(sessionId)
    const session = resolveBusinessSession()
    const adoption = await prepareVerifiedSignatory(sessionId, '历史结算已采用主体')
    const draft = { ...adoption, name: '原专业合同', projectId: 'project-real-318', supplierId: 'supplier-real-318', subKind: '专业', content: '原范围', signDate: '2026-09-01', amount: 1000 }
    const contract = await subcontractContractCommandTestInstance.execute({ ...session, requiredCapability: 'subcontract-contract:write', commandId: 'historical-contract', baseVersion: null, action: 'submit', draft, attachments: {} }, session, sessionId)
    const settlement = await ownerCommercialDocumentCommandTestInstance.execute({ ...session, requiredCapability: 'subcontract-document:write', commandId: 'historical-settlement', kind: 'sub_settlement', action: 'submit', baseVersion: null, draft: { name: '原确认结算', projectId: draft.projectId, supplierId: draft.supplierId, contractId: contract.id, settlementType: '过程结算', totalAmount: 300, settlementDate: '2026-09-02' }, attachments: {} }, session, sessionId)
    // 支付链尚未由此测试 owner 接管；下游源提供独立的既有确认回单及精确结算分摊。
    const readFacts = ownerCommercialDocumentReadTestInstance.facts.bind(ownerCommercialDocumentReadTestInstance)
    vi.spyOn(ownerCommercialDocumentReadTestInstance, 'facts').mockImplementation((kind, currentSessionId) => {
      const facts = readFacts(kind, currentSessionId)
      return { ...facts, documents: facts.documents.map(row => row.id !== settlement.id
        ? row
        : {
            ...row,
            subcontractSettlementEvidence: { ...row.subcontractSettlementEvidence!, applications: [{ id: 'historical-application', projectId: draft.projectId, supplierId: draft.supplierId, contractId: contract.id, status: 'paid', allocations: [{ settlementId: settlement.id, amount: 300 }], payments: [{ id: 'historical-confirmed-payment', amount: 120, confirmed: true }] }] },
          }) }
    })
    expect((await loadTargetCostActual(draft.projectId, sessionId)).categories.find(row => row.category === '专业分包')).toMatchObject({ signedAmount: { value: 1000 }, settledAmount: { value: 300 }, paidAmount: { value: 120 } })
    await subcontractContractCommandTestInstance.execute({ ...session, id: contract.id, requiredCapability: 'subcontract-contract:write', commandId: 'void-historical-contract', baseVersion: contract.version, action: 'save', draft: { ...draft, status: '已作废' }, attachments: {} }, session, sessionId)
    expect((await loadTargetCostActual(draft.projectId, sessionId)).categories.find(row => row.category === '专业分包')).toMatchObject({ signedAmount: { value: 0, status: 'complete' }, settledAmount: { value: 300, status: 'complete' }, paidAmount: { value: 120, status: 'complete' } })
    expect(ownerCommercialDocumentCommandTestInstance.rows(sessionId).find(row => row.id === settlement.id)).toMatchObject({ contractId: contract.id, status: 'confirmed', amount: 300 })
  })
  it('真实分包确认结算在供应方失效后只保留其他合法结算的已知金额', async () => {
    prepareMaterialContractChainIdentityFixtures(sessionId)
    supplierCommandTestInstance.prepareImportedSuppliers([{ ...MATERIAL_CONTRACT_CHAIN_SUPPLIER, id: 'sub-gone', name: '待删除分包商' }], sessionId).commit()
    const session = resolveBusinessSession()
    const adoption = await prepareVerifiedSignatory(sessionId, '预算来源验收已核实我方主体')
    for (const [supplierId, amount] of [['supplier-real-318', 300], ['sub-gone', 700]] as const) {
      const contract = await subcontractContractCommandTestInstance.execute({ ...session, commandId: `sub-contract-${supplierId}`, requiredCapability: 'subcontract-contract:write', baseVersion: null, action: 'submit', draft: { ...adoption, name: '专业合同', projectId: 'project-real-318', supplierId, subKind: '专业', content: '已定范围', signDate: '2026-09-01', amount }, attachments: {} }, session, sessionId)
      await ownerCommercialDocumentCommandTestInstance.execute({ ...session, requiredCapability: 'subcontract-document:write', commandId: `sub-settlement-${supplierId}`, kind: 'sub_settlement', action: 'submit', baseVersion: null, draft: { name: '专业结算', projectId: 'project-real-318', supplierId, contractId: contract.id, settlementType: '过程结算', totalAmount: amount, settlementDate: '2026-09-02' }, attachments: {} }, session, sessionId)
    }
    expect((await loadTargetCostActual('project-real-318', sessionId)).categories.find(row => row.category === '专业分包')?.settledAmount).toMatchObject({ value: 1000, status: 'complete' })
    supplierCommandTestInstance.reset(sessionId)
    supplierCommandTestInstance.prepareImportedSuppliers([MATERIAL_CONTRACT_CHAIN_SUPPLIER], sessionId).commit()
    expect((await loadTargetCostActual('project-real-318', sessionId)).categories.find(row => row.category === '专业分包')?.settledAmount).toMatchObject({ value: null, knownValue: 300, status: 'partial' })
  })
  it('真实材采合同承诺9600与尚未接管结算/实付分开，供应方缺失后转未知而非保旧金额', async () => {
    prepareMaterialContractChainIdentityFixtures(sessionId)
    materialContractCommandTestInstance.importExisting([MATERIAL_CONTRACT_EXISTING_RECORD], sessionId)
    const first = await loadTargetCostActual('project-real-318', sessionId)
    expect(first.categories.find(row => row.category === '材料')).toMatchObject({ signedAmount: { value: 9600, status: 'complete' }, settledAmount: { value: null, status: 'pending' }, paidAmount: { value: null, status: 'pending' } })
    supplierCommandTestInstance.reset(sessionId)
    const missing = await loadTargetCostActual('project-real-318', sessionId)
    expect(missing.categories.find(row => row.category === '材料')?.signedAmount.value).toBeNull()
    expect(missing.sourceVersion).not.toBe(first.sourceVersion)
  })
  it('来源读取无权返回unknown；工程量为空不阻止预算项目，lookup无权不泄露目录', async () => {
    prepareMaterialContractChainIdentityFixtures(sessionId)
    materialContractCommandTestInstance.importExisting([MATERIAL_CONTRACT_EXISTING_RECORD], sessionId)
    materialContractReadTestInstance.reset('forbidden', sessionId)
    expect((await loadTargetCostActual('project-real-318', sessionId)).categories.find(row => row.category === '材料')?.signedAmount).toMatchObject({ value: null, knownValue: null, status: 'pending' })
    projectReadTestInstance.reset('forbidden', sessionId)
    const source = targetCostProjectSource(sessionId)
    expect(source.projects.map(row => row.id)).toContain('project-real-318')
    expect(source.options).toEqual([])
    expect(source.optionsStatus).toBe('forbidden')
    const read = await targetCostService.form({ origin: 'real' }, null, 'empty-quantity', sessionId)
    expect(read.projects).toEqual([])
    const saved = await targetCostService.execute({ workspaceId: read.context.workspaceId, actorId: read.context.actorId, commandId: 'budget-existing-project', requiredCapability: 'target-cost:write', origin: 'real', targetCostId: null, draftKey: 'empty-quantity', sourceVersion: read.context.sourceVersion, action: { kind: 'save-header', saveAction: 'draft', draft: { projectId: 'project-real-318', name: '已有选择的草稿' } } }, sessionId)
    expect((await targetCostService.detail({ origin: 'real' }, saved.id, sessionId)).view.header.projectId).toBe('project-real-318')
  })
  it('预算独立能力可取完整内部资格；项目public facts仍严格拒绝', () => {
    const source = createProjectReadTestInstance(() => ['target-cost:read'])
    expect(() => source.facts()).toThrow('权限')
    expect(source.identities().rows.length).toBeGreaterThan(0)
  })
  it('一份已确认结算的分供方失效，不保旧金额且不吞另一份合法已知部分', async () => {
    prepareMaterialContractChainIdentityFixtures(sessionId)
    supplierCommandTestInstance.prepareImportedSuppliers([{ ...MATERIAL_CONTRACT_CHAIN_SUPPLIER, id: 'gone-supplier', name: '随后不可用' }], sessionId).commit()
    const session = resolveBusinessSession()
    for (const [supplierId, amount] of [['supplier-real-318', 300], ['gone-supplier', 700]] as const) {
      const contract = await auxiliaryContractInstance(sessionId).execute({ ...session, requiredCapability: 'auxiliary-contract:write', commandId: `contract-${supplierId}`, baseVersion: null, action: 'submit', draft: { kind: 'other_expense', name: '检测合同', projectId: 'project-real-318', supplierId, category: '检测服务', signDate: '2026-09-01', amount }, attachments: {} }, session)
      const draft = { name: '检测结算', projectId: 'project-real-318', contractId: contract.id, settlementDate: '2026-09-02', totalAmount: amount }
      const submitted = await otherSettlementInstance(sessionId).execute({ ...session, requiredCapability: 'other-settlement:write', commandId: `submit-${supplierId}`, baseVersion: null, action: 'submit', draft, attachments: {} }, session)
      await otherSettlementInstance(sessionId).execute({ ...session, requiredCapability: 'other-settlement:write', commandId: `confirm-${supplierId}`, id: submitted.id, baseVersion: submitted.version, action: 'confirm', draft, attachments: {} }, session)
    }
    const first = await loadTargetCostActual('project-real-318', sessionId)
    expect(first.categories.find(row => row.category === '其他')?.settledAmount).toMatchObject({ value: 1000, status: 'complete' })
    supplierCommandTestInstance.reset(sessionId)
    supplierCommandTestInstance.prepareImportedSuppliers([MATERIAL_CONTRACT_CHAIN_SUPPLIER], sessionId).commit()
    const second = await loadTargetCostActual('project-real-318', sessionId)
    expect(second.categories.find(row => row.category === '其他')?.settledAmount).toMatchObject({ value: null, knownValue: 300, status: 'partial' })
  })
})
