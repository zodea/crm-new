import { afterEach, describe, expect, it } from 'vitest'
import { decodeCustomerDetailRead } from '~/lib/customer/repository'
import { prepareConstructionContractChainIdentityFixtures } from '../../server/utils/construction-contract-chain-test-fixture'
import { CONSTRUCTION_CONTRACT_EXISTING_RECORD, constructionContractCommandTestInstance } from '../../server/utils/construction-contract-command-test-instance'
import { customerCommandTestInstance } from '../../server/utils/customer-command-test-instance'
import { customerReadTestInstance } from '../../server/utils/customer-read-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from '../../server/utils/owner-commercial-document-fixtures'
import { ownerCommercialDocumentReadTestInstance } from '../../server/utils/owner-commercial-document-read-test-instance'
import { projectCommandTestInstance } from '../../server/utils/project-command-test-instance'
import { supplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'

const scopes = ['customer-receipt-source', 'customer-receipt-other']
const query = { origin: 'real', includeDemo: 'false' }
const customerId = 'customer-real-320'

afterEach(() => {
  for (const scope of scopes) {
    customerCommandTestInstance.reset(scope)
    constructionContractCommandTestInstance.reset(scope)
    customerReadTestInstance.reset('ready', scope)
    ownerCommercialDocumentCommandTestInstance.reset(scope)
    ownerCommercialDocumentReadTestInstance.reset('ready', scope)
    projectCommandTestInstance.reset(scope)
    supplierCommandTestInstance.reset(scope)
  }
})

describe('客户收款只读取当前会话的中央事实', () => {
  it.each(['forbidden', 'unavailable'] as const)('正式收款源 %s 不影响独立演示收款', async (scenario) => {
    const scope = scopes[0]
    const demoQuery = { origin: 'demo', includeDemo: 'true' }
    const before = await customerReadTestInstance.detail('customer_demo_001', demoQuery, scope)
    expect(before.receipts.length).toBeGreaterThan(0)
    ownerCommercialDocumentReadTestInstance.reset(scenario, scope)
    const after = await customerReadTestInstance.detail('customer_demo_001', demoQuery, scope)
    expect(after.receiptsProblem).toBeUndefined()
    expect(after.receipts).toEqual(before.receipts)
    const receipt = await customerReadTestInstance.receipt('rr_mz0x1_0', { ...demoQuery, customerId: 'customer_demo_001' }, scope)
    expect(receipt.receipt.receipt.id).toBe('rr_mz0x1_0')
  })

  it('源记录隐藏客户关系时不反向泄露收款，恢复关联权限后再回读', async () => {
    const scope = scopes[0]
    prepareConstructionContractChainIdentityFixtures(scope)
    const source = OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS.find(row => row.kind === 'final_settlement')!
    ownerCommercialDocumentCommandTestInstance.importExisting([{ ...source, customerPermission: 'forbidden' }], scope)
    const hidden = await customerReadTestInstance.detail(customerId, query, scope)
    expect(hidden.receipts).toEqual([])
    expect(hidden.summary.effectiveReceiptAmount).toBe('0.00')
    await expect(customerReadTestInstance.receipt('receipt-real-325', { ...query, customerId }, scope)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    ownerCommercialDocumentCommandTestInstance.reset(scope)
    ownerCommercialDocumentCommandTestInstance.importExisting([source], scope)
    expect((await customerReadTestInstance.detail(customerId, query, scope)).receipts).toHaveLength(1)
  })

  it('可读收款保留受限项目和合同的权限态，不从独立可读关系补出关联', async () => {
    const scope = scopes[0]
    prepareConstructionContractChainIdentityFixtures(scope)
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], scope)
    const source = OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS.find(row => row.kind === 'final_settlement')!
    ownerCommercialDocumentCommandTestInstance.importExisting([{ ...source, projectPermission: 'forbidden', contractPermission: 'forbidden' }], scope)
    const detail = decodeCustomerDetailRead(await customerReadTestInstance.detail(customerId, query, scope))
    expect(detail.receipts[0]).toMatchObject({ project: { state: 'forbidden', id: null }, contract: { state: 'forbidden', id: null } })
    expect(detail.projects[0]).toMatchObject({ receiptCount: 0, effectiveReceiptAmount: '0.00' })
  })

  it('只有客户身份时不出现固定正式收款；已导入会话与其他会话隔离', async () => {
    for (const scope of scopes)
      prepareConstructionContractChainIdentityFixtures(scope)

    const empty = await customerReadTestInstance.detail(customerId, query, scopes[0])
    expect(empty.receipts).toEqual([])
    expect(empty.summary).toMatchObject({ receiptCount: 0, effectiveReceiptAmount: '0.00' })

    ownerCommercialDocumentCommandTestInstance.importExisting(OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS, scopes[0])
    const imported = await customerReadTestInstance.detail(customerId, query, scopes[0])
    expect(imported.receipts.map(row => row.receipt.id)).toEqual(['receipt-real-325'])
    expect(imported.summary.effectiveReceiptAmount).toBe('900000.00')
    expect(imported.sourceVersion).not.toBe(empty.sourceVersion)
    expect((await customerReadTestInstance.detail(customerId, query, scopes[1])).receipts).toEqual([])

    ownerCommercialDocumentCommandTestInstance.reset(scopes[0])
    const removed = await customerReadTestInstance.detail(customerId, query, scopes[0])
    expect(removed.receipts).toEqual([])
    await expect(customerReadTestInstance.receipt('receipt-real-325', { ...query, customerId }, scopes[0]))
      .rejects
      .toMatchObject({ problem: { code: 'not-found' } })
  })

  it.each(['forbidden', 'unavailable'] as const)('收款源 %s 保留客户与其他关系，收款及依赖差额未知，恢复后回读', async (scenario) => {
    const scope = scopes[0]
    prepareConstructionContractChainIdentityFixtures(scope)
    constructionContractCommandTestInstance.importExisting([CONSTRUCTION_CONTRACT_EXISTING_RECORD], scope)
    ownerCommercialDocumentCommandTestInstance.importExisting(OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS, scope)
    ownerCommercialDocumentReadTestInstance.reset(scenario, scope)
    const detail = await customerReadTestInstance.detail(customerId, query, scope)
    expect(decodeCustomerDetailRead(detail)).toEqual(detail)
    expect(detail.customer.id).toBe(customerId)
    expect(detail.receiptsProblem?.code).toBe(scenario)
    expect(detail.receipts).toEqual([])
    expect(detail.summary).toMatchObject({ receiptCount: null, effectiveReceiptAmount: null, draftReceiptCount: null, outstandingAmount: null })
    expect(detail.projects[0]).toMatchObject({ receiptCount: null, effectiveReceiptAmount: null })
    expect(detail.contracts[0]).toMatchObject({ receiptAmount: null, outstandingAmount: null })
    expect(() => decodeCustomerDetailRead({ ...detail, summary: { ...detail.summary, receiptCount: 0 } })).toThrow()
    expect(() => decodeCustomerDetailRead({ ...detail, summary: { ...detail.summary, effectiveReceiptAmount: '0.00' } })).toThrow()
    expect(JSON.stringify(detail)).not.toContain('receipt-real-325')
    await expect(customerReadTestInstance.receipt('receipt-real-325', { ...query, customerId }, scope))
      .rejects
      .toMatchObject({ problem: { code: scenario } })
    expect((await customerReadTestInstance.list({}, scope)).items).toHaveLength(1)
    ownerCommercialDocumentReadTestInstance.reset('ready', scope)
    expect((await customerReadTestInstance.detail(customerId, query, scope)).summary.effectiveReceiptAmount).toBe('900000.00')
  })

  it('同一收款被多张最终结算引用只计一次，收款详情与客户金额一致', async () => {
    const scope = scopes[0]
    prepareConstructionContractChainIdentityFixtures(scope)
    const source = OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS.find(row => row.kind === 'final_settlement')!
    ownerCommercialDocumentCommandTestInstance.importExisting([source, { ...source, id: 'another-final-settlement', no: 'JS-SECOND' }], scope)
    const detail = decodeCustomerDetailRead(await customerReadTestInstance.detail(customerId, query, scope))
    expect(detail.summary).toMatchObject({ receiptCount: 1, effectiveReceiptAmount: '900000.00' })
    const receipt = await customerReadTestInstance.receipt('receipt-real-325', { ...query, customerId }, scope)
    expect(receipt.receipt.amount).toBe('900000.00')
    expect(receipt.receipt.payerAccount).toBe('')
    expect(receipt.sourceVersion).toBe(detail.sourceVersion)
  })
})
