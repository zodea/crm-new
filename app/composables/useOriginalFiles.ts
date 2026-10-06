import type { ExportFileOptions, ExportFileResult } from '~/lib/kit/export'
import { useObjectUrl } from '@vueuse/core'
import { nextTick, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'

const PREVIEW_TYPES = new Set(['application/pdf', 'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'])
interface OriginalFile { id: string, fileName: string, mimeType: string }
interface OriginalContent { payloadBase64: string, mimeType: string }

export function useOriginalFiles<T extends OriginalFile>(options: {
  scope: () => string
  canRead: (file: T) => boolean
  read: (file: T, signal: AbortSignal) => Promise<OriginalContent>
  errorMessage: (cause: unknown) => string
  exportFile: (options: ExportFileOptions) => Promise<ExportFileResult>
}) {
  const previewOpen = shallowRef(false)
  const previewBlob = shallowRef<Blob>()
  const previewUrl = useObjectUrl(previewBlob)
  const previewTitle = shallowRef('附件预览')
  const previewMime = shallowRef('')
  const busy = shallowRef('')
  const problem = shallowRef('')
  let controller: AbortController | null = null
  let previewTrigger: HTMLElement | null = null
  let previewScope = ''
  let previewFile: T | null = null
  function restoreFocus(event: Event) {
    event.preventDefault()
    if (!previewOpen.value && previewTrigger?.isConnected && previewScope === options.scope() && previewFile && options.canRead(previewFile))
      previewTrigger.focus()
  }
  function clear() {
    controller?.abort()
    controller = null
    previewBlob.value = undefined
    previewMime.value = ''
    busy.value = ''
  }
  function cancel() {
    clear()
    previewOpen.value = false
  }
  function begin(file: T) {
    cancel()
    problem.value = ''
    if (!options.canRead(file))
      throw new Error('附件不属于当前可读取记录或已删除')
    const current = new AbortController()
    controller = current
    busy.value = file.id
    return current
  }
  function bytes(content: OriginalContent) {
    return Uint8Array.from(atob(content.payloadBase64), character => character.charCodeAt(0))
  }
  function canPreview(file: T) {
    return options.canRead(file) && PREVIEW_TYPES.has(file.mimeType.toLowerCase())
  }
  async function preview(file: T) {
    let current: AbortController | null = null
    try {
      current = begin(file)
      previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
      previewScope = options.scope()
      previewFile = file
      previewTitle.value = file.fileName
      previewOpen.value = true
      const content = await options.read(file, current.signal)
      if (controller !== current || current.signal.aborted)
        return
      if (!PREVIEW_TYPES.has(content.mimeType.toLowerCase()))
        throw new Error('当前格式不支持预览，请下载原文件')
      previewMime.value = content.mimeType.toLowerCase()
      previewBlob.value = new Blob([bytes(content)], { type: previewMime.value })
      await nextTick()
    }
    catch (cause) {
      if (!current || (controller === current && !current.signal.aborted))
        problem.value = options.errorMessage(cause)
    }
    finally {
      if (controller === current)
        busy.value = ''
    }
  }
  async function download(file: T) {
    let current: AbortController | null = null
    try {
      current = begin(file)
      const active = current
      await options.exportFile({
        defaultName: file.fileName,
        mimeType: file.mimeType,
        signal: active.signal,
        data: async () => {
          if (controller !== active || active.signal.aborted || !options.canRead(file))
            throw new Error('附件读取已取消')
          const content = await options.read(file, active.signal)
          if (controller !== active || active.signal.aborted || !options.canRead(file))
            throw new Error('附件读取已取消')
          return bytes(content)
        },
      })
    }
    catch (cause) {
      if (!current || (controller === current && !current.signal.aborted))
        problem.value = options.errorMessage(cause)
    }
    finally {
      if (controller === current) {
        controller = null
        busy.value = ''
      }
    }
  }
  watch(previewOpen, (open) => {
    if (!open)
      clear()
  }, { flush: 'sync' })
  watch(options.scope, cancel, { flush: 'sync' })
  onDeactivated(cancel)
  onScopeDispose(cancel)
  return { previewOpen, previewUrl, previewTitle, previewMime, busy, problem, canPreview, preview, download, cancel, restoreFocus }
}
