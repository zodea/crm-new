import type { ExportData } from '~/lib/kit/export'
import type { DeliveryRecord, DeliveryRecordSourceFile } from '~/stores/delivery-record'
import * as XLSX from 'xlsx'
import { assertDeliveryExportActive, loadCentralDeliveryExportSources } from '~/lib/delivery-record/export-sources'
import { exportDataToBytes } from '~/lib/kit/export'
import { createZip, sanitizeSegment } from '~/lib/project/archive'

export const DELIVERY_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const DELIVERY_ZIP_MIME = 'application/zip'

export interface DeliveryExportRow {
  projectName: string
  supplierName: string
  orderNo: string
  deliveryDate: string
  materialName: string
  spec: string
  unit: string
  quantity: number | null
  unitPrice: number | null
  amount: number | null
  sourceFile: string
  exception: string
}

const EXPORT_COLUMNS: readonly { key: keyof DeliveryExportRow, label: string, width: number }[] = [
  { key: 'projectName', label: '项目', width: 24 },
  { key: 'supplierName', label: '分供方', width: 30 },
  { key: 'orderNo', label: '送货单号', width: 20 },
  { key: 'deliveryDate', label: '日期', width: 14 },
  { key: 'materialName', label: '材料名称', width: 24 },
  { key: 'spec', label: '规格', width: 18 },
  { key: 'unit', label: '单位', width: 10 },
  { key: 'quantity', label: '数量', width: 12 },
  { key: 'unitPrice', label: '单价', width: 12 },
  { key: 'amount', label: '金额', width: 14 },
  { key: 'sourceFile', label: '原件名/页码', width: 30 },
  { key: 'exception', label: '异常说明', width: 34 },
]

export interface DeliveryExportResolvers {
  projectName: (id: string) => string
  supplierName: (id: string | null) => string
}

export interface DeliveryExportSourceInfo {
  fileName: string
  shared: boolean
  available?: boolean
  sourceKey?: string
}

export interface DeliveryArchiveSource extends DeliveryRecordSourceFile {
  recordId: string
  sourceKey: string
  shared: boolean
}

export interface DeliveryArchiveExportOptions {
  convertImagesToPdf: boolean
  loadSource: (record: DeliveryRecord) => Promise<DeliveryRecordSourceFile | null>
  signal?: AbortSignal
}

export interface DeliveryArchiveExportResult {
  data: Uint8Array
  rows: readonly DeliveryExportRow[]
  sources: readonly DeliveryArchiveSource[]
  missingRecordIds: readonly string[]
  pdfSourceCount: number
  imagePdfFileName: string | null
}

function rowException(
  record: DeliveryRecord,
  line: DeliveryRecord['lines'][number],
  source?: DeliveryExportSourceInfo,
): string {
  const reasons: string[] = []
  if (!record.hasSourceFile || source?.available === false)
    reasons.push('缺少原件')
  if (source?.shared)
    reasons.push('多单共用原件/无法拆分')
  if (!record.supplierId)
    reasons.push('未区分分供方')
  if (line.qty == null || line.unitPrice == null || line.amount == null)
    reasons.push('数量/金额缺失')
  if (record.reviewFlag)
    reasons.push(record.reviewFlag)
  if (record.note)
    reasons.push(record.note)
  return [...new Set(reasons)].join('；')
}

export function deliveryLedgerRows(
  records: readonly DeliveryRecord[],
  resolvers: DeliveryExportResolvers,
  sources: ReadonlyMap<string, DeliveryExportSourceInfo> = new Map(),
): DeliveryExportRow[] {
  return records
    .flatMap(record => record.lines.map((line) => {
      const source = sources.get(record.id)
      return {
        projectName: resolvers.projectName(record.projectId),
        supplierName: resolvers.supplierName(record.supplierId),
        orderNo: record.orderNo,
        deliveryDate: record.deliveryDate,
        materialName: line.materialName,
        spec: line.spec,
        unit: line.unit,
        quantity: line.qty,
        unitPrice: line.unitPrice,
        amount: line.amount,
        sourceFile: source?.available === false
          ? '—'
          : source
            ? `${source.fileName} / ${source.shared ? '共用原件' : '—'}`
            : record.hasSourceFile ? `${record.fileName || '原件'} / —` : '—',
        exception: rowException(record, line, source),
      }
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName, 'zh-CN')
      || a.supplierName.localeCompare(b.supplierName, 'zh-CN')
      || a.deliveryDate.localeCompare(b.deliveryDate)
      || a.orderNo.localeCompare(b.orderNo, 'zh-CN')
      || a.materialName.localeCompare(b.materialName, 'zh-CN'))
}

function excelDateValue(value: string): Date | string {
  const match = value.match(/^(\d{4})[-/]([01]\d)[-/]([0-3]\d)$/)
  if (!match)
    return value
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? value : date
}

function writeWorkbook(workbook: XLSX.WorkBook): ExportData {
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer
}

export function createDeliveryLedgerXlsx(rows: readonly DeliveryExportRow[]): ExportData {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['送货单归档明细'],
    EXPORT_COLUMNS.map(column => column.label),
    ...rows.map(row => EXPORT_COLUMNS.map((column) => {
      if (column.key === 'deliveryDate')
        return excelDateValue(row.deliveryDate)
      return row[column.key]
    })),
  ])
  worksheet['!cols'] = EXPORT_COLUMNS.map(column => ({ wch: column.width }))
  worksheet['!merges'] = [{
    s: { r: 0, c: 0 },
    e: { r: 0, c: EXPORT_COLUMNS.length - 1 },
  }]

  for (let row = 2; row < rows.length + 2; row++) {
    const dateCell = worksheet[XLSX.utils.encode_cell({ r: row, c: 3 })]
    if (dateCell)
      dateCell.z = 'yyyy"年"m"月"d"日";@'
    for (const column of [7, 8, 9]) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })]
      if (cell && typeof cell.v === 'number')
        cell.z = '0.00_);[Red](0.00)'
    }
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '送货单明细')
  return writeWorkbook(workbook)
}

interface PdfPageImage {
  bytes: Uint8Array
  width: number
  height: number
  widthPoints: number
  heightPoints: number
}

const IMAGE_MIME_RE = /^image\/(?:png|jpe?g)$/i

function isPdf(source: DeliveryRecordSourceFile): boolean {
  return source.mimeType === 'application/pdf' || /\.pdf$/i.test(source.fileName)
}

function isImage(source: DeliveryRecordSourceFile): boolean {
  return IMAGE_MIME_RE.test(source.mimeType) || /\.(?:png|jpe?g)$/i.test(source.fileName)
}

function imageJpegDimensions(bytes: Uint8Array): { width: number, height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8)
    return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xFF) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]!
    offset += 2
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7))
      continue
    if (offset + 2 > bytes.length)
      return null
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!
    if (length < 2 || offset + length > bytes.length)
      return null
    const isFrame = (marker >= 0xC0 && marker <= 0xC3)
      || (marker >= 0xC5 && marker <= 0xC7)
      || (marker >= 0xC9 && marker <= 0xCB)
      || (marker >= 0xCD && marker <= 0xCF)
    if (isFrame) {
      return {
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      }
    }
    offset += length
  }
  return null
}

async function imageToJpeg(source: DeliveryArchiveSource): Promise<PdfPageImage> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined')
    throw new Error(`无法将图片原件转换为 PDF：当前环境不支持图片渲染（${source.fileName}）`)
  const bitmap = await createImageBitmap(new Blob([source.bytes as unknown as BlobPart], { type: source.mimeType }))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, bitmap.width)
    canvas.height = Math.max(1, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context)
      throw new Error(`无法将图片原件转换为 PDF：${source.fileName}`)
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error(`无法编码图片原件：${source.fileName}`)), 'image/jpeg', 0.94)
    })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const dimensions = imageJpegDimensions(bytes) ?? { width: bitmap.width, height: bitmap.height }
    return {
      bytes,
      width: dimensions.width,
      height: dimensions.height,
      widthPoints: dimensions.width * 72 / 96,
      heightPoints: dimensions.height * 72 / 96,
    }
  }
  finally {
    bitmap.close()
  }
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function pdfNumber(value: number): string {
  return Math.max(1, value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function createImagePdf(pages: readonly PdfPageImage[]): Uint8Array {
  const objects: Uint8Array[] = [new Uint8Array()]
  const pageRefs: number[] = []
  const object = (body: Uint8Array | string): number => {
    objects.push(typeof body === 'string' ? ascii(body) : body)
    return objects.length - 1
  }
  const catalogRef = object('')
  const pagesRef = object('')
  for (const [index, page] of pages.entries()) {
    const imageRef = object(concatBytes([
      ascii(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`),
      page.bytes,
      ascii('\nendstream'),
    ]))
    const content = ascii(`q\n${pdfNumber(page.widthPoints)} 0 0 ${pdfNumber(page.heightPoints)} 0 0 cm\n/Im${index + 1} Do\nQ\n`)
    const contentRef = object(concatBytes([
      ascii(`<< /Length ${content.length} >>\nstream\n`),
      content,
      ascii('endstream'),
    ]))
    const pageRef = object(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${pdfNumber(page.widthPoints)} ${pdfNumber(page.heightPoints)}] /Resources << /XObject << /Im${index + 1} ${imageRef} 0 R >> >> /Contents ${contentRef} 0 R >>`)
    pageRefs.push(pageRef)
  }
  objects[catalogRef] = ascii(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`)
  objects[pagesRef] = ascii(`<< /Type /Pages /Kids [${pageRefs.map(ref => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`)

  const chunks: Uint8Array[] = [ascii('%PDF-1.7\n%\xFF\xFF\xFF\xFF\n')]
  const offsets: number[] = [0]
  let offset = chunks[0]!.length
  for (let index = 1; index < objects.length; index += 1) {
    const prefix = ascii(`${index} 0 obj\n`)
    const suffix = ascii('\nendobj\n')
    offsets[index] = offset
    chunks.push(prefix, objects[index]!, suffix)
    offset += prefix.length + objects[index]!.length + suffix.length
  }
  const xrefOffset = offset
  const xref = [`xref\n0 ${objects.length}\n`, '0000000000 65535 f \n', ...offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`)].join('')
  chunks.push(ascii(`${xref}trailer\n<< /Size ${objects.length} /Root ${catalogRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`))
  return concatBytes(chunks)
}

function sourceKey(record: DeliveryRecord): string {
  return record.printBatchId.trim() || record.id
}

function sourcePath(source: DeliveryArchiveSource, usedPaths: Set<string>): string {
  const extension = /\.(pdf|png|jpe?g)$/i.exec(source.fileName)?.[1]?.toLowerCase() || 'bin'
  const folder = isPdf(source) ? '原件/PDF' : '原件/图片'
  const stem = sanitizeSegment(source.fileName.replace(/\.(pdf|png|jpe?g)$/i, ''), '原件').replace(/[\uD800-\uDBFF]$/, '')
  const extensionSuffix = `.${extension}`
  const nameFor = (sequence: number) => {
    const suffix = sequence > 1 ? ` (${sequence})` : ''
    const budget = 120 - extensionSuffix.length - suffix.length
    let shortened = ''
    for (const character of stem) {
      if (shortened.length + character.length > budget)
        break
      shortened += character
    }
    return `${shortened}${suffix}${extensionSuffix}`
  }
  let sequence = 1
  let name = nameFor(sequence)
  let path = `${folder}/${name}`
  while (usedPaths.has(path.toLowerCase())) {
    sequence += 1
    name = nameFor(sequence)
    path = `${folder}/${name}`
  }
  usedPaths.add(path.toLowerCase())
  return path
}

async function loadUniqueSources(
  records: readonly DeliveryRecord[],
  loadSource: DeliveryArchiveExportOptions['loadSource'],
): Promise<{ sources: DeliveryArchiveSource[], sourceByRecord: Map<string, DeliveryExportSourceInfo>, missingRecordIds: string[] }> {
  const sorted = [...records].sort((a, b) => a.projectId.localeCompare(b.projectId)
    || (a.supplierId || '').localeCompare(b.supplierId || '')
    || a.deliveryDate.localeCompare(b.deliveryDate)
    || a.orderNo.localeCompare(b.orderNo, 'zh-CN'))
  const groups = new Map<string, DeliveryRecord[]>()
  for (const record of sorted) {
    const key = sourceKey(record)
    groups.set(key, [...(groups.get(key) ?? []), record])
  }
  const sources: DeliveryArchiveSource[] = []
  const sourceByRecord = new Map<string, DeliveryExportSourceInfo>()
  const missingRecordIds: string[] = []
  for (const [key, group] of groups) {
    let loaded: DeliveryRecordSourceFile | null = null
    let owner: DeliveryRecord | undefined
    for (const record of group) {
      if (!record.hasSourceFile)
        continue
      loaded = await loadSource(record)
      if (loaded) {
        owner = record
        break
      }
    }
    if (!loaded || !owner) {
      for (const record of group) {
        missingRecordIds.push(record.id)
        sourceByRecord.set(record.id, { fileName: record.fileName || '原件', shared: group.length > 1, available: false })
      }
      continue
    }
    const source: DeliveryArchiveSource = { ...loaded, recordId: owner.id, sourceKey: key, shared: group.length > 1 }
    sources.push(source)
    for (const record of group)
      sourceByRecord.set(record.id, { fileName: loaded.fileName, shared: group.length > 1 })
  }
  return { sources, sourceByRecord, missingRecordIds }
}

function deliveryArchiveExplanation(
  sources: readonly DeliveryArchiveSource[],
  missingRecordIds: readonly string[],
  convertImagesToPdf: boolean,
  imagePdfFileName: string | null,
  convertedImageCount: number,
): Uint8Array {
  const pdfSourceCount = sources.filter(isPdf).length
  const imageSourceCount = sources.filter(isImage).length
  const lines = [
    '送货单原件包导出说明',
    `原件共 ${sources.length} 份：PDF ${pdfSourceCount} 份，图片 ${imageSourceCount} 份。`,
    `PDF 原件未重建或合并，均以原始字节整份保存在“原件/PDF/”；多页 PDF 和共用 PDF 不拆分、不重排，共用源只保留一份。`,
    imagePdfFileName
      ? `已将 ${convertedImageCount} 份图片原件另行封装为“${imagePdfFileName}”；该文件只包含图片，不包含 PDF 原件。`
      : convertImagesToPdf
        ? '已选择图片转 PDF，但本次没有可转换的 PNG/JPG 图片，因此未生成图片合并 PDF。'
        : '本次未选择图片转 PDF；图片原件保持原格式保存在“原件/图片/”。',
    missingRecordIds.length
      ? `缺少原件的记录（${missingRecordIds.length}）：${missingRecordIds.join('、')}。缺失状态同时写入“送货单明细.xlsx”的异常说明。`
      : '本次导出记录均已找到原件。',
  ]
  return new TextEncoder().encode(lines.join('\n'))
}

export async function createDeliveryArchiveZip(
  records: readonly DeliveryRecord[],
  resolvers: DeliveryExportResolvers,
  options: DeliveryArchiveExportOptions,
): Promise<DeliveryArchiveExportResult> {
  assertDeliveryExportActive(options.signal)
  const central = records.some(record => record.dataOrigin !== undefined)
  if (central && records.some(record => record.dataOrigin === undefined))
    throw new Error('送货导出来源不一致，请重新读取')
  const { sources, sourceByRecord, missingRecordIds } = central
    ? await loadCentralDeliveryExportSources(records, options.loadSource, options.signal)
    : await loadUniqueSources(records, options.loadSource)
  assertDeliveryExportActive(options.signal)
  const usedSourcePaths = new Set<string>()
  const sourceFiles = sources.map(source => ({ path: sourcePath(source, usedSourcePaths), data: source.bytes, sourceKey: source.sourceKey }))
  if (central) {
    const paths = new Map(sourceFiles.map(file => [file.sourceKey, file.path]))
    for (const info of sourceByRecord.values()) {
      if (info.sourceKey && paths.has(info.sourceKey))
        info.fileName = paths.get(info.sourceKey)!
    }
  }
  const rows = deliveryLedgerRows(records, resolvers, sourceByRecord)
  const imageSources = options.convertImagesToPdf ? sources.filter(isImage) : []
  const imagePages: PdfPageImage[] = []
  for (const source of imageSources) {
    assertDeliveryExportActive(options.signal)
    imagePages.push(await imageToJpeg(source))
  }
  assertDeliveryExportActive(options.signal)
  const imagePdfFileName = imagePages.length ? '图片原件合并.pdf' : null
  const zipFiles = [
    { path: '送货单明细.xlsx', data: exportDataToBytes(createDeliveryLedgerXlsx(rows)) },
    {
      path: '导出说明.txt',
      data: deliveryArchiveExplanation(
        sources,
        missingRecordIds,
        options.convertImagesToPdf,
        imagePdfFileName,
        imagePages.length,
      ),
    },
    ...(imagePdfFileName ? [{ path: imagePdfFileName, data: createImagePdf(imagePages) }] : []),
    ...sourceFiles,
  ]
  return {
    data: createZip(zipFiles),
    rows,
    sources,
    missingRecordIds,
    pdfSourceCount: sources.filter(isPdf).length,
    imagePdfFileName,
  }
}
