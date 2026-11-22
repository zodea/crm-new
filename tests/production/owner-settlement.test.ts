import type { FinanceCommand } from '../../app/lib/finance/central-contract'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { FINANCE_FAMILIES } from '../../app/lib/finance/central-contract'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { productionFinanceSettlementOwners } from '../../server/utils/production-finance-runtime'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionOwnerDocumentService } from '../../server/utils/production-owner-document-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { runColdProcess } from '../helpers/cold-process'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

async function fixture() {
  const f = await createSubcontractFixture()
  const actor = f.session()
  actor.capabilities.push('owner-document:read', 'owner-document:write', 'subcontract-document:read', 'subcontract-document:write', 'boq:read', 'other-settlement:read', ...Object.values(FINANCE_FAMILIES).flatMap(family => [`${family}:read`, `${family}:write`]))
  f.setActor(actor)
  const request = f.command()
  request.draft.amount = 1000
  const contract = await f.service.execute(request, f.session)
  const owner = createProductionOwnerDocumentService(f.storage)
  const context = await owner.context(undefined, f.session)
  const selected = { projectId: f.project.id, supplierId: f.supplier.id, contractId: contract.id }
  const relationshipVersionsJson = JSON.stringify(Object.fromEntries(Object.entries(selected).map(([field, id]) => {
    const choices = field === 'projectId' ? context.projects : field === 'supplierId' ? context.suppliers : context.contracts
    return [field, { id, version: choices.find(row => row.id === id)!.version }]
  })))
  const finance = createProductionFinanceService(f.storage, { references: productionFinanceSettlementOwners })
  const settlement = await owner.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'subcontract-document:write', commandId: 'business-settlement-confirm', kind: 'sub_settlement', action: 'submit', id: null, baseVersion: null, draft: { no: 'BUSINESS-JS', name: '真实分包结算', projectId: f.project.id, supplierId: f.supplier.id, contractId: contract.id, relationshipVersionsJson, settlementType: '过程结算', settlementDate: '2026-10-07', totalAmount: 100 }, attachments: {} }, f.session)
  const application = (commandId: string, allocations = [{ settlementId: settlement.id, allocatedAmount: 60 }]): FinanceCommand => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId, requiredCapability: 'finance-payment-application:write', kind: 'payment_application', action: 'submit', baseVersion: null, attachments: {}, draft: { name: '原分包结算付款申请', bizType: '有合同-合同劳务', projectId: f.project.id, supplierId: f.supplier.id, contractId: contract.id, contractReference: { domain: 'subcontract', id: contract.id, version: contract.version }, applyAmount: allocations.reduce((sum, row) => sum + row.allocatedAmount, 0), applyDate: '2026-10-07', applicant: actor.actorId, invoiceState: '无需发票', settlementAllocations: allocations } })
  const payment = (commandId: string, applicationId: string, amount = 30): FinanceCommand => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId, requiredCapability: 'finance-payment-record:write', kind: 'payment_record', action: 'confirm', baseVersion: null, attachments: {}, draft: { projectId: f.project.id, supplierId: f.supplier.id, payeeName: '分包正式分供方', amount, paymentDate: '2026-10-07', voucherNo: `${commandId}-VOUCHER`, bankSerialNo: `${commandId}-BANK`, confirmedBy: actor.actorId, applicationAllocations: [{ paymentApplicationId: applicationId, allocatedAmount: amount }] } })
  return { ...f, actor, owner, finance, contract, settlement, application, payment, relationshipVersionsJson }
}

it('单一正式分包结算→真实合同申请→确认支付，冷读只消费原实际分摊且精确核owner权限', { timeout: 20000 }, async () => {
  const f = await fixture()
  try {
    const applicationRequest = f.application('business-real-application')
    const selectedContract = { domain: 'subcontract' as const, id: f.contract.id, version: f.contract.version }
    const lookup = { kind: 'settlements' as const, keyword: '', projectId: f.project.id, supplierId: f.supplier.id, contractId: selectedContract.id, contractDomain: selectedContract.domain, contractVersion: selectedContract.version }
    expect((await f.finance.lookup('payment_application', lookup, f.session)).items).toEqual([expect.objectContaining({ id: f.settlement.id })])
    expect((await f.finance.lookup('payment_application', { ...lookup, contractDomain: 'auxiliary' }, f.session)).items).toEqual([])
    expect((await f.finance.lookup('payment_application', { ...lookup, contractVersion: String(Number(selectedContract.version) + 1) }, f.session)).items).toEqual([])
    const application = await f.finance.execute(applicationRequest, f.session)
    expect(application.paymentSettlementEvidenceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(applicationRequest.draft).toMatchObject({ contractReference: selectedContract })
    expect(await f.finance.execute(applicationRequest, f.session)).toEqual(application)
    const paymentRequest = f.payment('business-real-payment', application.id)
    const payment = await f.finance.execute(paymentRequest, f.session)
    await f.storage.close()
    expect(await f.finance.execute(paymentRequest, f.session)).toEqual(payment)
    expect((await f.owner.detail('sub_settlement', f.settlement.id, { origin: 'real' }, f.session)).document.amounts).toMatchObject({ total: '100.00', contractAmount: '1000.00', cumulativeApplied: '60.00', remainingApplicable: '40.00', cumulativePaid: '30.00', remainingUnpaid: '70.00' })
    expect(await f.storage.select('SELECT id,document_owner,total_amount FROM expenditure_settlements')).toEqual([{ id: f.settlement.id, document_owner: 'business', total_amount: 100 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, amount: 30 }])
    const otherOnly = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'subcontract-document:read') })
    const protectedDetail = await f.finance.paymentDetail(application.id, otherOnly)
    expect(protectedDetail.detail.settlements).toEqual([expect.objectContaining({ id: f.settlement.id, sourceState: 'forbidden', no: '', name: '', totalAmount: null })])
    await expect(f.finance.execute({ ...applicationRequest, commandId: 'other-cannot-adopt-business' }, otherOnly)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const withoutCash = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'finance-payment-record:read') })
    expect((await f.owner.detail('sub_settlement', f.settlement.id, { origin: 'real' }, withoutCash)).document.amounts).toMatchObject({ cumulativeApplied: '60.00', cumulativePaid: null, remainingUnpaid: null })
    const current = await f.finance.paymentDetail(application.id, f.session)
    expect(current.detail.contractAmount).toBe('1000')
    expect(current.detail.settlements).toEqual([expect.objectContaining({ id: f.settlement.id, sourceState: 'readable', totalAmount: '100' })])
    const settlementRead = await f.owner.detail('sub_settlement', f.settlement.id, { origin: 'real' }, f.session)
    expect(settlementRead.subcontractSettlementEvidence).toMatchObject({ originalContractAmount: '1000.00', effectiveContractAmount: '1000.00', sections: { supplements: [], changes: [], settlements: [expect.objectContaining({ id: f.settlement.id, amount: '100.00' })], penalties: [], applications: [expect.objectContaining({ id: application.id, amount: '60.00', allocatedAmount: '60.00', approvedAmount: null, approvedAmountState: 'not-entered' })], payments: [expect.objectContaining({ id: `${application.id}:${payment.id}`, amount: '30.00', allocatedAmount: '30.00', navigation: expect.objectContaining({ subject: expect.objectContaining({ id: application.id, entity: 'payment-application' }) }) })] } })
    const sub = await f.service.detail(f.contract.id, { origin: 'real', focusId: f.settlement.id }, f.session)
    expect(sub.sections.settlements.progress).toEqual([expect.objectContaining({ id: f.settlement.id, amount: '100.00', navigation: expect.objectContaining({ subject: expect.objectContaining({ id: f.settlement.id }) }) })])
    expect(sub.sections.payments.applications).toEqual([expect.objectContaining({ id: application.id })])
    expect(sub.sections.payments.records).toEqual([expect.objectContaining({ id: payment.id, amount: '30.00' })])
    expect(sub.contract.amounts).toMatchObject({ settled: '100.00', paid: null })
    const project = await createProductionProjectService(f.storage).detail(f.project.id, { origin: 'real' }, f.session)
    expect(project.ownerJourneys?.pages.subSettlement?.items).toEqual([expect.objectContaining({ id: f.settlement.id })])
    expect(Object.keys(project.ownerJourneys?.pages ?? {})).toHaveLength(9)
    expect((await createProductionConstructionContractService(f.storage).detail(f.main.id, { origin: 'real' }, f.session)).meta.sources.find(source => source.key === 'owner-documents')?.state).toBe('readable')
    const coldFile = resolve(f.options.directory, 'business-settlement-cold.json')
    await f.storage.close()
    await runColdProcess('production-owner-document-cold', [f.options.directory, JSON.stringify(f.actor), JSON.stringify([{ kind: 'sub_settlement', commandId: 'business-settlement-confirm' }]), coldFile, JSON.stringify({ projectIds: [f.project.id], subcontractIds: [f.contract.id], constructionIds: [f.main.id] })])
    const cold = JSON.parse(await readFile(coldFile, 'utf8'))
    expect(cold.resolutions).toEqual([{ outcome: 'applied', result: f.settlement }])
    expect(cold.details.find((read: { document: { id: string } }) => read.document.id === f.settlement.id).subcontractSettlementEvidence).toEqual(settlementRead.subcontractSettlementEvidence)
    expect(cold.hosts.subcontracts[0].sections.settlements.progress).toEqual(sub.sections.settlements.progress)
    expect(cold.hosts.projects[0].ownerJourneys.pages.subSettlement.items).toEqual(project.ownerJourneys?.pages.subSettlement?.items)
  }
  finally { await f.storage.close() }
})

it('失效原申请仍保真实已确认现金，余款资格关闭且不释放第二申请', { timeout: 20000 }, async () => {
  const f = await fixture()
  try {
    const application = await f.finance.execute(f.application('business-historical-application'), f.session)
    await f.finance.execute(f.payment('business-historical-payment', application.id), f.session)
    await f.storage.execute('UPDATE payment_applications SET deleted_at=? WHERE id=?', ['2026-10-07T00:00:00.000Z', application.id])
    const detail = await f.owner.detail('sub_settlement', f.settlement.id, { origin: 'real' }, f.session)
    expect(detail.document.amounts).toMatchObject({ cumulativeApplied: null, remainingApplicable: null, cumulativePaid: '30.00', remainingUnpaid: '70.00' })
    await expect(f.finance.execute(f.application('business-cannot-release-old-cash', [{ settlementId: f.settlement.id, allocatedAmount: 40 }]), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, amount: 30 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_applications')).toEqual([{ n: 1 }])
  }
  finally { await f.storage.close() }
})

it('跨申请现金按原精确分摊只计一次，多结算申请无结算级现金归属保持未知', { timeout: 20000 }, async () => {
  const f = await fixture()
  try {
    const first = await f.finance.execute(f.application('business-first-application'), f.session)
    const second = await f.finance.execute(f.application('business-second-application', [{ settlementId: f.settlement.id, allocatedAmount: 20 }]), f.session)
    const cash = f.payment('business-cross-application-payment', first.id, 50)
    cash.draft = { ...cash.draft, applicationAllocations: [{ paymentApplicationId: first.id, allocatedAmount: 30 }, { paymentApplicationId: second.id, allocatedAmount: 20 }] }
    await f.finance.execute(cash, f.session)
    expect((await f.owner.detail('sub_settlement', f.settlement.id, { origin: 'real' }, f.session)).document.amounts).toMatchObject({ cumulativeApplied: '80.00', cumulativePaid: '50.00', remainingUnpaid: '50.00' })
    const another = await f.owner.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, requiredCapability: 'subcontract-document:write', commandId: 'business-another-settlement', kind: 'sub_settlement', action: 'submit', id: null, baseVersion: null, attachments: {}, draft: { name: '真实第二张结算', projectId: f.project.id, supplierId: f.supplier.id, contractId: f.contract.id, relationshipVersionsJson: f.relationshipVersionsJson, settlementType: '过程结算', settlementDate: '2026-10-07', totalAmount: 50 } }, f.session)
    const multi = await f.finance.execute(f.application('business-multi-settlement-application', [{ settlementId: f.settlement.id, allocatedAmount: 10 }, { settlementId: another.id, allocatedAmount: 20 }]), f.session)
    await f.finance.execute(f.payment('business-multi-settlement-payment', multi.id, 15), f.session)
    expect((await f.owner.detail('sub_settlement', f.settlement.id, { origin: 'real' }, f.session)).document.amounts).toMatchObject({ cumulativeApplied: '90.00', cumulativePaid: null, remainingUnpaid: null })
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 2, amount: 65 }])
    expect(await f.storage.select('SELECT SUM(allocated_amount) AS amount FROM payment_record_application_allocations WHERE deleted_at IS NULL')).toEqual([{ amount: 65 }])
  }
  finally { await f.storage.close() }
})
