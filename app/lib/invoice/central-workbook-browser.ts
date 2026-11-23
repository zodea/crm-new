import type { InvoiceImportSheet } from './excel'
import * as XLSX from 'xlsx'
import { parseInvoiceWorkbookForMapping } from './excel'
import { assertInvoiceWorkbookRanges, assertInvoiceWorkbookSize, INVOICE_WORKBOOK_LIMIT_MESSAGE, INVOICE_WORKBOOK_MAX_EXPANDED_BYTES, INVOICE_WORKBOOK_MAX_SHEETS, InvoiceWorkbookLimitError } from './workbook-limits'

interface ZipEntry { nameBytes: Uint8Array, bytes: Uint8Array, crc: number }
interface PendingZipEntry { nameBytes: Uint8Array, localOffset: number, start: number, stop: number, method: number, compressed: number, expanded: number, crc: number, descriptor: boolean }
export interface InspectedInvoiceWorkbook {
  file: File
  sha256: string
  sheetNames: readonly string[]
  loadSheet: (name: string, signal?: AbortSignal) => Promise<InvoiceImportSheet>
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new DOMException('读取已取消。', 'AbortError')
}

const checksumTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function checksum(bytes: Uint8Array) {
  let value = 0xFFFFFFFF
  for (const byte of bytes) value = checksumTable[(value ^ byte) & 0xFF]! ^ (value >>> 8)
  return (value ^ 0xFFFFFFFF) >>> 0
}
function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}
function assertSupportedZipExtra(data: DataView, start: number, length: number) {
  const end = start + length
  for (let pos = start; pos < end;) {
    if (pos + 4 > end)
      throw new Error('工作簿 ZIP 扩展字段损坏。')
    const kind = data.getUint16(pos, true)
    const size = data.getUint16(pos + 2, true)
    pos += 4
    if (pos + size > end)
      throw new Error('工作簿 ZIP 扩展字段损坏。')
    if (kind === 1)
      throw new Error('工作簿 ZIP64 格式暂不支持，请另存后重试。')
    pos += size
  }
}
function joinBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}
function storedZip(entries: readonly ZipEntry[]): ArrayBuffer {
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const item of entries) {
    const header = new Uint8Array(30)
    const h = new DataView(header.buffer)
    h.setUint32(0, 0x04034B50, true)
    h.setUint16(4, 20, true)
    h.setUint16(6, 0x800, true)
    h.setUint32(14, item.crc, true)
    h.setUint32(18, item.bytes.length, true)
    h.setUint32(22, item.bytes.length, true)
    h.setUint16(26, item.nameBytes.length, true)
    local.push(header, item.nameBytes, item.bytes)
    const record = new Uint8Array(46)
    const c = new DataView(record.buffer)
    c.setUint32(0, 0x02014B50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x800, true)
    c.setUint32(16, item.crc, true)
    c.setUint32(20, item.bytes.length, true)
    c.setUint32(24, item.bytes.length, true)
    c.setUint16(28, item.nameBytes.length, true)
    c.setUint32(42, offset, true)
    central.push(record, item.nameBytes)
    offset += header.length + item.nameBytes.length + item.bytes.length
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054B50, true)
  e.setUint16(8, entries.length, true)
  e.setUint16(10, entries.length, true)
  e.setUint32(12, directorySize, true)
  e.setUint32(16, offset, true)
  return joinBytes([...local, ...central, end]).buffer
}

async function inflateLimited(bytes: Uint8Array, remaining: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined')
    throw new Error('当前浏览器无法安全解压工作簿，请使用受支持的浏览器。')
  const input = Uint8Array.from(bytes)
  const reader = new Blob([input.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      checkAbort(signal)
      const next = await reader.read()
      checkAbort(signal)
      if (next.done)
        break
      length += next.value.length
      if (length > remaining) {
        await reader.cancel()
        throw new InvoiceWorkbookLimitError(INVOICE_WORKBOOK_LIMIT_MESSAGE)
      }
      chunks.push(next.value)
    }
    return joinBytes(chunks)
  }
  finally {
    signal?.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

/** 核验原 ZIP 并重包为无压缩条目，避免后续解析器使用未经核验的目录。 */
export async function boundedInvoiceBrowserXlsx(original: ArrayBuffer, signal?: AbortSignal): Promise<ArrayBuffer> {
  assertInvoiceWorkbookSize(original.byteLength)
  const bytes = new Uint8Array(original)
  const data = new DataView(original)
  try {
    let end = -1
    for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos--) {
      if (data.getUint32(pos, true) === 0x06054B50 && pos + 22 + data.getUint16(pos + 20, true) === bytes.length) {
        end = pos
        break
      }
    }
    if (end < 0 || data.getUint16(end + 4, true) !== 0 || data.getUint16(end + 6, true) !== 0)
      throw new Error('工作簿 ZIP 目录损坏或不受支持。')
    const count = data.getUint16(end + 10, true)
    const directorySize = data.getUint32(end + 12, true)
    const directoryStart = data.getUint32(end + 16, true)
    if (count === 0xFFFF || directorySize === 0xFFFFFFFF || directoryStart === 0xFFFFFFFF)
      throw new Error('工作簿 ZIP64 格式暂不支持，请另存后重试。')
    if (data.getUint16(end + 8, true) !== count || directoryStart + directorySize !== end)
      throw new Error('工作簿 ZIP 目录格式不受支持。')
    let pos = directoryStart
    let declaredTotal = 0
    const pending: PendingZipEntry[] = []
    const names = new Set<string>()
    for (let index = 0; index < count; index++) {
      checkAbort(signal)
      if (pos + 46 > end || data.getUint32(pos, true) !== 0x02014B50)
        throw new Error('工作簿 ZIP 目录损坏。')
      const flags = data.getUint16(pos + 8, true)
      const method = data.getUint16(pos + 10, true)
      const crc = data.getUint32(pos + 16, true)
      const compressed = data.getUint32(pos + 20, true)
      const expanded = data.getUint32(pos + 24, true)
      const nameLength = data.getUint16(pos + 28, true)
      const extraLength = data.getUint16(pos + 30, true)
      const commentLength = data.getUint16(pos + 32, true)
      const localOffset = data.getUint32(pos + 42, true)
      const next = pos + 46 + nameLength + extraLength + commentLength
      if (compressed === 0xFFFFFFFF || expanded === 0xFFFFFFFF || localOffset === 0xFFFFFFFF)
        throw new Error('工作簿 ZIP64 格式暂不支持，请另存后重试。')
      if (next > end || (flags & 0x2041) || ![0, 8].includes(method) || data.getUint16(pos + 34, true) !== 0)
        throw new Error('工作簿含不受支持的压缩或加密格式。')
      assertSupportedZipExtra(data, pos + 46 + nameLength, extraLength)
      const nameBytes = bytes.subarray(pos + 46, pos + 46 + nameLength)
      if (!(flags & 0x800) && nameBytes.some(byte => byte >= 0x80))
        throw new Error('工作簿 ZIP 文件名编码无法安全核验。')
      const name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(nameBytes)
      const outputNameBytes = new TextEncoder().encode(name)
      if (!sameBytes(nameBytes, outputNameBytes))
        throw new Error('工作簿 ZIP 文件名无法可靠保留。')
      // 当前 SheetJS ZIP 读取将文件名每个字节映射为字符，再形成 CFB 路径并做不区分大小写查找。
      let sheetJsName = ''
      for (const byte of outputNameBytes)
        sheetJsName += String.fromCharCode(byte)
      const fullPath = sheetJsName.startsWith('Root Entry/') ? sheetJsName : `Root Entry/${sheetJsName}`.replace('//', '/')
      const lookupName = fullPath.replace(/^Root Entry\//, '').toLowerCase()
      if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..') || names.has(lookupName))
        throw new Error('工作簿 ZIP 路径或条目无法安全核验。')
      names.add(lookupName)
      if (localOffset + 30 > directoryStart || data.getUint32(localOffset, true) !== 0x04034B50 || data.getUint16(localOffset + 6, true) !== flags || data.getUint16(localOffset + 8, true) !== method)
        throw new Error('工作簿 ZIP 本地目录不一致。')
      if (!(flags & 8) && (data.getUint32(localOffset + 14, true) !== crc || data.getUint32(localOffset + 18, true) !== compressed || data.getUint32(localOffset + 22, true) !== expanded))
        throw new Error('工作簿 ZIP 本地正文信息不一致。')
      if ((flags & 8) && (data.getUint32(localOffset + 14, true) !== 0 || data.getUint32(localOffset + 18, true) !== 0 || data.getUint32(localOffset + 22, true) !== 0))
        throw new Error('工作簿 ZIP 本地正文信息不一致。')
      const localNameLength = data.getUint16(localOffset + 26, true)
      const localExtraLength = data.getUint16(localOffset + 28, true)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const stop = start + compressed
      if (stop > directoryStart || !sameBytes(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength), nameBytes))
        throw new Error('工作簿 ZIP 条目范围不一致。')
      assertSupportedZipExtra(data, localOffset + 30 + localNameLength, localExtraLength)
      if (expanded > INVOICE_WORKBOOK_MAX_EXPANDED_BYTES - declaredTotal)
        throw new InvoiceWorkbookLimitError(INVOICE_WORKBOOK_LIMIT_MESSAGE)
      declaredTotal += expanded
      pending.push({ nameBytes: outputNameBytes, localOffset, start, stop, method, compressed, expanded, crc, descriptor: !!(flags & 8) })
      pos = next
    }
    if (pos !== end)
      throw new Error('工作簿 ZIP 中央目录长度不一致。')
    const sorted = [...pending].sort((left, right) => left.localOffset - right.localOffset)
    for (let index = 1; index < sorted.length; index++) {
      checkAbort(signal)
      if (sorted[index]!.localOffset < sorted[index - 1]!.stop)
        throw new Error('工作簿 ZIP 条目范围不一致。')
    }
    for (let index = 0; index < sorted.length; index++) {
      checkAbort(signal)
      const entry = sorted[index]!
      if (!entry.descriptor)
        continue
      const boundary = sorted[index + 1]?.localOffset ?? directoryStart
      const pos = entry.stop
      const unsigned = pos + 12 <= boundary && data.getUint32(pos, true) === entry.crc
        && data.getUint32(pos + 4, true) === entry.compressed && data.getUint32(pos + 8, true) === entry.expanded
      const signed = pos + 16 <= boundary && data.getUint32(pos, true) === 0x08074B50
        && data.getUint32(pos + 4, true) === entry.crc && data.getUint32(pos + 8, true) === entry.compressed
        && data.getUint32(pos + 12, true) === entry.expanded
      if (unsigned === signed)
        throw new Error('工作簿 ZIP 数据描述符缺失、冲突或超出条目范围。')
    }
    let total = 0
    const entries: ZipEntry[] = []
    for (const { nameBytes, start, stop, method, expanded, crc } of pending) {
      checkAbort(signal)
      const content = method === 0 ? Uint8Array.from(bytes.subarray(start, stop)) : await inflateLimited(bytes.subarray(start, stop), INVOICE_WORKBOOK_MAX_EXPANDED_BYTES - total, signal)
      total += content.length
      if (total > INVOICE_WORKBOOK_MAX_EXPANDED_BYTES)
        throw new InvoiceWorkbookLimitError(INVOICE_WORKBOOK_LIMIT_MESSAGE)
      if (content.length !== expanded || checksum(content) !== crc)
        throw new Error('工作簿 ZIP 正文、大小或校验值不一致。')
      entries.push({ nameBytes, bytes: content, crc })
    }
    checkAbort(signal)
    return storedZip(entries)
  }
  catch (cause) {
    if (cause instanceof Error && !(cause instanceof RangeError))
      throw cause
    throw new Error('工作簿 ZIP 结构无法安全核验。')
  }
}

const readOptions = { type: 'array' as const, codepage: 65001, cellFormula: true, cellNF: true, cellStyles: true, sheetStubs: true, WTF: true }

/** XML 范围与公式缓存尚不能核实时，禁止交给 SheetJS。 */
async function requireVerifiedWorkbookXml(_safe: ArrayBuffer): Promise<void> {
  throw new Error('工作簿安全核验暂不可用，请保留原文件并稍后重试。')
}

/** 保存原文件用于后续摘要和提交；安全重包仅用于浏览器解析。 */
export async function inspectCentralInvoiceWorkbook(file: File, signal?: AbortSignal): Promise<InspectedInvoiceWorkbook> {
  assertInvoiceWorkbookSize(file.size)
  if (/\.xls$/i.test(file.name))
    throw new Error('旧版 XLS 暂无法安全校验，请保留原文件并稍后处理。')
  if (!/\.xlsx$/i.test(file.name))
    throw new Error('请选择 Excel 文件（.xlsx 或 .xls）。')
  checkAbort(signal)
  const original = await file.arrayBuffer()
  checkAbort(signal)
  if (original.byteLength !== file.size)
    throw new Error('文件大小无法核验，请重新选择文件。')
  const safe = await boundedInvoiceBrowserXlsx(original, signal)
  await requireVerifiedWorkbookXml(safe)
  const digest = await crypto.subtle.digest('SHA-256', original)
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  checkAbort(signal)
  const names = XLSX.read(safe, { type: 'array', bookSheets: true, WTF: true }).SheetNames
  if (names.length > INVOICE_WORKBOOK_MAX_SHEETS)
    throw new InvoiceWorkbookLimitError(INVOICE_WORKBOOK_LIMIT_MESSAGE)
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length)
    throw new Error('工作簿含重名工作表，无法可靠核验。')
  for (const name of names) {
    checkAbort(signal)
    const sparse = XLSX.read(safe, { ...readOptions, sheets: name })
    assertInvoiceWorkbookRanges(sparse, name)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  checkAbort(signal)
  return {
    file,
    sha256,
    sheetNames: names,
    async loadSheet(name, sheetSignal) {
      checkAbort(sheetSignal)
      if (!names.includes(name))
        throw new Error('工作簿中不存在此工作表。')
      const sparse = XLSX.read(safe, { ...readOptions, sheets: name })
      assertInvoiceWorkbookRanges(sparse, name)
      const parsed = await parseInvoiceWorkbookForMapping(safe, file.name, { workbook: sparse, selectedSheet: name })
      checkAbort(sheetSignal)
      const sheet = parsed.sheets[0]
      if (!sheet || sheet.name !== name)
        throw new Error('工作表读取不完整，请重新选择。')
      return sheet
    },
  }
}
