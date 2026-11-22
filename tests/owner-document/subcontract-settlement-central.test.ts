import { describe, expect, it } from 'vitest'
import { createHttpOwnerCommercialDocumentReadRepository } from '~/lib/owner-document/central-http-repository'
import { buildOwnerCommercialDocumentDetail } from '~/lib/owner-document/central-repository'
import { validateOwnerDocumentDetailReturnTo } from '~/lib/owner-document/return-context'
import { buildSubcontractSettlementEvidenceRead } from '~/lib/owner-document/subcontract-settlement'
import { parseOwnerCommercialDocumentCommandRequest } from '../../server/utils/owner-commercial-document-command-request'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { createOwnerCommercialDocumentReadTestInstance } from '../../server/utils/owner-commercial-document-read-test-instance'
import { withReadMeta } from '../../server/utils/read-meta'
import { publicReadMeta } from '../helpers/public-read-meta'

const session = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['subcontract-document:read', 'subcontract-document:write'] }
function instance() {
  return createOwnerCommercialDocumentCommandTestInstance({
    projects: [{ id: 'project-328', name: '结算项目', customerId: null }],
    suppliers: [{ id: 'supplier-328', name: '劳务分供方' }],
    subcontractContracts: [{ id: 'contract-328', no: 'FB-328', name: '劳务合同', projectId: 'project-328', supplierId: 'supplier-328' }],
  })
}
function request(overrides: Record<string, unknown> = {}) {
  return parseOwnerCommercialDocumentCommandRequest({
    ...session,
    requiredCapability: 'subcontract-document:write',
    commandId: 'settlement-save-328',
    action: 'save',
    kind: 'sub_settlement',
    id: null,
    baseVersion: null,
    draft: { no: 'JS-328', name: '八月过程结算', projectId: 'project-328', supplierId: 'supplier-328', contractId: 'contract-328', settlementType: '过程结算', totalAmount: 18000, settlementDate: '2026-08-31', deductionNote: '按实际抵扣事实读取', note: '结算备注' },
    attachments: { add: [{ fileName: '结算单.pdf', fileSize: 328, mimeType: 'application/pdf', category: '结算单' }], removeIds: [], restoreIds: [] },
    ...overrides,
  })
}

describe('aX02 分包结算中央事实', () => {
  it('来源HTTP强检未知批复与真实零的语义，不接受坏金额、缺少分区或畸形导航', async () => {
    const commands = instance()
    const confirmed = await commands.execute(request({ action: 'submit' }), session)
    const source = commands.rows().find(row => row.id === confirmed.id)!
    source.subcontractSettlementEvidence = { contractAmount: 0, supplements: [], changes: [], settlements: [source], deductions: [], penalties: [], applications: [{ id: 'application-decode', projectId: source.projectId, supplierId: source.supplierId!, contractId: source.contractId, status: 'approved', allocations: [{ settlementId: source.id, amount: 0 }], payments: [], applyAmount: 0, approvedAmount: 0, approvedAmountState: 'known' }] }
    const query = { kind: 'sub_settlement' as const, id: source.id, origin: 'real' as const, includeDemo: false }
    const detail = withReadMeta(buildOwnerCommercialDocumentDetail({ documents: [source], query, capabilities: session.capabilities, asOf: source.updatedAt, sourceVersion: 'source-decode' }), publicReadMeta({ schemaVersion: 'owner-document-read-v3', dataOrigin: 'real', asOf: source.updatedAt, sourceVersion: 'source-decode', capabilities: session.capabilities, requested: true, scope: query }))
    await expect(createHttpOwnerCommercialDocumentReadRepository({ fetcher: async () => detail }).get(query)).resolves.toMatchObject({ subcontractSettlementEvidence: { originalContractAmount: '0.00', sections: { applications: [expect.objectContaining({ approvedAmount: '0.00', approvedAmountState: 'known' })] } } })
    for (const mutation of [
      (value: typeof detail) => { value.subcontractSettlementEvidence!.sections.applications![0]!.approvedAmountState = 'legacy-unknown' },
      (value: typeof detail) => { value.subcontractSettlementEvidence!.sections.applications![0]!.amount = 'invalid' },
      (value: typeof detail) => { Reflect.set(value.subcontractSettlementEvidence!.sections.applications![0]!, 'navigation', { kind: 'unavailable', reason: 'invalid' }) },
    ]) {
      const invalid = structuredClone(detail)
      mutation(invalid)
      await expect(createHttpOwnerCommercialDocumentReadRepository({ fetcher: async () => invalid }).get(query)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    }
    const invalidSections = structuredClone(detail)
    Reflect.deleteProperty(invalidSections.subcontractSettlementEvidence!.sections, 'payments')
    await expect(createHttpOwnerCommercialDocumentReadRepository({ fetcher: async () => invalidSections }).get(query)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
  })
  it('完整来源投影保原合同、有效协议、每张结算和独立抵扣，多结算现金未知与明确零分开', () => {
    const source = { id: 'settlement-current', dataOrigin: 'real' as const, projectId: 'project-source', supplierId: 'supplier-source', contractId: 'contract-source', status: 'confirmed', amount: 100 }
    const original = { id: 'supplement-valid', no: 'BC-1', name: '有效补充协议', date: '2026-10-07', status: '生效', amount: 20 }
    const application = { id: 'application-source', no: 'FK-1', name: '原付款申请', date: '2026-10-07', projectId: source.projectId, supplierId: source.supplierId, contractId: source.contractId, status: 'submitted', applyAmount: 60, approvedAmount: 0, approvedAmountState: 'known' as const, allocations: [{ settlementId: source.id, amount: 30 }, { settlementId: 'settlement-other', amount: 30 }], payments: [{ id: 'payment-source', no: 'ZF-1', totalAmount: 40, amount: 20, confirmed: true }] }
    const result = buildSubcontractSettlementEvidenceRead(source, { contractAmount: 1000, supplements: [original, { ...original, id: 'draft', status: 'draft', amount: 999 }], changes: [{ ...original, id: 'change-source', status: 'submitted', amount: null }], settlements: [{ ...source, name: '本期结算' }, { ...source, id: 'prior', name: '往期已确认', amount: 0 }], deductions: [], penalties: [{ ...original, id: 'penalty-source', deductionId: 'deduction-source', amount: 10, deductionAmount: 5 }], applications: [application] })
    expect(result.originalContractAmount).toBe('1000.00')
    expect(result.effectiveContractAmount).toBe('1020.00')
    expect(result.sections.supplements).toHaveLength(1)
    expect(result.sections.changes?.[0]).toMatchObject({ id: 'change-source', amount: null, status: 'submitted' })
    expect(result.sections.settlements?.[1]).toMatchObject({ amount: '0.00', note: '往期已确认结算' })
    expect(result.sections.penalties?.[0]).toMatchObject({ id: 'deduction-source', amount: '10.00', allocatedAmount: '5.00', navigation: { subject: { id: 'penalty-source' } } })
    expect(result.sections.applications?.[0]).toMatchObject({ amount: '60.00', allocatedAmount: '30.00', approvedAmount: '0.00', approvedAmountState: 'known' })
    expect(result.sections.payments?.[0]).toMatchObject({ amount: '40.00', allocatedAmount: null, navigation: { subject: { id: 'application-source' } } })
    expect(result.sections.payments?.[0]?.note).toContain('归属未知')
    expect(buildSubcontractSettlementEvidenceRead(source).sections).toEqual({ supplements: null, changes: null, settlements: null, penalties: null, applications: null, payments: null })
  })
  it('接受结算详情返回上下文并保持 canonical settlement variant', () => {
    expect(validateOwnerDocumentDetailReturnTo('/subcontract/settlement/settlement-328?origin=real', 'real', 'sub_settlement')).toBe('/subcontract/settlement/settlement-328?origin=real')
  })
  it('已知付款与抵扣只按有效分摊归集，多结算申请的部分支付不猜归属', async () => {
    const commands = instance()
    const confirmed = await commands.execute(request({ action: 'submit' }), session)
    const row = commands.rows().find(row => row.id === confirmed.id)!
    row.subcontractSettlementEvidence = {
      contractAmount: 100000,
      settlements: [row],
      deductions: [{ id: 'deduction-328', settlementId: row.id, amount: 1000, active: true }, { id: 'deleted-deduction', settlementId: row.id, amount: 9000, active: false }],
      applications: [{ id: 'application-328', projectId: row.projectId, supplierId: row.supplierId!, contractId: row.contractId, status: 'approved', allocations: [{ settlementId: row.id, amount: 12000 }], payments: [{ id: 'payment-328', confirmed: true, amount: 5000 }, { id: 'unconfirmed-payment', confirmed: false, amount: 7000 }] }],
    }
    const get = () => buildOwnerCommercialDocumentDetail({ documents: [row], query: { kind: 'sub_settlement', id: row.id, origin: 'real', includeDemo: false }, capabilities: session.capabilities, asOf: row.updatedAt, sourceVersion: '328' })
    expect(get().document.amounts).toMatchObject({ deductions: '1000.00', netSettlement: '17000.00', cumulativeApplied: '12000.00', remainingApplicable: '5000.00', cumulativePaid: '5000.00', remainingUnpaid: '12000.00' })
    row.subcontractSettlementEvidence.applications![0]!.allocations.push({ settlementId: 'another-settlement', amount: 10000 })
    expect(get().document.amounts).toMatchObject({ cumulativeApplied: '12000.00', cumulativePaid: null, remainingUnpaid: null })
  })
  it('累计仅计同合同已确认结算，未知付款保持 null；候选只返回已确认且来源一致的结算', async () => {
    const commands = instance()
    const saved = await commands.execute(request(), session)
    const confirmed = await commands.execute(request({ commandId: 'confirmed-source', action: 'submit', attachments: {} }), session)
    const read = createOwnerCommercialDocumentReadTestInstance(() => session.capabilities, commands)
    const detail = read.detail('sub_settlement', confirmed.id, { origin: 'real' })
    const candidates = commands.context(session, undefined, 'sub_settlement').settlements
    expect(candidates).toEqual([expect.objectContaining({ id: confirmed.id, projectId: 'project-328', supplierId: 'supplier-328', contractId: 'contract-328' })])
    expect(candidates?.some(row => row.id === saved.id)).toBe(false)
    expect(detail.document.amounts).toMatchObject({ cumulativeSettled: '18000.00', priorSettled: '0.00', cumulativeApplied: null, cumulativePaid: null, remainingUnpaid: null })
  })
  it('草稿保存、附件读回和确认使用同一稳定结算 ID；确认后锁定业务字段', async () => {
    const commands = instance()
    const saved = await commands.execute(request(), session)
    expect(await commands.execute(request(), session)).toEqual(saved)
    const form = commands.form('sub_settlement', saved.id, session)
    expect(form.draft).toMatchObject({ name: '八月过程结算', totalAmount: 18000, status: 'draft', deductionNote: '按实际抵扣事实读取' })
    expect(form.attachments).toEqual([expect.objectContaining({ ownerType: 'expenditure_settlement', ownerId: saved.id, fileName: '结算单.pdf' })])
    const confirmed = await commands.execute(request({ commandId: 'settlement-confirm-328', action: 'submit', id: saved.id, baseVersion: saved.version, draft: form.draft, attachments: {} }), session)
    const read = createOwnerCommercialDocumentReadTestInstance(() => session.capabilities, commands)
    const detail = read.detail('sub_settlement', saved.id, { origin: 'real' })
    expect(detail.document).toMatchObject({ kind: 'sub_settlement', status: 'confirmed', source: { type: 'expenditure_settlement', id: saved.id }, amounts: { kind: 'sub_settlement', total: '18000.00' } })
    expect(detail.documentNavigation).toMatchObject({ subject: { entity: 'subcontract-document', id: saved.id }, variant: 'settlement' })
    await expect(commands.execute(request({ commandId: 'stale-328', id: saved.id, baseVersion: saved.version }), session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(commands.execute(request({ commandId: 'locked-328', id: saved.id, baseVersion: confirmed.version }), session)).rejects.toThrow('只有草稿或已退回甲方商务单据可以编辑')
  })
})
