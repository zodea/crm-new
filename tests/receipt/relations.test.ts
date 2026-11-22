import { afterEach, describe, expect, it } from 'vitest'
import { decodeConstructionContractDetailRead } from '../../app/lib/construction-contract/repository'
import { decodeCustomerDetailRead } from '../../app/lib/customer/repository'
import { emptyReceiptDraft } from '../../app/lib/receipt/contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { CONSTRUCTION_PROJECT_FIXTURE, prepareConstructionContractChainIdentityFixtures } from '../../server/utils/construction-contract-chain-test-fixture'
import { CONSTRUCTION_CONTRACT_EXISTING_RECORD, constructionContractCommandTestInstance } from '../../server/utils/construction-contract-command-test-instance'
import { constructionContractReadTestInstance } from '../../server/utils/construction-contract-read-test-instance'
import { customerCommandTestInstance } from '../../server/utils/customer-command-test-instance'
import { customerReadTestInstance } from '../../server/utils/customer-read-test-instance'
import { createOwnerCommercialDocumentCommandTestInstance, ownerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from '../../server/utils/owner-commercial-document-fixtures'
import { createOwnerCommercialDocumentReadTestInstance, ownerCommercialDocumentReadTestInstance } from '../../server/utils/owner-commercial-document-read-test-instance'
import { projectCommandTestInstance } from '../../server/utils/project-command-test-instance'
import { projectReadTestInstance } from '../../server/utils/project-read-test-instance'
import { receiptCommandTestInstance } from '../../server/utils/receipt-command-service'
import { receiptReadTestInstance } from '../../server/utils/receipt-read-test-instance'
import { supplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'

const scope = 'receipt-independent-relations'
const session = resolveBusinessSession()
const customerId = 'customer-real-320'
const query = { origin: 'real', includeDemo: false }

afterEach(() => {
  receiptCommandTestInstance.reset(scope)
  receiptReadTestInstance.reset('ready', scope)
  customerCommandTestInstance.reset(scope)
  projectCommandTestInstance.reset(scope)
  supplierCommandTestInstance.reset(scope)
  constructionContractCommandTestInstance.reset(scope)
  ownerCommercialDocumentReadTestInstance.reset('ready', scope)
  ownerCommercialDocumentCommandTestInstance.reset(scope)
})

describe('普通收款的独立中央关联事实', () => {
  it('项目收入读取同一普通收款源，草稿不累计，收款不可读时变未知', async () => {
    prepareConstructionContractChainIdentityFixtures(scope)
    const saved = receiptCommandTestInstance.execute({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'receipt:write', commandId: 'project-income', baseVersion: null, origin: 'real', action: 'submit', attachments: {}, draft: { ...emptyReceiptDraft(), projectId: 'project-real-320', customerId, receiptDate: '2026-09-11', amount: '12.35' } }, session, scope)
    const after = await projectReadTestInstance.detail('project-real-320', query, scope)
    expect(after.item.income.value).toBe('12.35')
    receiptCommandTestInstance.execute({ id: saved.id, workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'receipt:write', commandId: 'project-draft', baseVersion: saved.version, origin: 'real', action: 'draft', attachments: {}, draft: receiptCommandTestInstance.form(saved.id, session, scope).draft }, session, scope)
    expect((await projectReadTestInstance.detail('project-real-320', query, scope)).item.income.value).toBe('0.00')
    receiptReadTestInstance.reset('unavailable', scope)
    expect((await projectReadTestInstance.detail('project-real-320', query, scope)).item.income).toMatchObject({ value: null, missingSources: ['receipt-registrations:unavailable'] })
  })
  it('收款详情与列表使用施工合同同一变更后金额、累计及开票未收款指标', async () => {
    prepareConstructionContractChainIdentityFixtures(scope)
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], scope)
    const document = OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS.find(row => row.kind === 'final_settlement')!
    ownerCommercialDocumentCommandTestInstance.importExisting([document], scope)
    const saved = receiptCommandTestInstance.execute({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'receipt:write', commandId: 'metric-receipt', baseVersion: null, origin: 'real', action: 'submit', attachments: {}, draft: { ...emptyReceiptDraft(), projectId: document.projectId, customerId: document.customerId, contractId: document.contractId, receiptDate: '2026-09-11', amount: '12.35' } }, session, scope)
    const contract = constructionContractReadTestInstance.detail(document.contractId!, query, scope).contract
    expect(contract.amounts.changed).not.toBe(contract.amounts.contract)
    for (const detail of [await receiptReadTestInstance.detail(saved.id, query, scope), (await receiptReadTestInstance.list(query, scope)).items[0]!]) {
      expect(detail.amounts).toMatchObject({ contractOriginal: contract.amounts.contract, contract: contract.amounts.changed, contractChange: '80000.00', cumulativeReceipt: contract.amounts.received, cumulativeReceiptExcludingCurrent: '0.00', invoicedUnreceived: contract.amounts.invoicedUnreceived })
    }
  })

  it('新中央项目与施工合同可在最终结算选择，普通收款按当前身份进入该合同结算', () => {
    prepareConstructionContractChainIdentityFixtures(scope)
    const projectId = 'new-project-436'
    const contractId = 'new-contract-436'
    projectCommandTestInstance.prepareImportedProjects([{ ...CONSTRUCTION_PROJECT_FIXTURE, id: projectId, name: '新中央项目' }], scope).commit()
    constructionContractCommandTestInstance.importExisting([{ ...CONSTRUCTION_CONTRACT_EXISTING_RECORD, id: contractId, draft: { ...CONSTRUCTION_CONTRACT_EXISTING_RECORD.draft, id: contractId, projectId, amount: 1000 } }], scope)
    const commands = createOwnerCommercialDocumentCommandTestInstance({
      strictSources: true,
      projectSource: projectCommandTestInstance,
      customerSource: customerCommandTestInstance,
      constructionContractSource: constructionContractCommandTestInstance,
      receiptSource: sessionId => receiptReadTestInstance.facts(sessionId),
      finalSettlementChanges: (id, sessionId) => id === contractId && sessionId === scope ? [] : null,
    })
    const read = createOwnerCommercialDocumentReadTestInstance(() => session.capabilities, commands)
    const context = commands.context(session, scope, 'final_settlement')
    expect(context.projects).toContainEqual(expect.objectContaining({ id: projectId }))
    expect(context.contracts).toContainEqual(expect.objectContaining({ id: contractId, projectId, changedContractAmount: 1000, receivedAmount: 0 }))
    const first = receiptCommandTestInstance.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'receipt:write',
      commandId: 'new-settlement-receipt',
      baseVersion: null,
      origin: 'real',
      action: 'submit',
      draft: { ...emptyReceiptDraft(), projectId, customerId, contractId, receiptDate: '2026-09-11', amount: '12.35' },
      attachments: {},
    }, session, scope)
    const document = { ...OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS.find(row => row.kind === 'final_settlement')!, id: 'new-final-436', projectId, contractId }
    commands.importExisting([document], scope)
    const detail = read.detail('final_settlement', document.id, query, scope)
    expect(detail.document.amounts.cumulativeReceipts).toBe('12.35')
    expect(detail.document.amounts.changedContract).toBe('1000.00')
    expect(commands.rows(scope).find(row => row.id === document.id)?.finalSettlementEvidence?.changes).toEqual([])
    expect(detail.finalSettlementEvidence?.sourceStates).toEqual({ supplements: 'readable', changes: 'readable', receipts: 'readable' })
    expect(detail.finalSettlementEvidence?.sources?.filter(row => row.kind === 'receipt').map(row => row.id)).toEqual([first.id])
  })

  it('最终结算引用同一普通收款，修改与来源故障同步反映且不回落固定正式样例', () => {
    prepareConstructionContractChainIdentityFixtures(scope)
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], scope)
    const document = OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS.find(row => row.kind === 'final_settlement')!
    ownerCommercialDocumentCommandTestInstance.importExisting([document], scope)
    const first = receiptCommandTestInstance.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'receipt:write',
      commandId: 'settlement-receipt',
      baseVersion: null,
      origin: 'real',
      action: 'submit',
      draft: { ...emptyReceiptDraft(), no: 'SK-SAME', projectId: 'project-real-320', customerId, contractId: CONSTRUCTION_CONTRACT_EXISTING_RECORD.id, receiptDate: '2026-09-11', amount: '12.35' },
      attachments: {},
    }, session, scope)
    const detail = ownerCommercialDocumentReadTestInstance.detail('final_settlement', document.id, query, scope)
    expect(detail.document.amounts.cumulativeReceipts).toBe('12.35')
    expect(detail.finalSettlementEvidence?.sources?.filter(row => row.kind === 'receipt').map(row => row.id)).toEqual([first.id])
    const record = receiptCommandTestInstance.form(first.id, session, scope)
    receiptCommandTestInstance.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'receipt:write',
      commandId: 'edit-settlement-receipt',
      id: first.id,
      baseVersion: first.version,
      origin: 'real',
      action: 'save',
      draft: { ...record.draft, amount: '22.35' },
      attachments: {},
    }, session, scope)
    const updated = ownerCommercialDocumentReadTestInstance.detail('final_settlement', document.id, query, scope)
    expect(updated.document.amounts.cumulativeReceipts).toBe('22.35')
    expect(updated.sourceVersion).not.toBe(detail.sourceVersion)
    receiptReadTestInstance.reset('forbidden', scope)
    const restricted = ownerCommercialDocumentReadTestInstance.detail('final_settlement', document.id, query, scope)
    expect(restricted.document.amounts.cumulativeReceipts).toBeNull()
    expect(JSON.stringify(restricted)).not.toContain(first.id)
    expect(restricted.finalSettlementEvidence).toMatchObject({ receiptsProblem: { code: 'forbidden' } })
  })

  it('施工合同累计收款和客户余额随普通收款更新，收款源故障保留合同并清除依赖金额', async () => {
    prepareConstructionContractChainIdentityFixtures(scope)
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], scope)
    const contractId = CONSTRUCTION_CONTRACT_EXISTING_RECORD.id
    const before = constructionContractReadTestInstance.detail(contractId, query, scope)
    const saved = receiptCommandTestInstance.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'receipt:write',
      commandId: 'contract-receipt',
      baseVersion: null,
      origin: 'real',
      action: 'submit',
      draft: { ...emptyReceiptDraft(), no: 'SK-CONTRACT', projectId: 'project-real-320', customerId, contractId, receiptDate: '2026-09-11', amount: '12.35' },
      attachments: {},
    }, session, scope)
    const after = decodeConstructionContractDetailRead(constructionContractReadTestInstance.detail(contractId, query, scope))
    expect(after.contract.amounts.received).toBe('12.35')
    expect(after.sections.receipts.map(row => row.id)).toEqual([saved.id])
    expect(after.sourceVersion).not.toBe(before.sourceVersion)
    expect((await customerReadTestInstance.detail(customerId, query, scope)).contracts[0]?.receiptAmount).toBe('12.35')
    receiptReadTestInstance.reset('unavailable', scope)
    const unavailable = decodeConstructionContractDetailRead(constructionContractReadTestInstance.detail(contractId, query, scope))
    expect(unavailable).toMatchObject({ contract: { id: contractId, amounts: { received: null, bySettlementReceivable: null, invoicedUnreceived: null } }, sections: { receipts: [] }, receiptsProblem: { code: 'unavailable' } })
    expect(unavailable.contract.amounts.contract).toBe(after.contract.amounts.contract)
  })

  it('客户能看到已登记草稿，空金额与明确零分别保留且均不计有效收款', async () => {
    prepareConstructionContractChainIdentityFixtures(scope)
    for (const [commandId, amount] of [['empty', null], ['zero', '0.00']] as const) {
      receiptCommandTestInstance.execute({
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        requiredCapability: 'receipt:write',
        commandId,
        baseVersion: null,
        origin: 'real',
        action: 'draft',
        draft: { ...emptyReceiptDraft(), no: commandId, customerId, projectId: 'project-real-320', amount },
        attachments: {},
      }, session, scope)
    }
    const detail = decodeCustomerDetailRead(await customerReadTestInstance.detail(customerId, query, scope))
    expect(detail.receipts.map(row => ({ no: row.receipt.no, amount: row.amount, effective: row.effectiveAmount }))).toEqual([
      { no: 'empty', amount: null, effective: '0.00' },
      { no: 'zero', amount: '0.00', effective: '0.00' },
    ])
    expect(detail.summary).toMatchObject({ receiptCount: 2, draftReceiptCount: 2, effectiveReceiptAmount: '0.00' })
  })

  it('没有最终结算文档也进入客户收款，结算服务失败不撤回普通收款', async () => {
    prepareConstructionContractChainIdentityFixtures(scope)
    const before = await customerReadTestInstance.detail(customerId, query, scope)
    const saved = receiptCommandTestInstance.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: 'receipt:write',
      commandId: 'ordinary-receipt',
      baseVersion: null,
      origin: 'real',
      action: 'submit',
      draft: { ...emptyReceiptDraft(), no: 'SK-CENTRAL', projectId: 'project-real-320', customerId, receiptDate: '2026-09-11', amount: '12.35', payerAccount: '62220001', paymentMethod: '银行转账' },
      attachments: {},
    }, session, scope)
    const after = await customerReadTestInstance.detail(customerId, query, scope)
    expect(after.receipts).toEqual([expect.objectContaining({ receipt: expect.objectContaining({ id: saved.id }), amount: '12.35', payerAccount: '62220001', paymentMethod: '银行转账' })])
    expect(after.summary.effectiveReceiptAmount).toBe('12.35')
    expect(after.sourceVersion).not.toBe(before.sourceVersion)
    ownerCommercialDocumentReadTestInstance.reset('unavailable', scope)
    const independent = await customerReadTestInstance.detail(customerId, query, scope)
    expect(independent.receiptsProblem).toBeUndefined()
    expect(independent.receipts).toEqual(after.receipts)
    const direct = await customerReadTestInstance.receipt(saved.id, { ...query, customerId }, scope)
    expect(direct.receipt.amount).toBe('12.35')
  })
})
