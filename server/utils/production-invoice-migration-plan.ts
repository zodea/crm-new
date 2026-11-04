import type { CentralInvoiceFields, CentralInvoiceItem } from '../../app/lib/invoice/central-contract'
import type { LegacyCompanyInvoiceMapping, validateLegacyInvoiceMappings } from './production-invoice-migration-mapping'
import type { readLegacyInvoiceSource } from './production-invoice-migration-source'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { isISODateDTO, isISODateTimeDTO } from '../../app/types/read-model'

type Source = Awaited<ReturnType<typeof readLegacyInvoiceSource>>
type Mapping = Awaited<ReturnType<typeof validateLegacyInvoiceMappings>>

export function normalizeLegacyInvoiceItems(raw: unknown): { values: CentralInvoiceItem[], ambiguous: boolean } {
  function invalid(): never {
    throw new CentralInvoiceProblem('validation-failed', '旧发票明细无法可靠表达；完整原库保持不变。')
  }
  if (typeof raw !== 'string')
    return invalid()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch { return invalid() }
  if (!Array.isArray(parsed) || parsed.length > 2000)
    return invalid()
  let ambiguous = false
  const values = parsed.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return invalid()
    const row = item as Record<string, unknown>
    const number = (key: string) => {
      const value = row[key]
      if (value === null || value === undefined || value === 0) {
        ambiguous = true
        return null
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000)
        return invalid()
      return value
    }
    const text = (key: string) => {
      const value = row[key]
      if (value === null || value === undefined)
        return ''
      if (typeof value !== 'string' || value.length > 500)
        return invalid()
      return value
    }
    return { name: text('name'), spec: text('spec'), unit: text('unit'), quantity: number('quantity'), unitPrice: number('unitPrice'), amount: number('amount'), taxRate: text('taxRate'), taxAmount: number('taxAmount') }
  })
  return { values, ambiguous }
}

/** 创建待提交的来源计划；不写库，也不将旧状态伪装成新的识别或核对回执。 */
export function prepareLegacyInvoicePlan(source: Source, mapping: Mapping & { companyByInvoice?: Map<string, LegacyCompanyInvoiceMapping> }, options: { allowIncompleteHistory?: boolean } = {}) {
  if (mapping.dependenciesMissing.length && !options.allowIncompleteHistory)
    throw new CentralInvoiceProblem('conflict', '旧付款分摊尚未完整迁入，不能发布发票批次。')
  const entries = source.graph.map((invoice) => {
    const head = invoice.head
    const reference = (table: 'projects' | 'suppliers', value: unknown) => {
      if (value === null || value === undefined || value === '')
        return null
      const target = mapping.mapped.get(`${table}:${String(value)}`)
      if (!target)
        throw new CentralInvoiceProblem('validation-failed', '旧发票关联缺少明确映射。')
      return target
    }
    const companyReference = head.company_expense_contract_id == null || head.company_expense_contract_id === '' ? null : mapping.companyByInvoice?.get(String(head.id))
    if (head.company_expense_contract_id != null && head.company_expense_contract_id !== '' && !companyReference)
      throw new CentralInvoiceProblem('validation-failed', '旧公司发票缺少明确且经核验的合同和主体映射。')
    const contract = companyReference ? companyReference.target : head.contract_id == null || head.contract_id === '' ? null : mapping.contractByLegacy.get(String(head.contract_id))
    if (contract === undefined)
      throw new CentralInvoiceProblem('validation-failed', '旧发票合同缺少明确映射。')
    const amounts: Record<string, number | null> = {}
    for (const key of ['amount', 'tax_amount', 'total_amount']) {
      const value = head[key]
      if (!(value === null || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000_000)))
        throw new CentralInvoiceProblem('validation-failed', '旧发票金额无法安全表达，请保留原库并人工核对。')
      // 旧 store 曾把未知金额写为零；原值仍在 sourceHead 中，不能声称它是真实零。
      amounts[key] = value === 0 ? null : value
    }
    return {
      id: String(head.id),
      projectId: reference('projects', head.project_id),
      supplierId: companyReference ? companyReference.supplierId : reference('suppliers', head.supplier_id),
      contract,
      ...(companyReference ? { companyAdoption: companyReference } : {}),
      amounts,
      ambiguousZeroFields: [...invoice.ambiguousZeroFields],
      originalState: invoice.originalState,
      sourceHead: head,
      sourceFiles: invoice.files,
      sourceAllocations: invoice.allocations,
      sourceLogs: invoice.logs,
    }
  })
  const applicationIds = new Set(source.graph.flatMap(invoice => invoice.allocations.map(allocation => allocation.payment_application_id)))
  return { sourceSha256: source.sha256, sourceSchemaVersion: source.schemaVersion, sourceSchema: source.schema, sourceReferences: source.references, sourceApplications: source.applications.filter(application => applicationIds.has(application.id)), orphanLogs: source.orphanLogs, entries }
}

/** 预检与发布共用同一组旧票校验；不改变原始证据或写入中央库。 */
export function validateLegacyInvoiceEntry(entry: ReturnType<typeof prepareLegacyInvoicePlan>['entries'][number]) {
  const head = entry.sourceHead
  function fail(message: string): never {
    throw new CentralInvoiceProblem('validation-failed', `旧发票迁入：${message}；完整原库保持不变。`)
  }
  function text(key: string, max = 500): string {
    const value = head[key]
    if (value === null)
      return ''
    if (typeof value !== 'string' || value.length > max)
      return fail(`旧字段 ${key} 无法安全表达`)
    return value
  }
  function timestamp(value: unknown): string | null {
    if (value === null || value === '')
      return null
    if (!isISODateTimeDTO(value))
      return fail('旧时间无法可靠表达，不能推测时区')
    return value
  }
  if (!['scan', 'excel'].includes(String(head.source)) || !['pending', 'processing', 'done', 'failed'].includes(String(head.ocr_status))
    || !['unreviewed', 'reviewed'].includes(String(head.review_status)) || !['none', 'archived'].includes(String(head.account_status)) || !['normal', 'duplicate'].includes(String(head.dup_status))) {
    return fail('旧来源或历史状态无法核验')
  }
  const item = normalizeLegacyInvoiceItems(head.items)
  const fields: CentralInvoiceFields = { invoiceNumber: text('invoice_number'), invoiceDate: text('invoice_date'), invoiceType: text('invoice_type'), buyer: text('buyer'), buyerTaxNo: text('buyer_tax_no'), seller: text('seller'), sellerTaxNo: text('seller_tax_no'), amount: entry.amounts.amount!, taxAmount: entry.amounts.tax_amount!, totalAmount: entry.amounts.total_amount!, taxRate: text('tax_rate'), remark: text('remark', 4000) }
  if (fields.invoiceDate && !isISODateDTO(fields.invoiceDate))
    return fail('旧开票日期无法可靠表达')
  const originalOwnerKind = head.owner_kind === null || head.owner_kind === '' ? null : head.owner_kind
  if (!(originalOwnerKind === null || originalOwnerKind === 'personal' || originalOwnerKind === 'project') || (originalOwnerKind === 'project' ? !entry.projectId : entry.projectId !== null))
    return fail('旧归属与项目关系不一致')
  const companyAdoption = 'companyAdoption' in entry ? entry.companyAdoption : undefined
  if (companyAdoption && (entry.projectId !== null || originalOwnerKind === 'project' || entry.contract?.domain !== 'company' || !entry.supplierId))
    return fail('旧公司发票的项目、合同或分供方映射不一致')
  const ownerKind = companyAdoption ? 'company' : originalOwnerKind
  const archivedAt = timestamp(head.archived_at)
  const deletedAt = timestamp(head.deleted_at)
  if ((head.account_status === 'archived' && (head.review_status !== 'reviewed' || !ownerKind || !archivedAt)) || (head.account_status === 'none' && archivedAt))
    return fail('旧归档状态、核对记录或时间不完整')
  if (!Number.isSafeInteger(head.print_count) || Number(head.print_count) < 0 || ![0, 90, 180, 270].includes(Number(head.print_rotation)))
    return fail('旧打印历史无法可靠表达')
  return { item, fields, ownerKind, archivedAt, deletedAt }
}
