import type { SubcontractContractCommandRequestDTO } from '../../app/lib/subcontract-contract/command-contract'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { readProductionConstructionScopeMainFact } from '../../server/utils/production-construction-scope-record'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSubcontractContractService } from '../../server/utils/production-subcontract-contract-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'

export async function createSubcontractFixture() {
  const base = resolve('.tmp/opt-02/subcontract-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/subcontract-`)
  const options = { directory, workspaceId: 'subcontract-workspace', ownerId: 'subcontract-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  let actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['subcontract-contract:read', 'subcontract-contract:write', 'subcontract-contract:import', 'construction-scope:read', 'construction-scope:write', 'construction-contract:read', 'construction-contract:write', 'project:list:read', 'project:write', 'customer:list:read', 'customer:write', 'supplier:list:read', 'supplier:write', 'our-signatory:read', 'our-signatory:write'] }
  const session = () => structuredClone(actor)
  const baseCommand = { workspaceId: actor.workspaceId, actorId: actor.actorId, baseVersion: null, action: 'save', attachments: {} }
  const customer = await createProductionCustomerService(storage).execute({ ...baseCommand, commandId: 'subcontract-customer', requiredCapability: 'customer:write', draft: { name: '分包正式甲方', contact: '合成联系人' } }, session)
  const project = await createProductionProjectService(storage).execute({ ...baseCommand, commandId: 'subcontract-project', requiredCapability: 'project:write', draft: { name: '分包正式工程', customerId: customer.id, manager: '合成负责人' } }, session)
  const supplier = await createProductionSupplierService(storage).execute({ ...baseCommand, commandId: 'subcontract-supplier', requiredCapability: 'supplier:write', draft: { name: '分包正式分供方', supplierCategory: '其他', contact: '合同联系人', contactPhone: '13900000000' } }, session)
  const signatory = await createProductionOurSignatoryService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'subcontract-signatory', requiredCapability: 'our-signatory:write', baseVersion: null, draft: { name: '分包正式我方', taxNo: 'SUBCONTRACT-VERIFICATION', registeredAddress: null, legalRepresentative: null, verificationNote: '合成正式我方核验', status: 'active' } }, session)
  const construction = createProductionConstructionContractService(storage)
  const main = await construction.execute({ ...baseCommand, commandId: 'subcontract-main', requiredCapability: 'construction-contract:write', draft: { name: '分包所属施工主合同', no: 'MAIN-SUB', projectId: project.id, customerId: customer.id, signDate: '2026-10-07', content: '真实上游施工范围', amount: 0, taxRate: 0, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, managementFeeAmount: 0, managementFeeBasis: '明确零配置' } }, session)
  const selected = await storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, actor, main.id))
  const constructionMain = { id: selected.id, projectId: selected.projectId!, basis: selected.basis }
  const service = createProductionSubcontractContractService(storage)
  let sequence = 0
  const command = (overrides: Partial<SubcontractContractCommandRequestDTO> = {}): SubcontractContractCommandRequestDTO => ({ ...baseCommand, commandId: `subcontract-command-${++sequence}`, requiredCapability: 'subcontract-contract:write', action: 'submit', constructionMain, draft: { name: '真实分包合同', no: `SUB-${sequence}`, subKind: '劳务', projectId: project.id, supplierId: supplier.id, content: '原劳务范围', signDate: '2026-10-07', amount: 0, taxRate: 0, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version }, attachments: { add: [{ fileName: '分包签约.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] }, ...overrides })
  return { options, storage, session, service, command, customer, project, supplier, signatory, main, constructionMain, setActor: (value: typeof actor) => {
    actor = value
  } }
}
