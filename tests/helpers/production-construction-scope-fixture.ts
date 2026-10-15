import type { ConstructionScopeCommand, ConstructionScopeRead } from '../../app/lib/construction-scope/contract'
import type { BusinessSession } from '../../server/utils/business-session'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { FINANCE_FAMILIES } from '../../app/lib/finance/central-contract'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { readProductionConstructionScopeMainFact } from '../../server/utils/production-construction-scope-record'
import { createProductionConstructionScopeService } from '../../server/utils/production-construction-scope-service'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionMaterialContractService } from '../../server/utils/production-material-contract-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createSeededProductionStorage } from './production-storage-seed'

/** Only actual identity/upstream owners; no expense, material contract or cash fixture is added. */
export async function installConstructionEngineeringFixture(storage: ProductionStorage, actor: BusinessSession, prefix = 'actual-engineering') {
  for (const capability of ['customer:list:read', 'customer:write', 'project:list:read', 'project:write', 'our-signatory:read', 'our-signatory:write', 'construction-contract:read', 'construction-contract:write', 'construction-scope:read', 'construction-scope:write']) {
    if (!actor.capabilities.includes(capability))
      actor.capabilities.push(capability)
  }
  const session = () => structuredClone(actor)
  const base = { workspaceId: actor.workspaceId, actorId: actor.actorId, baseVersion: null, action: 'save', attachments: {} }
  const customer = await createProductionCustomerService(storage).execute({ ...base, commandId: `${prefix}-customer`, requiredCapability: 'customer:write', draft: { name: '实际工程甲方', contact: '合成联系人' } }, session)
  const project = await createProductionProjectService(storage).execute({ ...base, commandId: `${prefix}-project`, requiredCapability: 'project:write', draft: { name: '实际业务工程', customerId: customer.id, manager: '合成负责人' } }, session)
  const signatory = await createProductionOurSignatoryService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: `${prefix}-signatory`, requiredCapability: 'our-signatory:write', baseVersion: null, draft: { name: '实际签约我方', taxNo: `${prefix}-TAX`, registeredAddress: null, legalRepresentative: null, verificationNote: '合成工程身份核验', status: 'active' } }, session)
  const main = await createProductionConstructionContractService(storage).execute({ ...base, commandId: `${prefix}-main`, requiredCapability: 'construction-contract:write', draft: { name: '实际施工主合同', projectId: project.id, customerId: customer.id, content: '实际业务范围', signDate: '2026-10-05', amount: null, taxRate: 0, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version } }, session)
  const fact = await storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, actor, main.id))
  return { project, customer, signatory, main, constructionMain: { id: fact.id, projectId: project.id, basis: fact.basis } }
}

export async function createConstructionScopeFixture() {
  const base = resolve('.tmp/opt-02/construction-scope-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const options = { directory, workspaceId: 'scope-workspace', ownerId: 'scope-owner', purpose: 'verification' as const }
  const storage = await createSeededProductionStorage(options)
  const actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['construction-scope:read', 'construction-scope:write', 'construction-contract:read', 'construction-contract:write', 'material-contract:read', 'material-contract:write', 'subcontract-contract:read', 'auxiliary-contract:read', 'project:list:read', 'project:write', 'customer:list:read', 'customer:write', 'supplier:list:read', 'supplier:write', 'our-signatory:read', 'our-signatory:write', ...Object.values(FINANCE_FAMILIES).flatMap(family => [`${family}:read`, `${family}:write`])] }
  const session = () => structuredClone(actor)
  const baseCommand = { workspaceId: actor.workspaceId, actorId: actor.actorId, baseVersion: null, action: 'save', attachments: {} }
  const customer = await createProductionCustomerService(storage).execute({ ...baseCommand, requiredCapability: 'customer:write', commandId: 'scope-customer', draft: { name: '关联核验甲方', contact: '合成联系人' } }, session)
  const project = await createProductionProjectService(storage).execute({ ...baseCommand, requiredCapability: 'project:write', commandId: 'scope-project', draft: { name: '关联核验项目', customerId: customer.id, manager: '合成负责人' } }, session)
  const otherProject = await createProductionProjectService(storage).execute({ ...baseCommand, requiredCapability: 'project:write', commandId: 'scope-other-project', draft: { name: '其他真实项目', customerId: customer.id, manager: '合成负责人' } }, session)
  const supplier = await createProductionSupplierService(storage).execute({ ...baseCommand, requiredCapability: 'supplier:write', commandId: 'scope-supplier', draft: { name: '真实材料及服务商', supplierCategory: '其他', contact: '合成联系人' } }, session)
  const signatory = await createProductionOurSignatoryService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'our-signatory:write', commandId: 'scope-signatory', baseVersion: null, draft: { name: '正式我方', taxNo: 'SCOPE-VERIFICATION', registeredAddress: null, legalRepresentative: null, verificationNote: '合成核验签约主体', status: 'active' } }, session)
  const construction = createProductionConstructionContractService(storage)
  const main = await construction.execute({ ...baseCommand, commandId: 'scope-main', requiredCapability: 'construction-contract:write', draft: { name: '施工主合同甲', no: 'MAIN-SCOPE-A', projectId: project.id, customerId: customer.id, content: '真实项目施工范围', signDate: '2026-10-07', amount: 0, taxRate: 0, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, managementFeeAmount: 0, managementFeeBasis: '明确零配置' } }, session)
  const secondMain = await construction.execute({ ...baseCommand, commandId: 'scope-main-b', requiredCapability: 'construction-contract:write', draft: { name: '施工主合同乙', no: 'MAIN-SCOPE-B', projectId: project.id, customerId: customer.id, content: '真实项目其他施工范围', signDate: '2026-10-07', amount: null, taxRate: 0, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, managementFeeAmount: 0, managementFeeBasis: '明确零配置' } }, session)
  const materialService = createProductionMaterialContractService(storage)
  const selectedMain = await storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, actor, main.id))
  const constructionMain = { id: selectedMain.id, projectId: selectedMain.projectId!, basis: selectedMain.basis }
  const material = await materialService.execute({ ...baseCommand, action: 'submit', commandId: 'scope-material', requiredCapability: 'material-contract:write', constructionMain, draft: { name: '材料采购实际来源', no: 'MATERIAL-SCOPE', projectId: project.id, supplierId: supplier.id, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, content: '原材料合同', signDate: '2026-10-07', amount: 100, lineItems: [{ materialName: '材料', unit: '件', qty: 1, taxInclusiveUnitPrice: 100 }], taxRate: 0 }, attachments: { add: [{ fileName: '材料原件.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] } }, session)
  const finance = createProductionFinanceService(storage)
  const expense = await finance.execute({ ...baseCommand, commandId: 'scope-expense', kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', draft: { projectId: project.id, constructionMain, applicantSupplierId: supplier.id, reimbursementDate: '2026-10-07', status: 'confirmed', lines: [{ expenseItem: '检测实际业务费用', counterpartySupplierId: supplier.id, amount: 40 }, { expenseItem: '另一个实际费用', counterpartySupplierId: supplier.id, amount: 60 }] } }, session)
  const expenseRead = await finance.form('reimbursement', expense.id, session)
  const expenseId = expenseRead.draft.lines[0]!.id!
  const otherExpenseId = expenseRead.draft.lines[1]!.id!
  const scope = createProductionConstructionScopeService(storage)
  return { storage, options, actor, session, project, otherProject, customer, supplier, signatory, construction, main, secondMain, material, materialService, finance, expense, expenseId, otherExpenseId, scope }
}
export function constructionScopeCommand(read: ConstructionScopeRead, commandId: string, mainId = read.candidates[0]?.id ?? null): ConstructionScopeCommand {
  if (!read.projectId || !read.sourceBasis)
    throw new Error('测试必须读取真实正式来源')
  return { workspaceId: read.workspaceId, actorId: read.actorId, requiredCapability: 'construction-scope:write', commandId, source: read.source, projectId: read.projectId, action: mainId ? 'bind' : 'unbind', mainId, baseVersion: read.relation?.version ?? null, sourceBasis: read.sourceBasis, mainBasis: mainId ? read.candidates.find(row => row.id === mainId)!.basis : null }
}
