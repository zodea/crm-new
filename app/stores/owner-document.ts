import type { FileRefChanges } from '~/lib/forms/file-refs'
import type { OwnerCommercialDocumentCommandRequestDTO } from '~/lib/owner-document/central-command-contract'
import type {
  OwnerCommercialDocumentKind,
  OwnerCommercialDocumentListQueryDTO,
  OwnerCommercialDocumentListSummaryDTO,
} from '~/lib/owner-document/central-repository'
import type {
  AcceptanceLifecycleTarget,
  OwnerDocumentDraft,
  OwnerDocumentKind,
  OwnerDocumentListRecord,
  OwnerDocumentSaveAction,
  OwnerReportAuditDraft,
} from '~/lib/owner-document/forms'
import { isTauri } from '@tauri-apps/api/core'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { SUBCONTRACT_CHANGE_WRITE_CAPABILITY } from '~/lib/owner-document/central-command-contract'
import {
  completeOwnerDocumentCommandIntent,
  ownerDocumentCommandId,
} from '~/lib/owner-document/command-intent'
import {
  advanceOwnerDocumentFormVersion,
  initializeOwnerDocumentFormVersion,
  requireOwnerDocumentFormVersion,
  withOwnerDocumentFormVersion,
} from '~/lib/owner-document/form-version'
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
import { ownerDocumentListRecordFromCentral } from '~/lib/owner-document/list'

export const useOwnerDocumentStore = defineStore('owner-document', () => {
  const usesCentralBrowser = import.meta.client && !isTauri()
  const isCentralKind = (kind: OwnerDocumentKind): kind is OwnerCommercialDocumentKind =>
    kind === 'owner_change' || kind === 'owner_report'
    || kind === 'acceptance' || kind === 'final_settlement' || kind === 'owner_penalty'
    || kind === 'sub_change' || kind === 'sub_settlement'
  function rememberCentralForm(form: Awaited<ReturnType<typeof centralForm>>) {
    return withOwnerDocumentFormVersion(form.draft, form.version)
  }

  function centralBaseVersion(draft: OwnerDocumentDraft): string {
    return requireOwnerDocumentFormVersion(draft)
  }

  function centralRepositories() {
    return useNuxtApp().$repositories
  }

  async function centralContext(kind: OwnerCommercialDocumentKind) {
    return centralRepositories().ownerCommercialDocumentCommands.context(kind)
  }

  async function centralForm(kind: OwnerCommercialDocumentKind, id: string) {
    return centralRepositories().ownerCommercialDocumentCommands.loadForm(kind, id)
  }

  async function centralCommand(
    kind: OwnerCommercialDocumentKind,
    id: string | null,
    baseVersion: string | null,
    values: Record<string, unknown>,
    commandId = `owner-document-${crypto.randomUUID()}`,
  ) {
    const context = await centralContext(kind)
    return centralRepositories().ownerCommercialDocumentCommands.execute({
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      requiredCapability: (kind === 'sub_change' || kind === 'sub_settlement') ? SUBCONTRACT_CHANGE_WRITE_CAPABILITY : 'owner-document:write',
      commandId,
      kind,
      id,
      baseVersion,
      ...values,
    } as OwnerCommercialDocumentCommandRequestDTO)
  }

  const records = shallowRef<Partial<Record<OwnerDocumentKind, OwnerDocumentListRecord[]>>>({})
  const listLoading = shallowRef<Partial<Record<OwnerDocumentKind, boolean>>>({})
  const listErrors = shallowRef<Partial<Record<OwnerDocumentKind, string>>>({})
  const listLoadSequence: Partial<Record<OwnerDocumentKind, number>> = {}
  const centralPagination = shallowRef<Partial<Record<OwnerCommercialDocumentKind, { page: number, pageSize: number, total: number }>>>({})
  const centralSummaries = shallowRef<Partial<Record<OwnerCommercialDocumentKind, OwnerCommercialDocumentListSummaryDTO>>>({})
  const centralCapabilities = shallowRef<Partial<Record<OwnerCommercialDocumentKind, string[]>>>({})
  const centralEmptyReasons = shallowRef<Partial<Record<OwnerCommercialDocumentKind, 'no-records' | 'no-filter-match' | 'missing-relation' | null>>>({})
  const loading = shallowRef(false)

  async function loadKind(
    kind: OwnerDocumentKind,
    centralQuery?: Omit<OwnerCommercialDocumentListQueryDTO, 'kind' | 'includeDemo' | 'origin'>,
  ) {
    const sequence = (listLoadSequence[kind] ?? 0) + 1
    listLoadSequence[kind] = sequence
    listLoading.value = { ...listLoading.value, [kind]: true }
    listErrors.value = { ...listErrors.value, [kind]: '' }
    try {
      const centralPage = usesCentralBrowser && isCentralKind(kind)
        ? await centralRepositories().ownerCommercialDocumentRead.list({
            kind,
            includeDemo: false,
            origin: 'real',
            search: centralQuery?.search ?? '',
            projectId: centralQuery?.projectId ?? null,
            contractId: centralQuery?.contractId ?? null,
            supplierId: centralQuery?.supplierId ?? null,
            status: centralQuery?.status ?? null,
            documentType: centralQuery?.documentType ?? null,
            variant: centralQuery?.variant ?? null,
            page: centralQuery?.page ?? 1,
            pageSize: centralQuery?.pageSize ?? 20,
          })
        : null
      const rows = centralPage
        ? centralPage.items.map(ownerDocumentListRecordFromCentral)
        : await listOwnerDocumentForms(kind)
      if (centralPage && isCentralKind(kind) && listLoadSequence[kind] === sequence) {
        centralPagination.value = { ...centralPagination.value, [kind]: centralPage.pagination }
        centralSummaries.value = { ...centralSummaries.value, [kind]: centralPage.summary }
        centralCapabilities.value = { ...centralCapabilities.value, [kind]: [...centralPage.capabilities] }
        centralEmptyReasons.value = { ...centralEmptyReasons.value, [kind]: centralPage.empty?.reason ?? null }
      }
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

  function centralPageFor(kind: OwnerCommercialDocumentKind) {
    return centralPagination.value[kind] ?? { page: 1, pageSize: 20, total: 0 }
  }

  function centralSummaryFor(kind: OwnerCommercialDocumentKind) {
    return centralSummaries.value[kind] ?? null
  }

  function centralCapabilitiesFor(kind: OwnerCommercialDocumentKind) {
    return centralCapabilities.value[kind] ?? []
  }

  function centralEmptyReasonFor(kind: OwnerCommercialDocumentKind) {
    return centralEmptyReasons.value[kind] ?? null
  }

  async function refreshAfterMutation(kind: OwnerDocumentKind) {
    await loadKind(kind).catch(() => undefined)
  }

  async function loadOne(kind: OwnerDocumentKind, id: string) {
    loading.value = true
    try {
      return usesCentralBrowser && isCentralKind(kind)
        ? rememberCentralForm(await centralForm(kind, id))
        : await loadOwnerDocumentForm(kind, id)
    }
    finally {
      loading.value = false
    }
  }

  async function loadAttachments(kind: OwnerDocumentKind, id: string, includeDeleted = false) {
    if (usesCentralBrowser && isCentralKind(kind)) {
      const form = await centralForm(kind, id)
      const files = form.attachments
      return includeDeleted ? files : files.filter(file => file.deletedAt === null)
    }
    return listOwnerDocumentAttachments(kind, id, includeDeleted)
  }

  async function loadBoqLines(
    projectId: string,
    contractId: string,
    periodNo = '',
  ) {
    if (usesCentralBrowser)
      return centralRepositories().ownerCommercialDocumentCommands.boqLines(projectId, contractId, periodNo)
    return listOwnerDocumentBoqLines(projectId, contractId, periodNo)
  }

  async function loadDeductions(penaltyId: string) {
    return loadPenaltyDeductions(penaltyId)
  }

  async function loadContractSummary(
    contractId: string,
    excludeSettlementId = '',
    source: 'local' | 'central-owner' | 'central-subcontract' = 'local',
  ) {
    if (usesCentralBrowser && source === 'central-subcontract') {
      const context = await centralContext('sub_settlement')
      const contract = context.contracts.find(option => option.id === contractId)
      return contract
        ? { contractAmount: contract.changedContractAmount, receivedAmount: null, priorSettlementAmount: (context.settlements ?? []).filter(row => row.contractId === contractId && row.id !== excludeSettlementId).reduce((sum, row) => sum + row.amount, 0) }
        : null
    }
    if (usesCentralBrowser && source === 'central-owner') {
      const context = await centralContext('final_settlement')
      const contract = context.contracts.find(option => option.id === contractId)
      return contract
        ? {
            contractAmount: contract.changedContractAmount,
            receivedAmount: contract.receivedAmount,
            priorSettlementAmount: null,
          }
        : null
    }
    return loadOwnerDocumentContractSummary(contractId, excludeSettlementId)
  }

  async function loadBasicOptions(
    kind: 'crew' | 'project' | 'supplier',
    keyword: string,
    documentKind: OwnerDocumentKind = kind === 'supplier' ? 'sub_change' : 'owner_change',
  ) {
    if (usesCentralBrowser && (kind === 'project' || kind === 'supplier')) {
      const context = await centralContext(isCentralKind(documentKind) ? documentKind : 'owner_change')
      const search = keyword.trim().toLocaleLowerCase('zh-CN')
      const options = kind === 'project' ? context.projects : context.suppliers
      return options
        .filter(option => !search || option.label.toLocaleLowerCase('zh-CN').includes(search))
        .map(option => ({ id: option.id, label: option.label }))
    }
    return listOwnerDocumentBasicOptions(kind, keyword)
  }

  async function loadContractOptions(
    projectId: string,
    side: 'expenditure' | 'owner',
    supplierId: string,
    keyword: string,
  ) {
    if (usesCentralBrowser) {
      const context = await centralContext(side === 'owner' ? 'owner_change' : 'sub_change')
      const search = keyword.trim().toLocaleLowerCase('zh-CN')
      return context.contracts
        .filter(option => option.projectId === projectId)
        .filter(option => side === 'owner'
          ? option.kind === 'construction'
          : option.kind === 'subcontract' && option.supplierId === supplierId)
        .filter(option => !search || [option.label, option.hint ?? ''].some(value => value.toLocaleLowerCase('zh-CN').includes(search)))
        .map(option => ({ id: option.id, label: option.label, hint: option.hint }))
    }
    return listOwnerDocumentContractOptions(projectId, side, supplierId, keyword)
  }

  async function loadSettlementOptions(
    projectId: string,
    supplierId: string,
    contractId: string,
    keyword: string,
  ) {
    if (usesCentralBrowser) {
      const context = await centralContext('sub_settlement')
      return (context.settlements ?? []).filter(row => row.projectId === projectId
        && (!supplierId || row.supplierId === supplierId) && (!contractId || row.contractId === contractId)
        && (!keyword || row.label.includes(keyword))).map(row => ({ id: row.id, label: row.label }))
    }
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
      const result = usesCentralBrowser && isCentralKind(kind)
        ? await (async () => {
            const currentId = draft.id ?? null
            const baseVersion = currentId ? centralBaseVersion(draft) : null
            const values = {
              action: action === 'submit' ? 'submit' : 'save',
              draft,
              attachments,
            }
            const commandId = ownerDocumentCommandId(draft, { kind, id: currentId, baseVersion, ...values })
            const command = await centralCommand(kind, currentId, baseVersion, values, commandId)
            draft.id = command.id
            if (currentId)
              advanceOwnerDocumentFormVersion(draft, command.version)
            else
              initializeOwnerDocumentFormVersion(draft, command.version)
            completeOwnerDocumentCommandIntent(draft, commandId)
            return { id: command.id, logIds: [command.commandId] }
          })()
        : await saveOwnerDocumentForm(kind, draft, action, attachments)
      await refreshAfterMutation(kind)
      return result
    }
    finally {
      loading.value = false
    }
  }

  async function approveChange(id: string, approvedAt: string, draft?: OwnerDocumentDraft) {
    loading.value = true
    try {
      if (usesCentralBrowser) {
        if (!draft)
          throw new Error('签证页版本已丢失，请重新读取后再操作')
        const baseVersion = centralBaseVersion(draft)
        const values = { action: 'approve', approvedAt }
        const commandId = ownerDocumentCommandId(draft, { kind: 'owner_change', id, baseVersion, ...values })
        const result = await centralCommand('owner_change', id, baseVersion, values, commandId)
        advanceOwnerDocumentFormVersion(draft, result.version)
        completeOwnerDocumentCommandIntent(draft, commandId)
      }
      else {
        await approveOwnerChange(id, approvedAt)
      }
      await refreshAfterMutation('owner_change')
    }
    finally {
      loading.value = false
    }
  }

  async function auditReport(id: string, auditDraft: OwnerReportAuditDraft, formDraft?: OwnerDocumentDraft) {
    loading.value = true
    try {
      if (usesCentralBrowser) {
        if (!formDraft)
          throw new Error('审定页版本已丢失，请重新读取后再操作')
        const baseVersion = centralBaseVersion(formDraft)
        const values = { action: 'audit', audit: { lines: auditDraft.lines } }
        const commandId = ownerDocumentCommandId(formDraft, { kind: 'owner_report', id, baseVersion, ...values })
        const result = await centralCommand('owner_report', id, baseVersion, values, commandId)
        advanceOwnerDocumentFormVersion(formDraft, result.version)
        completeOwnerDocumentCommandIntent(formDraft, commandId)
      }
      else {
        await auditOwnerReport(id, auditDraft)
      }
      await refreshAfterMutation('owner_report')
    }
    finally {
      loading.value = false
    }
  }

  async function moveAcceptance(
    id: string,
    target: AcceptanceLifecycleTarget,
    draft?: OwnerDocumentDraft,
    attachments: FileRefChanges = {},
  ) {
    loading.value = true
    try {
      if (usesCentralBrowser) {
        if (!draft)
          throw new Error('验收生命周期版本已丢失，请重新读取后再操作')
        const baseVersion = centralBaseVersion(draft)
        const values = {
          action: 'transition-acceptance',
          target,
          facts: {
            acceptanceOrganization: draft.acceptanceOrganization,
            acceptancePerson: draft.acceptancePerson,
            acceptanceDate: draft.acceptanceDate,
            acceptanceConclusion: draft.acceptanceConclusion,
            warrantyOwner: draft.warrantyOwner,
            warrantyStartDate: draft.warrantyStartDate,
            warrantyEndDate: draft.warrantyEndDate,
            warrantyConfirmationOrganization: draft.warrantyConfirmationOrganization,
            warrantyConfirmationDate: draft.warrantyConfirmationDate,
            warrantyConfirmationNote: draft.warrantyConfirmationNote,
            note: draft.note,
          },
          attachments,
        }
        const commandId = ownerDocumentCommandId(draft, { kind: 'acceptance', id, baseVersion, ...values })
        const result = await centralCommand('acceptance', id, baseVersion, values, commandId)
        advanceOwnerDocumentFormVersion(draft, result.version)
        completeOwnerDocumentCommandIntent(draft, commandId)
      }
      else {
        await transitionAcceptance(id, target, draft, attachments)
      }
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
    if (usesCentralBrowser && isCentralKind(kind)) {
      const form = await centralForm(kind, id)
      const result = await centralCommand(kind, id, form.version, { action: 'delete' })
      await refreshAfterMutation(kind)
      return result.commandId
    }
    const logId = await deleteOwnerDocumentForm(kind, id)
    if (logId)
      await refreshAfterMutation(kind)
    return logId
  }

  async function restoreForm(kind: OwnerDocumentKind, id: string) {
    if (usesCentralBrowser && isCentralKind(kind))
      throw new Error('中央正式单据删除不提供本地恢复入口')
    const logId = await restoreOwnerDocumentForm(kind, id)
    if (logId)
      await refreshAfterMutation(kind)
    return logId
  }

  async function saveAttachments(
    kind: OwnerDocumentKind,
    id: string,
    changes: FileRefChanges,
    draft?: OwnerDocumentDraft,
  ) {
    loading.value = true
    try {
      if (usesCentralBrowser && isCentralKind(kind)) {
        if (!draft)
          throw new Error('附件页版本已丢失，请重新读取后再操作')
        const baseVersion = centralBaseVersion(draft)
        const values = {
          action: 'attachments',
          attachments: changes,
        }
        const commandId = ownerDocumentCommandId(draft, { kind, id, baseVersion, ...values })
        const result = await centralCommand(kind, id, baseVersion, values, commandId)
        advanceOwnerDocumentFormVersion(draft, result.version)
        completeOwnerDocumentCommandIntent(draft, commandId)
        return result.attachmentIds
      }
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
    centralPageFor,
    centralSummaryFor,
    centralCapabilitiesFor,
    centralEmptyReasonFor,
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
