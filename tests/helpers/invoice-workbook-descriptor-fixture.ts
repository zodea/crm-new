/** Synthetic ZIP only; it never reads files or invokes SheetJS. */
export type DescriptorCase = 'signed' | 'unsigned' | 'unsigned-signature-crc' | 'signed-signature-crc' | 'wrong-crc' | 'wrong-compressed' | 'wrong-expanded' | 'missing' | 'truncated' | 'overlap' | 'nonzero-local' | 'wide-without-zip64' | 'zip64-marked' | 'zip64-extra'
const encoder = new TextEncoder()
const SIGNATURE = 0x08074B50
const u32 = (value: number) => value >>> 0

export function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1
  }
  return u32(crc ^ 0xFFFFFFFF)
}

function join(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

/** Produce four synthetic bytes whose actual CRC equals the optional marker. */
function signatureCrcBytes(): Uint8Array<ArrayBuffer> {
  const baseline = crc32(new Uint8Array(4))
  const basis = Array.from<{ value: number, mask: number } | undefined>({ length: 32 }).fill(undefined)
  for (let bit = 0; bit < 32; bit++) {
    const probe = new Uint8Array(4)
    probe[bit >>> 3] = 1 << (bit & 7)
    let value = u32(crc32(probe) ^ baseline)
    let mask = u32(2 ** bit)
    for (let pivot = 31; pivot >= 0; pivot--) {
      if (!((value >>> pivot) & 1))
        continue
      if (basis[pivot]) {
        value = u32(value ^ basis[pivot]!.value)
        mask = u32(mask ^ basis[pivot]!.mask)
      }
      else {
        basis[pivot] = { value, mask }
        break
      }
    }
  }
  let value = u32(SIGNATURE ^ baseline)
  let mask = 0
  for (let pivot = 31; pivot >= 0; pivot--) {
    if (!((value >>> pivot) & 1))
      continue
    const row = basis[pivot]
    if (!row)
      throw new Error('Synthetic CRC basis is incomplete')
    value = u32(value ^ row.value)
    mask = u32(mask ^ row.mask)
  }
  if (value !== 0)
    throw new Error('Synthetic CRC is not representable')
  return new Uint8Array([mask & 0xFF, (mask >>> 8) & 0xFF, (mask >>> 16) & 0xFF, (mask >>> 24) & 0xFF])
}

function record(name: Uint8Array, flags: number, content: Uint8Array, offset: number, zip64 = false, sentinel = zip64) {
  const crc = crc32(content)
  const extra = zip64 ? new Uint8Array(20) : new Uint8Array(0)
  if (zip64) {
    const x = new DataView(extra.buffer)
    x.setUint16(0, 1, true)
    x.setUint16(2, 16, true)
    x.setBigUint64(4, BigInt(content.length), true)
    x.setBigUint64(12, BigInt(content.length), true)
  }
  const local = new Uint8Array(30)
  const l = new DataView(local.buffer)
  l.setUint32(0, 0x04034B50, true)
  l.setUint16(4, zip64 ? 45 : 20, true)
  l.setUint16(6, flags, true)
  if (!(flags & 8)) {
    l.setUint32(14, crc, true)
    l.setUint32(18, content.length, true)
    l.setUint32(22, content.length, true)
  }
  l.setUint16(26, name.length, true)
  l.setUint16(28, extra.length, true)
  const central = new Uint8Array(46)
  const c = new DataView(central.buffer)
  c.setUint32(0, 0x02014B50, true)
  c.setUint16(4, zip64 ? 45 : 20, true)
  c.setUint16(6, zip64 ? 45 : 20, true)
  c.setUint16(8, flags, true)
  c.setUint32(16, crc, true)
  c.setUint32(20, sentinel ? 0xFFFFFFFF : content.length, true)
  c.setUint32(24, sentinel ? 0xFFFFFFFF : content.length, true)
  c.setUint16(28, name.length, true)
  c.setUint16(30, extra.length, true)
  c.setUint32(42, offset, true)
  return { local: join([local, name, extra, content]), central: join([central, name, extra]), crc }
}

export function descriptorFixture(mode: DescriptorCase) {
  const name = encoder.encode('first.txt')
  const content = mode === 'unsigned-signature-crc' || mode === 'signed-signature-crc' ? signatureCrcBytes() : encoder.encode('abc')
  const first = record(name, 0x808, content, 0, mode === 'zip64-marked' || mode === 'zip64-extra', mode === 'zip64-marked')
  if (mode === 'nonzero-local')
    new DataView(first.local.buffer).setUint32(14, first.crc, true)
  const signed = mode === 'signed' || mode === 'signed-signature-crc' || mode === 'wrong-crc' || mode === 'wrong-compressed' || mode === 'wrong-expanded' || mode === 'truncated' || mode === 'overlap'
  const wide = mode === 'wide-without-zip64' || mode === 'zip64-marked' || mode === 'zip64-extra'
  const descriptor = new Uint8Array((signed ? 4 : 0) + 4 + (wide ? 16 : 8))
  const d = new DataView(descriptor.buffer)
  let pos = 0
  if (signed) {
    d.setUint32(pos, SIGNATURE, true)
    pos += 4
  }
  d.setUint32(pos, mode === 'wrong-crc' ? u32(first.crc ^ 1) : first.crc, true)
  pos += 4
  if (wide) {
    d.setBigUint64(pos, BigInt(content.length), true)
    d.setBigUint64(pos + 8, BigInt(content.length), true)
  }
  else {
    d.setUint32(pos, content.length + (mode === 'wrong-compressed' ? 1 : 0), true)
    d.setUint32(pos + 4, content.length + (mode === 'wrong-expanded' ? 1 : 0), true)
  }
  const included = mode === 'missing' ? descriptor.subarray(0, 0) : mode === 'truncated' ? descriptor.subarray(0, 6) : mode === 'overlap' ? descriptor.subarray(0, 8) : descriptor
  const second = record(encoder.encode('second.txt'), 0x800, encoder.encode('z'), first.local.length + included.length)
  const directory = join([first.central, second.central])
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054B50, true)
  e.setUint16(8, 2, true)
  e.setUint16(10, 2, true)
  e.setUint32(12, directory.length, true)
  e.setUint32(16, first.local.length + included.length + second.local.length, true)
  return { archive: join([first.local, included, second.local, directory, end]), content, crc: first.crc }
}

/** Check canonical stored output names and bytes without using a ZIP library. */
export function storedOutputEntries(archive: Uint8Array): Array<{ name: string, content: number[] }> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const end = archive.length - 22
  const count = view.getUint16(end + 10, true)
  let pos = view.getUint32(end + 16, true)
  const result: Array<{ name: string, content: number[] }> = []
  for (let index = 0; index < count; index++) {
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    const offset = view.getUint32(pos + 42, true)
    const size = view.getUint32(pos + 24, true)
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
    result.push({ name: new TextDecoder().decode(archive.subarray(pos + 46, pos + 46 + nameLength)), content: [...archive.subarray(start, start + size)] })
    pos += 46 + nameLength + extraLength + commentLength
  }
  return result
}
