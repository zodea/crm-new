import type { FileRefChanges } from '~/lib/forms/file-refs'
import type {
  MaterialFormDraft,
  MaterialFormKind,
  MaterialFormRecordMap,
  MaterialSaveAction,
} from '~/lib/material/forms'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import {
  deleteMaterialForm,
  getMaterialStockSummary,
  getOwnerMaterialSummary,
  listMaterialForms,
  loadMaterialForm,
  restoreMaterialForm,
  saveMaterialForm,
  updateMaterialFormAttachments,
} from '~/lib/material/forms'

type MaterialRecord = MaterialFormRecordMap[MaterialFormKind]

export const useMaterialStore = defineStore('material', () => {
  const records = shallowRef<Partial<Record<MaterialFormKind, MaterialRecord[]>>>({})
  const loading = shallowRef(false)

  function byId<K extends MaterialFormKind>(
    kind: K,
    id: string,
  ): MaterialFormRecordMap[K] | undefined {
    return records.value[kind]?.find(record => record.id === id) as
      | MaterialFormRecordMap[K]
      | undefined
  }

  async function loadKind<K extends MaterialFormKind>(
    kind: K,
  ): Promise<MaterialFormRecordMap[K][]> {
    loading.value = true
    try {
      const result = await listMaterialForms(kind)
      records.value = {
        ...records.value,
        [kind]: result,
      }
      return result
    }
    finally {
      loading.value = false
    }
  }

  async function loadOne<K extends MaterialFormKind>(
    kind: K,
    id: string,
  ): Promise<MaterialFormRecordMap[K] | null> {
    loading.value = true
    try {
      const record = await loadMaterialForm(kind, id)
      const current = records.value[kind] ?? []
      records.value = {
        ...records.value,
        [kind]: record
          ? [record, ...current.filter(item => item.id !== id)]
          : current.filter(item => item.id !== id),
      }
      return record
    }
    finally {
      loading.value = false
    }
  }

  async function saveForm<K extends MaterialFormKind>(
    kind: K,
    draft: MaterialFormDraft,
    action: MaterialSaveAction,
    attachments: FileRefChanges = {},
  ) {
    loading.value = true
    try {
      const result = await saveMaterialForm(kind, draft, action, attachments)
      await loadOne(kind, result.id)
      if (kind === 'mat_arrival')
        await loadKind('mat_requisition')
      if (kind.startsWith('owner_') && kind !== 'owner_control')
        await loadKind('owner_control')
      return result
    }
    finally {
      loading.value = false
    }
  }

  async function removeForm(kind: MaterialFormKind, id: string) {
    loading.value = true
    try {
      const logId = await deleteMaterialForm(kind, id)
      await loadKind(kind)
      return logId
    }
    finally {
      loading.value = false
    }
  }

  async function saveAttachments(
    kind: MaterialFormKind,
    id: string,
    attachments: FileRefChanges,
  ) {
    loading.value = true
    try {
      return await updateMaterialFormAttachments(kind, id, attachments)
    }
    finally {
      loading.value = false
    }
  }

  async function restoreForm(kind: MaterialFormKind, id: string) {
    loading.value = true
    try {
      const logId = await restoreMaterialForm(kind, id)
      await loadKind(kind)
      return logId
    }
    finally {
      loading.value = false
    }
  }

  return {
    records: readonly(records),
    loading: readonly(loading),
    byId,
    loadKind,
    loadOne,
    saveForm,
    saveAttachments,
    removeForm,
    restoreForm,
    getMaterialStockSummary,
    getOwnerMaterialSummary,
  }
})
