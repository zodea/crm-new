import type { BusinessSession } from '../../server/utils/business-session'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { Buffer } from 'node:buffer'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { wbsBytesDigest } from '../../server/utils/production-wbs-files'

interface Fixture { storage: ProductionStorage, project: { id: string }, session: () => BusinessSession, setActor: (actor: BusinessSession) => void }
export async function createWbsActualBoqFixture(f: Fixture) {
  const { createProductionCustomerService } = await import('../../server/utils/production-customer-service')
  const { createProductionOurSignatoryService } = await import('../../server/utils/production-our-signatory-service')
  const { createProductionConstructionContractService } = await import('../../server/utils/production-construction-contract-service')
  const { createProductionBoqService } = await import('../../server/utils/production-boq-service')
  const { boqDigest } = await import('../../server/utils/production-boq-record')
  const XLSX = await import('xlsx')
  f.setActor({ ...f.session(), capabilities: [...f.session().capabilities, 'customer:list:read', 'customer:write', 'our-signatory:read', 'our-signatory:write', 'construction-contract:read', 'construction-contract:write', 'boq:read', 'boq:write', 'owner-document:read', 'owner-document:write'] })
  const actor = f.session()
  const base = { workspaceId: actor.workspaceId, actorId: actor.actorId, baseVersion: null, action: 'draft' as const, attachments: {} }
  const customer = await createProductionCustomerService(f.storage).execute({ ...base, requiredCapability: 'customer:write', commandId: 'wbs-upstream-customer', draft: { name: 'WBS实际甲方' } }, f.session)
  const projects = createProductionProjectService(f.storage)
  const project = await projects.form(f.project.id, f.session)
  await projects.execute({ ...base, id: f.project.id, baseVersion: project.version, requiredCapability: 'project:write', commandId: 'wbs-upstream-project-customer', draft: { ...project.draft, customerId: customer.id } }, f.session)
  const signatory = await createProductionOurSignatoryService(f.storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, baseVersion: null, requiredCapability: 'our-signatory:write', commandId: 'wbs-upstream-signatory', draft: { name: 'WBS正式签约公司', taxNo: 'WBS-REAL', registeredAddress: null, legalRepresentative: null, verificationNote: '实际原件核实', status: 'active' } }, f.session)
  const construction = createProductionConstructionContractService(f.storage)
  const main = await construction.execute({ ...base, action: 'save', commandId: 'wbs-upstream-main', requiredCapability: 'construction-contract:write', draft: { name: 'WBS真实施工主合同', no: 'WBS-MAIN', projectId: f.project.id, customerId: customer.id, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, content: '真实合同楼栋范围', signDate: '2026-10-07', status: '履约中', amount: null, taxRate: 0 } }, f.session)
  const owner = createProductionBoqService(f.storage)
  const scope = { projectId: f.project.id, contractId: main.id, origin: 'real' as const }
  const read = await owner.read(scope, f.session)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['分项名称', '单位', '工程量', '合同单价', '楼栋'], ['墙面原清单', '㎡', 0, 12, 'B'], ['踢脚原清单', 'm', 4, 20, 'B']]), '原清单')
  const bytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
  const rows = [{ itemCode: 'WALL', itemName: '墙面原清单', unit: '㎡', qty: 0, unitPrice: 12, amount: 0, sourceRow: 2 }, { itemCode: 'ZERO', itemName: '踢脚原清单', unit: 'm', qty: 4, unitPrice: 20, amount: 80, sourceRow: 3 }].map(row => ({ ...row, section: '装修', trade: '油漆工', totalQty: null, building: 'B', unitType: '', multiplier: null, room: '', floorZone: '', spec: '', taxRate: null, ownerSupplied: false, sourceSheet: '原清单' }))
  const command = { ...scope, workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'boq:write' as const, commandId: 'wbs-actual-boq-import', contractVersion: read.contractVersion, action: { kind: 'import-file' as const, original: { fileName: '真实施工清单.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: bytes.length, sha256: wbsBytesDigest(bytes), payloadBase64: bytes.toString('base64') }, formatClass: 'D' as const, rows, bindings: await Promise.all(['wbs-i', 'wbs-z'].map(async (id, index) => ({ rowKey: String(index), itemId: id, itemVersion: boqDigest((await f.storage.select<Record<string, unknown>>('SELECT * FROM items WHERE id=?', [id]))[0]!) }))) } }
  const saved = await owner.execute(command, f.session)
  return { owner, construction, main, scope, command, saved, signatory, customer }
}
