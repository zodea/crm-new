import type { H3Event } from 'h3'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createDeflateRaw } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { assertInvoiceWorkbookRanges, assertInvoiceWorkbookSize, INVOICE_WORKBOOK_MAX_BYTES, INVOICE_WORKBOOK_MAX_EXPANDED_BYTES } from '../../app/lib/invoice/workbook-limits'
import { prepareInvoiceWorkbook } from '../../server/utils/production-invoice-workbook'
import { boundedInvoiceXlsx } from '../../server/utils/production-invoice-workbook-limits'
import { readInvoiceWorkbookRequest } from '../../server/utils/production-invoice-workbook-request'
import { syntheticInvoiceWorkbook } from '../helpers/invoice-workbook-fixture'

function oneDeflatedEntry(compressed: Buffer): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034B50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014B50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt16LE(name.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(local.length + name.length + compressed.length, 16)
  return Buffer.concat([local, name, compressed, central, name, end])
}

function manyEmptyEntries(count: number): Buffer {
  const locals: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (let index = 0; index < count; index++) {
    const name = Buffer.from(`entry-${index}`)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name)
    directory.push(Buffer.concat([central, name]))
    offset += local.length + name.length
  }
  const central = Buffer.concat(directory.reverse())
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, central, end])
}

function overlappingEntries(): Buffer {
  const outerName = Buffer.from('outer')
  const innerName = Buffer.from('inner')
  const inner = Buffer.alloc(30)
  inner.writeUInt32LE(0x04034B50, 0)
  inner.writeUInt16LE(20, 4)
  inner.writeUInt16LE(innerName.length, 26)
  const outer = Buffer.alloc(30)
  outer.writeUInt32LE(0x04034B50, 0)
  outer.writeUInt16LE(20, 4)
  outer.writeUInt16LE(8, 6)
  outer.writeUInt16LE(8, 8)
  outer.writeUInt16LE(outerName.length, 26)
  const innerOffset = outer.length + outerName.length
  const outerContent = Buffer.concat([inner, innerName])
  const innerCentral = Buffer.alloc(46)
  innerCentral.writeUInt32LE(0x02014B50, 0)
  innerCentral.writeUInt16LE(20, 4)
  innerCentral.writeUInt16LE(20, 6)
  innerCentral.writeUInt16LE(innerName.length, 28)
  innerCentral.writeUInt32LE(innerOffset, 42)
  const outerCentral = Buffer.alloc(46)
  outerCentral.writeUInt32LE(0x02014B50, 0)
  outerCentral.writeUInt16LE(20, 4)
  outerCentral.writeUInt16LE(20, 6)
  outerCentral.writeUInt16LE(8, 8)
  outerCentral.writeUInt16LE(8, 10)
  outerCentral.writeUInt32LE(outerContent.length, 20)
  outerCentral.writeUInt16LE(outerName.length, 28)
  const central = Buffer.concat([innerCentral, innerName, outerCentral, outerName])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(2, 8)
  end.writeUInt16LE(2, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(innerOffset + outerContent.length, 16)
  return Buffer.concat([outer, outerName, outerContent, central, end])
}

describe('发票工作簿边界', () => {
  it('按文件、表数、绝对坐标和合并范围拒绝超限，边界内不裁剪', () => {
    expect(() => assertInvoiceWorkbookSize(INVOICE_WORKBOOK_MAX_BYTES)).not.toThrow()
    expect(() => assertInvoiceWorkbookSize(INVOICE_WORKBOOK_MAX_BYTES + 1)).toThrow('请拆分')
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1:CV5000', '!merges': [{ s: { r: 0, c: 0 }, e: { r: 4999, c: 0 } }] }, '边界')
    expect(() => assertInvoiceWorkbookRanges(book)).not.toThrow()
    for (const ref of ['A1:CW5000', 'A1:CV5001', 'A5001:A5001']) {
      book.Sheets['边界']!['!ref'] = ref
      expect(() => assertInvoiceWorkbookRanges(book)).toThrow('请拆分')
    }
    book.Sheets['边界']!['!ref'] = 'A1:CV5000'
    book.Sheets['边界']!['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }]
    expect(() => assertInvoiceWorkbookRanges(book)).toThrow('重叠')
    book.Sheets['边界']!['!merges'] = []
    for (let index = 0; index < 20; index++) XLSX.utils.book_append_sheet(book, { '!ref': 'A1' }, `表${index}`)
    expect(() => assertInvoiceWorkbookRanges(book)).toThrow('请拆分')
  })

  it('正常压缩包安全重包，原字节不被改写', async () => {
    const fixture = await syntheticInvoiceWorkbook()
    const original = Buffer.from(fixture.bytes)
    const safe = await boundedInvoiceXlsx(fixture.bytes)
    expect(fixture.bytes).toEqual(original)
    expect(XLSX.read(safe, { type: 'buffer' }).SheetNames).toEqual(['历史'])
  })

  it('大量空条目的逆序目录可在时限内核验并保留目录顺序', { timeout: 15_000 }, async () => {
    const input = manyEmptyEntries(20_000)
    expect(input.length).toBeLessThan(INVOICE_WORKBOOK_MAX_BYTES)
    const output = await boundedInvoiceXlsx(input)
    const end = output.length - 22
    expect(output.readUInt16LE(end + 10)).toBe(20_000)
    const directoryStart = output.readUInt32LE(end + 16)
    const firstNameLength = output.readUInt16LE(directoryStart + 28)
    expect(output.subarray(directoryStart + 46, directoryStart + 46 + firstNameLength).toString()).toBe('entry-19999')
  })

  it('逆序嵌套条目在任何解压前被识别为范围重叠', async () => {
    await expect(boundedInvoiceXlsx(overlappingEntries())).rejects.toMatchObject({ problem: { code: 'validation-failed', message: '工作簿 ZIP 条目范围不一致。' } })
  })

  it('即使 ZIP 谎报零解压长度，也在实际输出超过 100 MiB 时停止', { timeout: 120_000 }, async () => {
    const encoder = createDeflateRaw()
    const chunks: Buffer[] = []
    encoder.on('data', chunk => chunks.push(Buffer.from(chunk)))
    const done = once(encoder, 'end')
    const block = Buffer.alloc(1024 * 1024)
    for (let index = 0; index < INVOICE_WORKBOOK_MAX_EXPANDED_BYTES / block.length; index++) {
      if (!encoder.write(block))
        await once(encoder, 'drain')
    }
    encoder.end(Buffer.from([0]))
    await done
    const malicious = oneDeflatedEntry(Buffer.concat(chunks))
    expect(malicious.length).toBeLessThan(INVOICE_WORKBOOK_MAX_BYTES)
    await expect(boundedInvoiceXlsx(malicious)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('100 MiB') } })
  })

  it('分块请求实际超限时中止，不依赖声明长度', async () => {
    const block = new Uint8Array(1024 * 1024)
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(block)
      },
      cancel() {
        cancelled = true
      },
    })
    const event = { headers: new Headers(), web: { request: { body: stream } }, method: 'POST' } as unknown as H3Event
    await expect(readInvoiceWorkbookRequest(event)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('拆分') } })
    expect(cancelled).toBe(true)
  })

  it('旧 XLS 安全解析缺口明确报不可用，原字节不改写', async () => {
    const bytes = Buffer.from('synthetic-xls')
    const source = { fileName: '旧表.xls', fileDigest: createHash('sha256').update(bytes).digest('hex'), sheetName: '旧表', rowNumber: 2, rawSnapshot: {} }
    await expect(prepareInvoiceWorkbook({ fileName: source.fileName, fileSize: bytes.length, payloadBase64: bytes.toString('base64') }, source)).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('XLS') } })
    expect(bytes.toString()).toBe('synthetic-xls')
  })
})
