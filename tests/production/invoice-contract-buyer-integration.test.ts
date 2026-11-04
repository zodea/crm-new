import { expect, it } from 'vitest'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { assertInvoiceContractBuyer, verifyInvoiceContractReference } from '../../server/utils/production-invoice-contracts'
import { createProductionMaterialContractService } from '../../server/utils/production-material-contract-service'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

it('四类项目合同以真实 owner 的已核实签约主体比对购方，失权、版本过期和身份不一致均拒绝', async () => {
  const f = await createSubcontractFixture()
  try {
    f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'material-contract:read', 'material-contract:write', 'auxiliary-contract:read', 'auxiliary-contract:write'] })
    const actor = f.session()
    const common = { workspaceId: actor.workspaceId, actorId: actor.actorId, baseVersion: null, attachments: {} }
    const subcontract = await f.service.execute(f.command(), f.session)
    const material = await createProductionMaterialContractService(f.storage).execute({ ...common, requiredCapability: 'material-contract:write', commandId: 'buyer-test-material', action: 'submit', constructionMain: f.constructionMain, draft: { name: '合成材料合同', projectId: f.project.id, supplierId: f.supplier.id, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version, content: '合成材料', signDate: '2026-10-07', amount: 100, taxRate: null, lineItems: [{ materialName: '合成材料', unit: '件', qty: 1, taxInclusiveUnitPrice: 100 }] }, attachments: { add: [{ fileName: '材料合同.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] } }, f.session)
    const auxiliary = await createProductionAuxiliaryContractService(f.storage).execute({ ...common, requiredCapability: 'auxiliary-contract:write', commandId: 'buyer-test-auxiliary', action: 'draft', constructionMain: f.constructionMain, draft: { kind: 'other_expense', name: '合成检测合同', no: 'AUX-BUYER', category: '检测服务', projectId: f.project.id, supplierId: f.supplier.id, signDate: '2026-10-07', amount: 0, taxRate: 0, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version } }, f.session)
    const references = [
      { domain: 'construction' as const, id: f.main.id, version: f.main.version },
      { domain: 'subcontract' as const, id: subcontract.id, version: subcontract.version },
      { domain: 'material' as const, id: material.id, version: material.version },
      { domain: 'auxiliary' as const, id: auxiliary.id, version: auxiliary.version },
    ]
    for (const reference of references) {
      const read = (current = actor, version = reference.version) => f.storage.withTransaction(tx => verifyInvoiceContractReference(tx, current, { ...reference, version }, f.project.id, f.supplier.id))
      const actual = await read()
      expect(actual.ourSignatoryId).toBe(f.signatory.id)
      expect(() => assertInvoiceContractBuyer(actor, actual, f.signatory.id)).not.toThrow()
      expect(() => assertInvoiceContractBuyer(actor, actual, 'different-buyer')).toThrow('不一致')
      expect(() => assertInvoiceContractBuyer({ ...actor, capabilities: actor.capabilities.filter(value => value !== 'our-signatory:read') }, actual, f.signatory.id)).toThrow('无我方主体读取权限')
      await expect(read(actor, '999999')).rejects.toMatchObject({ problem: { code: 'conflict' } })
      const capability = reference.domain === 'auxiliary' ? 'auxiliary-contract:read' : `${reference.domain}-contract:read`
      await expect(read({ ...actor, capabilities: actor.capabilities.filter(value => value !== capability) })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    }
  }
  finally {
    await f.storage.close()
  }
})
