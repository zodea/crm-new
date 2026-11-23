import { Buffer } from 'node:buffer'
import { promisify } from 'node:util'
import { inflateRaw } from 'node:zlib'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { INVOICE_WORKBOOK_LIMIT_MESSAGE, INVOICE_WORKBOOK_MAX_BYTES, INVOICE_WORKBOOK_MAX_EXPANDED_BYTES } from '../../app/lib/invoice/workbook-limits'

const MAX_EXPANDED = INVOICE_WORKBOOK_MAX_EXPANDED_BYTES
const inflate = promisify(inflateRaw)
function invalid(message: string): never {
  throw new CentralInvoiceProblem('validation-failed', message)
}
const split = (): never => invalid(INVOICE_WORKBOOK_LIMIT_MESSAGE)
const checksumTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function checksum(data: Uint8Array) {
  let value = 0xFFFFFFFF
  for (const byte of data) value = checksumTable[(value ^ byte) & 0xFF]! ^ (value >>> 8)
  return (value ^ 0xFFFFFFFF) >>> 0
}
function name(bytes: Uint8Array, flags: number) {
  if (!(flags & 0x800) && bytes.some(byte => byte >= 0x80))
    return invalid('工作簿 ZIP 文件名编码无法安全核验，请另存后重试。')
  let result: string
  try {
    result = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  }
  catch { return invalid('工作簿 ZIP 文件名编码损坏。') }
  if (!result || result.includes('\\') || result.includes('\0') || result.startsWith('/') || result.split('/').some(part => part === '.' || part === '..'))
    return invalid('工作簿 ZIP 路径无法安全核验。')
  const outputName = Buffer.from(result, 'utf8')
  if (!outputName.equals(bytes))
    return invalid('工作簿 ZIP 文件名无法可靠保留。')
  // 与浏览器保持相同的 SheetJS CFB 字节路径和大小写查找口径。
  let sheetJsName = ''
  for (const byte of outputName)
    sheetJsName += String.fromCharCode(byte)
  const fullPath = sheetJsName.startsWith('Root Entry/') ? sheetJsName : `Root Entry/${sheetJsName}`.replace('//', '/')
  return { outputName, lookupName: fullPath.replace(/^Root Entry\//, '').toLowerCase() }
}
interface Entry { nameBytes: Buffer, data: Buffer, crc: number }
interface PendingEntry { nameBytes: Buffer, localOffset: number, start: number, stop: number, method: number, compressed: number, expanded: number, crc: number, descriptor: boolean }

function assertSupportedZipExtra(data: Buffer, start: number, length: number) {
  const end = start + length
  for (let pos = start; pos < end;) {
    if (pos + 4 > end)
      return invalid('工作簿 ZIP 扩展字段损坏。')
    const kind = data.readUInt16LE(pos)
    const size = data.readUInt16LE(pos + 2)
    pos += 4
    if (pos + size > end)
      return invalid('工作簿 ZIP 扩展字段损坏。')
    if (kind === 1)
      return invalid('工作簿 ZIP64 格式暂不支持，请另存后重试。')
    pos += size
  }
}

/** 输出仅用于解析；原文件字节始终保留在发票证据中。 */
function storedZip(entries: Entry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const item of entries) {
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034B50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x800, 6)
    head.writeUInt32LE(item.crc, 14)
    head.writeUInt32LE(item.data.length, 18)
    head.writeUInt32LE(item.data.length, 22)
    head.writeUInt16LE(item.nameBytes.length, 26)
    local.push(head, item.nameBytes, item.data)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014B50, 0)
    record.writeUInt16LE(20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(0x800, 8)
    record.writeUInt32LE(item.crc, 16)
    record.writeUInt32LE(item.data.length, 20)
    record.writeUInt32LE(item.data.length, 24)
    record.writeUInt16LE(item.nameBytes.length, 28)
    record.writeUInt32LE(offset, 42)
    central.push(record, item.nameBytes)
    offset += head.length + item.nameBytes.length + item.data.length
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directorySize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

/** 先按真实输出限额解压并重建，避免后续解析器对恶意 ZIP 采用不同目录。 */
export async function boundedInvoiceXlsx(bytes: Uint8Array): Promise<Buffer> {
  if (!bytes.length || bytes.length > INVOICE_WORKBOOK_MAX_BYTES)
    return split()
  const data = Buffer.from(bytes)
  try {
    let end = -1
    for (let pos = data.length - 22; pos >= Math.max(0, data.length - 65557); pos--) {
      if (data.readUInt32LE(pos) === 0x06054B50 && pos + 22 + data.readUInt16LE(pos + 20) === data.length) {
        end = pos
        break
      }
    }
    if (end < 0 || data.readUInt16LE(end + 4) !== 0 || data.readUInt16LE(end + 6) !== 0)
      return invalid('工作簿 ZIP 目录损坏或不受支持。')
    const count = data.readUInt16LE(end + 10)
    const directorySize = data.readUInt32LE(end + 12)
    const directoryStart = data.readUInt32LE(end + 16)
    if (count === 0xFFFF || directorySize === 0xFFFFFFFF || directoryStart === 0xFFFFFFFF)
      return invalid('工作簿 ZIP64 格式暂不支持，请另存后重试。')
    if (data.readUInt16LE(end + 8) !== count || directoryStart + directorySize !== end)
      return invalid('工作簿 ZIP 目录格式不受支持。')
    let pos = directoryStart
    let declaredTotal = 0
    const pending: PendingEntry[] = []
    const seen = new Set<string>()
    for (let index = 0; index < count; index++) {
      if (pos + 46 > end || data.readUInt32LE(pos) !== 0x02014B50)
        return invalid('工作簿 ZIP 目录损坏。')
      const flags = data.readUInt16LE(pos + 8)
      const method = data.readUInt16LE(pos + 10)
      const crc = data.readUInt32LE(pos + 16)
      const compressed = data.readUInt32LE(pos + 20)
      const expanded = data.readUInt32LE(pos + 24)
      const nameLength = data.readUInt16LE(pos + 28)
      const extraLength = data.readUInt16LE(pos + 30)
      const commentLength = data.readUInt16LE(pos + 32)
      const localOffset = data.readUInt32LE(pos + 42)
      const next = pos + 46 + nameLength + extraLength + commentLength
      if (compressed === 0xFFFFFFFF || expanded === 0xFFFFFFFF || localOffset === 0xFFFFFFFF)
        return invalid('工作簿 ZIP64 格式暂不支持，请另存后重试。')
      if (next > end || (flags & 0x2041) || ![0, 8].includes(method) || data.readUInt16LE(pos + 34) !== 0)
        return invalid('工作簿含不受支持的压缩或加密格式。')
      assertSupportedZipExtra(data, pos + 46 + nameLength, extraLength)
      const nameBytes = data.subarray(pos + 46, pos + 46 + nameLength)
      const { outputName, lookupName } = name(nameBytes, flags)
      if (seen.has(lookupName))
        return invalid('工作簿包含重复或等价 ZIP 条目。')
      seen.add(lookupName)
      if (localOffset + 30 > directoryStart || data.readUInt32LE(localOffset) !== 0x04034B50 || data.readUInt16LE(localOffset + 6) !== flags || data.readUInt16LE(localOffset + 8) !== method)
        return invalid('工作簿 ZIP 本地目录不一致。')
      if (!(flags & 8) && (data.readUInt32LE(localOffset + 14) !== crc || data.readUInt32LE(localOffset + 18) !== compressed || data.readUInt32LE(localOffset + 22) !== expanded))
        return invalid('工作簿 ZIP 本地正文信息不一致。')
      if ((flags & 8) && (data.readUInt32LE(localOffset + 14) !== 0 || data.readUInt32LE(localOffset + 18) !== 0 || data.readUInt32LE(localOffset + 22) !== 0))
        return invalid('工作簿 ZIP 本地正文信息不一致。')
      const localName = data.readUInt16LE(localOffset + 26)
      const localExtra = data.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localName + localExtra
      const stop = start + compressed
      if (stop > directoryStart || !data.subarray(localOffset + 30, localOffset + 30 + localName).equals(nameBytes))
        return invalid('工作簿 ZIP 条目范围不一致。')
      assertSupportedZipExtra(data, localOffset + 30 + localName, localExtra)
      if (expanded > MAX_EXPANDED - declaredTotal)
        return split()
      declaredTotal += expanded
      pending.push({ nameBytes: outputName, localOffset, start, stop, method, compressed, expanded, crc, descriptor: !!(flags & 8) })
      pos = next
    }
    if (pos !== end)
      return invalid('工作簿 ZIP 中央目录长度不一致。')
    const sorted = [...pending].sort((a, b) => a.localOffset - b.localOffset)
    for (let index = 1; index < sorted.length; index++) {
      if (sorted[index]!.localOffset < sorted[index - 1]!.stop)
        return invalid('工作簿 ZIP 条目范围不一致。')
    }
    for (let index = 0; index < sorted.length; index++) {
      const entry = sorted[index]!
      if (!entry.descriptor)
        continue
      const boundary = sorted[index + 1]?.localOffset ?? directoryStart
      const pos = entry.stop
      const unsigned = pos + 12 <= boundary && data.readUInt32LE(pos) === entry.crc
        && data.readUInt32LE(pos + 4) === entry.compressed && data.readUInt32LE(pos + 8) === entry.expanded
      const signed = pos + 16 <= boundary && data.readUInt32LE(pos) === 0x08074B50
        && data.readUInt32LE(pos + 4) === entry.crc && data.readUInt32LE(pos + 8) === entry.compressed
        && data.readUInt32LE(pos + 12) === entry.expanded
      if (unsigned === signed)
        return invalid('工作簿 ZIP 数据描述符缺失、冲突或超出条目范围。')
    }
    let total = 0
    const entries: Entry[] = []
    for (const { nameBytes, start, stop, method, expanded, crc } of pending) {
      let content: Buffer
      if (method === 0) {
        content = Buffer.from(data.subarray(start, stop))
      }
      else {
        try {
          content = await inflate(data.subarray(start, stop), { maxOutputLength: Math.max(1, MAX_EXPANDED - total) })
        }
        catch { return invalid('工作簿压缩数据损坏或解压超过 100 MiB，请拆分后重试。') }
      }
      total += content.length
      if (total > MAX_EXPANDED)
        return split()
      if (content.length !== expanded || checksum(content) !== crc)
        return invalid('工作簿 ZIP 正文、大小或校验值不一致。')
      entries.push({ nameBytes, data: content, crc })
    }
    return storedZip(entries)
  }
  catch (cause) {
    if (cause instanceof CentralInvoiceProblem)
      throw cause
    return invalid('工作簿 ZIP 结构无法安全核验。')
  }
}
