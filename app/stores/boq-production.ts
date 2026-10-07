import type { CreateBoqChangeOrderDraft } from '~/lib/boq/change'
import type { BoqFormatClass, BoqImportRow } from '~/lib/boq/import'
import type { BoqAction, BoqCommand, BoqCommandResult, BoqOriginalInput, BoqScope, ProductionBoqRead } from '~/lib/boq/production-contract'
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'
import { boqRecoveryDescriptor, readBoqRecoveryForRoute } from '~/lib/boq/command-recovery'
import { createProductionBoqRepository } from '~/lib/boq/production-repository'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { quantityProblem } from '~/lib/quantity/central-contract'
import { generateId } from '~/lib/util/id'

export const useProductionBoqStore = defineStore('boq-production', () => {
  const repository = createProductionBoqRepository((url, options) => $fetch<unknown, string>(url, { ...options, retry: 0 }))
  const codec = createCommandRecoveryStorage()
  const directory = shallowRef<Awaited<ReturnType<typeof repository.catalog>> | null>(null)
  const workspace = shallowRef<ProductionBoqRead | null>(null)
  const pending = shallowRef<CommandRecoveryDescriptor[]>([])
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  const applied = new Map<string, BoqCommandResult>()
  const savedCommands = shallowRef<string[]>([])
  let generation = 0
  let lastScope: BoqScope | null = null
  function targetReadBack(value: ProductionBoqRead, saved: BoqCommandResult) {
    if (saved.projectId !== value.projectId || saved.contractId !== value.contractId)
      return false
    if (saved.action === 'import-file')
      return value.files.some(file => file.id === saved.fileId) && saved.lineIds?.every(id => value.lines.some(line => line.id === id && line.fileId === saved.fileId)) && saved.priceIds?.every(id => value.prices.some(price => price.id === id && price.fileId === saved.fileId))
    if (saved.action === 'owner-change' || saved.action === 'reject-change')
      return saved.deleted ? !value.changes.some(row => row.id === saved.id) : value.changes.some(row => row.id === saved.id)
    if (saved.action === 'delete-line')
      return !value.lines.some(row => row.id === saved.id)
    if (saved.action === 'correct-building')
      return value.lines.some(row => row.id === saved.id && row.declaredBuildingId === saved.buildingResult?.buildingId && row.building === saved.buildingResult?.building)
    return value.lines.some(row => row.id === saved.id)
  }
  function acknowledge(result: BoqCommandResult) {
    applied.set(result.commandId, result)
    savedCommands.value = [...applied.keys()]
  }
  const catalog = computed(() => {
    const groups = new Map<string, { id: string, code: string, name: string, contracts: Array<{ id: string, no: string, name: string, lineCount: number }> }>()
    for (const contract of directory.value?.contracts ?? []) {
      if (['draft', '草稿'].includes(contract.status))
        continue
      const project = groups.get(contract.projectId) ?? { id: contract.projectId, code: '', name: contract.projectName, contracts: [] }
      project.contracts.push({ id: contract.id, no: contract.no, name: contract.name, lineCount: contract.lineCount })
      groups.set(contract.projectId, project)
    }
    return [...groups.values()]
  })
  function route(scope?: BoqScope) {
    return `/contract/boq${scope ? `?project=${encodeURIComponent(scope.projectId)}&contract=${encodeURIComponent(scope.contractId)}&origin=real` : ''}`
  }
  async function loadCatalog() {
    const epoch = ++generation
    loading.value = true
    error.value = ''
    try {
      const result = await repository.catalog()
      if (epoch !== generation)
        return
      directory.value = result
      pending.value = readBoqRecoveryForRoute(route(lastScope ?? undefined), result, sessionStorage)
    }
    catch (cause) {
      if (epoch === generation)
        error.value = cause instanceof Error ? cause.message : '真实施工主合同候选尚未读取成功'
      throw cause
    }
    finally {
      if (epoch === generation)
        loading.value = false
    }
  }
  async function loadWorkspace(projectId: string, contractId: string) {
    const epoch = ++generation
    const scope: BoqScope = { projectId, contractId, origin: 'real' }
    lastScope = scope
    workspace.value = null
    loading.value = true
    error.value = ''
    try {
      const identity = await repository.catalog()
      if (epoch !== generation)
        return null
      directory.value = identity
      pending.value = readBoqRecoveryForRoute(route(scope), identity, sessionStorage)
      const result = await repository.read(scope)
      if (epoch !== generation)
        return null
      if (result.workspaceId !== identity.workspaceId || result.actorId !== identity.actorId)
        throw quantityProblem('forbidden', '清单读回身份已变化，请保留原编号')
      for (const marker of pending.value.filter(row => applied.has(row.commandId))) {
        if (!targetReadBack(result, applied.get(marker.commandId)!))
          throw quantityProblem('unavailable', '原结果已保存，但实际目标尚未完整读回；保留原编号')
        codec.clear(commandRecoveryKey(marker), marker.commandId)
        applied.delete(marker.commandId)
      }
      savedCommands.value = [...applied.keys()]
      workspace.value = result
      pending.value = readBoqRecoveryForRoute(route(scope), identity, sessionStorage)
      return result
    }
    catch (cause) {
      if (epoch === generation)
        error.value = cause instanceof Error ? cause.message : '清单实际来源暂不可用'
      throw cause
    }
    finally {
      if (epoch === generation)
        loading.value = false
    }
  }
  async function execute(action: BoqAction) {
    const state = workspace.value
    if (!state || pending.value.length || saving.value || !state.capabilities.includes('boq:write'))
      throw quantityProblem('forbidden', '先读取原施工主合同并核对已有原编号，再保存清单')
    const epoch = generation
    const command: BoqCommand = { workspaceId: state.workspaceId, actorId: state.actorId, commandId: generateId('boq-command'), requiredCapability: 'boq:write', projectId: state.projectId, contractId: state.contractId, origin: 'real', contractVersion: state.contractVersion, action: structuredClone(action) }
    if (command.action.kind === 'owner-change')
      command.action.command = { ...command.action.command, workspaceId: command.workspaceId, actorId: command.actorId, commandId: command.commandId }
    const descriptor = boqRecoveryDescriptor(command)
    codec.remember(commandRecoveryKey(descriptor), descriptor)
    pending.value = [descriptor]
    saving.value = true
    try {
      const result = await repository.execute(command)
      acknowledge(result)
      if (epoch !== generation)
        return result
      await loadWorkspace(command.projectId, command.contractId)
      return result
    }
    catch (cause) {
      if (epoch === generation)
        error.value = cause instanceof Error ? cause.message : '原清单结果未知，保留编号先核对'
      throw cause
    }
    finally { saving.value = false }
  }
  async function importWorkbook(input: { projectId: string, contractId: string, original: BoqOriginalInput, formatClass: BoqFormatClass, rows: readonly BoqImportRow[] }) {
    if (workspace.value?.projectId !== input.projectId || workspace.value.contractId !== input.contractId)
      await loadWorkspace(input.projectId, input.contractId)
    return execute({ kind: 'import-file', original: input.original, formatClass: input.formatClass, rows: [...input.rows], bindings: input.rows.map((_, index) => ({ rowKey: String(index), itemId: null, itemVersion: null })) })
  }
  async function recover(descriptor: CommandRecoveryDescriptor) {
    if (!lastScope || descriptor.scopeId !== `${lastScope.projectId}:${lastScope.contractId}`)
      throw quantityProblem('forbidden', '请回原施工主合同核对清单')
    const scope = { ...lastScope }
    const epoch = generation
    const identity = await repository.catalog()
    if (identity.workspaceId !== descriptor.workspaceId || identity.actorId !== descriptor.actorId)
      throw quantityProblem('forbidden', '当前操作者不同，原清单定位保留')
    const result = await repository.resolve(descriptor)
    if (result.outcome === 'applied')
      acknowledge(result.result)
    else codec.clear(commandRecoveryKey(descriptor), descriptor.commandId)
    if (epoch !== generation)
      return result
    await loadWorkspace(scope.projectId, scope.contractId)
    return result
  }
  async function createChange(draft: CreateBoqChangeOrderDraft) {
    if (workspace.value?.projectId !== draft.projectId || workspace.value.contractId !== draft.contractId)
      await loadWorkspace(draft.projectId, draft.contractId)
    const saved = await execute({ kind: 'owner-change', command: { workspaceId: '', actorId: '', commandId: '', requiredCapability: 'owner-document:write', kind: 'owner_change', id: null, baseVersion: null, action: 'save', draft: { ...draft, no: draft.code, documentType: draft.documentType ?? 'change_negotiation', lines: draft.lines.map((line, index) => ({ ...line, id: `change-line-${index + 1}`, deltaQty: line.operation === 'add' ? line.qty : line.deltaQty })) }, attachments: {} } })
    return { orderId: saved.changeId!, logIds: [] }
  }
  async function attachmentChange(id: string, changes: import('~/lib/forms/file-refs').FileRefChanges) {
    const current = workspace.value?.changes.find(row => row.id === id)
    if (!current)
      throw new Error('原变洽签尚未从当前施工主合同读取')
    return execute({ kind: 'owner-change', command: { workspaceId: '', actorId: '', commandId: '', requiredCapability: 'owner-document:write', kind: 'owner_change', id, baseVersion: current.version, action: 'attachments', attachments: changes } })
  }
  async function originalFile(ownerKind: 'boq-file' | 'owner-change', ownerId: string, fileId: string) {
    const current = workspace.value
    if (!current)
      throw new Error('先读取实际清单与原附件')
    const epoch = generation
    const file = await repository.file({ projectId: current.projectId, contractId: current.contractId, origin: 'real', ownerKind, ownerId, fileId }, current)
    if (epoch !== generation || workspace.value?.workspaceId !== current.workspaceId || workspace.value.actorId !== current.actorId)
      throw quantityProblem('forbidden', '原件读取期间来源、页面范围或身份已变化')
    return file
  }
  async function approveChange(id: string, approvedAt: string) {
    const current = workspace.value?.changes.find(row => row.id === id)
    if (!current)
      throw new Error('原变洽签尚未从当前施工主合同读取')
    return execute({ kind: 'owner-change', command: { workspaceId: '', actorId: '', commandId: '', requiredCapability: 'owner-document:write', kind: 'owner_change', id, baseVersion: current.version, action: 'approve', approvedAt } })
  }
  async function transitionChange(id: string, target: 'submitted' | 'rejected', note = '') {
    const current = workspace.value?.changes.find(row => row.id === id)
    if (!current)
      throw new Error('原变洽签尚未读取')
    if (target === 'rejected')
      return execute({ kind: 'reject-change', changeId: id, version: current.version, note })
    const source = current.document
    return execute({ kind: 'owner-change', command: { workspaceId: '', actorId: '', commandId: '', requiredCapability: 'owner-document:write', kind: 'owner_change', id, baseVersion: current.version, action: 'submit', draft: { projectId: source.projectId, contractId: source.contractId, no: source.no, name: source.name, documentType: source.documentType, reason: source.note, applicationDate: source.applicationDate ?? '', note: source.note, lines: source.lines.map(line => ({ id: line.id, operation: line.operation, boqLineId: line.boqLineId, itemName: line.itemName, unit: line.unit, deltaQty: line.deltaQty, newUnitPrice: line.newUnitPrice, note: line.note })) }, attachments: {} } })
  }
  function clearWorkspace() {
    generation++
    workspace.value = null
    lastScope = null
    pending.value = []
    error.value = ''
    directory.value = null
  }
  return { catalog, directory: readonly(directory), workspace: readonly(workspace), pending: readonly(pending), savedCommands: readonly(savedCommands), loading: readonly(loading), saving: readonly(saving), error: readonly(error), loadCatalog, loadWorkspace, execute, importWorkbook, createChange, attachmentChange, originalFile, approveChange, transitionChange, recover, clearWorkspace }
})
