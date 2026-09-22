import type { ProjectSupplierFileQuery, ProjectSupplierFileRepository } from '~/lib/project-supplier/file-content'
import type { ProjectSupplierFileDTO } from '~/lib/project-supplier/read-contract'
import { useObjectUrl, useTimeoutFn } from '@vueuse/core'
import { computed, nextTick, onDeactivated, onScopeDispose, readonly, shallowRef, watch } from 'vue'
import { createProjectSupplierFileArchive } from '~/lib/project-supplier/file-archive'
import { assertFileReadActive } from '~/lib/project-supplier/file-content'
import { sanitizeSegment } from '~/lib/project/archive'

export type ProjectSupplierFilesContext = Omit<ProjectSupplierFileQuery, 'fileId' | 'ownerType' | 'ownerId'>
const SAFE_PREVIEW_TYPES = new Set(['application/pdf', 'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'])

export function useProjectSupplierFiles(options: {
  context: () => ProjectSupplierFilesContext | null
  files: () => readonly ProjectSupplierFileDTO[]
  repository: ProjectSupplierFileRepository
}) {
  const ui = useKitUI()
  const selectedIds = shallowRef<string[]>([])
  const busy = shallowRef('')
  const problem = shallowRef('')
  const archiveNotice = shallowRef('')
  const previewBlob = shallowRef<Blob>()
  const previewUrl = useObjectUrl(previewBlob)
  const { start: expirePreview, stop: stopPreviewTimer } = useTimeoutFn(() => {
    previewBlob.value = undefined
  }, 60_000, { immediate: false })
  let controller: AbortController | null = null
  let pendingWindow: Window | null = null

  function cancel() {
    controller?.abort()
    controller = null
    busy.value = ''
    pendingWindow?.close()
    pendingWindow = null
    previewBlob.value = undefined
    stopPreviewTimer()
  }

  function availability(file: ProjectSupplierFileDTO): string {
    const context = options.context()
    if (!context)
      return '当前页面正在更新或无原件查看权限'
    if (file.ownerType !== 'project_supplier' || file.ownerId !== context.relationId || file.content?.state === 'not-connected')
      return '该业务来源的原件读取尚未接入'
    if (file.content?.state !== 'available')
      return '历史原件缺失，可在 ZIP 清单中留痕'
    return ''
  }

  function selectable(file: ProjectSupplierFileDTO): boolean {
    const context = options.context()
    return !!context && file.ownerType === 'project_supplier' && file.ownerId === context.relationId && file.content?.state !== 'not-connected'
  }
  function canPreview(file: ProjectSupplierFileDTO): boolean {
    return !availability(file) && SAFE_PREVIEW_TYPES.has(file.mimeType.trim().toLowerCase())
  }
  const selectableFiles = computed(() => options.files().filter(selectable))
  const allSelected = computed(() => selectableFiles.value.length > 0 && selectableFiles.value.every(file => selectedIds.value.includes(file.file.id)))
  function toggle(file: ProjectSupplierFileDTO) {
    if (busy.value || !selectable(file))
      return
    selectedIds.value = selectedIds.value.includes(file.file.id)
      ? selectedIds.value.filter(id => id !== file.file.id)
      : [...selectedIds.value, file.file.id]
  }
  function toggleAll() {
    if (!busy.value)
      selectedIds.value = allSelected.value ? [] : selectableFiles.value.map(file => file.file.id)
  }

  function begin(action: string) {
    if (busy.value || !options.context())
      return null
    controller = new AbortController()
    busy.value = action
    problem.value = ''
    archiveNotice.value = ''
    return controller
  }
  function report(cause: unknown, current: AbortController, saving: boolean) {
    if (current.signal.aborted || controller !== current)
      return
    problem.value = cause instanceof Error ? cause.message : '合作原件读取失败，请重试'
    if (!saving)
      ui.error(problem.value)
  }
  function finish(current: AbortController) {
    if (controller === current) {
      busy.value = ''
      controller = null
    }
  }
  async function read(file: ProjectSupplierFileDTO, current: AbortController) {
    const context = options.context()
    if (!context)
      throw new DOMException('来源已变化', 'AbortError')
    const result = await options.repository.getContent({ ...context, fileId: file.file.id, ownerType: file.ownerType, ownerId: file.ownerId }, { signal: current.signal })
    assertFileReadActive(current.signal)
    if (result.state === 'missing')
      throw new Error(result.reason === 'missing-payload' ? '中央未保存该历史原件' : '该业务来源的原件读取尚未接入')
    return result
  }

  async function download(file: ProjectSupplierFileDTO) {
    if (availability(file))
      return
    const current = begin(`download:${file.file.id}`)
    if (!current)
      return
    try {
      await ui.exportFile({ data: async () => (await read(file, current)).bytes, defaultName: sanitizeSegment(file.file.label), mimeType: file.mimeType, signal: current.signal })
    }
    catch (cause) { report(cause, current, true) }
    finally { finish(current) }
  }

  async function preview(file: ProjectSupplierFileDTO) {
    if (!canPreview(file))
      return
    const current = begin(`preview:${file.file.id}`)
    if (!current)
      return
    let opened: Window | null = null
    try {
      opened = window.open('', '_blank')
      if (!opened) {
        ui.warning('浏览器阻止了预览窗口，请允许弹出窗口后重试')
        return
      }
      opened.opener = null
      pendingWindow = opened
      const result = await read(file, current)
      if (!SAFE_PREVIEW_TYPES.has(result.mimeType.trim().toLowerCase()))
        throw new Error('该文件类型不支持安全预览，请下载后查看')
      previewBlob.value = new Blob([Uint8Array.from(result.bytes).buffer], { type: result.mimeType })
      await nextTick()
      assertFileReadActive(current.signal)
      if (!previewUrl.value || opened.closed)
        throw new Error('预览窗口已关闭，请重新打开')
      opened.location.replace(previewUrl.value)
      pendingWindow = null
      expirePreview()
    }
    catch (cause) {
      opened?.close()
      if (pendingWindow === opened)
        pendingWindow = null
      if (controller === current)
        previewBlob.value = undefined
      report(cause, current, false)
    }
    finally { finish(current) }
  }

  async function downloadSelected() {
    const context = options.context()
    if (!context || !selectedIds.value.length)
      return
    const current = begin('zip')
    if (!current)
      return
    let result: Awaited<ReturnType<typeof createProjectSupplierFileArchive>> | undefined
    try {
      const files = options.files()
      const selectedFileIds = [...selectedIds.value]
      const saved = await ui.exportFile({ data: async () => {
        result = await createProjectSupplierFileArchive({ query: context, files, selectedFileIds, repository: options.repository, signal: current.signal })
        return result.data
      }, defaultName: '合作档案原件.zip', mimeType: 'application/zip', signal: current.signal })
      assertFileReadActive(current.signal)
      if (saved.status !== 'cancelled' && result?.missingCount)
        archiveNotice.value = `已保存 ${result.exportedCount} 份原件；${result.missingCount} 份历史原件缺失，本包不齐套，详情已写入清单。`
    }
    catch (cause) { report(cause, current, true) }
    finally { finish(current) }
  }

  watch(() => JSON.stringify(options.context()), () => {
    cancel()
    selectedIds.value = []
    problem.value = ''
    archiveNotice.value = ''
  }, { flush: 'sync' })
  watch(() => options.files(), () => {
    const ids = new Set(selectableFiles.value.map(file => file.file.id))
    selectedIds.value = selectedIds.value.filter(id => ids.has(id))
  })
  onDeactivated(cancel)
  onScopeDispose(cancel)
  return { selectedIds: readonly(selectedIds), busy: readonly(busy), problem: readonly(problem), archiveNotice: readonly(archiveNotice), allSelected, availability, selectable, canPreview, toggle, toggleAll, preview, download, downloadSelected, cancel }
}
