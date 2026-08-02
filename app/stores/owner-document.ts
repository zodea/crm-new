import type { FileRefChanges } from '~/lib/forms/file-refs'
import type {
  AcceptanceLifecycleTarget,
  OwnerDocumentDraft,
  OwnerDocumentKind,
  OwnerDocumentListRecord,
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
  const records = shallowRef<Partial<Record<OwnerDocumentKind, OwnerDocumentListRecord[]>>>({})
  const listLoading = shallowRef<Partial<Record<OwnerDocumentKind, boolean>>>({})
  const listErrors = shallowRef<Partial<Record<OwnerDocumentKind, string>>>({})
  const listLoadSequence: Partial<Record<OwnerDocumentKind, number>> = {}
  const loading = shallowRef(false)

  async function loadKind(kind: OwnerDocumentKind) {
    const sequence = (listLoadSequence[kind] ?? 0) + 1
    listLoadSequence[kind] = sequence
    listLoading.value = { ...listLoading.value, [kind]: true }
    listErrors.value = { ...listErrors.value, [kind]: '' }
    try {
      const rows = await listOwnerDocumentForms(kind)
      if (listLoadSequence[kind] === sequence)
        records.value = { ...records.value, [kind]: rows }
      return rows
    }
    catch (cause) {
      if (listLoadSequence[kind] === sequence) {
        listErrors.value = {
          ...listErrors.value,
          [kind]: cause instanceof Error ? cause.message : '列表载入失败',
        }
      }
      throw cause
    }
    finally {
      if (listLoadSequence[kind] === sequence)
        listLoading.value = { ...listLoading.value, [kind]: false }
    }
  }

  function recordsFor(kind: OwnerDocumentKind) {
    return records.value[kind] ?? []
  }

  function listLoadingFor(kind: OwnerDocumentKind) {
    return listLoading.value[kind] ?? false
  }

  function listError(kind: OwnerDocumentKind) {
    return listErrors.value[kind] ?? ''
  }

  async function refreshAfterMutation(kind: OwnerDocumentKind) {
    await loadKind(kind).catch(() => undefined)
  }

  async function loadOne(kind: OwnerDocumentKind, id: string) {
    loading.value = true
    try {
      return await loadOwnerDocumentForm(kind, id)
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
      await refreshAfterMutation(kind)
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
      await refreshAfterMutation('owner_change')
    }
    finally {
      loading.value = false
    }
  }

  async function auditReport(id: string, draft: OwnerReportAuditDraft) {
    loading.value = true
    try {
      await auditOwnerReport(id, draft)
      await refreshAfterMutation('owner_report')
    }
    finally {
      loading.value = false
    }
  }

  async function moveAcceptance(id: string, target: AcceptanceLifecycleTarget) {
    loading.value = true
    try {
      await transitionAcceptance(id, target)
      await refreshAfterMutation('acceptance')
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
      await refreshAfterMutation('project_penalty')
    }
    finally {
      loading.value = false
    }
  }

  async function removeForm(kind: OwnerDocumentKind, id: string) {
    const logId = await deleteOwnerDocumentForm(kind, id)
    if (logId)
      await refreshAfterMutation(kind)
    return logId
  }

  async function restoreForm(kind: OwnerDocumentKind, id: string) {
    const logId = await restoreOwnerDocumentForm(kind, id)
    if (logId)
      await refreshAfterMutation(kind)
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
    listLoading: readonly(listLoading),
    listErrors: readonly(listErrors),
    loading: readonly(loading),
    loadKind,
    recordsFor,
    listLoadingFor,
    listError,
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
