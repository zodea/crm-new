import type { FileRefRecord } from '~/lib/forms/file-refs'
import { loadFileRefContent } from '~/lib/forms/file-refs'
import { toErrorMessage } from '~/lib/util/error'

function objectUrl(file: FileRefRecord, bytes: Uint8Array): string {
  const copy = bytes.slice()
  return URL.createObjectURL(new Blob([copy.buffer], {
    type: file.mimeType || 'application/octet-stream',
  }))
}

export function useFileRefAccess() {
  const { error, warning } = useKitUI()

  async function preview(file: FileRefRecord) {
    try {
      const content = await loadFileRefContent(file)
      if (!content) {
        warning('当前仅保存了文件元数据，无法读取原文件')
        return
      }
      const url = objectUrl(file, content.bytes)
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (!opened)
        warning('浏览器阻止了预览窗口，请允许弹出窗口后重试')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
    catch (cause) {
      error(`附件预览失败：${toErrorMessage(cause)}`)
    }
  }

  async function download(file: FileRefRecord) {
    try {
      const content = await loadFileRefContent(file)
      if (!content) {
        warning('当前仅保存了文件元数据，无法下载原文件')
        return
      }
      const url = objectUrl(file, content.bytes)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.fileName || '附件'
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    }
    catch (cause) {
      error(`附件下载失败：${toErrorMessage(cause)}`)
    }
  }

  return { preview, download }
}
