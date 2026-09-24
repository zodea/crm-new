import type { ProjectSupplierFileContent, ProjectSupplierFileQuery } from '~/lib/project-supplier/file-content'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createProjectSupplierFileArchive } from '~/lib/project-supplier/file-archive'
import { cooperationPdfFixture } from './pdf-fixture'

const query = { projectId: 'project-438', supplierId: 'supplier-438', relationId: 'relation-438', origin: 'real' as const, includeDemo: false }
const bytes = cooperationPdfFixture()

function file(id: string, fileName = '合同.pdf') {
  return {
    file: { id, label: fileName, state: 'resolved' as const, entity: 'file' as const, no: null },
    ownerType: 'project_supplier',
    ownerId: query.relationId,
    sourceLabel: '合作档案',
    navigation: { kind: 'unavailable' as const, reason: 'missing-route' as const },
    fileSize: bytes.byteLength,
    mimeType: 'application/pdf',
    category: '合同',
    uploader: '资料员',
    uploadedAt: '2026-09-10T00:00:00.000Z',
  }
}

function content(request: ProjectSupplierFileQuery): ProjectSupplierFileContent {
  return {
    ...request,
    dataOrigin: request.origin,
    state: 'available',
    bytes,
    fileName: '合同.pdf',
    fileSize: bytes.byteLength,
    mimeType: 'application/pdf',
    sourceVersion: '1',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

export function storedZipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const data = Buffer.from(bytes)
  const entries = new Map<string, Uint8Array>()
  let offset = 0
  while (data.readUInt32LE(offset) === 0x04034B50) {
    const size = data.readUInt32LE(offset + 18)
    const nameSize = data.readUInt16LE(offset + 26)
    const extraSize = data.readUInt16LE(offset + 28)
    const name = data.subarray(offset + 30, offset + 30 + nameSize).toString('utf8')
    const start = offset + 30 + nameSize + extraSize
    entries.set(name, new Uint8Array(data.subarray(start, start + size)))
    offset = start + size
  }
  return entries
}

describe('选中合作原件 ZIP', () => {
  it('仅明确历史缺正文可导出部分包，清单逐文件保留缺失事实', async () => {
    const result = await createProjectSupplierFileArchive({
      query,
      files: [file('first'), file('missing')],
      selectedFileIds: ['first', 'missing'],
      repository: { getContent: async request => request.fileId === 'missing'
        ? { ...content(request), state: 'missing', reason: 'missing-payload' }
        : content(request) },
    })
    const entries = storedZipEntries(result.data)
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('00_文件清单.json')))
    expect(manifest.files[1]).toMatchObject({ fileId: 'missing', state: 'missing', archiveName: null, sha256: null })
    expect(new TextDecoder().decode(entries.get('00_导出说明.txt'))).toContain('本包不齐套')
    expect(result).toMatchObject({ exportedCount: 1, missingCount: 1 })
  })

  it.each(['forbidden', 'unavailable', 'relationship-mismatch'])('某文件 %s 时整包失败，不把读取错误伪装成历史缺失', async (code) => {
    const cause = { problem: { code } }
    await expect(createProjectSupplierFileArchive({
      query,
      files: [file('first'), file('second')],
      selectedFileIds: ['first', 'second'],
      repository: { getContent: async (request) => {
        if (request.fileId === 'second')
          throw cause
        return content(request)
      } },
    })).rejects.toBe(cause)
  })

  it.each([{ relationId: 'other' }, { dataOrigin: 'demo' as const }, { state: 'missing' as const, reason: 'not-connected' as const }])('返回来源错配或未接入时拒绝生成：%j', async (change) => {
    await expect(createProjectSupplierFileArchive({
      query,
      files: [file('first')],
      selectedFileIds: ['first'],
      repository: { getContent: async request => ({ ...content(request), ...change }) },
    })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })

  it('等待正文期间取消不返回可保存的 ZIP', async () => {
    const controller = new AbortController()
    await expect(createProjectSupplierFileArchive({
      query,
      files: [file('first')],
      selectedFileIds: ['first'],
      signal: controller.signal,
      repository: { getContent: async (request) => {
        controller.abort()
        return content(request)
      } },
    })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([`a.${'b'.repeat(130)}`, `${'a'.repeat(119)}😀合同.pdf`, 'CON.pdf', '../合同.pdf'])('长文件名及特殊字符 %s 的清单与 ZIP 实际路径一一对应', async (name) => {
    const result = await createProjectSupplierFileArchive({
      query,
      files: [file('first', name), file('second', name)],
      selectedFileIds: ['first', 'second'],
      repository: { getContent: async request => ({ ...content(request), fileName: name }) },
    })
    const entries = storedZipEntries(result.data)
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('00_文件清单.json')))
    expect(new Set(manifest.files.map((row: { archiveName: string }) => row.archiveName)).size).toBe(2)
    for (const row of manifest.files) {
      expect(entries.get(row.archiveName)).toEqual(bytes)
      expect(row.archiveName.split('/').at(-1).length).toBeLessThanOrEqual(120)
      expect(row.archiveName).not.toMatch(/(?:^|\/)CON\.pdf$/i)
    }
  })

  it('同 ID 只读取一次，同名不同文件各自保留完整 PDF，清单摘要与包内字节一致', async () => {
    const getContent = vi.fn(async (request: ProjectSupplierFileQuery) => content(request))
    const result = await createProjectSupplierFileArchive({
      query,
      files: [file('first'), file('second')],
      selectedFileIds: ['first', 'second', 'first'],
      repository: { getContent },
    })
    const entries = storedZipEntries(result.data)
    expect(getContent).toHaveBeenCalledTimes(2)
    expect(entries.get('01_原件/合同.pdf')).toEqual(bytes)
    expect(entries.get('01_原件/合同 (2).pdf')).toEqual(bytes)
    const manifest = JSON.parse(new TextDecoder().decode(entries.get('00_文件清单.json')))
    expect(manifest.files).toMatchObject([
      { fileId: 'first', archiveName: '01_原件/合同.pdf', state: 'exported', sha256: content({ ...query, fileId: 'first', ownerType: 'project_supplier', ownerId: query.relationId }).sha256 },
      { fileId: 'second', archiveName: '01_原件/合同 (2).pdf', state: 'exported' },
    ])
    expect(result).toMatchObject({ exportedCount: 2, missingCount: 0 })
  })
})
