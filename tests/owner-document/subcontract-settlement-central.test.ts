import { describe, expect, it } from 'vitest'
import { buildOwnerCommercialDocumentDetail } from '~/lib/owner-document/central-repository'
import { validateOwnerDocumentDetailReturnTo } from '~/lib/owner-document/return-context'
import { parseOwnerCommercialDocumentCommandRequest } from '../../server/utils/owner-commercial-document-command-request'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { createOwnerCommercialDocumentReadTestInstance } from '../../server/utils/owner-commercial-document-read-test-instance'

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
