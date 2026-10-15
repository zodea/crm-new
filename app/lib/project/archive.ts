export type ProjectArchiveSensitivity = 'normal' | 'sensitive'

export interface ProjectArchiveFile {
  id: string
  ownerType: string
  ownerId: string
  fileName: string
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: string
  sourceLabel: string
  folderPath: readonly string[]
  archivePath: string
  sensitivity: ProjectArchiveSensitivity
  hasPayload: boolean
  missingReason?: string
}

export interface ProjectArchiveFolder {
  key: string
  path: readonly string[]
  label: string
  sensitive?: boolean
}

export interface ProjectArchiveTreeNode {
  key: string
  label: string
  kind: 'folder' | 'file'
  children?: ProjectArchiveTreeNode[]
  file?: ProjectArchiveFile
  sensitive?: boolean
  empty?: boolean
}

export interface ProjectArchiveProject {
  id: string
  name: string
  code: string
  status: string
  manager: string
}

export interface ProjectArchiveSnapshot {
  project: ProjectArchiveProject
  folders: readonly ProjectArchiveFolder[]
  files: readonly ProjectArchiveFile[]
  tree: readonly ProjectArchiveTreeNode[]
}

export interface ProjectArchiveZipFile {
  path: string
  data: Uint8Array
  mimeType?: string
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

export function sanitizeSegment(value: unknown, fallback = '未命名'): string {
  const cleaned = [...text(value)]
    .map(character => character.codePointAt(0)! < 0x20 ? '-' : character)
    .join('')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/^\.+/, '')
    .replace(/[.\s]+$/g, '')
    .slice(0, 120)
  if (!cleaned)
    return fallback
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(cleaned))
    return `_${cleaned}`
  return cleaned
}

export function archivePath(...segments: readonly string[]): string {
  return segments.flatMap(segment => segment.split('/')).map(segment => sanitizeSegment(segment)).join('/')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function toBytes(value: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (value instanceof Uint8Array)
    return value
  if (value instanceof ArrayBuffer)
    return new Uint8Array(value)
  return new TextEncoder().encode(value)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let value = 0xFFFFFFFF
  for (const byte of bytes)
    value = CRC_TABLE[(value ^ byte) & 0xFF]! ^ (value >>> 8)
  return (value ^ 0xFFFFFFFF) >>> 0
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true)
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export function createZip(files: readonly ProjectArchiveZipFile[]): Uint8Array {
  const entries = [...files]
    .map(file => ({ ...file, path: archivePath(file.path), data: toBytes(file.data) }))
    .sort((left, right) => compareText(left.path, right.path))
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.path)
    const data = entry.data
    const header = new Uint8Array(30 + name.length)
    const view = new DataView(header.buffer)
    writeU32(view, 0, 0x04034B50)
    writeU16(view, 4, 20)
    writeU16(view, 6, 0x0800)
    writeU16(view, 8, 0)
    writeU16(view, 10, 0)
    writeU16(view, 12, 0)
    writeU32(view, 14, crc32(data))
    writeU32(view, 18, data.length)
    writeU32(view, 22, data.length)
    writeU16(view, 26, name.length)
    writeU16(view, 28, 0)
    header.set(name, 30)
    chunks.push(header, data)

    const centralHeader = new Uint8Array(46 + name.length)
    const centralView = new DataView(centralHeader.buffer)
    writeU32(centralView, 0, 0x02014B50)
    writeU16(centralView, 4, 20)
    writeU16(centralView, 6, 20)
    writeU16(centralView, 8, 0x0800)
    writeU16(centralView, 10, 0)
    writeU16(centralView, 12, 0)
    writeU16(centralView, 14, 0)
    writeU32(centralView, 16, crc32(data))
    writeU32(centralView, 20, data.length)
    writeU32(centralView, 24, data.length)
    writeU16(centralView, 28, name.length)
    writeU16(centralView, 30, 0)
    writeU16(centralView, 32, 0)
    writeU16(centralView, 34, 0)
    writeU16(centralView, 36, 0)
    writeU32(centralView, 38, 0)
    writeU32(centralView, 42, offset)
    centralHeader.set(name, 46)
    central.push(centralHeader)
    offset += header.length + data.length
  }
  const centralBytes = concatBytes(central)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  writeU32(endView, 0, 0x06054B50)
  writeU16(endView, 4, 0)
  writeU16(endView, 6, 0)
  writeU16(endView, 8, entries.length)
  writeU16(endView, 10, entries.length)
  writeU32(endView, 12, centralBytes.length)
  writeU32(endView, 16, offset)
  writeU16(endView, 20, 0)
  return concatBytes([...chunks, centralBytes, end])
}
