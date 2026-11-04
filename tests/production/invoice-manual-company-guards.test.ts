import { expect, it } from 'vitest'
import { createCentralInvoiceHttp } from '../../app/lib/invoice/central-http'
import { createCentralInvoiceSession } from '../../app/lib/invoice/central-session'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { createProductionInvoiceService } from '../../server/utils/production-invoice-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

it('手工公司票拒绝身份、税号和来源变化，成功后可按原命令恢复', async () => {
  const f = await createSubcontractFixture()
  try {
    f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'finance-invoice:read', 'finance-invoice:write', 'auxiliary-contract:read', 'auxiliary-contract:write'] })
    const base = { workspaceId: f.session().workspaceId, actorId: f.session().actorId, requiredCapability: 'finance-invoice:write' as const }
    const suppliers = createProductionSupplierService(f.storage)
    const form = await suppliers.form(f.supplier.id, f.session)
    const supplier = await suppliers.execute({ workspaceId: base.workspaceId, actorId: base.actorId, action: 'save', commandId: 'company-guard-supplier-tax', id: f.supplier.id, requiredCapability: 'supplier:write', baseVersion: form.version, attachments: {}, draft: { ...form.draft, taxNo: 'COMPANY-GUARD-SELLER' } }, f.session, f.supplier.id)
    const secondBuyer = await createProductionOurSignatoryService(f.storage).execute({ workspaceId: base.workspaceId, actorId: base.actorId, requiredCapability: 'our-signatory:write', commandId: 'company-guard-second-buyer', baseVersion: null, draft: { name: '合成第二购方', taxNo: 'COMPANY-GUARD-SECOND', registeredAddress: null, legalRepresentative: null, verificationNote: '合成主体核验', status: 'active' } }, f.session)
    const contract = await createProductionAuxiliaryContractService(f.storage).execute({ workspaceId: base.workspaceId, actorId: base.actorId, requiredCapability: 'auxiliary-contract:write', commandId: 'company-guard-contract', baseVersion: null, action: 'draft', constructionMain: undefined, draft: { kind: 'company_expense', name: '合成公司合同', no: 'COMPANY-GUARD', category: '房租', supplierId: supplier.id, supplierVersion: supplier.version, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version }, attachments: {} }, f.session)
    const reference = { domain: 'company' as const, id: contract.id, version: contract.version }
    const invoice = createProductionInvoiceService(f.storage)
    async function reviewed(suffix: string, buyerTaxNo: string) {
      const fields = { invoiceNumber: `MANUAL-GUARD-${suffix}`, invoiceDate: '2026-01-01', invoiceType: '', buyer: '合成购方', buyerTaxNo, seller: '合成销方', sellerTaxNo: 'COMPANY-GUARD-SELLER', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' }
      const created = await invoice.execute({ ...base, action: 'manual', commandId: `company-guard-create-${suffix}`, baseVersion: null, fields, items: [] }, f.session)
      const result = await invoice.execute({ ...base, action: 'review', commandId: `company-guard-review-${suffix}`, invoiceId: created.invoiceId, baseVersion: created.version, manualCompletion: true }, f.session)
      return { invoiceId: created.invoiceId, version: result.version }
    }
    const archive = (item: { invoiceId: string, version: string }, commandId: string) => ({ ...base, action: 'archive' as const, commandId, invoiceId: item.invoiceId, baseVersion: item.version, ownerKind: 'company' as const, projectId: null, supplierId: supplier.id, taxNumbersConfirmed: true as const, taxVerification: { buyerId: f.signatory.id, buyerVersion: f.signatory.version, supplierVersion: supplier.version }, contract: reference })
    async function unchanged(item: { invoiceId: string, version: string }, commandId: string) {
      expect(await invoice.get(item.invoiceId, f.session)).toMatchObject({ sourceKind: 'manual', accountStatus: 'none', ownerKind: null, version: item.version })
      await f.storage.withTransaction(async (tx) => {
        expect(await tx.select('SELECT command_id FROM invoice_command_receipts WHERE command_id=?', [commandId])).toEqual([])
        expect(await tx.select('SELECT command_id FROM invoice_archive_evidence WHERE invoice_id=?', [item.invoiceId])).toEqual([])
        expect(await tx.select('SELECT command_id FROM invoice_audits WHERE command_id=?', [commandId])).toEqual([])
      })
    }

    const mismatch = await reviewed('TAX', 'WRONG-BUYER-TAX')
    const badTax = archive(mismatch, 'company-guard-bad-tax')
    await expect(invoice.execute(badTax, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('税号与所选') } })
    await unchanged(mismatch, badTax.commandId)

    const wrongBuyer = await reviewed('BUYER', 'COMPANY-GUARD-SECOND')
    const badBuyer = { ...archive(wrongBuyer, 'company-guard-bad-buyer'), taxVerification: { buyerId: secondBuyer.id, buyerVersion: secondBuyer.version, supplierVersion: supplier.version } }
    await expect(invoice.execute(badBuyer, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('合同我方签约主体与发票所选主体不一致') } })
    await unchanged(wrongBuyer, badBuyer.commandId)

    const valid = await reviewed('VALID', 'SUBCONTRACT-VERIFICATION')
    const noPermission = archive(valid, 'company-guard-no-supplier-read')
    const revoked = { ...f.session(), capabilities: f.session().capabilities.filter(capability => capability !== 'supplier:list:read') }
    await expect(invoice.execute(noPermission, () => revoked)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await unchanged(valid, noPermission.commandId)

    const updatedForm = await suppliers.form(supplier.id, f.session)
    const updated = await suppliers.execute({ workspaceId: base.workspaceId, actorId: base.actorId, action: 'save', commandId: 'company-guard-supplier-change', id: supplier.id, requiredCapability: 'supplier:write', baseVersion: updatedForm.version, attachments: {}, draft: { ...updatedForm.draft, name: '合成分供方已更新' } }, f.session, supplier.id)
    expect(updated.version).not.toBe(supplier.version)
    const stale = archive(valid, 'company-guard-stale-supplier')
    await expect(invoice.execute(stale, f.session)).rejects.toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining('分供方资料已变化') } })
    await unchanged(valid, stale.commandId)

    const accepted = { ...archive(valid, 'company-guard-success'), taxVerification: { buyerId: f.signatory.id, buyerVersion: f.signatory.version, supplierVersion: updated.version } }
    const client = createCentralInvoiceHttp(async (url, options) => url.endsWith('/resolve') ? invoice.resolve(String((options?.body as { commandId: string }).commandId), f.session) : invoice.getRead(valid.invoiceId, f.session), f.session())
    const remembered = new Map<string, string>()
    const storage = () => ({
      getItem: (key: string) => remembered.get(key) ?? null,
      setItem: (key: string, value: string) => { remembered.set(key, value) },
      removeItem: (key: string) => { remembered.delete(key) },
    })
    const uncertain = createCentralInvoiceSession({ identity: f.session(), targetId: valid.invoiceId, repository: { ...client, execute: async (request) => {
      await invoice.execute(request, f.session)
      throw new Error('合成响应丢失')
    } }, context: async () => f.session(), storage })
    await expect(uncertain.submit(accepted)).rejects.toThrow('合成响应丢失')
    expect(uncertain.pending()?.commandId).toBe(accepted.commandId)
    const recovered = await createCentralInvoiceSession({ identity: f.session(), targetId: valid.invoiceId, repository: client, context: async () => f.session(), storage }).recover()
    expect(recovered).toMatchObject({ outcome: 'applied', read: { record: { accountStatus: 'archived', ownerKind: 'company', supplierId: supplier.id, contract: reference } } })
    expect(remembered.size).toBe(0)
    if (!recovered || recovered.outcome !== 'applied')
      throw new Error('原命令未恢复为已应用')
    expect(await invoice.execute(accepted, f.session)).toEqual(recovered.result)
    await f.storage.withTransaction(async (tx) => {
      expect(await tx.select('SELECT command_id FROM invoice_command_receipts WHERE command_id=?', [accepted.commandId])).toHaveLength(1)
      expect(await tx.select('SELECT command_id FROM invoice_archive_evidence WHERE invoice_id=?', [valid.invoiceId])).toHaveLength(1)
      expect(await tx.select('SELECT command_id FROM invoice_audits WHERE command_id=?', [accepted.commandId])).toHaveLength(1)
    })
  }
  finally { await f.storage.close() }
}, 30_000)
