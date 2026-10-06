import type { ContractLineItemDraft, ProjectContractFormDraft } from '../../app/lib/contract/forms'
import type { CoreMigrationServerEntityDTO } from '../../app/lib/migration/core-contract'
import type { MaterialContractSourceGraph } from '../../app/lib/migration/material-contract-source'
import type { MaterialContractMigrationRecord } from './material-contract-command-test-instance'
import { isDeepStrictEqual } from 'node:util'
import { decodeOurSignatorySnapshot } from '../../app/lib/our-signatory/contract'
import { contractMigratedAttachments } from './contract-original'

const string = (value: unknown) => typeof value === 'string' ? value : ''
function numeric(value: unknown, fail: (message: string) => never): number | null {
  if (value === null || value === undefined)
    return null
  return typeof value === 'number' && Number.isFinite(value) ? value : fail('材采旧图含无法核验的数值')
}
function timestamp(value: unknown, fail: (message: string) => never): string {
  const parsed = Date.parse(string(value))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fail('材采旧图缺少真实创建或更新时间')
}
export function materialMigratedLine(row: Record<string, unknown>, fail: (message: string) => never): ContractLineItemDraft {
  let source = null
  if (row.source_evidence != null) {
    try {
      source = JSON.parse(String(row.source_evidence))
    }
    catch { return fail('材采旧行来源证据损坏') }
  }
  return { id: string(row.id), materialName: string(row.material_name), spec: string(row.spec), materialGrade: string(row.material_grade), brand: string(row.brand), unit: string(row.unit), qty: numeric(row.qty, fail), taxInclusiveUnitPrice: numeric(row.tax_inclusive_unit_price, fail), applicableTaxRate: numeric(row.applicable_tax_rate, fail), plannedArrivalDate: string(row.planned_arrival_date), note: string(row.note), sortOrder: numeric(row.sort_order, fail) ?? 0, originalLineId: typeof row.original_line_id === 'string' ? row.original_line_id : null, changeAmount: numeric(row.change_amount, fail), changeBasis: string(row.change_basis), source }
}

export function migratedMaterialContract(entity: CoreMigrationServerEntityDTO, options: {
  parent?: CoreMigrationServerEntityDTO
  parentGraph?: MaterialContractSourceGraph
  allocatedIds: Set<string>
  originals: Map<string, { bytes: Uint8Array, sha256: string }>
  fail: (message: string) => never
}): MaterialContractMigrationRecord {
  const fail = options.fail
  let graph: MaterialContractSourceGraph

  try {
    graph = JSON.parse(String(entity.attributes.materialGraphJson))
  }
  catch { return fail('材采旧图没有完整来源证据') }
  if (graph?.schemaVersion !== 1 || !graph.head || graph.head.id !== entity.legacyId || !Array.isArray(graph.lines) || !Array.isArray(graph.deductions) || !Array.isArray(graph.attachments) || !Array.isArray(graph.audit))
    return fail('材采旧图结构、稳定身份或原始证据无效')
  const supplement = Boolean(options.parent)
  const head = graph.head
  let signatory = null
  if (head.our_signatory_snapshot != null) {
    try {
      signatory = decodeOurSignatorySnapshot(JSON.parse(String(head.our_signatory_snapshot)))
    }
    catch { return fail('旧材采签约主体冻结快照无效') }
    const evidence = graph.ourSignatoryEvidence
    const history = evidence?.history.filter(row => row.signatory_id === signatory!.id && String(row.version) === signatory!.version)
    if (head.our_signatory_id !== signatory.id || evidence?.record.id !== signatory.id || history?.length !== 1)
      return fail('旧材采签约主体缺少同图核实历史')
    let facts

    try {
      const { status: _status, ...details } = JSON.parse(String(history[0]!.draft_json))
      facts = details
    }
    catch { return fail('旧材采主体核实历史原文损坏') }
    if (!isDeepStrictEqual(signatory, { id: signatory.id, version: signatory.version, ...facts }))
      return fail('旧材采文书主体快照与当时核实事实不一致')
  }
  else if (head.our_signatory_id != null) {
    return fail('旧材采主体关系缺少文书快照')
  }
  if (supplement ? head.contract_id !== options.parent!.legacyId : head.kind !== '材采')
    return fail('材采旧图主合同或协议归属不一致')
  const assertChildren = (rows: Record<string, unknown>[], kind: 'line' | 'deduction') => {
    for (const row of rows) {
      const key = `${kind}:${String(row.id)}`
      if (!string(row.id) || options.allocatedIds.has(key) || row[supplement ? 'supplement_id' : 'contract_id'] !== entity.legacyId)
        fail('材采旧行或减项稳定身份重复、缺失或跨归属')
      options.allocatedIds.add(key)
      if (kind === 'deduction' && row[supplement ? 'contract_id' : 'supplement_id'] !== null)
        fail('材采减项须精确属于主合同或协议之一')
      if (row.deleted_at != null)
        timestamp(row.deleted_at, fail)
    }
  }
  assertChildren(graph.lines, 'line')
  assertChildren(graph.deductions, 'deduction')
  const lineItems = graph.lines.filter(row => row.deleted_at === null).map(row => materialMigratedLine(row, fail))
  for (const line of lineItems) {
    if (line.originalLineId && (!supplement || !options.parentGraph?.lines.some(original => original.id === line.originalLineId)))
      fail('协议引用的原材料行没有同一主合同的真实身份依据')
  }
  const projectId = supplement ? options.parent!.references.projectId ?? null : entity.references.projectId ?? null
  const supplierId = supplement ? options.parent!.references.supplierId ?? null : entity.references.supplierId ?? null
  if (!supplement && ((head.project_id !== projectId && head.project_id != null) || (head.supplier_id !== supplierId && head.supplier_id != null))) {
    // Core 已显式映射旧ID；原值仍留在 sourceGraph，不把它冒充中央ID。
    if ((typeof head.project_id !== 'string' && head.project_id != null) || (typeof head.supplier_id !== 'string' && head.supplier_id != null))
      fail('材采旧图关系身份损坏')
  }
  const draft: ProjectContractFormDraft = { id: entity.id, isSupplement: supplement, originalContractId: options.parent?.id ?? null, name: entity.name, no: string(head.no), projectId, supplierId, content: string(head.content), invoiceType: string(head.invoice_type), contactName: string(head.contact_name), contactPhone: string(head.contact_phone), taxRate: numeric(head.tax_rate, fail), signDate: string(head.sign_date), mainTerms: string(head.main_terms), paymentTerms: string(head.payment_terms), brandQualityTerms: string(head.brand_quality_terms), scheduleTerms: string(head.schedule_terms), warrantyTerms: string(head.warranty_terms), specialTerms: string(head.special_terms), retentionRatio: numeric(head.retention_ratio, fail), retentionAmount: numeric(head.retention_amount, fail), retentionDays: numeric(head.retention_days, fail), invoiceName: string(head.invoice_name), invoiceTaxNo: string(head.invoice_tax_no), invoiceAddressPhone: string(head.invoice_address_phone), invoiceBank: string(head.invoice_bank), invoiceBankAccount: string(head.invoice_bank_account), amount: numeric(head.amount, fail), status: string(head.status), note: string(head.note), lineItems, ourSignatoryId: signatory?.id ?? null, ourSignatoryVersion: signatory?.version ?? null, ourSignatorySnapshot: signatory, legacyPartyA: typeof head.party_a === 'string' ? head.party_a : null, deductions: graph.deductions.filter(row => row.deleted_at === null).map(row => ({ id: string(row.id), name: string(row.name), amount: numeric(row.amount, fail), basis: string(row.basis), sortOrder: numeric(row.sort_order, fail) ?? 0 })) }
  const files = graph.attachments.map(file => ({ ...file, uploadedAt: timestamp(file.uploadedAt, fail), deletedAt: file.deletedAt == null ? null : timestamp(file.deletedAt, fail) }))
  const attachments = contractMigratedAttachments(files, { ownerId: entity.id, legacyOwnerId: entity.legacyId, ownerType: supplement ? 'contract_supplement' : 'contract', allocatedIds: options.allocatedIds, originals: options.originals, fail })
  const originalLineSnapshots = graph.lines.flatMap((line) => {
    if (!line.original_line_id || line.original_line_snapshot == null)
      return []
    let original: Record<string, unknown>

    try {
      original = JSON.parse(String(line.original_line_snapshot))
    }
    catch { return fail('协议旧冻结原行证据损坏') }
    if (original.id !== line.original_line_id || original.contract_id !== options.parent?.legacyId || String(original.updated_at) !== line.original_source_updated_at)
      return fail('协议旧冻结原行身份或来源时间不一致')
    return [{ originalLineId: String(line.original_line_id), parentVersion: null, sourceUpdatedAt: timestamp(original.updated_at, fail), line: materialMigratedLine(original, fail) }]
  })
  return { id: entity.id, draft, attachments, createdAt: timestamp(head.created_at, fail), updatedAt: timestamp(head.updated_at, fail), migrationBatchId: entity.batchId, deletedAt: entity.deletedAt, sourceGraph: graph, originalLineSnapshots: [...new Map(originalLineSnapshots.map(row => [row.originalLineId, row])).values()] }
}
