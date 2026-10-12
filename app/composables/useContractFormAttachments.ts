import type {
  ContractFormAttachment,
  ContractFormAttachmentChanges,
  ContractFormAttachmentDraft,
} from '~/lib/contract/forms'
import { computed, readonly, shallowRef } from 'vue'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
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
  const readingFiles = shallowRef(false)
  let fileGeneration = 0

  const dirty = computed(() =>
    pendingAttachments.value.length > 0
    || pendingRemoveIds.value.length > 0
    || pendingRestoreIds.value.length > 0,
  )

  function invalidatePreparation() {
    fileGeneration++
    readingFiles.value = false
  }

  function clearPending() {
    invalidatePreparation()
    pendingAttachments.value = []
    pendingRemoveIds.value = []
    pendingRestoreIds.value = []
  }

  function reset(files: ContractFormAttachment[] = []) {
    attachments.value = files
    clearPending()
  }

  function capture() {
    return JSON.parse(JSON.stringify({ add: pendingAttachments.value, removeIds: pendingRemoveIds.value, restoreIds: pendingRestoreIds.value })) as {
      add: PendingContractAttachment[]
      removeIds: string[]
      restoreIds: string[]
    }
  }

  /** Settle only the input acknowledged by the same saved target; retain subsequent edits. */
  function acknowledge(files: ContractFormAttachment[], sent: ReturnType<typeof capture>) {
    attachments.value = files
    const submitted = new Map(sent.add.map(file => [file.localId, JSON.stringify(file)]))
    pendingAttachments.value = pendingAttachments.value.filter(file => submitted.get(file.localId) !== JSON.stringify(file))
    pendingRemoveIds.value = pendingRemoveIds.value.filter(id => !sent.removeIds.includes(id))
    pendingRestoreIds.value = pendingRestoreIds.value.filter(id => !sent.restoreIds.includes(id))
  }

  function changes(): ContractFormAttachmentChanges {
    return {
      add: pendingAttachments.value.map(({ localId: _localId, ...file }) => file),
      removeIds: pendingRemoveIds.value,
      restoreIds: pendingRestoreIds.value,
    }
  }

  function appendDrafts(files: ContractFormAttachmentDraft[]) {
    pendingAttachments.value = [
      ...pendingAttachments.value,
      ...files.map(file => ({
        ...file,
        localId: crypto.randomUUID(),
        category: file.category || '合同附件',
      })),
    ]
  }

  async function handleFiles(files: File[]) {
    const generation = ++fileGeneration
    readingFiles.value = true
    try {
      const drafts = await Promise.all(files.map(file => fileRefDraftFromFile(file)))
      if (generation === fileGeneration)
        appendDrafts(drafts)
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
    readingFiles: readonly(readingFiles),
    dirty,
    invalidatePreparation,
    reset,
    capture,
    acknowledge,
    clearPending,
    changes,
    appendDrafts,
    handleFiles,
    removePending,
    patchPending,
    toggleExisting,
  }
}
