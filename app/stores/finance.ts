import type {
  F3FormDraft,
  F3FormKind,
  F3SaveAction,
  FinanceFormRecordMap,
} from '~/lib/finance/forms'
import type { FileRefChanges } from '~/lib/forms/file-refs'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import {
  loadFinanceForm,
  saveFinanceForm,
  unconfirmPaymentRecord,
} from '~/lib/finance/forms'

type FinanceRecord = FinanceFormRecordMap[F3FormKind]

export const useFinanceStore = defineStore('finance', () => {
  const records = shallowRef<Partial<Record<F3FormKind, FinanceRecord[]>>>({})
  const loading = shallowRef(false)

  function byId<K extends F3FormKind>(
    kind: K,
    id: string,
  ): FinanceFormRecordMap[K] | undefined {
    return records.value[kind]?.find(record => record.id === id) as
      | FinanceFormRecordMap[K]
      | undefined
  }

  async function loadOne<K extends F3FormKind>(
    kind: K,
    id: string,
  ): Promise<FinanceFormRecordMap[K] | null> {
    loading.value = true
    try {
      const record = await loadFinanceForm(kind, id)
      if (!record)
        return null
      const current = records.value[kind] ?? []
      records.value = {
        ...records.value,
        [kind]: [
          record,
          ...current.filter(item => item.id !== id),
        ],
      }
      return record
    }
    finally {
      loading.value = false
    }
  }

  async function saveForm<K extends F3FormKind>(
    kind: K,
    draft: F3FormDraft,
    action: F3SaveAction,
    attachments: FileRefChanges = {},
  ) {
    loading.value = true
    try {
      const result = await saveFinanceForm(kind, draft, action, attachments)
      await loadOne(kind, result.id)
      return result
    }
    finally {
      loading.value = false
    }
  }

  async function unconfirmPayment(id: string) {
    loading.value = true
    try {
      await unconfirmPaymentRecord(id)
      await loadOne('payment_record', id)
    }
    finally {
      loading.value = false
    }
  }

  return {
    records: readonly(records),
    loading: readonly(loading),
    byId,
    loadOne,
    saveForm,
    unconfirmPayment,
  }
})
