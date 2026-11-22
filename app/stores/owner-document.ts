import type { FileRefChanges } from '~/lib/forms/file-refs'
import type { OwnerCommercialDocumentCommandRequestDTO, OwnerCommercialDocumentFormReadDTO } from '~/lib/owner-document/central-command-contract'
import type {
  OwnerAcceptanceViewVariant,
  OwnerCommercialDocumentKind,
  OwnerCommercialDocumentListQueryDTO,
  OwnerCommercialDocumentListSummaryDTO,
} from '~/lib/owner-document/central-repository'
import type { OwnerDocumentCommandSession } from '~/lib/owner-document/command-intent'
import type {
  AcceptanceLifecycleTarget,
  OwnerDocumentDraft,
  OwnerDocumentKind,
  OwnerDocumentListRecord,
  OwnerDocumentSaveAction,
  OwnerDocumentSaveResult,
  OwnerReportAuditDraft,
} from '~/lib/owner-document/forms'
import type { QuantityBasis } from '~/lib/quantity/basis'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { ownerCommercialDocumentProblemFromUnknown } from '~/lib/owner-document/central-repository'
import {
  createOwnerDocumentCommandSession,
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
  deleteOwnerDocumentForm,
  listOwnerDocumentAttachments,
  listOwnerDocumentBasicOptions,
  listOwnerDocumentBoqLines,
  listOwnerDocumentContractOptions,
  listOwnerDocumentForms,
  loadOwnerDocumentContractSummary,
  loadOwnerDocumentForm,
  restoreOwnerDocumentForm,
  saveOwnerDocumentForm,
  transitionAcceptance,
  updateOwnerDocumentAttachments,
} from '~/lib/owner-document/forms'
import { ownerDocumentListRecordFromCentral } from '~/lib/owner-document/list'
import { bindReadAuthority } from '~/lib/read-model/authority'

export const useOwnerDocumentStore = defineStore('owner-document', () => {
  const usesCentralBrowser = import.meta.client
  const isCentralKind = (kind: OwnerDocumentKind): kind is OwnerCommercialDocumentKind =>
    kind === 'owner_change' || kind === 'owner_report'
    || kind === 'acceptance' || kind === 'final_settlement' || kind === 'owner_penalty'
    || kind === 'sub_change' || kind === 'sub_settlement' || kind === 'project_penalty'
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

  const commandSessions = new Map<string, OwnerDocumentCommandSession>()
  const lookupVersions = new Map<string, { id: string, version: string }>()
  function rememberLookupVersions(field: string, options: Array<{ id: string, version?: string }>) {
    for (const option of options) {
      const key = `${field}:${option.id}`
      if (option.version)
        lookupVersions.set(key, { id: option.id, version: option.version })
      else
        lookupVersions.delete(key)
    }
  }
  function lookupVersion(field: string, id: string) {
    return lookupVersions.get(`${field}:${id}`) ?? null
  }
  const commandSessionVersion = shallowRef(0)
  const commandSessionKey = (kind: OwnerCommercialDocumentKind, id: string | null) => `${kind}:${id ?? 'new'}`
  function commandSessionFor(kind: OwnerCommercialDocumentKind, id: string | null) {
    const key = commandSessionKey(kind, id)
    let entry = commandSessions.get(key)
    if (!entry) {
      entry = createOwnerDocumentCommandSession(kind, () => centralRepositories().ownerCommercialDocumentCommands)
      commandSessions.set(key, entry)
      commandSessionVersion.value++
    }
    return entry
  }
  function pendingCommand(kind: OwnerDocumentKind, id: string | null) {
    void commandSessionVersion.value
    return usesCentralBrowser && isCentralKind(kind) ? commandSessions.get(commandSessionKey(kind, id))?.session.pending ?? null : null
  }
  async function hydrateCommand(kind: OwnerDocumentKind, id: string | null) {
    if (!usesCentralBrowser || !isCentralKind(kind))
      return null
    const entry = commandSessionFor(kind, id)
    if (entry.session.pending) {
      const result = await entry.actions.recover(entry.session)
      return { ...result, recovered: true, recoveryOutcome: result.outcome }
    }
    if (entry.session.authority && entry.session.targetId === id)
      return { ...await entry.actions.revalidate(entry.session), recovered: false, recoveryOutcome: null }
    return entry.actions.hydrate(entry.session, id)
  }
  async function recoverCommand(kind: OwnerDocumentKind, id: string | null) {
    if (!usesCentralBrowser || !isCentralKind(kind))
      throw new Error('当前适配不支持中央原命令恢复')
    const entry = commandSessionFor(kind, id)
    const result = await entry.actions.recover(entry.session)
    if (result.outcome === 'applied')
      commandSessions.set(commandSessionKey(kind, result.result.id), entry)
    return result
  }
  async function refreshRelationshipVersions(kind: OwnerDocumentKind, draft: OwnerDocumentDraft) {
    if (!usesCentralBrowser || !isCentralKind(kind))
      return draft.relationshipVersionsJson
    const entry = commandSessionFor(kind, draft.id ?? null)
    const { context } = await entry.actions.revalidate(entry.session)
    const sources = { projectId: context.projects, contractId: context.contracts, customerId: context.customers, supplierId: context.suppliers, crewId: context.crews ?? [] }
    const versions: Record<string, { id: string, version: string }> = {}
    for (const [field, options] of Object.entries(sources)) {
      const id = draft[field]
      if (typeof id !== 'string' || !id)
        continue
      const selected = options.find(row => row.id === id)
      if (!selected?.version)
        throw new Error('原关系不再是可核验的同源候选，请保留输入重新选择')
      versions[field] = { id, version: selected.version }
    }
    return JSON.stringify(versions)
  }

  async function centralCommand(
    kind: OwnerCommercialDocumentKind,
    id: string | null,
    baseVersion: string | null,
    values: Record<string, unknown>,
    draft: OwnerDocumentDraft = typeof values.draft === 'object' ? values.draft as OwnerDocumentDraft : { ...(id ? { id } : {}) },
  ) {
    const entry = commandSessionFor(kind, id)
    if (entry.session.pending)
      throw new Error(entry.session.pending.result ? '记录已保存待刷新，请只重新读取原单据' : '原提交结果未知，请先核对原编号')
    if (!entry.session.context) {
      const hydrated = await hydrateCommand(kind, id)
      if (hydrated?.recovered)
        throw new Error('已核对原提交，请先读取原结果再继续编辑')
    }
    entry.session.baseVersion = baseVersion
    const attachments = values.attachments as FileRefChanges | undefined
    const result = await entry.actions.saveForm(entry.session, draft, values.action as OwnerCommercialDocumentCommandRequestDTO['action'], attachments ?? {}, values)
    commandSessions.set(commandSessionKey(kind, result.id), entry)
    return result
  }

  const records = shallowRef<Partial<Record<OwnerDocumentKind, OwnerDocumentListRecord[]>>>({})
  const listLoading = shallowRef<Partial<Record<OwnerDocumentKind, boolean>>>({})
  const listErrors = shallowRef<Partial<Record<OwnerDocumentKind, string>>>({})
  const listLoadSequence: Partial<Record<OwnerDocumentKind, number>> = {}
  const listSources = shallowRef<Partial<Record<OwnerDocumentKind, string>>>({})
  const centralPagination = shallowRef<Partial<Record<OwnerCommercialDocumentKind, { requestedPage: number, page: number, pageSize: number, total: number }>>>({})
  const centralQueryScopes = new Map<OwnerDocumentKind, string>()
  const centralSummaries = shallowRef<Partial<Record<OwnerCommercialDocumentKind, OwnerCommercialDocumentListSummaryDTO>>>({})
  const centralCapabilities = shallowRef<Partial<Record<OwnerCommercialDocumentKind, string[]>>>({})
  const centralEmptyReasons = shallowRef<Partial<Record<OwnerCommercialDocumentKind, 'no-records' | 'no-filter-match' | 'missing-relation' | null>>>({})
  const loading = shallowRef(false)

  function listSource(kind: OwnerDocumentKind, variant?: OwnerAcceptanceViewVariant | null) {
    return `${kind}:${kind === 'acceptance' ? variant ?? 'acceptance' : ''}`
  }

  function clearListSnapshot(kind: OwnerDocumentKind) {
    records.value = { ...records.value, [kind]: undefined }
    if (isCentralKind(kind)) {
      centralPagination.value = { ...centralPagination.value, [kind]: undefined }
      centralSummaries.value = { ...centralSummaries.value, [kind]: undefined }
      centralCapabilities.value = { ...centralCapabilities.value, [kind]: [] }
      centralEmptyReasons.value = { ...centralEmptyReasons.value, [kind]: undefined }
    }
  }

  bindReadAuthority((problem) => {
    if (!usesCentralBrowser)
      return
    for (const kind of Object.keys(listLoadSequence) as OwnerDocumentKind[]) {
      listLoadSequence[kind] = (listLoadSequence[kind] ?? 0) + 1
      clearListSnapshot(kind)
      listLoading.value = { ...listLoading.value, [kind]: false }
      listErrors.value = { ...listErrors.value, [kind]: problem.message }
    }
    centralQueryScopes.clear()
    lookupVersions.clear()
    for (const entry of new Set(commandSessions.values()))
      entry.actions.invalidate(entry.session)
  })

  function hasListSnapshot(kind: OwnerDocumentKind, variant?: OwnerAcceptanceViewVariant | null) {
    return records.value[kind] !== undefined && listSources.value[kind] === listSource(kind, variant)
  }

  async function loadKind(
    kind: OwnerDocumentKind,
    centralQuery?: Omit<OwnerCommercialDocumentListQueryDTO, 'kind' | 'includeDemo' | 'origin'>,
  ) {
    const sequence = (listLoadSequence[kind] ?? 0) + 1
    listLoadSequence[kind] = sequence
    const source = listSource(kind, centralQuery?.variant)
    const { page: _page, pageSize: _pageSize, ...range } = centralQuery ?? {}
    const queryScope = JSON.stringify(range)
    if (listSources.value[kind] !== source || (usesCentralBrowser && centralQueryScopes.get(kind) !== queryScope))
      clearListSnapshot(kind)
    centralQueryScopes.set(kind, queryScope)
    listSources.value = { ...listSources.value, [kind]: source }
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
        const problem = ownerCommercialDocumentProblemFromUnknown(cause).problem
        if (['unauthenticated', 'forbidden', 'not-found', 'relationship-mismatch'].includes(problem.code))
          clearListSnapshot(kind)
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
    return centralPagination.value[kind] ?? { requestedPage: 1, page: 1, pageSize: 20, total: 0 }
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
    quantityBasis?: QuantityBasis,
  ) {
    if (usesCentralBrowser)
      return centralRepositories().ownerCommercialDocumentCommands.boqLines(projectId, contractId, periodNo, quantityBasis)
    return listOwnerDocumentBoqLines(projectId, contractId, periodNo)
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
    if (usesCentralBrowser && (kind === 'project' || kind === 'supplier' || (kind === 'crew' && documentKind === 'project_penalty'))) {
      const context = await centralContext(isCentralKind(documentKind) ? documentKind : 'owner_change')
      const search = keyword.trim().toLocaleLowerCase('zh-CN')
      const options = kind === 'project' ? context.projects : kind === 'crew' ? context.crews ?? [] : context.suppliers
      rememberLookupVersions(`${kind}Id`, options)
      return options
        .filter(option => !search || option.label.toLocaleLowerCase('zh-CN').includes(search))
        .map(option => ({ id: option.id, label: option.label, version: option.version }))
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
      rememberLookupVersions('contractId', context.contracts)
      const search = keyword.trim().toLocaleLowerCase('zh-CN')
      return context.contracts
        .filter(option => option.projectId === projectId)
        .filter(option => side === 'owner'
          ? option.kind === 'construction'
          : option.kind === 'subcontract' && option.supplierId === supplierId)
        .filter(option => !search || [option.label, option.hint ?? ''].some(value => value.toLocaleLowerCase('zh-CN').includes(search)))
        .map(option => ({ id: option.id, label: option.label, hint: option.hint, version: option.version }))
    }
    return listOwnerDocumentContractOptions(projectId, side, supplierId, keyword)
  }

  async function saveForm(
    kind: OwnerDocumentKind,
    draft: OwnerDocumentDraft,
    action: OwnerDocumentSaveAction,
    attachments: FileRefChanges = {},
  ): Promise<OwnerDocumentSaveResult & { form?: OwnerCommercialDocumentFormReadDTO, retainedInput?: boolean }> {
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
            const command = await centralCommand(kind, currentId, baseVersion, values, draft)
            draft.id = command.id
            if (currentId)
              advanceOwnerDocumentFormVersion(draft, command.version)
            else
              initializeOwnerDocumentFormVersion(draft, command.version)
            return { id: command.id, logIds: [command.commandId], form: command.form, retainedInput: command.retainedInput }
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
        const result = await centralCommand('owner_change', id, baseVersion, values, draft)
        advanceOwnerDocumentFormVersion(draft, result.version)
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
        const result = await centralCommand('owner_report', id, baseVersion, values, formDraft)
        advanceOwnerDocumentFormVersion(formDraft, result.version)
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
        const result = await centralCommand('acceptance', id, baseVersion, values, draft)
        advanceOwnerDocumentFormVersion(draft, result.version)
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

  async function executePenaltyAction(request: Omit<Extract<OwnerCommercialDocumentCommandRequestDTO, { action: 'deduct-penalty' }>, 'commandId'> | Omit<Extract<OwnerCommercialDocumentCommandRequestDTO, { action: 'rectify-penalty' }>, 'commandId'>) {
    const form = await centralForm('project_penalty', request.id)
    const result = await centralCommand('project_penalty', request.id, request.baseVersion, { ...request }, form.draft)
    await refreshAfterMutation('project_penalty')
    return result
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
        const result = await centralCommand(kind, id, baseVersion, values, draft)
        advanceOwnerDocumentFormVersion(draft, result.version)
        return result.attachmentIds
      }
      return await updateOwnerDocumentAttachments(kind, id, changes)
    }
    finally {
      loading.value = false
    }
  }

  return {
    refreshRelationshipVersions,
    lookupVersion,
    pendingCommand,
    hydrateCommand,
    recoverCommand,
    executePenaltyAction,
    records: readonly(records),
    listLoading: readonly(listLoading),
    listErrors: readonly(listErrors),
    loading: readonly(loading),
    loadKind,
    hasListSnapshot,
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
    loadContractSummary,
    loadBasicOptions,
    loadContractOptions,
    saveForm,
    approveOwnerChange: approveChange,
    auditOwnerReport: auditReport,
    transitionAcceptance: moveAcceptance,
    removeForm,
    restoreForm,
    saveAttachments,
  }
})
