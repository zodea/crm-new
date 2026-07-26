import type {
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  ContractFormAttachmentDraft,
} from '~/lib/contract/forms'
import { isTauri } from '@tauri-apps/api/core'
import { computed, readonly, shallowRef } from 'vue'
import { toErrorMessage } from '~/lib/util/error'

export interface PendingContractAttachment extends ContractFormAttachmentDraft {
  localId: string
}

export function useContractFormAttachments() {
  const { error } = useKitUI()
  const attachments = shallowRef<ContractFormAttachment[]>([])
  const pendingAttachments = shallowRef<PendingContractAttachment[]>([])
  const pendingRemoveIds = shallowRef<string[]>([])
  const pendingRestoreIds = shallowRef<string[]>([])
  const desktopAttachmentPicker = shallowRef(isTauri())

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

  function reset(files: ContractFormAttachment[] = []) {
    attachments.value = files
    clearPending()
  }

  function changes(): ContractFormAttachmentChanges {
    return {
      add: pendingAttachments.value.map(({ localId: _localId, ...file }) => file),
      removeIds: pendingRemoveIds.value,
      restoreIds: pendingRestoreIds.value,
    }
  }

  function append(files: ContractFormAttachmentDraft[]) {
    pendingAttachments.value = [
      ...pendingAttachments.value,
      ...files.map((file, index) => ({
        ...file,
        localId: `${file.filePath || file.fileName}-${Date.now()}-${index}`,
        category: file.category || '合同附件',
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

  async function pickNativeFiles() {
    try {
      const [{ open }, { stat }, { basename }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs'),
        import('@tauri-apps/api/path'),
      ])
      const selected = await open({ multiple: true, directory: false })
      const paths = selected == null
        ? []
        : Array.isArray(selected) ? selected : [selected]
      const files = await Promise.all(paths.map(async filePath => ({
        fileName: await basename(filePath),
        filePath,
        fileSize: (await stat(filePath)).size,
      })))
      append(files)
    }
    catch (cause) {
      error(`选择附件失败：${toErrorMessage(cause)}`)
    }
  }

  function removePending(localId: string) {
    pendingAttachments.value = pendingAttachments.value.filter(file => file.localId !== localId)
  }

  function patchPending(
    localId: string,
    patch: Partial<PendingContractAttachment>,
  ) {
    pendingAttachments.value = pendingAttachments.value.map(file =>
      file.localId === localId ? { ...file, ...patch } : file,
    )
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

  return {
    attachments: readonly(attachments),
    pendingAttachments: readonly(pendingAttachments),
    pendingRemoveIds: readonly(pendingRemoveIds),
    pendingRestoreIds: readonly(pendingRestoreIds),
    desktopAttachmentPicker: readonly(desktopAttachmentPicker),
    dirty,
    reset,
    clearPending,
    changes,
    handleFiles,
    pickNativeFiles,
    removePending,
    patchPending,
    toggleExisting,
  }
}
