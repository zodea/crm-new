import type { ProjectArchiveZipFile } from '../project/archive'
import type { ProjectSupplierFileQuery, ProjectSupplierFileRepository } from './file-content'
import type { ProjectSupplierFileDTO } from './read-contract'
import { createZip, sanitizeSegment } from '../project/archive'
import { assertFileReadActive } from './file-content'
import { projectSupplierProblem, ProjectSupplierRepositoryProblem } from './read-contract'

interface ArchiveOptions {
  query: Omit<ProjectSupplierFileQuery, 'fileId' | 'ownerType' | 'ownerId'>
  files: readonly ProjectSupplierFileDTO[]
  selectedFileIds: readonly string[]
  repository: ProjectSupplierFileRepository
  signal?: AbortSignal
  exportedAt?: string
}

interface ManifestFile {
  fileId: string
  ownerType: string
  ownerId: string
  originalName: string
  archiveName: string | null
  fileSize: number
  sha256: string | null
  state: 'exported' | 'missing'
  reason: string | null
}

function fail(message: string): never {
  throw new ProjectSupplierRepositoryProblem(projectSupplierProblem('unavailable', message, true))
}

function truncateName(value: string, length: number): string {
  const truncated = value.slice(0, length)
  // ZIP 路径按 UTF-8 编码；不能把一个 emoji 截成无法回读的半个代理项。
  return truncated.replace(/[\uD800-\uDBFF]$/, '').replace(/[.\s]+$/, '')
}

function archiveName(fileName: string, used: Set<string>): string {
  const name = truncateName(sanitizeSegment(fileName.normalize('NFC'), '原件'), 120) || '原件'
  const extensionIndex = name.lastIndexOf('.')
  const hasExtension = extensionIndex > 0 && name.length - extensionIndex <= 17
  const extension = hasExtension ? name.slice(extensionIndex) : ''
  const base = hasExtension ? name.slice(0, extensionIndex) : name
  let candidate = name
  let count = 1
  while (used.has(candidate.toLocaleLowerCase('zh-CN'))) {
    const suffix = ` (${++count})`
    candidate = `${truncateName(base, 120 - extension.length - suffix.length)}${suffix}${extension}`
  }
  used.add(candidate.toLocaleLowerCase('zh-CN'))
  return `01_原件/${candidate}`
}

export async function createProjectSupplierFileArchive(options: ArchiveOptions): Promise<{
  data: Uint8Array
  exportedCount: number
  missingCount: number
}> {
  assertFileReadActive(options.signal)
  const files = new Map(options.files.map(file => [file.file.id, file]))
  const selected = [...new Set(options.selectedFileIds)]
  if (selected.length === 0)
    return fail('请选择需要下载的合作原件')
  const entries: ProjectArchiveZipFile[] = []
  const manifest: ManifestFile[] = []
  const used = new Set<string>()
  for (const fileId of selected) {
    assertFileReadActive(options.signal)
    const file = files.get(fileId)
    if (!file || file.ownerType !== 'project_supplier' || file.ownerId !== options.query.relationId)
      return fail('选择中包含当前未接入或不属于本合作关系的原件，请重新选择')
    const query = { ...options.query, fileId, ownerType: file.ownerType, ownerId: file.ownerId }
    const content = await options.repository.getContent(query, { signal: options.signal })
    assertFileReadActive(options.signal)
    for (const key of ['projectId', 'supplierId', 'relationId', 'fileId', 'ownerType', 'ownerId'] as const) {
      if (content[key] !== query[key])
        return fail('合作档案来源已变化，请重新读取后再下载')
    }
    if (content.dataOrigin !== query.origin)
      return fail('合作档案来源已变化，请重新读取后再下载')
    if (content.state === 'missing' && content.reason !== 'missing-payload')
      return fail('所选原件的中央读取尚未接入')
    const path = content.state === 'available' ? archiveName(content.fileName, used) : null
    manifest.push({
      fileId,
      ownerType: content.ownerType,
      ownerId: content.ownerId,
      originalName: content.fileName,
      archiveName: path,
      fileSize: content.fileSize,
      sha256: content.state === 'available' ? content.sha256 : null,
      state: content.state === 'available' ? 'exported' : 'missing',
      reason: content.state === 'available' ? null : '中央未保存该历史原件',
    })
    if (content.state === 'available' && path)
      entries.push({ path, data: content.bytes, mimeType: content.mimeType })
  }
  const exportedCount = manifest.filter(file => file.state === 'exported').length
  const missingCount = manifest.length - exportedCount
  const exportedAt = options.exportedAt ?? new Date().toISOString()
  entries.push(
    {
      path: '00_文件清单.json',
      data: new TextEncoder().encode(JSON.stringify({
        projectId: options.query.projectId,
        supplierId: options.query.supplierId,
        relationId: options.query.relationId,
        dataOrigin: options.query.origin,
        exportedAt,
        files: manifest,
      }, null, 2)),
    },
    {
      path: '00_导出说明.txt',
      data: new TextEncoder().encode([
        '项目合作档案原件包',
        `导出时间：${exportedAt}`,
        `已导出原件 ${exportedCount} 份；历史缺原件 ${missingCount} 份。`,
        missingCount ? '本包不齐套。缺失原件已在文件清单中登记，未伪造扫描件或补用本地同名文件。' : '本包包含本次所选原件，不代表合作档案已齐套。',
        'PDF 与图片保留原始字节；ZIP 附件按原件保存，未自动解包。',
      ].join('\n')),
    },
  )
  assertFileReadActive(options.signal)
  return { data: createZip(entries), exportedCount, missingCount }
}
