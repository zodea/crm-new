import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { boundedInvoiceBrowserXlsx } from '~/lib/invoice/central-workbook-browser'

interface FixtureEntry { name: string, content?: Uint8Array, method?: number, expanded?: number, crc?: number }
const encoder = new TextEncoder()
const bytes = (value: string) => encoder.encode(value)
function join(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}
function crc32(data: Uint8Array) {
  let crc = 0xFFFFFFFF
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
function fixture(entries: readonly FixtureEntry[], reverse = false): Uint8Array<ArrayBuffer> {
  const locals: Uint8Array[] = []
  const records: Uint8Array[] = []
  let offset = 0
  for (const item of entries) {
    const name = bytes(item.name)
    const content = item.content ?? new Uint8Array()
    const method = item.method ?? 0
    const expanded = item.expanded ?? content.length
    const crc = item.crc ?? crc32(content)
    const local = new Uint8Array(30)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034B50, true)
    l.setUint16(4, 20, true)
    l.setUint16(6, 0x800, true)
    l.setUint16(8, method, true)
    l.setUint32(14, crc, true)
    l.setUint32(18, content.length, true)
    l.setUint32(22, expanded, true)
    l.setUint16(26, name.length, true)
    const central = new Uint8Array(46)
    const c = new DataView(central.buffer)
    c.setUint32(0, 0x02014B50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x800, true)
    c.setUint16(10, method, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, content.length, true)
    c.setUint32(24, expanded, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    locals.push(local, name, content)
    records.push(join([central, name]))
    offset += local.length + name.length + content.length
  }
  const directory = join(reverse ? [...records].reverse() : records)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054B50, true)
  e.setUint16(8, entries.length, true)
  e.setUint16(10, entries.length, true)
  e.setUint32(12, directory.length, true)
  e.setUint32(16, offset, true)
  return join([...locals, directory, end])
}

function centralNames(archive: ArrayBuffer): Uint8Array[] {
  const view = new DataView(archive)
  const data = new Uint8Array(archive)
  const end = data.length - 22
  const count = view.getUint16(end + 10, true)
  let pos = view.getUint32(end + 16, true)
  const names: Uint8Array[] = []
  for (let index = 0; index < count; index++) {
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    names.push(data.slice(pos + 46, pos + 46 + nameLength))
    pos += 46 + nameLength + extraLength + commentLength
  }
  return names
}

/** 外层正文是伪造的压缩流，内层本地头嵌套其中；目录先列外层。 */
function overlapping(): ArrayBuffer {
  const outerName = bytes('outer')
  const innerName = bytes('inner')
  const inner = new Uint8Array(30)
  const i = new DataView(inner.buffer)
  i.setUint32(0, 0x04034B50, true)
  i.setUint16(4, 20, true)
  i.setUint16(26, innerName.length, true)
  const outer = new Uint8Array(30)
  const o = new DataView(outer.buffer)
  o.setUint32(0, 0x04034B50, true)
  o.setUint16(4, 20, true)
  o.setUint16(6, 8, true)
  o.setUint16(8, 8, true)
  o.setUint16(26, outerName.length, true)
  const content = join([inner, innerName])
  const innerOffset = outer.length + outerName.length
  const outerCentral = new Uint8Array(46)
  const a = new DataView(outerCentral.buffer)
  a.setUint32(0, 0x02014B50, true)
  a.setUint16(4, 20, true)
  a.setUint16(6, 20, true)
  a.setUint16(8, 8, true)
  a.setUint16(10, 8, true)
  a.setUint32(20, content.length, true)
  a.setUint16(28, outerName.length, true)
  const innerCentral = new Uint8Array(46)
  const b = new DataView(innerCentral.buffer)
  b.setUint32(0, 0x02014B50, true)
  b.setUint16(4, 20, true)
  b.setUint16(6, 20, true)
  b.setUint16(28, innerName.length, true)
  b.setUint32(42, innerOffset, true)
  const directory = join([outerCentral, outerName, innerCentral, innerName])
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054B50, true)
  e.setUint16(8, 2, true)
  e.setUint16(10, 2, true)
  e.setUint32(12, directory.length, true)
  e.setUint32(16, innerOffset + content.length, true)
  return join([outer, outerName, content, directory, end]).buffer
}

afterEach(() => vi.unstubAllGlobals())

describe('中央浏览器 ZIP 预检草稿', () => {
  it('完整扫描目录和重叠区间后才解压', async () => {
    await expect(boundedInvoiceBrowserXlsx(overlapping())).rejects.toThrow('ZIP 条目范围不一致')
    const invalid = fixture([{ name: 'first', method: 8, content: new Uint8Array([0xFF]), expanded: 1 }, { name: 'later' }])
    const view = new DataView(invalid.buffer)
    const end = invalid.length - 22
    const directory = view.getUint32(end + 16, true)
    view.setUint32(directory + 46 + bytes('first').length, 0, true)
    await expect(boundedInvoiceBrowserXlsx(invalid.buffer)).rejects.toThrow('ZIP 目录损坏')
  })

  it.each([
    ['xl/workbook.xml', 'XL/WORKBOOK.XML'],
    ['xl/workbook.xml', 'Root Entry/xl/workbook.xml'],
    ['xl/workbook.xml', 'xl//workbook.xml'],
  ])('拒绝 SheetJS 等价的条目名 %s 与 %s', async (first, second) => {
    await expect(boundedInvoiceBrowserXlsx(fixture([{ name: first }, { name: second }]).buffer)).rejects.toThrow('ZIP 路径或条目')
  })

  it('保留 SheetJS 查找口径下不同的条目路径', async () => {
    const zip = fixture([{ name: 'xl/workbook.xml' }, { name: 'Root Entry/xl//workbook.xml' }])
    await expect(boundedInvoiceBrowserXlsx(zip.buffer)).resolves.toBeInstanceOf(ArrayBuffer)
  })

  it('不把 SheetJS 字节名称不同的非 ASCII 名称当成同一条目', async () => {
    const zip = fixture([{ name: 'Ä.xml' }, { name: 'ä.xml' }])
    await expect(boundedInvoiceBrowserXlsx(zip.buffer)).resolves.toBeInstanceOf(ArrayBuffer)
  })

  it('保留文件名开头的 U+FEFF 原始字节', async () => {
    const name = '\uFEFFxl/workbook.xml'
    const safe = await boundedInvoiceBrowserXlsx(fixture([{ name }]).buffer)
    expect(centralNames(safe)).toEqual([bytes(name)])
  })

  it('前导 U+FEFF 与无前导字符的名称在重包和 SheetJS 字节路径中分别保留', async () => {
    const first = '\uFEFFxl/workbook.xml'
    const second = 'xl/workbook.xml'
    const safe = await boundedInvoiceBrowserXlsx(fixture([{ name: first }, { name: second }]).buffer)
    expect(centralNames(safe)).toEqual([bytes(first), bytes(second)])
    const paths = XLSX.CFB.read(new Uint8Array(safe), { type: 'array' }).FullPaths.map(path => path.replace(/^Root Entry\//, '').toLowerCase())
    const sheetJsName = Array.from(bytes(first), byte => String.fromCharCode(byte)).join('').toLowerCase()
    expect(sheetJsName).not.toBe(second)
    expect(paths.filter(path => path === sheetJsName)).toHaveLength(1)
    expect(paths.filter(path => path === second)).toHaveLength(1)
  })

  it('拒绝路径穿越和错误 CRC，不改写原数据', async () => {
    await expect(boundedInvoiceBrowserXlsx(fixture([{ name: '../escape' }]).buffer)).rejects.toThrow('ZIP 路径或条目')
    const bad = fixture([{ name: 'entry', content: bytes('abc'), crc: 0 }])
    const original = Uint8Array.from(bad)
    await expect(boundedInvoiceBrowserXlsx(bad.buffer)).rejects.toThrow('校验值不一致')
    expect(bad).toEqual(original)
  })

  it('逆序目录中的大量空条目可通过并保留原目录顺序', { timeout: 30_000 }, async () => {
    const input = fixture(Array.from({ length: 20_000 }, (_, index) => ({ name: `entry-${index}` })), true)
    const output = await boundedInvoiceBrowserXlsx(input.buffer)
    const data = new DataView(output)
    const end = output.byteLength - 22
    const directory = data.getUint32(end + 16, true)
    expect(data.getUint16(end + 10, true)).toBe(20_000)
    const length = data.getUint16(directory + 28, true)
    expect(new TextDecoder().decode(new Uint8Array(output, directory + 46, length))).toBe('entry-19999')
  })

  it('有效工作簿重包后仍可读取原有表格', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['票号'], ['合成-001']]), '合成表')
    const original = XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer
    const safe = await boundedInvoiceBrowserXlsx(original)
    expect(XLSX.read(safe, { type: 'array' }).Sheets['合成表']?.A2?.v).toBe('合成-001')
  })

  it('已取消时不继续读取条目', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(boundedInvoiceBrowserXlsx(fixture([{ name: 'entry' }]).buffer, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('压缩流虚报尺寸时按实际输出累计终止', async () => {
    class SyntheticInflate {
      constructor() {
        const block = new Uint8Array(1024 * 1024)
        return new TransformStream<Uint8Array, Uint8Array>({
          transform(_chunk, controller) {
            for (let index = 0; index < 101; index++)
              controller.enqueue(block)
          },
        })
      }
    }
    vi.stubGlobal('DecompressionStream', SyntheticInflate)
    const input = fixture([{ name: 'forged', method: 8, content: new Uint8Array([1]), expanded: 0, crc: 0 }])
    await expect(boundedInvoiceBrowserXlsx(input.buffer)).rejects.toThrow('解压最多 100 MiB')
  })
})
