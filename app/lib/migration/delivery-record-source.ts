import type { DeliveryLegacySourceFile, DeliverySourceAsset } from '../delivery-record/source-assets'
import type { CoreMigrationSourceEntityDTO } from './core-contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { mapDeliverySourceAssets } from '../delivery-record/source-assets'
import { compareCanonicalText } from './core-contract'

export const DELIVERY_RECORD_SOURCE_SQL = `SELECT d.*,
  (SELECT json_group_array(json_object(
    'id', l.id, 'recordId', l.delivery_record_id, 'materialName', l.material_name,
    'spec', l.spec, 'unit', l.unit, 'qty', l.qty, 'unitPrice', l.unit_price,
    'amount', l.amount, 'amountSource', l.amount_source, 'note', l.note,
    'sortOrder', l.sort_order, 'createdAt', l.created_at, 'updatedAt', l.updated_at,
    'deletedAt', l.deleted_at))
    FROM (SELECT * FROM delivery_lines ORDER BY sort_order, id) l
    WHERE l.delivery_record_id = d.id) AS lines_json,
  (SELECT json_group_array(json_object(
    'id', f.id, 'recordId', f.owner_id, 'ownerType', f.owner_type, 'category', f.category,
    'fileName', f.file_name, 'fileSize', f.file_size, 'mimeType', f.mime_type,
    'encoding', p.encoding, 'payloadBase64', p.content, 'deletedAt', f.deleted_at))
    FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id = f.id
    WHERE f.owner_type = 'delivery_record' AND f.owner_id = d.id
      AND f.category = 'source') AS sources_json,
  (SELECT json_group_array(json_object(
    'id', o.id, 'action', o.action, 'beforeData', o.before_data, 'afterData', o.after_data,
    'operator', o.operator, 'createdAt', o.created_at))
    FROM (SELECT * FROM operation_logs ORDER BY created_at, id) o
    WHERE o.table_name = 'delivery_records' AND o.record_id = d.id) AS audit_json
  FROM delivery_records d ORDER BY d.id`

function text(value: unknown): string {
  return value == null ? '' : String(value)
}
function nullableText(value: unknown): string | null {
  return value == null || value === '' ? null : String(value)
}
function deletedTime(value: unknown): string | null {
  const raw = nullableText(value)
  if (!raw)
    return null
  const sqliteUtc = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(raw)
  const normalized = sqliteUtc ? `${sqliteUtc[1]}T${sqliteUtc[2]}.${(sqliteUtc[3] ?? '').padEnd(3, '0')}Z` : raw
  if (!isISODateTimeDTO(normalized))
    throw new Error('送货记录软删除时间无效，请核对旧源，不自动补写日期')
  return normalized
}
function jsonRows(value: unknown): Array<Record<string, unknown>> {
  const rows: unknown = JSON.parse(text(value) || '[]')
  if (!Array.isArray(rows) || rows.some(row => row === null || typeof row !== 'object' || Array.isArray(row)))
    throw new Error('送货迁移明细或留痕格式无效')
  return rows
}

/** 旧源只采证；不能恢复的原件或审计以缺失/待核验保留，不在本地生成正式副本。 */
export async function deliveryRecordSourceEntities(rows: readonly Record<string, unknown>[]): Promise<CoreMigrationSourceEntityDTO[]> {
  const ordered = [...rows].sort((a, b) => compareCanonicalText(text(a.id), text(b.id)))
  const assets = new Map<string, DeliverySourceAsset>()
  const assetByRecord = new Map<string, string | null>()
  const problems = new Map<string, string>()
  const legacyOriginals = new Map<string, unknown[]>()
  const batches = new Map<string, Record<string, unknown>[]>()
  for (const row of ordered) {
    const batch = JSON.stringify(row.print_batch_id ? ['batch', row.print_batch_id] : ['record', row.id])
    batches.set(batch, [...batches.get(batch) ?? [], row])
  }
  for (const batch of batches.values()) {
    try {
      const sources: DeliveryLegacySourceFile[] = batch.flatMap(row => jsonRows(row.sources_json).filter(source => !source.deletedAt).map((source) => {
        if (source.ownerType !== 'delivery_record' || source.recordId !== row.id || source.category !== 'source'
          || (source.payloadBase64 !== null && source.encoding !== 'base64')) {
          throw new Error('送货原件 owner、归属或编码无效')
        }
        return { id: text(source.id), recordId: text(row.id), fileName: text(source.fileName), fileSize: Number(source.fileSize), mimeType: text(source.mimeType), payloadBase64: source.payloadBase64 == null ? null : text(source.payloadBase64) }
      }))
      const mapped = await mapDeliverySourceAssets(batch.map(row => ({ id: text(row.id), printBatchId: nullableText(row.print_batch_id) })), sources)
      for (const asset of mapped.assets) assets.set(asset.id, asset)
      for (const link of mapped.links) assetByRecord.set(link.recordId, link.assetId)
    }
    catch (cause) {
      for (const row of batch) problems.set(text(row.id), cause instanceof Error ? cause.message : '送货原件迁移校验失败')
    }
  }
  for (const row of ordered) {
    try {
      const retired = []
      for (const source of jsonRows(row.sources_json).filter(source => source.deletedAt)) {
        if (source.ownerType !== 'delivery_record' || source.recordId !== row.id || source.category !== 'source'
          || (source.payloadBase64 !== null && source.encoding !== 'base64')) {
          throw new Error('历史送货原件 owner、归属或编码无效')
        }
        const mapped = await mapDeliverySourceAssets([{ id: text(row.id), printBatchId: `legacy-file:${text(source.id)}` }], [{ id: text(source.id), recordId: text(row.id), fileName: text(source.fileName), fileSize: Number(source.fileSize), mimeType: text(source.mimeType), payloadBase64: source.payloadBase64 == null ? null : text(source.payloadBase64) }])
        retired.push({ legacyFileRefId: text(source.id), recordId: text(row.id), deletedAt: text(source.deletedAt), fileName: text(source.fileName), asset: mapped.assets[0] ?? null })
      }
      legacyOriginals.set(text(row.id), retired)
    }
    catch (cause) {
      problems.set(text(row.id), cause instanceof Error ? cause.message : '历史原件迁移校验失败')
    }
  }
  return ordered.map((row) => {
    const allLines = jsonRows(row.lines_json)
    const currentLines = allLines.filter(line => !line.deletedAt)
    const audit = jsonRows(row.audit_json)
    const assetId = assetByRecord.get(text(row.id))
    const asset = assetId ? assets.get(assetId) : null
    const nullableTotal = (field: string): number | null => currentLines.some(line => line[field] == null)
      ? null
      : currentLines.reduce((sum, line) => sum + Number(line[field]), 0)
    const amount = nullableTotal('amount')
    const attributes: CoreMigrationSourceEntityDTO['attributes'] = {
      orderNo: text(row.order_no),
      deliveryDate: text(row.delivery_date),
      rawSiteText: text(row.raw_site_text),
      fileName: text(row.file_name),
      ocrStatus: text(row.ocr_status),
      archived: Number(row.archived || 0),
      printBatchId: text(row.print_batch_id),
      printDisposition: text(row.print_disposition),
      printedAt: text(row.printed_at),
      printExcludedAt: text(row.print_excluded_at),
      reviewFlag: text(row.review_flag),
      note: text(row.note),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      sourceState: asset ? 'available' : 'missing',
      sourceProblem: problems.get(text(row.id)) ?? null,
      assetJson: JSON.stringify(asset ?? null),
      allLinesJson: JSON.stringify(allLines),
      auditJson: JSON.stringify(audit),
      legacyOriginalsJson: JSON.stringify(legacyOriginals.get(text(row.id)) ?? []),
    }
    return { legacyId: text(row.id), name: text(row.order_no) || `送货记录 ${text(row.id)}`, references: { projectId: nullableText(row.project_id), supplierId: nullableText(row.supplier_id) }, quantity: nullableTotal('qty'), amount: amount === null ? null : amount.toFixed(2), attributes, deletedAt: deletedTime(row.deleted_at) }
  })
}
