import type { BusinessSession } from '../../server/utils/business-session'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import * as XLSX from 'xlsx'
import { createProductionBoqService } from '../../server/utils/production-boq-service'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'

/** Actual registered owners and bytes; no development singleton or direct SQL seeding of BOQ facts. */
export async function installProductionBoqFixture(storage: ProductionStorage, actor: BusinessSession, projectId: string, values: { qty?: number, unitPrice?: number, building?: string, itemName?: string } = {}) {
  for (const capability of ['boq:read', 'boq:write', 'owner-document:read', 'owner-document:write', 'construction-contract:read', 'construction-contract:write', 'customer:list:read', 'customer:write', 'project:list:read', 'project:write', 'our-signatory:read', 'our-signatory:write']) {
    if (!actor.capabilities.includes(capability))
      actor.capabilities.push(capability)
  }
  const session = () => structuredClone(actor)
  const prefix = `boq-fixture-${randomUUID().slice(0, 8)}`
  const identity = { workspaceId: actor.workspaceId, actorId: actor.actorId }
  const projects = createProductionProjectService(storage)
  const original = await projects.form(projectId, session)
  let customerId = original.draft.customerId
  if (!customerId) {
    const customer = await createProductionCustomerService(storage).execute({ ...identity, commandId: `${prefix}-customer`, requiredCapability: 'customer:write', baseVersion: null, action: 'draft', draft: { name: 'BOQ合成核验甲方' }, attachments: {} }, session)
    customerId = customer.id
    await projects.execute({ ...identity, commandId: `${prefix}-project-customer`, requiredCapability: 'project:write', baseVersion: original.version, action: 'draft', draft: { ...original.draft, customerId }, attachments: {} }, session)
  }
  const signatory = await createProductionOurSignatoryService(storage).execute({ ...identity, commandId: `${prefix}-signatory`, requiredCapability: 'our-signatory:write', baseVersion: null, draft: { name: 'BOQ合成核验我方', taxNo: `${prefix}-TAX`, registeredAddress: null, legalRepresentative: null, verificationNote: '合成实际服务核验', status: 'active' } }, session)
  const construction = createProductionConstructionContractService(storage)
  const main = await construction.execute({ ...identity, commandId: `${prefix}-main`, requiredCapability: 'construction-contract:write', baseVersion: null, action: 'save', draft: { name: 'BOQ实际主合同', no: `${prefix}-MAIN`, projectId, customerId, content: '合成实际施工范围', signDate: '2026-07-01', status: '履约中', amount: null, taxRate: 0, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version }, attachments: {} }, session)
  const scope = { projectId, contractId: main.id, origin: 'real' as const }
  const owner = createProductionBoqService(storage)
  const basis = await owner.read(scope, session)
  const qty = values.qty ?? 0
  const unitPrice = values.unitPrice ?? 17
  const itemName = values.itemName ?? 'BOQ实际分项'
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['分项名称', '单位', '工程量', '合同单价'], [itemName, '㎡', qty, unitPrice]]), '实际原清单')
  const bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  const row = { section: '装修', trade: '油漆工', itemCode: '', itemName, unit: '㎡', qty, totalQty: null, unitPrice, amount: qty * unitPrice, building: values.building ?? '', unitType: '', multiplier: null, room: '', floorZone: '', spec: '', taxRate: null, ownerSupplied: false, sourceSheet: '实际原清单', sourceRow: 2 }
  const command = { ...identity, ...scope, commandId: `${prefix}-file`, requiredCapability: 'boq:write' as const, contractVersion: basis.contractVersion, action: { kind: 'import-file' as const, original: { fileName: '真实原清单.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }, formatClass: 'D' as const, rows: [row], bindings: [{ rowKey: '0', itemId: null, itemVersion: null }] } }
  const saved = await owner.execute(command, session)
  return { owner, construction, main, scope, saved, command, line: (await owner.read(scope, session)).lines.find(line => line.id === saved.lineIds![0])!, session }
}
