import type { QuotationRecord } from './contract'
import { decodeQuotationDraft, isObject, quotationProblem, validId } from './contract'

export interface QuotationMigrationReference {
  entityType: 'projects' | 'suppliers'
  serverId: string
  label: string
  version: string
  sourceVersion: string
}
export interface QuotationImportBinding extends QuotationMigrationReference {
  legacyId: string
  confirmedBy: string
}
export interface QuotationMigrationSource {
  sha256: string
  payloadBase64: string
}
export interface QuotationRelations {
  version: string
  projectId: string | null
  supplierId: string | null
  importBatchId: string
  sourceSnapshotSha256: string
}
const fail = () => quotationProblem('validation-failed', '报价迁入关联证据无效；请保留原库和原回执')
export function decodeQuotationMigrationReference(value: unknown): QuotationMigrationReference {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'entityType,label,serverId,sourceVersion,version'
    || !['projects', 'suppliers'].includes(String(value.entityType)) || !validId(value.serverId) || typeof value.label !== 'string'
    || typeof value.version !== 'string' || !/^[1-9]\d*$/.test(value.version) || typeof value.sourceVersion !== 'string'
    || !new RegExp(`^${value.entityType}:\\d+$`).test(value.sourceVersion)) {
    return fail()
  }
  return value as unknown as QuotationMigrationReference
}
export function decodeQuotationImportBindings(value: unknown): QuotationImportBinding[] {
  if (!Array.isArray(value) || value.length > 100000)
    return fail()
  const rows = value.map((row) => {
    if (!isObject(row) || Object.keys(row).sort().join(',') !== 'confirmedBy,entityType,label,legacyId,serverId,sourceVersion,version' || !validId(row.legacyId) || !validId(row.confirmedBy))
      return fail()
    const { legacyId, confirmedBy, ...reference } = row
    return { ...decodeQuotationMigrationReference(reference), legacyId, confirmedBy }
  })
  if (new Set(rows.map(row => `${row.entityType}:${row.legacyId}`)).size !== rows.length)
    return fail()
  return rows.sort((a, b) => `${a.entityType}:${a.legacyId}`.localeCompare(`${b.entityType}:${b.legacyId}`))
}
export function quotationSourceReferences(graph: {
  tables: {
    material_quotations: Record<string, unknown>[]
    material_quotation_history: Record<string, unknown>[]
  }
}) {
  const drafts = [...graph.tables.material_quotations.map(head => decodeQuotationDraft(JSON.parse(String(head.draft_json)))), ...graph.tables.material_quotation_history.map(row => decodeQuotationDraft(JSON.parse(String(row.snapshot_json)).draft))]
  const rows = new Map<string, {
    entityType: 'projects' | 'suppliers'
    legacyId: string
  }>()
  for (const draft of drafts) {
    for (const [entityType, id] of [['projects', draft.projectId], ['suppliers', draft.supplierId]] as const) {
      if (id)
        rows.set(`${entityType}:${id}`, { entityType, legacyId: id })
    }
  }
  return [...rows.values()].sort((a, b) => `${a.entityType}:${a.legacyId}`.localeCompare(`${b.entityType}:${b.legacyId}`))
}
export function decodeQuotationImportManifest(value: unknown): {
  graph: Record<string, unknown>
  sourceSnapshotSha256: string | null
  bindings: QuotationImportBinding[]
} {
  if (!isObject(value))
    return fail()
  if (value.schemaVersion === 'material-quotation-graph-v1')
    return { graph: value, sourceSnapshotSha256: null, bindings: [] }
  if (Object.keys(value).sort().join(',') !== 'bindings,graph,schemaVersion,sourceSnapshotSha256' || value.schemaVersion !== 'material-quotation-import-evidence-v1' || !isObject(value.graph) || typeof value.sourceSnapshotSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceSnapshotSha256))
    return fail()
  const bindings = decodeQuotationImportBindings(value.bindings)
  const required = quotationSourceReferences(value.graph as never)
  if (required.length !== bindings.length || required.some(row => !bindings.some(binding => binding.entityType === row.entityType && binding.legacyId === row.legacyId)))
    return fail()
  return { graph: value.graph, sourceSnapshotSha256: value.sourceSnapshotSha256, bindings }
}
/** The frozen source remains untouched. Only its explicitly confirmed current association is projected. */
export function projectQuotationImportRelations(records: QuotationRecord[], imports: {
  batch_id: string
  graph_json: string | null
}[]): QuotationRecord[] {
  const evidence = imports.filter(row => row.graph_json).map(row => ({ batchId: row.batch_id, ...decodeQuotationImportManifest(JSON.parse(row.graph_json!)) }))
  return records.map((record) => {
    const relations = record.history.flatMap((history): QuotationRelations[] => {
      const matched = evidence.filter(row => row.sourceSnapshotSha256 && (row.graph.tables as {
        material_quotation_history: {
          quotation_id: string
          version: number
        }[]
      }).material_quotation_history.some(source => source.quotation_id === record.id && String(source.version) === history.version))
      if (!matched.length)
        return []
      // A later import can enclose prior evidence. The newest current identity binding is explicit, never a name guess.
      const current = matched.at(-1)!
      const target = (type: 'projects' | 'suppliers', raw: string | null) => raw === null ? null : current.bindings.find(row => row.entityType === type && row.legacyId === raw)?.serverId ?? fail()
      return [{ version: history.version, projectId: target('projects', history.draft.projectId), supplierId: target('suppliers', history.draft.supplierId), importBatchId: current.batchId, sourceSnapshotSha256: current.sourceSnapshotSha256! }]
    })
    return relations.length ? { ...record, relations } : record
  })
}
