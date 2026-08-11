import type { SoftDb } from '~/lib/db/soft-delete'
import type { DeliveryAmountSource } from '~/lib/delivery/review'
import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'
import { db } from '~/lib/db/client'
import { select, withTransaction } from '~/lib/db/connection'
import {
  createSoftDeleteActions,
  logCreate,
  restoreRecord,
  selectVisibleSql,
  softDelete,
  undoOperation,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import { deliveryNaturalKey, hasDeliveryPricePending, normalizeDeliveryOrderNo } from '~/lib/delivery/review'
import { generateId } from '~/lib/util/id'

export interface DeliveryLineDraft {
  materialName: string
  spec: string
  unit: string
  qty: number | null
  unitPrice: number | null
  amount?: number | null
  amountSource?: DeliveryAmountSource
  note: string
}

export interface DeliveryLine extends Omit<DeliveryLineDraft, 'amount' | 'amountSource'> {
  id: string
  deliveryRecordId: string
  amount: number | null
  amountSource: DeliveryAmountSource
  currentValueConfirmed: boolean
  sortOrder: number
}

export type DeliveryPrintDisposition = 'pending' | 'printed' | 'excluded'

export interface DeliveryRecord {
  id: string
  projectId: string
  supplierId: string | null
  rawSiteText: string
  orderNo: string
  deliveryDate: string
  fileName: string
  filePath: string
  ocrStatus: string
  reviewStatus: 'reviewed' | 'unreviewed'
  naturalKeyDuplicate: boolean
  currentValuesConfirmed: boolean
  archived: boolean
  stored: boolean
  printBatchId: string
  printDisposition: DeliveryPrintDisposition
  printedAt: string
  printExcludedAt: string
  reviewFlag: string
  note: string
  createdAt: string
  updatedAt: string
  hasSourceFile: boolean
  lines: readonly DeliveryLine[]
  totalAmount: number
}

export interface DeliveryRecordInput {
  projectId: string
  supplierId: string | null
  orderNo: string
  deliveryDate: string
  note: string
  reviewFlag?: string
  rawSiteText?: string
  fileName?: string
  filePath?: string
  printBatchId?: string
  confirmations?: DeliveryRecordConfirmations
  lines: DeliveryLineDraft[]
}

export interface DeliveryRecordConfirmations {
  noOrderNoConfirmed?: boolean
  pricePendingConfirmed?: boolean
}

export interface DeliveryRecordSourceFile {
  fileName: string
  mimeType: string
  fileSize: number
  bytes: Uint8Array
}

interface PreparedSourceFile {
  fileName: string
  mimeType: string
  fileSize: number
  content: string
}

interface DeliveryOperationLog {
  table_name: string
  record_id: string
  action: string
  before_data: string | null
}

const DELIVERY_LINE_IDS_META = '__delivery_line_ids'

function withDeliveryLineIds(data: string | null, lineIds: string[]): string {
  const value = data ? JSON.parse(data) as unknown : {}
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('送货单操作日志快照格式错误')
  return JSON.stringify({ ...value, [DELIVERY_LINE_IDS_META]: lineIds })
}

function deliveryLineIdsFrom(data: string | null): string[] | null {
  if (!data)
    return null
  try {
    const value = JSON.parse(data) as Record<string, unknown>
    const lineIds = value[DELIVERY_LINE_IDS_META]
    return Array.isArray(lineIds) && lineIds.every(id => typeof id === 'string') ? lineIds : null
  }
  catch {
    return null
  }
}

async function attachDeliveryLineIds(tx: SoftDb, logId: string, beforeIds: string[], afterIds: string[]): Promise<void> {
  const [log] = await tx.select<{ before_data: string | null, after_data: string | null }>(
    'SELECT before_data, after_data FROM operation_logs WHERE id = ?',
    [logId],
  )
  if (!log)
    throw new Error('送货单编辑日志不存在')
  await tx.execute(
    'UPDATE operation_logs SET before_data = ?, after_data = ? WHERE id = ?',
    [
      withDeliveryLineIds(log.before_data, beforeIds),
      withDeliveryLineIds(log.after_data, afterIds),
      logId,
    ],
  )
}

function toNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function fileMimeType(file: File): string {
  const declared = file.type.trim()
  if (declared)
    return declared
  if (/\.pdf$/i.test(file.name))
    return 'application/pdf'
  if (/\.png$/i.test(file.name))
    return 'image/png'
  if (/\.jpe?g$/i.test(file.name))
    return 'image/jpeg'
  return 'application/octet-stream'
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  return btoa(binary)
}

function base64ToBytes(content: string): Uint8Array {
  const binary = atob(content)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function prepareSourceFile(file: File): Promise<PreparedSourceFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    fileName: file.name,
    mimeType: fileMimeType(file),
    fileSize: bytes.byteLength,
    content: bytesToBase64(bytes),
  }
}

function amountOf(qty: number | null, unitPrice: number | null): number | null {
  if (qty == null || unitPrice == null)
    return null
  return roundMoney(qty * unitPrice)
}

interface NormalizedDeliveryLineDraft extends Omit<DeliveryLineDraft, 'amount' | 'amountSource'> {
  amount: number | null
  amountSource: DeliveryAmountSource
}

function amountSourceOf(value: unknown, fallback: DeliveryAmountSource): DeliveryAmountSource {
  return value === 'calculated' || value === 'ocr' || value === 'manual' ? value : fallback
}

function normalizeLines(lines: DeliveryLineDraft[]): NormalizedDeliveryLineDraft[] {
  return lines
    .map((line) => {
      const qty = toNullableNumber(line.qty)
      const unitPrice = toNullableNumber(line.unitPrice)
      const hasExplicitAmount = line.amount !== undefined
      return {
        materialName: line.materialName.trim(),
        spec: line.spec.trim(),
        unit: line.unit.trim(),
        qty,
        unitPrice,
        amount: hasExplicitAmount ? toNullableNumber(line.amount) : amountOf(qty, unitPrice),
        amountSource: amountSourceOf(line.amountSource, hasExplicitAmount ? 'manual' : 'calculated'),
        note: line.note.trim(),
      }
    })
    .filter(line => line.materialName.length > 0)
}

function validateInput(input: DeliveryRecordInput): NormalizedDeliveryLineDraft[] {
  if (!input.projectId)
    throw new Error('送货单必须选择项目')
  const lines = normalizeLines(input.lines)
  if (!lines.length)
    throw new Error('至少添加一条材料明细')
  return lines
}

const MANAGED_REVIEW_FLAGS = new Set(['原件无单号', '价格待补录'])

function reviewFlagTokens(values: readonly (string | undefined)[]): string[] {
  return values.flatMap(value => (value ?? '').split(/[；;]/))
    .map(value => value.trim())
    .filter(Boolean)
}

function deriveReviewFlag(
  orderNo: string,
  lines: readonly NormalizedDeliveryLineDraft[],
  confirmations: DeliveryRecordConfirmations | undefined,
  ...existingFlags: (string | undefined)[]
): string {
  const tokens = reviewFlagTokens(existingFlags)
    .filter(token => !MANAGED_REVIEW_FLAGS.has(token))
  if (!orderNo) {
    if (confirmations?.noOrderNoConfirmed !== true)
      throw new Error('缺少送货单号，请先确认原件确实无单号')
    tokens.push('原件无单号')
  }
  if (hasDeliveryPricePending(lines)) {
    if (confirmations?.pricePendingConfirmed !== true)
      throw new Error('缺少单价或金额，请先确认按“价格待补录”归档')
    tokens.push('价格待补录')
  }
  return [...new Set(tokens)].join('；')
}

function rowToLine(row: Record<string, unknown>, currentValueConfirmed: boolean): DeliveryLine {
  return {
    id: row.id as string,
    deliveryRecordId: row.delivery_record_id as string,
    materialName: (row.material_name ?? '') as string,
    spec: (row.spec ?? '') as string,
    unit: (row.unit ?? '') as string,
    qty: toNullableNumber(row.qty),
    unitPrice: toNullableNumber(row.unit_price),
    amount: toNullableNumber(row.amount),
    amountSource: amountSourceOf(row.amount_source, 'manual'),
    currentValueConfirmed,
    note: (row.note ?? '') as string,
    sortOrder: toNumber(row.sort_order),
  }
}

type DeliveryRecordWithoutDuplicateFlag = Omit<DeliveryRecord, 'naturalKeyDuplicate'>

function currentValuesConfirmedFromRow(row: Record<string, unknown>): boolean {
  return Boolean(row.archived) && row.ocr_status === 'reviewed'
}

function rowToRecord(
  row: Record<string, unknown>,
  lines: DeliveryLine[],
  hasSourceFile: boolean,
): DeliveryRecordWithoutDuplicateFlag {
  const ocrStatus = (row.ocr_status ?? 'pending') as string
  const currentValuesConfirmed = currentValuesConfirmedFromRow(row)
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    supplierId: (row.supplier_id ?? null) as string | null,
    rawSiteText: (row.raw_site_text ?? '') as string,
    orderNo: (row.order_no ?? '') as string,
    deliveryDate: (row.delivery_date ?? '') as string,
    fileName: (row.file_name ?? '') as string,
    filePath: (row.file_path ?? '') as string,
    ocrStatus,
    reviewStatus: currentValuesConfirmed ? 'reviewed' : 'unreviewed',
    currentValuesConfirmed,
    archived: Boolean(row.archived),
    // v25 起归档即视为已入库；stored 只保留作存量兼容镜像。
    stored: Boolean(row.archived),
    printBatchId: (row.print_batch_id || row.id) as string,
    printDisposition: (
      row.print_disposition === 'pending'
      || row.print_disposition === 'printed'
      || row.print_disposition === 'excluded'
        ? row.print_disposition
        : 'excluded'
    ) as DeliveryPrintDisposition,
    printedAt: (row.printed_at ?? '') as string,
    printExcludedAt: (row.print_excluded_at ?? '') as string,
    reviewFlag: (row.review_flag ?? '') as string,
    note: (row.note ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
    updatedAt: (row.updated_at ?? '') as string,
    hasSourceFile,
    lines,
    totalAmount: roundMoney(lines.reduce((sum, line) => sum + (line.amount ?? 0), 0)),
  }
}

function withNaturalKeyDuplicateFlags(
  records: readonly DeliveryRecordWithoutDuplicateFlag[],
): DeliveryRecord[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    const key = deliveryNaturalKey(record)
    if (key)
      counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return records.map((record) => {
    const key = deliveryNaturalKey(record)
    return {
      ...record,
      naturalKeyDuplicate: key != null && (counts.get(key) ?? 0) > 1,
    }
  })
}

async function assertDeliveryNaturalKeyAvailable(
  tx: SoftDb,
  input: Pick<DeliveryRecordInput, 'projectId' | 'supplierId' | 'orderNo'>,
  excludeId?: string,
): Promise<void> {
  const orderNo = normalizeDeliveryOrderNo(input.orderNo)
  if (!input.projectId.trim() || !input.supplierId?.trim() || !orderNo)
    return

  const params: unknown[] = [input.projectId, input.supplierId]
  const excludeSql = excludeId ? 'AND id <> ?' : ''
  if (excludeId)
    params.push(excludeId)
  const rows = await tx.select<{ order_no: string | null }>(
    `SELECT order_no
     FROM delivery_records
     WHERE project_id = ?
       AND supplier_id = ?
       AND deleted_at IS NULL
       ${excludeSql}`,
    params,
  )
  if (rows.some(row => normalizeDeliveryOrderNo(row.order_no ?? '') === orderNo))
    throw new Error('送货单自然键重复，不能重复归档')
}

async function insertLines(tx: SoftDb, recordId: string, lines: NormalizedDeliveryLineDraft[], now: string): Promise<void> {
  for (const [index, line] of lines.entries()) {
    const id = generateId('dline')
    await tx.execute(
      `INSERT INTO delivery_lines
        (id, delivery_record_id, material_name, spec, unit, qty, unit_price, amount, amount_source, note, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        recordId,
        line.materialName,
        line.spec,
        line.unit,
        line.qty,
        line.unitPrice,
        line.amount,
        line.amountSource,
        line.note,
        index,
        now,
        now,
      ],
    )
    await logCreate(tx, 'delivery_lines', id)
  }
}

async function persistSourceFile(
  tx: SoftDb,
  recordId: string,
  source: PreparedSourceFile,
  now: string,
): Promise<void> {
  const [existing] = await tx.select<{ id: string }>(
    `SELECT id FROM file_refs
     WHERE owner_type = 'delivery_record'
       AND owner_id = ?
       AND category = 'source'
       AND deleted_at IS NULL
     LIMIT 1`,
    [recordId],
  )
  const fileRefId = existing?.id ?? generateId('file')

  if (existing) {
    await tx.execute(
      `UPDATE file_refs
       SET file_name = ?, file_path = '', file_size = ?, mime_type = ?, uploaded_at = ?
       WHERE id = ?`,
      [source.fileName, source.fileSize, source.mimeType, now, fileRefId],
    )
  }
  else {
    await tx.execute(
      `INSERT INTO file_refs
        (id, owner_type, owner_id, file_name, file_path, file_size, category, uploader, uploaded_at, mime_type)
       VALUES (?, 'delivery_record', ?, ?, '', ?, 'source', '', ?, ?)`,
      [fileRefId, recordId, source.fileName, source.fileSize, now, source.mimeType],
    )
  }

  await tx.execute(
    `INSERT INTO file_payloads (file_ref_id, encoding, content)
     VALUES (?, 'base64', ?)
     ON CONFLICT(file_ref_id) DO UPDATE SET
       encoding = excluded.encoding,
       content = excluded.content`,
    [fileRefId, source.content],
  )
}

export const useDeliveryRecordStore = defineStore('delivery-record', () => {
  const list = shallowRef<DeliveryRecord[]>([])
  const loading = shallowRef(false)

  async function load() {
    loading.value = true
    try {
      const [recordRows, lineRows, sourceRows] = await Promise.all([
        select<Record<string, unknown>>(selectVisibleSql('delivery_records', 'AND archived = 1 ORDER BY delivery_date DESC, created_at DESC')),
        select<Record<string, unknown>>(selectVisibleSql('delivery_lines', 'ORDER BY sort_order, created_at')),
        select<{ owner_id: string }>(
          `SELECT source.owner_id
           FROM file_refs AS source
           INNER JOIN file_payloads AS payload ON payload.file_ref_id = source.id
           WHERE source.owner_type = 'delivery_record'
             AND source.category = 'source'
             AND source.deleted_at IS NULL`,
        ),
      ])
      const currentValuesConfirmedByRecord = new Map(recordRows.map(row => [
        row.id as string,
        currentValuesConfirmedFromRow(row),
      ]))
      const linesByRecord = new Map<string, DeliveryLine[]>()
      for (const row of lineRows) {
        const recordId = row.delivery_record_id as string
        const line = rowToLine(row, currentValuesConfirmedByRecord.get(recordId) === true)
        const lines = linesByRecord.get(line.deliveryRecordId) ?? []
        lines.push(line)
        linesByRecord.set(line.deliveryRecordId, lines)
      }
      const sourceRecordIds = new Set(sourceRows.map(row => row.owner_id))
      list.value = withNaturalKeyDuplicateFlags(recordRows.map(row => rowToRecord(
        row,
        linesByRecord.get(row.id as string) ?? [],
        sourceRecordIds.has(row.id as string),
      )))
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(record => record.id === id)
  }

  async function add(input: DeliveryRecordInput, sourceFile?: File): Promise<string> {
    const lines = validateInput(input)
    // File 读取与编码可能失败，必须在开启 SQLite 事务前完成。
    const source = sourceFile ? await prepareSourceFile(sourceFile) : null
    const id = generateId('del')
    const printBatchId = input.printBatchId?.trim() || id
    const orderNo = normalizeDeliveryOrderNo(input.orderNo)
    const now = new Date().toISOString()
    await withTransaction(async (tx) => {
      const reviewFlag = deriveReviewFlag(orderNo, lines, input.confirmations, input.reviewFlag)
      await assertDeliveryNaturalKeyAvailable(tx, input)
      await tx.execute(
        `INSERT INTO delivery_records
          (id, project_id, supplier_id, raw_site_text, order_no, delivery_date, file_name, file_path,
           ocr_status, archived, stored, print_batch_id, print_disposition, printed_at, print_excluded_at,
           review_flag, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reviewed', 1, 1, ?, 'pending', NULL, NULL, ?, ?, ?, ?)`,
        [
          id,
          input.projectId,
          input.supplierId || null,
          input.rawSiteText?.trim() ?? '',
          orderNo || null,
          input.deliveryDate,
          input.fileName?.trim() || source?.fileName || '',
          input.filePath?.trim() ?? '',
          printBatchId,
          reviewFlag,
          input.note.trim(),
          now,
          now,
        ],
      )
      await logCreate(tx, 'delivery_records', id)
      await insertLines(tx, id, lines, now)
      if (source)
        await persistSourceFile(tx, id, source, now)
    })
    await load()
    return id
  }

  async function updatePrintDisposition(
    ids: readonly string[],
    disposition: Exclude<DeliveryPrintDisposition, 'pending'>,
  ): Promise<void> {
    const uniqueIds = [...new Set(ids.filter(Boolean))]
    if (!uniqueIds.length)
      return
    const now = new Date().toISOString()
    await withTransaction(async (tx) => {
      const placeholders = uniqueIds.map(() => '?').join(', ')
      const rows = await tx.select<{
        id: string
        print_disposition: DeliveryPrintDisposition
      }>(`
        SELECT id, print_disposition
        FROM delivery_records
        WHERE id IN (${placeholders})
          AND archived = 1
          AND deleted_at IS NULL
      `, uniqueIds)
      if (
        rows.length !== uniqueIds.length
        || rows.some(row => row.print_disposition !== 'pending')
      ) {
        throw new Error('送货单打印状态已变化，请刷新后重试')
      }

      for (const id of uniqueIds) {
        let changed = 0
        const logId = await withUpdateLog(tx, 'delivery_records', id, async () => {
          await tx.execute(
            `UPDATE delivery_records
             SET print_disposition = ?,
                 printed_at = ?,
                 print_excluded_at = ?,
                 updated_at = ?
             WHERE id = ?
               AND archived = 1
               AND print_disposition = 'pending'
               AND deleted_at IS NULL`,
            [
              disposition,
              disposition === 'printed' ? now : null,
              disposition === 'excluded' ? now : null,
              now,
              id,
            ],
          )
          const [result] = await tx.select<{ count: number }>('SELECT changes() AS count')
          changed = Number(result?.count ?? 0)
        })
        if (!logId || changed !== 1)
          throw new Error('送货单打印状态已变化，请刷新后重试')
      }
    })
    await load()
  }

  async function excludeFromPrint(id: string): Promise<void> {
    await updatePrintDisposition([id], 'excluded')
  }

  async function excludeManyFromPrint(ids: readonly string[]): Promise<void> {
    await updatePrintDisposition(ids, 'excluded')
  }

  async function confirmPrintReceipt(id: string): Promise<void> {
    await updatePrintDisposition([id], 'printed')
  }

  async function confirmManyPrintReceipts(ids: readonly string[]): Promise<void> {
    await updatePrintDisposition(ids, 'printed')
  }

  async function update(id: string, input: DeliveryRecordInput): Promise<string | null> {
    const lines = validateInput(input)
    const orderNo = normalizeDeliveryOrderNo(input.orderNo)
    const now = new Date().toISOString()
    const logId = await withTransaction(async (tx) => {
      const [existing] = await tx.select<{ review_flag: string | null }>(
        `SELECT review_flag
         FROM delivery_records
         WHERE id = ? AND deleted_at IS NULL`,
        [id],
      )
      if (!existing)
        return null
      const reviewFlag = deriveReviewFlag(
        orderNo,
        lines,
        input.confirmations,
        existing.review_flag ?? '',
        input.reviewFlag,
      )
      await assertDeliveryNaturalKeyAvailable(tx, input, id)
      const updateLogId = await withUpdateLog(tx, 'delivery_records', id, () => tx.execute(
        `UPDATE delivery_records
         SET project_id=?, supplier_id=?, order_no=?, delivery_date=?, review_flag=?, note=?, updated_at=?
         WHERE id=?`,
        [
          input.projectId,
          input.supplierId || null,
          orderNo || null,
          input.deliveryDate,
          reviewFlag,
          input.note.trim(),
          now,
          id,
        ],
      ))
      if (!updateLogId)
        return null
      const oldLines = await tx.select<{ id: string }>(
        `${selectVisibleSql('delivery_lines')} AND delivery_record_id = ?`,
        [id],
      )
      for (const line of oldLines)
        await softDelete(tx, 'delivery_lines', line.id)
      await insertLines(tx, id, lines, now)
      const newLines = await tx.select<{ id: string }>(
        `${selectVisibleSql('delivery_lines')} AND delivery_record_id = ?`,
        [id],
      )
      await attachDeliveryLineIds(tx, updateLogId, oldLines.map(line => line.id), newLines.map(line => line.id))
      return updateLogId
    })
    await load()
    return logId
  }

  async function loadSourceFile(id: string): Promise<DeliveryRecordSourceFile | null> {
    const [row] = await select<{
      file_name: string | null
      file_size: number | null
      mime_type: string | null
      encoding: string
      content: string
    }>(
      `SELECT
         source.file_name,
         source.file_size,
         source.mime_type,
         payload.encoding,
         payload.content
       FROM file_refs AS source
       INNER JOIN file_payloads AS payload ON payload.file_ref_id = source.id
       WHERE source.owner_type = 'delivery_record'
         AND source.owner_id = ?
         AND source.category = 'source'
         AND source.deleted_at IS NULL
       LIMIT 1`,
      [id],
    )
    if (!row)
      return null
    if (row.encoding !== 'base64')
      throw new Error(`不支持的送货单原件编码：${row.encoding}`)
    const bytes = base64ToBytes(row.content)
    return {
      fileName: row.file_name ?? '',
      mimeType: row.mime_type ?? '',
      fileSize: Number(row.file_size ?? bytes.byteLength),
      bytes,
    }
  }

  async function saveSourceFile(id: string, file: File): Promise<void> {
    // File 读取与编码可能失败，必须在开启 SQLite 事务前完成。
    const source = await prepareSourceFile(file)
    const now = new Date().toISOString()
    await withTransaction(async (tx) => {
      const [record] = await tx.select<{ id: string }>(
        `SELECT id FROM delivery_records
         WHERE id = ? AND archived = 1 AND deleted_at IS NULL`,
        [id],
      )
      if (!record)
        throw new Error('送货单归档记录不存在')

      await persistSourceFile(tx, id, source, now)
      await tx.execute(
        `UPDATE delivery_records
         SET file_name = ?, file_path = '', updated_at = ?
         WHERE id = ?`,
        [source.fileName, now, id],
      )
    })
    await load()
  }

  const softActions = createSoftDeleteActions(db, 'delivery_records', load)

  async function undo(logId: string): Promise<boolean> {
    const undone = await withTransaction(async (tx) => {
      const [log] = await tx.select<DeliveryOperationLog>(
        'SELECT table_name, record_id, action, before_data FROM operation_logs WHERE id = ?',
        [logId],
      )
      const beforeLineIds = log?.table_name === 'delivery_records' && log.action === 'update'
        ? deliveryLineIdsFrom(log.before_data)
        : null
      if (!log || beforeLineIds == null)
        return undoOperation(tx, logId)

      const didUndo = await undoOperation(tx, logId)
      if (!didUndo)
        return false

      const lines = await tx.select<{ id: string, deleted_at: string | null }>(
        'SELECT id, deleted_at FROM delivery_lines WHERE delivery_record_id = ?',
        [log.record_id],
      )
      const existingIds = new Set(lines.map(line => line.id))
      if (beforeLineIds.some(id => !existingIds.has(id)))
        throw new Error('送货单编辑撤回缺少原明细行')

      const beforeIds = new Set(beforeLineIds)
      for (const line of lines) {
        if (beforeIds.has(line.id) && line.deleted_at != null)
          await restoreRecord(tx, 'delivery_lines', line.id)
        else if (!beforeIds.has(line.id) && line.deleted_at == null)
          await softDelete(tx, 'delivery_lines', line.id)
      }
      return true
    })
    if (!undone)
      return false
    await load()
    return true
  }

  return {
    list: readonly(list),
    loading: readonly(loading),
    load,
    byId,
    pendingPrintRecords: computed(() => list.value.filter(record => record.printDisposition === 'pending')),
    add,
    update,
    excludeFromPrint,
    excludeManyFromPrint,
    confirmPrintReceipt,
    confirmManyPrintReceipts,
    loadSourceFile,
    saveSourceFile,
    remove: softActions.remove,
    restore: softActions.restore,
    undo,
  }
})
