import type { Ref } from 'vue'
import type { F3FormKind } from '~/lib/finance/forms'
import type {
  FileRefChanges,
  FileRefDraft,
  FileRefRecord,
} from '~/lib/forms/file-refs'
import { computed, onScopeDispose, readonly, shallowRef, watch } from 'vue'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { toErrorMessage } from '~/lib/util/error'

export type PendingFinanceAttachment = FileRefDraft & { localId: string }

export function useFinanceFormAttachments(kind: Ref<F3FormKind>) {
  const { warning, error } = useKitUI()
  const attachments = shallowRef<FileRefRecord[]>([])
  const pendingAttachments = shallowRef<PendingFinanceAttachment[]>([])
  const pendingRemoveIds = shallowRef<string[]>([])
  const pendingRestoreIds = shallowRef<string[]>([])
  const readingFiles = shallowRef(false)
  let fileGeneration = 0

  function invalidatePreparation() {
    ++fileGeneration
    readingFiles.value = false
  }
  watch(kind, invalidatePreparation, { flush: 'sync' })
  onScopeDispose(invalidatePreparation)

  const dirty = computed(() =>
    pendingAttachments.value.length > 0
    || pendingRemoveIds.value.length > 0
    || pendingRestoreIds.value.length > 0,
  )

  function clearPending() {
    invalidatePreparation()
    pendingAttachments.value = []
    pendingRemoveIds.value = []
    pendingRestoreIds.value = []
  }

  function reset(files: FileRefRecord[] = []) {
    attachments.value = files
    clearPending()
  }

  function capture() {
    return JSON.parse(JSON.stringify({ add: pendingAttachments.value, removeIds: pendingRemoveIds.value, restoreIds: pendingRestoreIds.value })) as { add: PendingFinanceAttachment[], removeIds: string[], restoreIds: string[] }
  }

  function acknowledge(files: FileRefRecord[], sent: ReturnType<typeof capture>, addedIds: readonly string[] = []) {
    // Compare the user's current intent with the persisted state, including an undone
    // removal/restoration while the write was pending.
    const desired = new Map(attachments.value.map(file => [file.id, file.deletedAt
      ? pendingRestoreIds.value.includes(file.id)
      : !pendingRemoveIds.value.includes(file.id)]))
    const submitted = new Map(sent.add.map(file => [file.localId, JSON.stringify(file)]))
    for (const [index, file] of sent.add.entries()) {
      const current = pendingAttachments.value.find(item => item.localId === file.localId)
      const id = addedIds[index]
      if (id)
        desired.set(id, Boolean(current && JSON.stringify(current) === JSON.stringify(file)))
    }
    pendingAttachments.value = pendingAttachments.value.filter(file => submitted.get(file.localId) !== JSON.stringify(file))
    pendingRemoveIds.value = files.filter(file => !file.deletedAt && desired.get(file.id) === false).map(file => file.id)
    pendingRestoreIds.value = files.filter(file => file.deletedAt && desired.get(file.id) === true).map(file => file.id)
    attachments.value = files
  }

  function changes(sent = capture()): FileRefChanges {
    return {
      add: sent.add.map(({ localId: _localId, ...file }) => file),
      removeIds: [...sent.removeIds],
      restoreIds: [...sent.restoreIds],
    }
  }

  function append(files: FileRefDraft[]) {
    const existingCount = attachments.value.filter(file => !file.deletedAt).length
      - pendingRemoveIds.value.length
      + pendingRestoreIds.value.length
    const max = kind.value === 'payment_application' ? 15 : 30
    const available = Math.max(max - existingCount - pendingAttachments.value.length, 0)
    if (files.length > available)
      warning(`最多保留 ${max} 份附件，本次只加入前 ${available} 份`)
    pendingAttachments.value = [
      ...pendingAttachments.value,
      ...files.slice(0, available).map(file => ({
        ...file,
        localId: crypto.randomUUID(),
        category: file.category || (kind.value === 'payment_record' ? '付款回单' : '业务附件'),
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
    patch: Partial<PendingFinanceAttachment>,
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
    readingFiles: readonly(readingFiles),
    invalidatePreparation,
    capture,
    acknowledge,
    reset,
    clearPending,
    changes,
    handleFiles,
    toggleExisting,
    removePending,
    patchPending,
  }
}
