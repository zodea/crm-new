import { mkdir, mkdtemp } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { productionFinanceOwners } from '../../server/utils/production-finance-runtime'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionInvoiceService, listProductionInvoiceReferences } from '../../server/utils/production-invoice-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { testTempRoot } from '../helpers/test-temp-root'

it('真实付款采用证据冻结发票原版本，后续补原件不改变历史票面', async () => {
  const base = testTempRoot('finance-invoice-adoption')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'invoice-finance-workspace', ownerId: 'synthetic-owner', purpose: 'verification' })
  const actor = { ...storage.identity, capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-payment-application:read', 'finance-payment-application:write', 'customer:list:read', 'customer:write', 'project:list:read', 'project:write', 'supplier:list:read', 'supplier:write', 'our-signatory:read', 'our-signatory:write'] }
  const session = () => actor
  try {
    const baseCommand = { ...storage.identity, baseVersion: null, action: 'save', attachments: {} }
    const customer = await createProductionCustomerService(storage).execute({ ...baseCommand, requiredCapability: 'customer:write', commandId: 'adoption-customer', draft: { name: '合成客户', contact: '合成人' } }, session)
    const project = await createProductionProjectService(storage).execute({ ...baseCommand, requiredCapability: 'project:write', commandId: 'adoption-project', draft: { name: '合成项目', customerId: customer.id, manager: '合成人' } }, session)
    const supplier = await createProductionSupplierService(storage).execute({ ...baseCommand, requiredCapability: 'supplier:write', commandId: 'adoption-supplier', draft: { name: '合成销方', taxNo: 'SYN-SELLER', supplierCategory: '其他', contact: '合成人' } }, session)
    const signatory = await createProductionOurSignatoryService(storage).execute({ ...storage.identity, requiredCapability: 'our-signatory:write', commandId: 'adoption-signatory', baseVersion: null, draft: { name: '合成主体', taxNo: 'SYN-BUYER', registeredAddress: null, legalRepresentative: null, verificationNote: '合成资料', status: 'active' } }, session)
    const invoices = createProductionInvoiceService(storage)
    const common = { ...storage.identity, requiredCapability: 'finance-invoice:write' }
    const fields = { invoiceNumber: 'SYN-123', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'SYN-BUYER', seller: '合成销方', sellerTaxNo: 'SYN-SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const created = await invoices.execute({ ...common, action: 'manual', commandId: 'synthetic-invoice-create', baseVersion: null, fields, items: [] }, session)
    const reviewed = await invoices.execute({ ...common, action: 'review', commandId: 'synthetic-invoice-review', invoiceId: created.invoiceId, baseVersion: created.version, manualCompletion: true }, session)
    const archived = await invoices.execute({ ...common, action: 'archive', commandId: 'synthetic-invoice-archive', invoiceId: created.invoiceId, baseVersion: reviewed.version, ownerKind: 'project', projectId: project.id, supplierId: supplier.id, taxNumbersConfirmed: true, taxVerification: { buyerId: signatory.id, buyerVersion: signatory.version, supplierVersion: supplier.version } }, session)
    const finance = createProductionFinanceService(storage, { references: productionFinanceOwners })
    expect((await finance.lookup('payment_application', { kind: 'invoices', keyword: '', projectId: project.id, supplierId: supplier.id }, session)).items).toMatchObject([{ id: created.invoiceId, label: 'SYN-123', hint: '含税 ¥100.00' }])
    await expect(finance.lookup('payment_application', { kind: 'invoices', keyword: '', projectId: project.id, supplierId: supplier.id }, () => ({ ...actor, capabilities: actor.capabilities.filter(cap => cap !== 'finance-invoice:read') }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const request = { ...storage.identity, requiredCapability: 'finance-payment-application:write', kind: 'payment_application', action: 'draft', commandId: 'synthetic-payment-create', baseVersion: null, attachments: {}, draft: { name: '合成付款', bizType: '项目费用', projectId: project.id, supplierId: supplier.id, applyAmount: 30, invoiceState: '先款后票', invoiceAllocations: [{ invoiceId: created.invoiceId, allocatedAmount: 30 }] } }
    const saved = await finance.execute(request, session)
    expect(await finance.execute(request, session)).toEqual(saved)
    expect((await finance.paymentDetail(saved.id, session)).detail.invoices).toMatchObject([{ invoiceNumber: 'SYN-123', totalAmount: '100', allocatedAmount: '30', sourceState: 'frozen' }])
    const attached = await invoices.execute({ ...common, action: 'attach-original', commandId: 'synthetic-invoice-attach', invoiceId: created.invoiceId, baseVersion: archived.version, confirmed: true, original: { fileName: '合成.png', fileSize: 8, mimeType: 'image/png', contentBase64: 'iVBORw0KGgo=' } }, session)
    expect(attached.version).not.toBe(archived.version)
    expect((await finance.paymentDetail(saved.id, session)).detail.invoices).toMatchObject([{ invoiceNumber: 'SYN-123', totalAmount: '100', allocatedAmount: '30', sourceState: 'frozen' }])
    const existing = await finance.form('payment_application', saved.id, session)
    const changed = await finance.execute({ ...request, commandId: 'synthetic-payment-change', id: saved.id, baseVersion: saved.version, draft: { ...existing.draft, applyAmount: 20, invoiceAllocations: [{ invoiceId: created.invoiceId, allocatedAmount: 20 }] } }, session)
    expect((await finance.paymentDetail(saved.id, session)).detail.invoices).toMatchObject([{ invoiceNumber: 'SYN-123', totalAmount: '100', allocatedAmount: '20', sourceState: 'frozen' }])
    const versions = await storage.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=? AND id=? ORDER BY version', ['payment_application', saved.id])
    expect(JSON.parse(versions[0]!.snapshot_json).invoiceAdoptions[0].invoice.original).toBeNull()
    expect(JSON.parse(versions[0]!.snapshot_json).invoiceAdoptions[0].invoice.fields).toMatchObject({ amount: null, taxAmount: 0, totalAmount: 100 })
    expect(JSON.parse(versions[1]!.snapshot_json).invoiceAdoptions[0].invoice.original.id).toBe(attached.originalId)
    await finance.execute({ ...request, commandId: 'synthetic-payment-delete', action: 'delete', id: saved.id, baseVersion: changed.version, draft: {} }, session)
    await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
    await storage.execute('DROP TRIGGER finance_history_no_update')
    await storage.execute(`UPDATE finance_history SET snapshot_json=json_remove(snapshot_json,'$.invoiceAdoptions') WHERE kind=? AND id=? AND version=1`, ['payment_application', saved.id])
    await expect(validateFinanceJournal(storage, actor)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  }
  finally { await storage.close() }
})

it('合同更新后历史票款仍读取当时冻结票面，新关联须重新核对', async () => {
  const base = testTempRoot('finance-invoice-contract')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'invoice-contract-workspace', ownerId: 'synthetic-owner', purpose: 'verification' })
  const actor = { ...storage.identity, capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-payment-application:read', 'finance-payment-application:write', 'customer:list:read', 'customer:write', 'project:list:read', 'project:write', 'supplier:list:read', 'supplier:write', 'our-signatory:read', 'our-signatory:write', 'construction-contract:read', 'construction-contract:write'] }
  const session = () => actor
  const common = { ...storage.identity, baseVersion: null, action: 'draft', attachments: {} }
  try {
    const customer = await createProductionCustomerService(storage).execute({ ...common, requiredCapability: 'customer:write', commandId: 'invoice-customer', draft: { name: '合成客户' } }, session)
    const project = await createProductionProjectService(storage).execute({ ...common, requiredCapability: 'project:write', commandId: 'invoice-project', draft: { name: '合成工程', customerId: customer.id } }, session)
    const signatory = await createProductionOurSignatoryService(storage).execute({ ...storage.identity, requiredCapability: 'our-signatory:write', commandId: 'invoice-signatory', baseVersion: null, draft: { name: '合成主体', taxNo: 'SYN-BUYER', registeredAddress: null, legalRepresentative: null, verificationNote: '合成资料', status: 'active' } }, session)
    const supplier = await createProductionSupplierService(storage).execute({ ...common, requiredCapability: 'supplier:write', commandId: 'invoice-supplier', action: 'save', draft: { name: '合成销方', taxNo: 'SYN-SELLER', supplierCategory: '其他', contact: '合成人' } }, session)
    const contracts = createProductionConstructionContractService(storage)
    const contract = await contracts.execute({ ...storage.identity, requiredCapability: 'construction-contract:write', commandId: 'invoice-contract-create', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成施工合同', no: 'SYN-C1', projectId: project.id, customerId: customer.id, content: '合成范围', signDate: '2026-01-01', amount: null, taxRate: 0, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, managementFeeAmount: 0, managementFeeBasis: '明确零记取' } }, session)
    const invoices = createProductionInvoiceService(storage)
    const envelope = { ...storage.identity, requiredCapability: 'finance-invoice:write' }
    const fields = { invoiceNumber: 'SYN-456', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: 'SYN-BUYER', seller: '合成销方', sellerTaxNo: 'SYN-SELLER', amount: null, taxAmount: 0, totalAmount: 100, taxRate: '', remark: '' }
    const created = await invoices.execute({ ...envelope, action: 'manual', commandId: 'invoice-create', baseVersion: null, fields, items: [] }, session)
    const reviewed = await invoices.execute({ ...envelope, action: 'review', commandId: 'invoice-review', invoiceId: created.invoiceId, baseVersion: created.version, manualCompletion: true }, session)
    await invoices.execute({ ...envelope, action: 'archive', commandId: 'invoice-archive', invoiceId: created.invoiceId, baseVersion: reviewed.version, ownerKind: 'project', projectId: project.id, supplierId: supplier.id, contract: { domain: 'construction', id: contract.id, version: contract.version }, taxNumbersConfirmed: true, taxVerification: { buyerId: signatory.id, buyerVersion: signatory.version, supplierVersion: supplier.version } }, session)
    const finance = createProductionFinanceService(storage, { references: productionFinanceOwners })
    const request = { ...storage.identity, requiredCapability: 'finance-payment-application:write', kind: 'payment_application', action: 'draft', commandId: 'invoice-payment', baseVersion: null, attachments: {}, draft: { name: '合成项目付款', bizType: '项目费用', projectId: project.id, supplierId: supplier.id, applyAmount: 30, invoiceState: '先款后票', invoiceAllocations: [{ invoiceId: created.invoiceId, allocatedAmount: 30 }] } }
    const saved = await finance.execute(request, session)
    const form = await contracts.form(contract.id, session)
    await contracts.execute({ ...storage.identity, requiredCapability: 'construction-contract:write', commandId: 'invoice-contract-change', id: contract.id, baseVersion: form.version, action: 'save', attachments: {}, draft: { ...form.draft, managementFeeAmount: 8 } }, session, contract.id)
    expect(await finance.execute(request, session)).toEqual(saved)
    expect((await finance.paymentDetail(saved.id, session)).detail.invoices).toMatchObject([{ invoiceNumber: 'SYN-456', totalAmount: '100', allocatedAmount: '30', sourceState: 'frozen' }])
    expect((await finance.paymentDetail(saved.id, () => ({ ...actor, capabilities: actor.capabilities.filter(cap => cap !== 'finance-invoice:read') }))).detail.invoices).toMatchObject([{ invoiceNumber: '', totalAmount: null, allocatedAmount: '30', sourceState: 'forbidden' }])
    await expect(storage.withTransaction(tx => listProductionInvoiceReferences(tx, actor, created.invoiceId))).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(finance.execute({ ...request, commandId: 'invoice-payment-new' }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await storage.select('SELECT id FROM payment_applications')).toHaveLength(1)
    await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
    await storage.execute('DROP TRIGGER finance_history_no_update')
    await storage.execute(`UPDATE finance_history SET snapshot_json=json_remove(snapshot_json,'$.invoiceAdoptions') WHERE kind=? AND id=?`, ['payment_application', saved.id])
    await expect(finance.paymentDetail(saved.id, session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  }
  finally { await storage.close() }
})
