import type {
  FileRefChanges,
  FileRefDraft,
  FileRefRecord,
} from '~/lib/forms/file-refs'
import { computed, readonly, shallowRef } from 'vue'

export type PendingMaterialAttachment = FileRefDraft & { localId: string }

export function useMaterialFormAttachments() {
  const { warning } = useKitUI()
  const attachments = shallowRef<FileRefRecord[]>([])
  const pendingAttachments = shallowRef<PendingMaterialAttachment[]>([])
  const pendingRemoveIds = shallowRef<string[]>([])
  const pendingRestoreIds = shallowRef<string[]>([])

  const dirty = computed(() =>
    pendingAttachments.value.length > 0
    || pendingRemoveIds.value.length > 0
    || pendingRestoreIds.value.length > 0,
  )

  function clearPending() {
    pendingAttachments.value = []
    pendingRemoveIds.value = []
    pendingRestoreIds.value = []
  }

  function reset(files: FileRefRecord[] = []) {
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
        category: file.category || '业务附件',
      })),
    ]
  }

  function handleFiles(files: File[]) {
    append(files.map(file => ({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    })))
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
    patch: Partial<PendingMaterialAttachment>,
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
    dirty,
    reset,
    clearPending,
    changes,
    handleFiles,
    toggleExisting,
    removePending,
    patchPending,
  }
}
