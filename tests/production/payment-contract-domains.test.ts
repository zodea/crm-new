import { expect, it } from 'vitest'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { productionFinanceOwners } from '../../server/utils/production-finance-runtime'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionInvoiceService } from '../../server/utils/production-invoice-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

it('分包、其他支出和公司合同通过真实来源候选、指定发票及确认付款', async () => {
  const f = await createSubcontractFixture()
  try {
    f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'auxiliary-contract:read', 'auxiliary-contract:write', 'material-contract:read', 'finance-invoice:read', 'finance-invoice:write', 'finance-payment-application:read', 'finance-payment-application:write', 'finance-payment-record:read', 'finance-payment-record:write'] })
    const supplierService = createProductionSupplierService(f.storage)
    const supplierForm = await supplierService.form(f.supplier.id, f.session)
    const supplier = await supplierService.execute({ workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'supplier:write', commandId: 'payment-domains-tax', id: f.supplier.id, baseVersion: supplierForm.version, action: 'save', attachments: {}, draft: { ...supplierForm.draft, taxNo: 'SYN-SELLER' } }, f.session, f.supplier.id)
    const subcontract = await f.service.execute(f.command(), f.session)
    const auxiliary = createProductionAuxiliaryContractService(f.storage)
    const common = { workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'auxiliary-contract:write', baseVersion: null, action: 'draft', attachments: {} }
    const other = await auxiliary.execute({ ...common, commandId: 'payment-domains-other', constructionMain: f.constructionMain, draft: { kind: 'other_expense', name: '合成检测合同', no: 'SYN-OTHER', category: '检测服务', projectId: f.project.id, supplierId: supplier.id, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version } }, f.session)
    const company = await auxiliary.execute({ ...common, commandId: 'payment-domains-company', draft: { kind: 'company_expense', name: '合成公司合同', no: 'SYN-COMPANY', category: '房租', supplierId: supplier.id, supplierVersion: supplier.version, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version } }, f.session)
    const finance = createProductionFinanceService(f.storage, { references: productionFinanceOwners })
    const invoice = createProductionInvoiceService(f.storage)
    const identity = { workspaceId: f.session().workspaceId, actorId: f.session().actorId }
    const invoiceIds = new Map<string, string>()
    const cases = [
      { domain: 'subcontract' as const, contract: subcontract, projectId: f.project.id, bizType: '预付款' },
      { domain: 'auxiliary' as const, contract: other, projectId: f.project.id, bizType: '预付款' },
      { domain: 'company' as const, contract: company, projectId: null, bizType: '公司付款' },
    ]
    for (const item of cases) {
      const reference = { domain: item.domain, id: item.contract.id, version: item.contract.version }
      const candidates = await finance.lookup('payment_application', { kind: 'payment-contracts', keyword: '', projectId: item.projectId, supplierId: supplier.id, paymentBizType: item.bizType }, f.session)
      expect(candidates.items).toContainEqual(expect.objectContaining({ id: `${item.domain}_${item.contract.id}`, paymentContract: reference }))
      const base = { ...identity, requiredCapability: 'finance-invoice:write' }
      const fields = { invoiceNumber: `SYN-${item.domain}`, invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'SUBCONTRACT-VERIFICATION', seller: '合成分供方', sellerTaxNo: 'SYN-SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
      const created = item.domain === 'company'
        ? await invoice.execute({ ...base, action: 'upload', commandId: `payment-domains-upload-${item.domain}`, baseVersion: null, ownerKind: 'company', projectId: null, original: { fileName: '合成.png', fileSize: 8, mimeType: 'image/png', contentBase64: 'iVBORw0KGgo=' } }, f.session)
        : await invoice.execute({ ...base, action: 'manual', commandId: `payment-domains-manual-${item.domain}`, baseVersion: null, fields, items: [] }, f.session)
      const edited = item.domain === 'company'
        ? await invoice.execute({ ...base, action: 'edit', commandId: `payment-domains-edit-${item.domain}`, invoiceId: created.invoiceId, baseVersion: created.version, fields, items: [] }, f.session)
        : created
      const reviewed = await invoice.execute({ ...base, action: 'review', commandId: `payment-domains-review-${item.domain}`, invoiceId: created.invoiceId, baseVersion: edited.version, manualCompletion: true }, f.session)
      const archive = { ...base, action: 'archive', commandId: `payment-domains-archive-${item.domain}`, invoiceId: created.invoiceId, baseVersion: reviewed.version, ownerKind: item.domain === 'company' ? 'company' : 'project', projectId: item.projectId, supplierId: supplier.id, contract: reference, taxNumbersConfirmed: true, taxVerification: { buyerId: f.signatory.id, buyerVersion: f.signatory.version, supplierVersion: supplier.version } }
      await invoice.execute(archive, f.session)
      invoiceIds.set(item.domain, created.invoiceId)
      const application = await finance.execute({ ...identity, requiredCapability: 'finance-payment-application:write', kind: 'payment_application', action: 'save', commandId: `payment-domains-application-${item.domain}`, baseVersion: null, attachments: {}, draft: { name: `合成${item.domain}`, bizType: item.bizType, projectId: item.projectId, supplierId: supplier.id, contractId: reference.id, contractReference: reference, applyAmount: 30, applyDate: '2026-01-01', applicant: '合成人', invoiceState: '先款后票', invoiceAllocations: [{ invoiceId: created.invoiceId, allocatedAmount: 30 }] } }, f.session)
      const confirmation = { ...identity, requiredCapability: 'finance-payment-record:write', kind: 'payment_record', action: 'confirm', commandId: `payment-domains-confirm-${item.domain}`, baseVersion: null, attachments: {}, draft: { projectId: item.projectId, supplierId: supplier.id, payeeName: '合成分供方', amount: 30, paymentDate: '2026-01-01', voucherNo: `V-${item.domain}`, bankSerialNo: `B-${item.domain}`, confirmedBy: identity.actorId, applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 30 }] } }
      const result = await finance.execute(confirmation, f.session)
      expect(result.paymentInvoiceEvidenceSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(await finance.execute(confirmation, f.session)).toEqual(result)
    }
    const companyInvoice = invoiceIds.get('company')!
    const projectInvoice = invoiceIds.get('subcontract')!
    const request = { ...identity, requiredCapability: 'finance-payment-application:write', kind: 'payment_application', action: 'save', baseVersion: null, attachments: {}, draft: { name: '合成跨归属申请', supplierId: supplier.id, contractId: null, applyAmount: 1, applyDate: '2026-01-01', applicant: '合成人', invoiceState: '先款后票' } }
    const wrongCompany = { ...request, commandId: 'payment-wrong-company-invoice', draft: { ...request.draft, bizType: '公司付款', projectId: null, invoiceAllocations: [{ invoiceId: projectInvoice, allocatedAmount: 1 }] } }
    const wrongProject = { ...request, commandId: 'payment-wrong-project-invoice', draft: { ...request.draft, bizType: '管理费', projectId: f.project.id, invoiceAllocations: [{ invoiceId: companyInvoice, allocatedAmount: 1 }] } }
    const wrong = await Promise.allSettled([finance.execute(wrongCompany, f.session), finance.execute(wrongProject, f.session)])
    expect(wrong).toHaveLength(2)
    expect(wrong.map(result => result.status === 'fulfilled' ? 'fulfilled' : result.reason.problem?.code)).toEqual(['validation-failed', 'validation-failed'])
    const companyCandidates = await finance.lookup('payment_application', { kind: 'invoices', keyword: '', projectId: null, supplierId: supplier.id }, f.session)
    expect(companyCandidates.items.map(row => row.id)).toEqual([companyInvoice])
    await expect(validateFinanceJournal(f.storage, f.session())).resolves.toBeDefined()
  }
  finally { await f.storage.close() }
})
