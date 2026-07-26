import type { FileRefChanges } from '~/lib/forms/file-refs'
import type {
  AcceptanceLifecycleTarget,
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
  deleteOwnerDocumentForm,
  listOwnerDocumentAttachments,
  listOwnerDocumentBasicOptions,
  listOwnerDocumentBoqLines,
  listOwnerDocumentContractOptions,
  listOwnerDocumentForms,
  listOwnerDocumentSettlementOptions,
  loadOwnerDocumentContractSummary,
  loadOwnerDocumentForm,
  loadPenaltyDeductions,
  restoreOwnerDocumentForm,
  saveOwnerDocumentForm,
  transitionAcceptance,
  updateOwnerDocumentAttachments,
} from '~/lib/owner-document/forms'

export const useOwnerDocumentStore = defineStore('owner-document', () => {
  const records = shallowRef<Partial<Record<OwnerDocumentKind, Record<string, unknown>[]>>>({})
  const loading = shallowRef(false)

  async function loadKind(kind: OwnerDocumentKind) {
    loading.value = true
    try {
      const rows = await listOwnerDocumentForms(kind)
      records.value = { ...records.value, [kind]: rows }
      return rows
    }
    finally {
      loading.value = false
    }
  }

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

  async function loadAttachments(kind: OwnerDocumentKind, id: string, includeDeleted = false) {
    return listOwnerDocumentAttachments(kind, id, includeDeleted)
  }

  async function loadBoqLines(
    projectId: string,
    contractId: string,
    periodNo = '',
  ) {
    return listOwnerDocumentBoqLines(projectId, contractId, periodNo)
  }

  async function loadDeductions(penaltyId: string) {
    return loadPenaltyDeductions(penaltyId)
  }

  async function loadContractSummary(contractId: string, excludeSettlementId = '') {
    return loadOwnerDocumentContractSummary(contractId, excludeSettlementId)
  }

  async function loadBasicOptions(
    kind: 'crew' | 'project' | 'supplier',
    keyword: string,
  ) {
    return listOwnerDocumentBasicOptions(kind, keyword)
  }

  async function loadContractOptions(
    projectId: string,
    side: 'expenditure' | 'owner',
    supplierId: string,
    keyword: string,
  ) {
    return listOwnerDocumentContractOptions(projectId, side, supplierId, keyword)
  }

  async function loadSettlementOptions(
    projectId: string,
    supplierId: string,
    contractId: string,
    keyword: string,
  ) {
    return listOwnerDocumentSettlementOptions(
      projectId,
      supplierId,
      contractId,
      keyword,
    )
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

  async function moveAcceptance(id: string, target: AcceptanceLifecycleTarget) {
    loading.value = true
    try {
      await transitionAcceptance(id, target)
      return await loadOne('acceptance', id)
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

  async function removeForm(kind: OwnerDocumentKind, id: string) {
    const logId = await deleteOwnerDocumentForm(kind, id)
    if (logId)
      await loadKind(kind)
    return logId
  }

  async function restoreForm(kind: OwnerDocumentKind, id: string) {
    const logId = await restoreOwnerDocumentForm(kind, id)
    if (logId)
      await loadKind(kind)
    return logId
  }

  async function saveAttachments(
    kind: OwnerDocumentKind,
    id: string,
    changes: FileRefChanges,
  ) {
    loading.value = true
    try {
      return await updateOwnerDocumentAttachments(kind, id, changes)
    }
    finally {
      loading.value = false
    }
  }

  return {
    records: readonly(records),
    loading: readonly(loading),
    loadKind,
    loadOne,
    loadAttachments,
    loadBoqLines,
    loadDeductions,
    loadContractSummary,
    loadBasicOptions,
    loadContractOptions,
    loadSettlementOptions,
    saveForm,
    approveOwnerChange: approveChange,
    auditOwnerReport: auditReport,
    transitionAcceptance: moveAcceptance,
    deductProjectPenalty: deductPenalty,
    removeForm,
    restoreForm,
    saveAttachments,
  }
})
