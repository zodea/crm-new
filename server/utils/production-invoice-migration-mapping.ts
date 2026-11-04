import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { InvoiceContractReference } from '../../app/lib/invoice/central-contract'
import type { BusinessSession } from './business-session'
import type { ProductionStorage } from './production-storage'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { resolveContractSignatory } from '../../app/lib/our-signatory/storage'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { verifyInvoiceContractReference, verifyLegacyInvoiceCompanyReference } from './production-invoice-contracts'
import { verifyLegacyInvoiceOriginal } from './production-invoice-migration-original'
import { prepareLegacyInvoicePlan, validateLegacyInvoiceEntry } from './production-invoice-migration-plan'
import { readLegacyInvoiceSource } from './production-invoice-migration-source'
import { readMigrationReference } from './production-migration-references'

type Source = Awaited<ReturnType<typeof readLegacyInvoiceSource>>
interface MasterMapping { legacyId: string, targetId: string, version: string, sourceVersion: string }
interface ContractMapping { legacyId: string, target: InvoiceContractReference }
export interface InvoiceLegacyMappings { projects: MasterMapping[], suppliers: MasterMapping[], contracts: ContractMapping[], companyInvoices?: LegacyCompanyInvoiceMapping[] }
export interface LegacyCompanyInvoiceMapping {
  invoiceId: string
  legacyContractId: string
  target: InvoiceContractReference & { domain: 'company' }
  supplierId: string
  supplierVersion: string
  supplierSourceVersion: string
  buyerId: string
  buyerVersion: string
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(value)
function fail(code: 'validation-failed' | 'conflict' | 'unavailable', message: string): never {
  throw new CentralInvoiceProblem(code, `发票迁入预检：${message}；完整原库保持不变。`)
}

/** 公司关联仅在逐票显式选择及同源合同、主体、分供方均核验后提供计划。 */
export async function validateLegacyCompanyInvoiceMappings(
  tx: TransactionDb,
  actor: BusinessSession,
  source: Source,
  rows: LegacyCompanyInvoiceMapping[],
  mapped: Map<string, string>,
  dependencies: { readReference?: typeof readMigrationReference, readBuyer?: typeof resolveContractSignatory, verifyCompany?: typeof verifyLegacyInvoiceCompanyReference } = {},
) {
  if (!actor.capabilities.includes('our-signatory:read') || !actor.capabilities.includes('supplier:list:read'))
    throw new CentralInvoiceProblem('forbidden', '公司发票迁入须读取我方主体和分供方资料。')
  const invoices = source.graph.filter(invoice => invoice.head.company_expense_contract_id != null && invoice.head.company_expense_contract_id !== '')
  if (!Array.isArray(rows) || rows.length !== invoices.length || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row)) || new Set(rows.map(row => row.invoiceId)).size !== rows.length)
    return fail('validation-failed', '公司发票须逐票明确映射，不能遗漏或重复')
  const result = new Map<string, LegacyCompanyInvoiceMapping>()
  for (const row of rows) {
    const invoice = invoices.find(item => item.head.id === row.invoiceId)
    if (Object.keys(row).sort().join(',') !== 'buyerId,buyerVersion,invoiceId,legacyContractId,supplierId,supplierSourceVersion,supplierVersion,target'
      || !id(row.invoiceId) || !id(row.legacyContractId) || !id(row.supplierId) || !id(row.buyerId)
      || ![row.supplierVersion, row.buyerVersion].every(value => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)))
      || typeof row.supplierSourceVersion !== 'string' || !row.supplierSourceVersion
      || !row.target || Object.keys(row.target).sort().join(',') !== 'domain,id,version' || row.target.domain !== 'company' || !id(row.target.id)
      || typeof row.target.version !== 'string' || !/^[1-9]\d*$/.test(row.target.version) || !Number.isSafeInteger(Number(row.target.version))
      || !invoice || invoice.head.company_expense_contract_id !== row.legacyContractId
      || !source.references.some(reference => reference.table === 'company_expense_contracts' && reference.id === row.legacyContractId)) {
      return fail('validation-failed', '公司发票的原表、身份或目标版本无效')
    }
    const oldSupplier = invoice.head.supplier_id
    if (oldSupplier != null && oldSupplier !== '' && mapped.get(`suppliers:${oldSupplier}`) !== row.supplierId)
      return fail('validation-failed', '显式选择与旧发票分供方映射不一致')
    const supplier = await (dependencies.readReference ?? readMigrationReference)(tx, actor, 'suppliers', row.supplierId)
    if (!supplier || supplier.serverId !== row.supplierId || supplier.version !== row.supplierVersion || supplier.sourceVersion !== row.supplierSourceVersion)
      return fail('conflict', '公司发票分供方目录已变化，请重新选择')
    let buyer
    try {
      buyer = await (dependencies.readBuyer ?? resolveContractSignatory)(tx, { id: row.buyerId, version: row.buyerVersion, required: true })
    }
    catch (cause) {
      const problem = cause && typeof cause === 'object' && 'problem' in cause ? cause.problem : null
      const code = problem && typeof problem === 'object' && 'code' in problem ? problem.code : null
      if (code === 'conflict')
        return fail('conflict', '公司发票我方主体版本已变化，请重新选择')
      if (code === 'validation-failed')
        return fail('validation-failed', '公司发票我方主体不存在或已停用')
      return fail('unavailable', '公司发票我方主体资料无法核实')
    }
    if (!buyer || buyer.id !== row.buyerId || buyer.version !== row.buyerVersion)
      return fail('conflict', '公司发票我方主体已变化，请重新选择')
    await (dependencies.verifyCompany ?? verifyLegacyInvoiceCompanyReference)(tx, actor, row.target, row.supplierId, row.buyerId, source.sha256, row.legacyContractId)
    result.set(row.invoiceId, row)
  }
  return result
}

/** 同一只读目标事务核对完整旧库和用户显式映射，不产生任何迁入事实。 */
export async function previewLegacyInvoiceMappings(
  storage: ProductionStorage,
  input: { source: { sha256: string, payloadBase64: string }, mappings: InvoiceLegacyMappings },
  session: () => BusinessSession,
  dependencies: { readReference?: typeof readMigrationReference, verifyContract?: typeof verifyInvoiceContractReference, readBuyer?: typeof resolveContractSignatory, verifyCompany?: typeof verifyLegacyInvoiceCompanyReference } = {},
) {
  const authorize = () => {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId
      || !actor.capabilities.includes('finance-invoice:read') || !actor.capabilities.includes('finance-invoice:import')) {
      throw new CentralInvoiceProblem('forbidden', '当前身份无发票旧库映射预检权限。')
    }
    return actor
  }
  const identityKey = (actor: BusinessSession) => JSON.stringify({ workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities].sort() })
  const originalActor = identityKey(authorize())
  return withVerifiedMigrationSnapshot(input.source, async (native, evidence) => {
    const source = await readLegacyInvoiceSource(native, evidence, { inspectCompany: Object.hasOwn(input.mappings, 'companyInvoices') })
    return storage.withTransaction(async (tx) => {
      const actor = authorize()
      if (identityKey(actor) !== originalActor)
        throw new CentralInvoiceProblem('forbidden', '映射预检期间身份或权限已变化。')
      const result = await validateLegacyInvoiceMappings(tx, actor, source, input.mappings, dependencies)
      const plan = prepareLegacyInvoicePlan(source, result, { allowIncompleteHistory: true })
      for (const entry of plan.entries) {
        validateLegacyInvoiceEntry(entry)
        await verifyLegacyInvoiceOriginal(tx, entry.sourceFiles)
      }
      if (identityKey(authorize()) !== originalActor)
        throw new CentralInvoiceProblem('forbidden', '映射预检期间身份或权限已变化。')
      return { sourceSha256: source.sha256, invoiceCount: source.graph.length, missingAllocationIds: result.dependenciesMissing, orphanLogCount: result.orphanLogCount }
    })
  })
}

/** 只核验映射和当前来源，不创建发票，也不改写已有票款历史。 */
export async function validateLegacyInvoiceMappings(
  tx: TransactionDb,
  actor: BusinessSession,
  source: Source,
  mappings: InvoiceLegacyMappings,
  dependencies: { readReference?: typeof readMigrationReference, verifyContract?: typeof verifyInvoiceContractReference, readBuyer?: typeof resolveContractSignatory, verifyCompany?: typeof verifyLegacyInvoiceCompanyReference } = {},
) {
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings) || !['contracts,projects,suppliers', 'companyInvoices,contracts,projects,suppliers'].includes(Object.keys(mappings).sort().join(','))
    || !Array.isArray(mappings.projects) || !Array.isArray(mappings.suppliers) || !Array.isArray(mappings.contracts) || (mappings.companyInvoices !== undefined && !Array.isArray(mappings.companyInvoices))) {
    return fail('validation-failed', '映射结构无效')
  }
  const readReference = dependencies.readReference ?? readMigrationReference
  const verifyContract = dependencies.verifyContract ?? verifyInvoiceContractReference
  const mapped = new Map<string, string>()
  for (const table of ['projects', 'suppliers'] as const) {
    const rows = mappings[table]
    const sourceRefs = source.references.filter(reference => reference.table === table)
    if (rows.length !== sourceRefs.length || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row)) || new Set(rows.map(row => row.legacyId)).size !== rows.length)
      return fail('validation-failed', `${table} 必须逐项映射，不能遗漏或重复`)
    for (const row of rows) {
      if (!row || Object.keys(row).sort().join(',') !== 'legacyId,sourceVersion,targetId,version' || !id(row.legacyId) || !id(row.targetId)
        || typeof row.version !== 'string' || !/^[1-9]\d*$/.test(row.version) || typeof row.sourceVersion !== 'string' || !row.sourceVersion
        || !sourceRefs.some(reference => reference.id === row.legacyId)) {
        return fail('validation-failed', `${table} 映射身份或版本无效`)
      }
      const actual = await readReference(tx, actor, table, row.targetId)
      if (!actual || actual.serverId !== row.targetId || actual.version !== row.version || actual.sourceVersion !== row.sourceVersion)
        return fail('conflict', `${table} 当前身份或版本已变化，请重新核对`)
      mapped.set(`${table}:${row.legacyId}`, actual.serverId)
    }
  }
  const contractRefs = source.references.filter(reference => reference.table === 'contracts')
  if (mappings.contracts.length !== contractRefs.length || mappings.contracts.some(row => !row || typeof row !== 'object' || Array.isArray(row)) || new Set(mappings.contracts.map(row => row.legacyId)).size !== mappings.contracts.length)
    return fail('validation-failed', '原合同必须逐项映射，不能遗漏或重复')
  const domains: Record<string, InvoiceContractReference['domain']> = { 施工: 'construction', 分包: 'subcontract', 材采: 'material', 其他支出: 'auxiliary' }
  const contractByLegacy = new Map<string, InvoiceContractReference>()
  for (const mapping of mappings.contracts) {
    const reference = contractRefs.find(item => item.id === mapping.legacyId)
    if (!mapping || Object.keys(mapping).sort().join(',') !== 'legacyId,target' || !id(mapping.legacyId) || !reference || !mapping.target
      || Object.keys(mapping.target).sort().join(',') !== 'domain,id,version' || !id(mapping.target.id)
      || typeof mapping.target.version !== 'string' || !/^[1-9]\d*$/.test(mapping.target.version) || !Number.isSafeInteger(Number(mapping.target.version))
      || typeof reference.row.kind !== 'string' || domains[reference.row.kind] !== mapping.target.domain) {
      return fail('validation-failed', '原合同类别或目标身份不一致')
    }
    contractByLegacy.set(mapping.legacyId, mapping.target)
  }
  const hasCompany = source.graph.some(invoice => invoice.head.company_expense_contract_id != null && invoice.head.company_expense_contract_id !== '')
  const companyByInvoice = hasCompany ? await validateLegacyCompanyInvoiceMappings(tx, actor, source, mappings.companyInvoices ?? [], mapped, dependencies) : undefined
  if (!hasCompany && mappings.companyInvoices?.length)
    return fail('validation-failed', '来源没有公司发票，不能附加无关映射')
  const dependenciesMissing: string[] = []
  for (const invoice of source.graph) {
    const legacyId = String(invoice.head.id)
    if ((await tx.select('SELECT id FROM invoices WHERE id=?', [legacyId])).length)
      return fail('conflict', '原发票身份已被中央记录占用，不能覆盖或自动合并')
    const projectId = invoice.head.project_id == null || invoice.head.project_id === '' ? null : mapped.get(`projects:${invoice.head.project_id}`)
    const supplierId = invoice.head.supplier_id == null || invoice.head.supplier_id === '' ? null : mapped.get(`suppliers:${invoice.head.supplier_id}`)
    if (projectId === undefined || supplierId === undefined)
      return fail('validation-failed', '发票项目或分供方缺少明确映射')
    if (invoice.head.contract_id != null && invoice.head.contract_id !== '') {
      const contract = contractByLegacy.get(String(invoice.head.contract_id))
      if (!contract)
        return fail('validation-failed', '发票合同缺少明确映射')
      await verifyContract(tx, actor, contract, projectId, supplierId)
    }
    const targetAllocations = await tx.select<{ id: string }>('SELECT id FROM payment_application_invoice_allocations WHERE invoice_id=?', [legacyId])
    if (targetAllocations.some(row => !invoice.allocations.some(allocation => allocation.id === row.id)))
      return fail('conflict', '中央付款分摊包含不属于此旧发票来源的历史，不能按相同编号自动合并')
    for (const allocation of invoice.allocations) {
      const current = (await tx.select<Record<string, unknown>>('SELECT * FROM payment_application_invoice_allocations WHERE id=?', [allocation.id]))[0]
      if (!current) {
        dependenciesMissing.push(String(allocation.id))
        continue
      }
      if (['id', 'invoice_id', 'payment_application_id', 'allocated_amount', 'deleted_at', 'note', 'created_at', 'updated_at']
        .some(key => Object.hasOwn(allocation, key) && current[key] !== allocation[key])) {
        return fail('conflict', '既有付款分摊与旧发票身份或历史事实不一致')
      }
    }
  }
  return { mapped, contractByLegacy, dependenciesMissing, orphanLogCount: source.orphanLogs.length, ...(companyByInvoice ? { companyByInvoice } : {}) }
}
