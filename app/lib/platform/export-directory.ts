import type { ExportDirectoryTarget } from '~/lib/kit/export'
import { appendCollisionSuffix } from '~/lib/kit/export'

interface BrowserWritableFile {
  write: (data: Uint8Array) => Promise<void>
  close: () => Promise<void>
}

interface BrowserFileHandle {
  createWritable: () => Promise<BrowserWritableFile>
}

interface BrowserDirectoryHandle {
  name: string
  getDirectoryHandle: (name: string, options: { create: true }) => Promise<BrowserDirectoryHandle>
  getFileHandle: (name: string, options: { create: boolean }) => Promise<BrowserFileHandle>
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<BrowserDirectoryHandle>
}

function hasErrorName(error: unknown, name: string) {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === name
}

function isAbortError(error: unknown) {
  return hasErrorName(error, 'AbortError')
}

function candidateFileName(fileName: string, sequence: number): string {
  return sequence === 1 ? fileName : appendCollisionSuffix(fileName, sequence)
}

export interface PickExportDirectoryOptions {
  /** 配置导出需要在所选目录内创建子目录；直接保存保持 false 的最小权限。 */
  recursive?: boolean
}

function relativePathSegments(relativePath: string): string[] {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean)
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..'))
    throw new Error('导出文件路径必须是所选目录内的安全相对路径')
  return segments
}

async function browserFileExists(
  directory: BrowserDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await directory.getFileHandle(name, { create: false })
    return true
  }
  catch (error) {
    if (hasErrorName(error, 'NotFoundError'))
      return false
    // 同名项是子目录时按「名字已被占用」处理。
    if (hasErrorName(error, 'TypeMismatchError'))
      return true
    throw error
  }
}

async function pickBrowserDirectory(
  picker: NonNullable<DirectoryPickerWindow['showDirectoryPicker']>,
  options: PickExportDirectoryOptions,
): Promise<ExportDirectoryTarget | null> {
  try {
    const directory = await picker({ mode: 'readwrite' })
    return {
      displayPath: directory.name,
      supportsSubdirectories: true,
      async writeFile(relativePath, data) {
        const segments = relativePathSegments(relativePath)
        if (segments.length > 1 && !options.recursive)
          throw new Error('当前目录权限不允许创建导出子目录')
        let targetDirectory = directory
        for (const segment of segments.slice(0, -1))
          targetDirectory = await targetDirectory.getDirectoryHandle(segment, { create: true })

        // File System Access API 没有 createNew，只能先探测再创建；
        // 同名文件已存在时换下一个序号，绝不覆盖既有文件。
        const fileName = segments.at(-1)!
        for (let sequence = 1; ; sequence++) {
          const candidate = candidateFileName(fileName, sequence)
          if (await browserFileExists(targetDirectory, candidate))
            continue

          const file = await targetDirectory.getFileHandle(candidate, { create: true })
          const writable = await file.createWritable()
          await writable.write(data)
          await writable.close()
          return
        }
      },
    }
  }
  catch (error) {
    if (isAbortError(error))
      return null
    throw error
  }
}

function browserDownloadTarget(): ExportDirectoryTarget {
  return {
    displayPath: '浏览器下载',
    supportsSubdirectories: false,
    async writeFile(relativePath, data, mimeType) {
      const downloadName = relativePathSegments(relativePath).join('__')
      const blob = new Blob([Uint8Array.from(data).buffer], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = downloadName
      link.hidden = true
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    },
  }
}

/** 选择一个可写目录；不支持目录访问 API 的浏览器退回标准下载目录。 */
export async function pickExportDirectory(
  options: PickExportDirectoryOptions = {},
): Promise<ExportDirectoryTarget | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    throw new Error('导出只能在浏览器中运行')

  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  return picker ? await pickBrowserDirectory(picker.bind(window), options) : browserDownloadTarget()
}
