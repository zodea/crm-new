import type { ExportDirectoryTarget } from '~/lib/kit/export'
import { isTauri } from '@tauri-apps/api/core'

interface BrowserWritableFile {
  write: (data: Uint8Array) => Promise<void>
  close: () => Promise<void>
}

interface BrowserFileHandle {
  createWritable: () => Promise<BrowserWritableFile>
}

interface BrowserDirectoryHandle {
  name: string
  getFileHandle: (name: string, options: { create: true }) => Promise<BrowserFileHandle>
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<BrowserDirectoryHandle>
}

function isAbortError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}

async function pickTauriDirectory(): Promise<ExportDirectoryTarget | null> {
  const [{ open }, { writeFile }, { join }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ])
  const selection = await open({
    directory: true,
    multiple: false,
    recursive: false,
  })
  const directory = Array.isArray(selection) ? selection[0] : selection
  if (!directory)
    return null

  return {
    displayPath: directory,
    async writeFile(name, data) {
      await writeFile(await join(directory, name), data)
    },
  }
}

async function pickBrowserDirectory(
  picker: NonNullable<DirectoryPickerWindow['showDirectoryPicker']>,
): Promise<ExportDirectoryTarget | null> {
  try {
    const directory = await picker({ mode: 'readwrite' })
    return {
      displayPath: directory.name,
      async writeFile(name, data) {
        const file = await directory.getFileHandle(name, { create: true })
        const writable = await file.createWritable()
        await writable.write(data)
        await writable.close()
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
    async writeFile(name, data, mimeType) {
      const blob = new Blob([Uint8Array.from(data).buffer], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.hidden = true
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    },
  }
}

/** 选择一个可写目录；不支持目录访问 API 的浏览器退回标准下载目录。 */
export async function pickExportDirectory(): Promise<ExportDirectoryTarget | null> {
  if (isTauri())
    return await pickTauriDirectory()

  if (typeof window === 'undefined' || typeof document === 'undefined')
    throw new Error('导出只能在浏览器或桌面端运行')

  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  return picker ? await pickBrowserDirectory(picker.bind(window)) : browserDownloadTarget()
}
