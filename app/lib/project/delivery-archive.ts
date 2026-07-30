import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtesFor, visibleCond } from '~/lib/db/soft-delete'

export interface ProjectDeliveryArchiveRow {
  id: string
  projectId: string
  orderNo: string
  deliveryDate: string
  supplier: string
  lineCount: number
  totalQty: number
  totalAmount: number
  fileName: string
  sourceFileId: string
  hasSourceFile: boolean
  sourceStatus: string
  ocrStatus: string
  reviewFlag: string
  printStatus: string
  sourcePath: string
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

export async function loadProjectDeliveryArchive(
  db: SoftDb,
): Promise<ProjectDeliveryArchiveRow[]> {
  const [deliveryRows, sourceRows] = await Promise.all([
    db.select<Record<string, unknown>>(`
      ${hiddenCtesFor('delivery_records', 'delivery_lines', 'suppliers')}
      SELECT delivery.*,
             COALESCE(supplier.name, '') AS supplier_name,
             COUNT(line.id) AS line_count,
             COALESCE(SUM(line.qty), 0) AS total_qty,
             COALESCE(SUM(line.amount), 0) AS total_amount
      FROM delivery_records AS delivery
      LEFT JOIN suppliers AS supplier
        ON supplier.id = delivery.supplier_id
       AND ${visibleCond('suppliers', 'supplier')}
      LEFT JOIN delivery_lines AS line
        ON line.delivery_record_id = delivery.id
       AND ${visibleCond('delivery_lines', 'line')}
      WHERE ${visibleCond('delivery_records', 'delivery')}
        AND delivery.archived = 1
      GROUP BY delivery.id
      ORDER BY delivery.delivery_date DESC, delivery.created_at DESC, delivery.id
    `),
    db.select<Record<string, unknown>>(`
      SELECT source.id, source.owner_id, source.file_name
      FROM file_refs AS source
      WHERE source.owner_type = 'delivery_record'
        AND source.category = 'source'
        AND source.deleted_at IS NULL
      ORDER BY source.uploaded_at DESC, source.id DESC
    `),
  ])

  const sourceByDelivery = new Map<string, Record<string, unknown>>()
  for (const row of sourceRows) {
    const ownerId = text(row.owner_id)
    if (!sourceByDelivery.has(ownerId))
      sourceByDelivery.set(ownerId, row)
  }

  return deliveryRows.map((row) => {
    const source = sourceByDelivery.get(text(row.id))
    return {
      id: text(row.id),
      projectId: text(row.project_id),
      orderNo: text(row.order_no),
      deliveryDate: text(row.delivery_date),
      supplier: text(row.supplier_name),
      lineCount: number(row.line_count),
      totalQty: number(row.total_qty),
      totalAmount: number(row.total_amount),
      fileName: text(source?.file_name || row.file_name),
      sourceFileId: text(source?.id),
      hasSourceFile: Boolean(source),
      sourceStatus: source ? '原件已关联' : text(row.file_name) ? '仅文件名' : '无原件',
      ocrStatus: text(row.ocr_status),
      reviewFlag: text(row.review_flag),
      printStatus: row.print_disposition === 'printed'
        ? '已打印'
        : row.print_disposition === 'pending' ? '待打印' : '已排除',
      sourcePath: `/material/delivery/archive/${text(row.id)}`,
    }
  })
}
