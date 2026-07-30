import type {
  FormAttachment,
  FormAttachmentChanges,
  FormSaveResult,
  MasterDataOwnerType,
  MasterDataSaveAction,
} from '~/lib/master-data/forms'
import { readonly, shallowRef } from 'vue'
import {
  assessMasterDataDeletion,
  deleteMasterDataRecord,
  listFormAttachments,
  restoreMasterDataRecord,
} from '~/lib/master-data/forms'

type FormLoader<T> = (id: string) => Promise<T | null>
type FormSaver<T> = (
  draft: T,
  action: MasterDataSaveAction,
  attachments?: FormAttachmentChanges,
) => Promise<FormSaveResult>

export function createMasterDataFormState<T extends { id?: string }>(
  ownerType: MasterDataOwnerType,
  loadForm: FormLoader<T>,
  saveForm: FormSaver<T>,
) {
  const current = shallowRef<T | null>(null)
  const attachments = shallowRef<FormAttachment[]>([])
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const revision = shallowRef(0)

  async function load(id: string) {
    loading.value = true
    try {
      const [record, files] = await Promise.all([
        loadForm(id),
        listFormAttachments(ownerType, id),
      ])
      current.value = record
      attachments.value = files
      return record
    }
    finally {
      loading.value = false
    }
  }

  async function save(
    draft: T,
    action: MasterDataSaveAction,
    changes?: FormAttachmentChanges,
  ) {
    saving.value = true
    try {
      const result = await saveForm(draft, action, changes)
      await load(result.id)
      revision.value += 1
      return result
    }
    finally {
      saving.value = false
    }
  }

  async function remove(id: string) {
    const logId = await deleteMasterDataRecord(ownerType, id)
    if (current.value?.id === id) {
      current.value = null
      attachments.value = []
    }
    if (logId)
      revision.value += 1
    return logId
  }

  async function assessDeletion(id: string) {
    if (ownerType !== 'customer' && ownerType !== 'crew' && ownerType !== 'worker')
      return { blockedReason: '', impact: [] }
    return assessMasterDataDeletion(ownerType, id)
  }

  async function restore(id: string) {
    const logId = await restoreMasterDataRecord(ownerType, id)
    await load(id)
    if (logId)
      revision.value += 1
    return logId
  }

  function clear() {
    current.value = null
    attachments.value = []
  }

  return {
    current: readonly(current),
    attachments: readonly(attachments),
    loading: readonly(loading),
    saving: readonly(saving),
    revision: readonly(revision),
    load,
    save,
    assessDeletion,
    remove,
    restore,
    clear,
  }
}
