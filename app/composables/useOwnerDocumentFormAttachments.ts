import type {
  FileRefChanges,
  FileRefDraft,
} from '~/lib/forms/file-refs'
import type { OwnerDocumentAttachmentRecord } from '~/lib/owner-document/central-command-contract'
import { isTauri } from '@tauri-apps/api/core'
import { computed, readonly, shallowRef } from 'vue'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { toErrorMessage } from '~/lib/util/error'

export type PendingOwnerDocumentAttachment = FileRefDraft & { localId: string }

export function useOwnerDocumentFormAttachments(options: { defaultCategory?: () => string } = {}) {
  const { warning, error } = useKitUI()
  const attachments = shallowRef<OwnerDocumentAttachmentRecord[]>([])
  const pendingAttachments = shallowRef<PendingOwnerDocumentAttachment[]>([])
  const pendingRemoveIds = shallowRef<string[]>([])
  const pendingRestoreIds = shallowRef<string[]>([])
  const desktopAttachmentPicker = shallowRef(isTauri())
  const readingFiles = shallowRef(false)
  let fileGeneration = 0

  const dirty = computed(() =>
    pendingAttachments.value.length > 0
    || pendingRemoveIds.value.length > 0
    || pendingRestoreIds.value.length > 0,
  )

  function clearPending() {
    fileGeneration++
    readingFiles.value = false
    pendingAttachments.value = []
    pendingRemoveIds.value = []
    pendingRestoreIds.value = []
  }

  function reset(files: OwnerDocumentAttachmentRecord[] = []) {
    attachments.value = files
    clearPending()
  }

  function changes(): FileRefChanges {
    return {
      add: pendingAttachments.value.map(({ localId: _localId, ...file }) => file),
      removeIds: pendingRemoveIds.value,
      restoreIds: pendingRestoreIds.value,
    }
  }

  function capture() {
    return JSON.parse(JSON.stringify({ add: pendingAttachments.value, removeIds: pendingRemoveIds.value, restoreIds: pendingRestoreIds.value })) as {
      add: PendingOwnerDocumentAttachment[]
      removeIds: string[]
      restoreIds: string[]
    }
  }

  function acknowledge(files: OwnerDocumentAttachmentRecord[], sent: ReturnType<typeof capture>) {
    attachments.value = files
    const submitted = new Map(sent.add.map(file => [file.localId, JSON.stringify(file)]))
    pendingAttachments.value = pendingAttachments.value.filter(file => submitted.get(file.localId) !== JSON.stringify(file))
    pendingRemoveIds.value = pendingRemoveIds.value.filter(id => !sent.removeIds.includes(id))
    pendingRestoreIds.value = pendingRestoreIds.value.filter(id => !sent.restoreIds.includes(id))
  }

  function append(files: FileRefDraft[]) {
    const activeCount = attachments.value.filter(file => !file.deletedAt).length
      - pendingRemoveIds.value.length
      + pendingRestoreIds.value.length
    const available = Math.max(9 - activeCount - pendingAttachments.value.length, 0)
    if (files.length > available)
      warning(`每张单据最多保留 9 份附件，本次只加入前 ${available} 份`)
    pendingAttachments.value = [
      ...pendingAttachments.value,
      ...files.slice(0, available).map((file, index) => ({
        ...file,
        localId: `${file.filePath || file.fileName}-${Date.now()}-${index}`,
        category: file.category || options.defaultCategory?.() || '业务附件',
      })),
    ]
  }

  async function handleFiles(files: File[]) {
    const generation = ++fileGeneration
    readingFiles.value = true
    try {
      const drafts = await Promise.all(files.map(file => fileRefDraftFromFile(file)))
      if (generation === fileGeneration)
        append(drafts)
    }
    catch (cause) {
      if (generation === fileGeneration)
        error(`附件读取失败：${toErrorMessage(cause)}`)
    }
    finally {
      if (generation === fileGeneration)
        readingFiles.value = false
    }
  }

  async function pickNativeFiles() {
    const generation = ++fileGeneration
    readingFiles.value = true
    try {
      const [{ open }, { stat, readFile }, { basename }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs'),
        import('@tauri-apps/api/path'),
      ])
      const selected = await open({ multiple: true, directory: false })
      const paths = selected == null ? [] : Array.isArray(selected) ? selected : [selected]
      const files = await Promise.all(paths.map(async (filePath) => {
        const metadata = await stat(filePath)
        const bytes = await readFile(filePath)
        if (bytes.byteLength !== metadata.size)
          throw new Error('附件选择后字节发生变化，请重新选择同一原件')
        return { ...await fileRefDraftFromFile(new File([bytes], await basename(filePath))), filePath }
      }))
      if (generation === fileGeneration)
        append(files)
    }
    catch (cause) {
      if (generation === fileGeneration)
        error(`选择附件失败：${toErrorMessage(cause)}`)
    }
    finally {
      if (generation === fileGeneration)
        readingFiles.value = false
    }
  }

  function toggleExisting(id: string) {
    const attachment = attachments.value.find(file => file.id === id)
    if (attachment?.deletedAt) {
      pendingRestoreIds.value = pendingRestoreIds.value.includes(id)
        ? pendingRestoreIds.value.filter(item => item !== id)
        : [...pendingRestoreIds.value, id]
      return
    }
    pendingRemoveIds.value = pendingRemoveIds.value.includes(id)
      ? pendingRemoveIds.value.filter(item => item !== id)
      : [...pendingRemoveIds.value, id]
  }

  function removePending(localId: string) {
    pendingAttachments.value = pendingAttachments.value.filter(file => file.localId !== localId)
  }

  function patchPending(
    localId: string,
    patch: Partial<PendingOwnerDocumentAttachment>,
  ) {
    pendingAttachments.value = pendingAttachments.value.map(file =>
      file.localId === localId ? { ...file, ...patch } : file,
    )
  }

  return {
    attachments: readonly(attachments),
    pendingAttachments: readonly(pendingAttachments),
    pendingRemoveIds: readonly(pendingRemoveIds),
    pendingRestoreIds: readonly(pendingRestoreIds),
    desktopAttachmentPicker: readonly(desktopAttachmentPicker),
    readingFiles: readonly(readingFiles),
    capture,
    acknowledge,
    dirty,
    reset,
    clearPending,
    changes,
    handleFiles,
    pickNativeFiles,
    toggleExisting,
    removePending,
    patchPending,
  }
}
