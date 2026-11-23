import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { boundedInvoiceBrowserXlsx } from '../../app/lib/invoice/central-workbook-browser'
import { boundedInvoiceXlsx } from '../../server/utils/production-invoice-workbook-limits'

interface Item { name: string | Uint8Array, content?: Uint8Array, crc?: number }
const enc = new TextEncoder()
function crc32(data: Uint8Array) {
  let crc = 0xFFFFFFFF
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
function zip(items: Item[], reverse = false): Buffer {
  const locals: Buffer[] = []
  const records: Buffer[] = []
  let offset = 0
  for (const item of items) {
    const name = typeof item.name === 'string' ? Buffer.from(item.name, 'utf8') : Buffer.from(item.name)
    const data = Buffer.from(item.content ?? [])
    const crc = item.crc ?? crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    records.push(Buffer.concat([central, name]))
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(reverse ? [...records].reverse() : records)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(items.length, 8)
  end.writeUInt16LE(items.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
function outputNames(data: Uint8Array) {
  const buffer = Buffer.from(data)
  const end = buffer.length - 22
  const count = buffer.readUInt16LE(end + 10)
  let pos = buffer.readUInt32LE(end + 16)
  const names: Buffer[] = []
  for (let index = 0; index < count; index++) {
    const n = buffer.readUInt16LE(pos + 28)
    const e = buffer.readUInt16LE(pos + 30)
    const c = buffer.readUInt16LE(pos + 32)
    names.push(Buffer.from(buffer.subarray(pos + 46, pos + 46 + n)))
    pos += 46 + n + e + c
  }
  return names
}
async function browser(input: Uint8Array) {
  return new Uint8Array(await boundedInvoiceBrowserXlsx(Uint8Array.from(input).buffer))
}
function overlap(): Buffer {
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
  const content = Buffer.concat([inner, innerName])
  const a = Buffer.alloc(46)
  a.writeUInt32LE(0x02014B50, 0)
  a.writeUInt16LE(20, 4)
  a.writeUInt16LE(20, 6)
  a.writeUInt16LE(8, 8)
  a.writeUInt16LE(8, 10)
  a.writeUInt32LE(content.length, 20)
  a.writeUInt16LE(outerName.length, 28)
  const b = Buffer.alloc(46)
  b.writeUInt32LE(0x02014B50, 0)
  b.writeUInt16LE(20, 4)
  b.writeUInt16LE(20, 6)
  b.writeUInt16LE(innerName.length, 28)
  b.writeUInt32LE(innerOffset, 42)
  const central = Buffer.concat([a, outerName, b, innerName])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(2, 8)
  end.writeUInt16LE(2, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(innerOffset + content.length, 16)
  return Buffer.concat([outer, outerName, content, central, end])
}

describe('中央服务端 ZIP 名称身份', () => {
  it('保留前导 U+FEFF 的原始字节，且与浏览器重包一致', async () => {
    const name = '\uFEFFxl/workbook.xml'
    const input = zip([{ name }])
    expect(outputNames(await boundedInvoiceXlsx(input))).toEqual([Buffer.from(name)])
    expect(outputNames(await browser(input))).toEqual([Buffer.from(name)])
  })

  it('前导 BOM 和无 BOM 的两个真实不同路径不误合并', async () => {
    const names = ['\uFEFFxl/workbook.xml', 'xl/workbook.xml']
    const input = zip(names.map(name => ({ name })))
    const expected = names.map(name => Buffer.from(name))
    const server = await boundedInvoiceXlsx(input)
    expect(outputNames(server)).toEqual(expected)
    expect(outputNames(await browser(input))).toEqual(expected)
    const namesSeen = XLSX.CFB.read(server, { type: 'buffer' }).FullPaths.map(path => path.replace(/^Root Entry\//, '').toLowerCase())
    const encoded = Array.from(enc.encode(names[0]!), byte => String.fromCharCode(byte)).join('').toLowerCase()
    expect(namesSeen.filter(path => path === encoded)).toHaveLength(1)
    expect(namesSeen.filter(path => path === names[1])).toHaveLength(1)
  })

  it.each([
    ['xl/workbook.xml', 'xl/workbook.xml'],
    ['xl/workbook.xml', 'XL/WORKBOOK.XML'],
    ['xl/workbook.xml', 'Root Entry/xl/workbook.xml'],
    ['xl/workbook.xml', 'xl//workbook.xml'],
  ])('拒绝 SheetJS 等价路径 %s 和 %s', async (first, second) => {
    const input = zip([{ name: first }, { name: second }])
    await expect(boundedInvoiceXlsx(input)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    await expect(browser(input)).rejects.toThrow('ZIP 路径或条目')
  })

  it('非 ASCII 字节名称不同则不合并', async () => {
    const names = ['Ä.xml', 'ä.xml']
    const input = zip(names.map(name => ({ name })))
    const expected = names.map(name => Buffer.from(name))
    expect(outputNames(await boundedInvoiceXlsx(input))).toEqual(expected)
    expect(outputNames(await browser(input))).toEqual(expected)
  })

  it('拒绝无效 UTF-8、路径穿越及错误 CRC', async () => {
    for (const item of [{ name: new Uint8Array([0xFF]) }, { name: '../escape' }, { name: 'entry', content: enc.encode('abc'), crc: 0 }]) {
      const input = zip([item])
      await expect(boundedInvoiceXlsx(input)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      await expect(browser(input)).rejects.toBeInstanceOf(Error)
    }
  })

  it('逆序 2 万条目仍按原目录顺序重包', { timeout: 15_000 }, async () => {
    const input = zip(Array.from({ length: 20_000 }, (_, index) => ({ name: `entry-${index}` })), true)
    const names = outputNames(await boundedInvoiceXlsx(input))
    expect(names).toHaveLength(20_000)
    expect(names[0]?.toString()).toBe('entry-19999')
    expect(names.at(-1)?.toString()).toBe('entry-0')
  })

  it('后项与前项嵌套时在解压前拒绝范围重叠', async () => {
    const input = overlap()
    await expect(boundedInvoiceXlsx(input)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: '工作簿 ZIP 条目范围不一致。' } })
    await expect(browser(input)).rejects.toThrow('ZIP 条目范围不一致')
  })

  it('合成有效工作簿重包后两端可正常解析', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['票号'], ['SYNTHETIC']]), '票据')
    const input = XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer
    const server = await boundedInvoiceXlsx(new Uint8Array(input))
    const client = await browser(new Uint8Array(input))
    expect(XLSX.read(server, { type: 'buffer' }).Sheets['票据']?.A2?.v).toBe('SYNTHETIC')
    expect(XLSX.read(client, { type: 'array' }).Sheets['票据']?.A2?.v).toBe('SYNTHETIC')
  })
})
