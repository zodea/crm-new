import type { FileRefRecord } from '~/lib/forms/file-refs'
import type { ExportFileOptions, ExportFileResult } from '~/lib/kit/export'
import type { ReceiptFileContent, ReceiptRecord } from '~/lib/receipt/contract'
import type { ReceiptRepository } from '~/lib/receipt/repository'
import { useObjectUrl } from '@vueuse/core'
import { nextTick, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { receiptProblem } from '~/lib/receipt/contract'
import { receiptProblemFromUnknown } from '~/lib/receipt/repository'

const PREVIEW_TYPES = new Set(['application/pdf', 'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'])
function bytes(content: ReceiptFileContent) {
  return Uint8Array.from(atob(content.payloadBase64), character => character.charCodeAt(0))
}

export function useReceiptFiles(options: {
  record: () => ReceiptRecord | null
  repository: Pick<ReceiptRepository, 'fileContent'>
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

  function clear() {
    controller?.abort()
    controller = null
    previewBlob.value = undefined
    busy.value = ''
  }
  function cancel() {
    clear()
    previewOpen.value = false
  }
  function source(file: FileRefRecord) {
    const record = options.record()
    if (!record || record.dataOrigin !== 'real')
      throw receiptProblem('forbidden', '当前来源没有可读取的收款附件正文')
    if (!record.attachments.some(row => row.id === file.id && row.ownerId === record.id && row.ownerType === 'receipt_registration' && row.deletedAt === null))
      throw receiptProblem('not-found', '附件不属于当前收款或已删除')
    return record
  }
  function begin(file: FileRefRecord) {
    cancel()
    problem.value = ''
    const current = new AbortController()
    controller = current
    busy.value = file.id
    return current
  }
  function canPreview(file: FileRefRecord) {
    return file.deletedAt === null && PREVIEW_TYPES.has(file.mimeType.toLowerCase())
  }
  async function preview(file: FileRefRecord) {
    const current = begin(file)
    previewTitle.value = file.fileName
    previewOpen.value = true
    try {
      const record = source(file)
      const content = await options.repository.fileContent(record.id, file.id, record.dataOrigin, { signal: current.signal })
      if (controller !== current || current.signal.aborted)
        return
      if (!PREVIEW_TYPES.has(content.mimeType.toLowerCase()))
        throw receiptProblem('validation-failed', '当前格式不支持预览，请下载原文件')
      previewMime.value = content.mimeType.toLowerCase()
      previewBlob.value = new Blob([bytes(content)], { type: previewMime.value })
      await nextTick()
    }
    catch (cause) {
      if (controller === current && !current.signal.aborted)
        problem.value = receiptProblemFromUnknown(cause).problem.message
    }
    finally {
      if (controller === current)
        busy.value = ''
    }
  }
  async function download(file: FileRefRecord) {
    const current = begin(file)
    try {
      const record = source(file)
      await options.exportFile({
        defaultName: file.fileName,
        mimeType: file.mimeType,
        signal: current.signal,
        data: async () => {
          const content = await options.repository.fileContent(record.id, file.id, record.dataOrigin, { signal: current.signal })
          return bytes(content)
        },
      })
    }
    catch (cause) {
      if (controller === current && !current.signal.aborted)
        problem.value = receiptProblemFromUnknown(cause).problem.message
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
  watch(() => {
    const record = options.record()
    return record ? `${record.dataOrigin}:${record.id}:${record.version}` : ''
  }, cancel, { flush: 'sync' })
  onDeactivated(cancel)
  onScopeDispose(cancel)
  return { previewOpen, previewUrl, previewTitle, previewMime, busy, problem, canPreview, preview, download, cancel }
}
