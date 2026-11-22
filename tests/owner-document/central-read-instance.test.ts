import { describe, expect, it } from 'vitest'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from '../../server/utils/owner-commercial-document-fixtures'
import { createOwnerCommercialDocumentReadTestInstance } from '../../server/utils/owner-commercial-document-read-test-instance'

describe('甲方商务单据中央读取实例', () => {
  it('ready 场景隔离各类正式记录并返回结算与罚扣真实事实', () => {
    const commands: ReturnType<typeof createOwnerCommercialDocumentCommandTestInstance> = createOwnerCommercialDocumentCommandTestInstance({
      documents: OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS,
      finalSettlementChanges: contractId => commands.rawRows().filter(row => row.kind === 'owner_change' && row.contractId === contractId && row.dataOrigin === 'real'),
    })
    const read = createOwnerCommercialDocumentReadTestInstance(
      () => ['owner-document:read', 'owner-document:write'],
      commands,
    )

    const changes = read.list('owner_change', { origin: 'real', pageSize: 20 })
    const reports = read.list('owner_report', { origin: 'real', pageSize: 20 })
    const settlements = read.list('final_settlement', { origin: 'real', status: 'doing', pageSize: 20 })
    const penalties = read.list('owner_penalty', { origin: 'real', search: 'LX-2026-326', pageSize: 20 })
    expect(changes.items).toHaveLength(2)
    expect(reports.items).toHaveLength(1)
    expect(settlements.items).toHaveLength(1)
    expect(penalties.items).toEqual([
      expect.objectContaining({
        id: 'owner-penalty-real-326',
        kind: 'owner_penalty',
        amounts: { kind: 'owner_penalty', amount: '36000.00' },
        attachmentCount: 1,
      }),
    ])
    expect(settlements.items[0]?.amounts).toEqual({
      kind: 'final_settlement',
      declared: '1280000.00',
      audited: null,
      changedContract: '1292800.00',
      cumulativeReceipts: '900000.00',
      receiptDifference: '380000.00',
    })
    const settlement = read.detail('final_settlement', 'final-settlement-real-325', { origin: 'real' })
    expect(settlement.document.amounts.audited).toBeNull()
    expect(settlement.finalSettlementEvidence?.sources).toEqual([
      expect.objectContaining({ kind: 'contract-supplement', id: 'supplement-real-325' }),
      expect.objectContaining({ kind: 'owner-change', id: 'change-manual-real-323', amount: '12800.00' }),
      expect.objectContaining({ kind: 'receipt', id: 'receipt-real-325' }),
    ])
    expect(changes.items.map(row => [row.kind, row.id, row.project.id, row.contract.id])).toEqual([
      ['owner_change', 'change-manual-real-323', 'project-real-320', 'construction-contract-existing-320'],
      ['owner_change', 'change-real-323', 'project-real-320', 'construction-contract-existing-320'],
    ])
    expect(changes.summary.origins.real).toEqual({
      count: 2,
      reportedAmount: '13320.00',
      auditedAmount: null,
      taxInclusiveAmount: '13320.00',
      taxExclusiveAmount: null,
      appliedTaxExclusiveAmount: null,
      subcontractApprovedAmount: '0.00',
      differenceAmount: '0.00',
      amountCompleteness: {
        reportedAmount: { knownValue: '13320.00', missingCount: 0 },
        auditedAmount: { knownValue: '0.00', missingCount: 2 },
        taxInclusiveAmount: { knownValue: '13320.00', missingCount: 0 },
        taxExclusiveAmount: { knownValue: '0.00', missingCount: 2 },
        appliedTaxExclusiveAmount: { knownValue: '0.00', missingCount: 2 },
        subcontractApprovedAmount: { knownValue: '0.00', missingCount: 0 },
        differenceAmount: { knownValue: '0.00', missingCount: 0 },
      },
      subcontractActualApproved: { value: null, status: 'missing' },
    })
    expect(settlement.files).toContainEqual(expect.objectContaining({ fileName: '甲方最终结算书.pdf' }))
    expect(read.detail('owner_penalty', 'owner-penalty-real-326', { origin: 'real' })).toMatchObject({
      ownerPenaltyFacts: {
        noticeNo: 'LX-2026-326',
        penaltyDate: '2026-08-24',
        reason: '施工进度延误',
        appealNote: '已提交工期顺延说明',
      },
      files: [{ fileName: '甲方联系单.pdf', category: 'contact-letter' }],
      sourceNavigation: { filters: { ownerTab: 'settlements' } },
    })
    expect(read.detail('owner_report', 'report-real-323', { origin: 'real' }).files).toEqual([])
  })

  it('empty、forbidden、unavailable 与来源错配保持不同失败语义', () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance({ documents: OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS })
    const read = createOwnerCommercialDocumentReadTestInstance(() => ['owner-document:read', 'demo:read'], commands)

    read.reset('empty')
    expect(read.list('owner_change', { origin: 'real' }).items).toHaveLength(2)
    read.reset('forbidden')
    expect(() => read.list('owner_change', {})).toThrow('无甲方商务单据查看权限')
    read.reset('unavailable')
    expect(() => read.list('owner_change', {})).toThrow('中央读取服务暂时不可用')
    read.reset('ready')
    expect(() => read.detail('owner_change', 'change-real-323', { origin: 'demo', includeDemo: true }))
      .toThrow('来源与地址不匹配')
  })

  it('甲方与分包读取权限不能跨 capability 家族复用', () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance({ documents: OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS })
    const ownerOnly = createOwnerCommercialDocumentReadTestInstance(() => ['owner-document:read'], commands)
    expect(() => ownerOnly.list('sub_change', { origin: 'real' })).toThrow('无分包变洽签查看权限')

    const subcontractOnly = createOwnerCommercialDocumentReadTestInstance(() => ['subcontract-document:read'], commands)
    expect(subcontractOnly.list('sub_change', { origin: 'real' }).capabilities)
      .toContain('subcontract-document:read')
    expect(() => subcontractOnly.list('owner_change', { origin: 'real' })).toThrow('无甲方商务单据查看权限')
  })
})
