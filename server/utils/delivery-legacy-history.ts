import type { DeliveryCentralLine, DeliveryCentralRecord, DeliveryRevision } from '../../app/lib/delivery-record/contract'
import { hasCompleteDeliveryValues } from '../../app/lib/delivery-record/domain'

type Row = Record<string, unknown>
type ResolveIdentity = (kind: 'projects' | 'suppliers', legacyId: string) => { id: string, name: string } | null
const stringFields = ['order_no', 'delivery_date', 'note', 'raw_site_text', 'review_flag', 'file_name', 'ocr_status', 'created_at', 'updated_at'] as const
function parseHead(value: unknown): Row | null {
  if (typeof value !== 'string')
    return null
  try {
    const result: unknown = JSON.parse(value)
    return result && typeof result === 'object' && !Array.isArray(result) ? result as Row : null
  }
  catch {
    return null
  }
}
function historicalLines(head: Row, legacyId: string, recordId: string, allLines: readonly Row[]): DeliveryCentralLine[] | null {
  const ids = head.__delivery_line_ids
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && id) || new Set(ids).size !== ids.length)
    return null
  const result: DeliveryCentralLine[] = []
  for (const id of ids) {
    const matches = allLines.filter(row => row.id === id && row.recordId === legacyId)
    if (matches.length !== 1)
      return null
    const row = matches[0]!
    if (![row.qty, row.unitPrice, row.amount].every(value => value === null || (typeof value === 'number' && Number.isFinite(value)))
      || !['materialName', 'spec', 'unit', 'note'].every(key => typeof row[key] === 'string')
      || !['calculated', 'manual', 'ocr'].includes(String(row.amountSource))) {
      return null
    }
    result.push({ id: `${recordId}:line:${id}`, deliveryRecordId: recordId, materialName: row.materialName as string, spec: row.spec as string, unit: row.unit as string, qty: row.qty as number | null, unitPrice: row.unitPrice as number | null, amount: row.amount as number | null, amountSource: row.amountSource as DeliveryCentralLine['amountSource'], note: row.note as string, sortOrder: result.length, currentValueConfirmed: head.archived === 1 && head.ocr_status === 'reviewed' })
  }
  return result
}
function snapshot(current: DeliveryCentralRecord, legacyId: string, value: unknown, allLines: readonly Row[], resolve: ResolveIdentity, version: string): DeliveryCentralRecord | null {
  const head = parseHead(value)
  if (!head || head.id !== legacyId || typeof head.project_id !== 'string' || !(head.supplier_id === null || typeof head.supplier_id === 'string')
    || !stringFields.every(key => typeof head[key] === 'string') || ![0, 1].includes(Number(head.archived))) {
    return null
  }
  const project = resolve('projects', head.project_id)
  const supplier = typeof head.supplier_id === 'string' && head.supplier_id ? resolve('suppliers', head.supplier_id) : null
  const lines = historicalLines(head, legacyId, current.id, allLines)
  if (!project || (head.supplier_id && !supplier) || !lines)
    return null
  const confirmed = head.archived === 1 && head.ocr_status === 'reviewed' && hasCompleteDeliveryValues({ supplierId: supplier?.id, deliveryDate: head.delivery_date, lines })
  for (const line of lines)
    line.currentValueConfirmed = confirmed
  return {
    ...current,
    version,
    projectId: project.id,
    projectName: project.name,
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.name ?? '',
    orderNo: head.order_no as string,
    deliveryDate: head.delivery_date as string,
    note: head.note as string,
    rawSiteText: head.raw_site_text as string,
    reviewFlag: head.review_flag as string,
    fileName: head.file_name as string,
    filePath: '',
    assetId: null,
    hasSourceFile: false,
    ocrStatus: head.ocr_status as string,
    archived: head.archived === 1,
    stored: head.archived === 1,
    reviewStatus: confirmed ? 'reviewed' : 'unreviewed',
    currentValuesConfirmed: confirmed,
    lines,
    totalAmount: Math.round((lines.reduce((sum, line) => sum + (line.amount ?? 0), 0) + Number.EPSILON) * 100) / 100,
    printDisposition: head.print_disposition === 'pending' || head.print_disposition === 'printed' ? head.print_disposition : 'excluded',
    printedAt: typeof head.printed_at === 'string' ? head.printed_at : '',
    printExcludedAt: typeof head.print_excluded_at === 'string' ? head.print_excluded_at : '',
    createdAt: head.created_at as string,
    updatedAt: head.updated_at as string,
    createdBy: '',
    updatedBy: '',
    deletedAt: typeof head.deleted_at === 'string' ? head.deleted_at : null,
  }
}

/** 只恢复有完整头快照、显式行 ID 和可映射祖先的旧修改；旧正文已被覆盖时绝不借用现件。 */
export function restoreLegacyDeliveryHistory(current: DeliveryCentralRecord, legacyId: string, allLines: readonly Row[], audit: readonly Row[], resolve: ResolveIdentity) {
  const revisions: DeliveryRevision[] = []
  let unresolvedCount = 0
  for (const entry of audit) {
    const before = snapshot(current, legacyId, entry.beforeData, allLines, resolve, String(revisions.length))
    const after = snapshot(current, legacyId, entry.afterData, allLines, resolve, String(revisions.length + 1))
    if (entry.action !== 'update' || typeof entry.id !== 'string' || !entry.id || typeof entry.operator !== 'string' || typeof entry.createdAt !== 'string' || !before || !after) {
      unresolvedCount++
      continue
    }
    const fields: Array<keyof DeliveryCentralRecord> = ['projectId', 'supplierId', 'orderNo', 'deliveryDate', 'note', 'reviewFlag', 'lines', 'printDisposition', 'printedAt', 'printExcludedAt']
    const changes = fields.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field])).map(field => ({ field, before: before[field], after: after[field] }))
    revisions.push({ id: `${current.id}:legacy:${entry.id}`, recordId: current.id, version: after.version, action: 'revise', reason: '旧审计恢复；原修订原因未记录，历史原件关联未证实', actorId: entry.operator, createdAt: entry.createdAt, before, after, changes })
  }
  return { revisions, unresolvedCount, currentVersion: String(revisions.length + 1) }
}
