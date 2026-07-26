import type { FileRefChanges } from '~/lib/forms/file-refs'
import type {
  OwnerDocumentDraft,
  OwnerDocumentKind,
  OwnerDocumentSaveAction,
  OwnerReportAuditDraft,
} from '~/lib/owner-document/forms'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import {
  approveOwnerChange,
  auditOwnerReport,
  deductProjectPenalty,
  loadOwnerDocumentForm,
  saveOwnerDocumentForm,
} from '~/lib/owner-document/forms'

export const useOwnerDocumentStore = defineStore('owner-document', () => {
  const records = shallowRef<Partial<Record<OwnerDocumentKind, Record<string, unknown>[]>>>({})
  const loading = shallowRef(false)

  async function loadOne(kind: OwnerDocumentKind, id: string) {
    loading.value = true
    try {
      const record = await loadOwnerDocumentForm(kind, id)
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

  async function saveForm(
    kind: OwnerDocumentKind,
    draft: OwnerDocumentDraft,
    action: OwnerDocumentSaveAction,
    attachments: FileRefChanges = {},
  ) {
    loading.value = true
    try {
      const result = await saveOwnerDocumentForm(kind, draft, action, attachments)
      await loadOne(kind, result.id)
      return result
    }
    finally {
      loading.value = false
    }
  }

  async function approveChange(id: string, approvedAt: string) {
    loading.value = true
    try {
      await approveOwnerChange(id, approvedAt)
      return await loadOne('owner_change', id)
    }
    finally {
      loading.value = false
    }
  }

  async function auditReport(id: string, draft: OwnerReportAuditDraft) {
    loading.value = true
    try {
      await auditOwnerReport(id, draft)
      return await loadOne('owner_report', id)
    }
    finally {
      loading.value = false
    }
  }

  async function deductPenalty(
    penaltyId: string,
    settlementId: string,
    amount: number,
    note = '',
  ) {
    loading.value = true
    try {
      await deductProjectPenalty(penaltyId, settlementId, amount, note)
      return await loadOne('project_penalty', penaltyId)
    }
    finally {
      loading.value = false
    }
  }

  return {
    records: readonly(records),
    loading: readonly(loading),
    loadOne,
    saveForm,
    approveOwnerChange: approveChange,
    auditOwnerReport: auditReport,
    deductProjectPenalty: deductPenalty,
  }
})
