import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import type { FormAttachmentChanges, MasterDataSaveAction, TargetCostFormDraft } from '~/lib/master-data/forms'
import type { TargetCostAction, TargetCostCommand, TargetCostCommandResult, TargetCostDetailRead, TargetCostFormRead, TargetCostListRead, TargetCostPending } from '~/lib/target-cost/central-contract'
import type { BudgetFileChanges } from '~/lib/target-cost/central-files'
import type { DataOriginDTO } from '~/types/read-model'
import { isTauri } from '@tauri-apps/api/core'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { loadTargetCostForm, saveTargetCostForm } from '~/lib/master-data/forms'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { encodeTargetCostWire, parseTargetCostCommand } from '~/lib/target-cost/central-codec'
import { TARGET_COST_DRAFT_KEYS, targetCostProblem } from '~/lib/target-cost/central-contract'
import { targetCostEditableDraft } from '~/lib/target-cost/central-domain'
import { localTargetCostForm } from '~/lib/target-cost/local-read'
import { generateId } from '~/lib/util/id'
import { useDataVisibilityStore } from './data-visibility'
import { createMasterDataFormState } from './master-data-form'

type Read = TargetCostFormRead | TargetCostDetailRead
interface MemoryPending { command: TargetCostCommand, descriptor: CommandRecoveryDescriptor, result: TargetCostCommandResult | null }
const LEGACY_PENDING_KEY = 'target-cost-central-pending-v1'
export const useTargetCostStore = defineStore('target-cost', () => {
  const local = createMasterDataFormState<TargetCostFormDraft>('target_cost', loadTargetCostForm, saveTargetCostForm)
  const pending = shallowRef<Record<string, MemoryPending>>({})
  const active = shallowRef(new Set<string>())
  const revision = shallowRef(0)
  const recovery = createCommandRecoveryStorage()
  const repositories = () => useNuxtApp().$repositories.targetCosts
  const descriptorFor = (command: TargetCostCommand): CommandRecoveryDescriptor => ({ commandId: command.commandId, workspaceId: command.workspaceId, actorId: command.actorId, family: 'target-cost', targetId: command.targetCostId, action: command.action.kind, ...(!command.targetCostId && command.draftKey ? { scopeId: command.draftKey } : {}) })
  const readScope = (read: Read) => ({ workspaceId: read.context.workspaceId, actorId: read.context.actorId, family: 'target-cost', targetId: read.targetCostId, ...(!read.targetCostId && 'draftKey' in read && read.draftKey ? { scopeId: read.draftKey } : {}) })
  /** Adopt existing pending keys before removing private legacy bodies; a failure keeps the original intact. */
  function adoptLegacyPending() {
    const encoded = sessionStorage.getItem(LEGACY_PENDING_KEY)
    if (encoded === null)
      return
    const values = JSON.parse(encoded)
    if (!values || typeof values !== 'object' || Array.isArray(values))
      throw targetCostProblem('unavailable', '旧预算原提交记录损坏，请保留现有存储核对')
    for (const entry of Object.values(values)) {
      const legacy = entry as TargetCostCommand
      if (legacy.action?.kind === 'save-header' && Object.keys(legacy.action.draft).some(key => ![...TARGET_COST_DRAFT_KEYS, 'projectName', 'projectCode', 'createdAt', 'updatedAt'].includes(key)))
        throw targetCostProblem('unavailable', '旧预算原提交含无法核验的字段，已保留原记录供核对')
      const candidate = legacy.action?.kind === 'save-header' ? { ...legacy, action: { ...legacy.action, draft: targetCostEditableDraft(legacy.action.draft) } } : legacy
      parseTargetCostCommand(encodeTargetCostWire(candidate))
      const command = legacy
      const descriptor = descriptorFor(command)
      const key = commandRecoveryKey(descriptor)
      const known = recovery.read(key)
      if (known && known.commandId !== descriptor.commandId)
        throw targetCostProblem('conflict', '旧预算原编号与当前待核对编号冲突')
      if (!known)
        recovery.remember(key, descriptor)
      pending.value = { ...pending.value, [key]: { command, descriptor, result: null } }
    }
    sessionStorage.removeItem(LEGACY_PENDING_KEY)
    if (sessionStorage.getItem(LEGACY_PENDING_KEY) !== null)
      throw targetCostProblem('unavailable', '旧预算正文清理失败，尚未发送新的提交')
  }
  function forScope(scope: ReturnType<typeof readScope>): TargetCostPending | null {
    const key = commandRecoveryKey(scope)
    const memory = pending.value[key]
    const descriptor = recovery.read(key)
    if (!descriptor)
      return null
    if (descriptor.workspaceId !== scope.workspaceId || descriptor.actorId !== scope.actorId || descriptor.targetId !== scope.targetId || descriptor.scopeId !== scope.scopeId)
      throw targetCostProblem('forbidden', '预算原编号不属于当前目标与草稿')
    return { descriptor, command: memory?.command ?? null, state: active.value.has(descriptor.commandId) ? 'sending' : memory?.result ? 'applied' : 'unknown' }
  }
  function getPending(read: Read): TargetCostPending | null {
    adoptLegacyPending()
    return read.context.origin === 'real' ? forScope(readScope(read)) : null
  }
  function getPendingForList(read: TargetCostListRead): TargetCostPending[] {
    adoptLegacyPending()
    if (read.context.origin !== 'real')
      return []
    return read.rows.flatMap(row => forScope({ workspaceId: read.context.workspaceId, actorId: read.context.actorId, family: 'target-cost', targetId: row.id }) ?? [])
  }
  function versionOf(sourceVersion: string): number | null {
    if (sourceVersion.startsWith('target-cost-v1:')) {
      try {
        const encoded = sourceVersion.slice(15).replace(/-/g, '+').replace(/_/g, '/')
        const version = JSON.parse(atob(encoded)).version
        return Number.isSafeInteger(version) ? version : null
      }
      catch { return null }
    }
    const legacy = /^budget:(\d+)\+projects:/.exec(sourceVersion)
    return legacy ? Number(legacy[1]) : null
  }
  async function afterRead(descriptor: CommandRecoveryDescriptor, result: TargetCostCommandResult) {
    const key = commandRecoveryKey(descriptor)
    recovery.verify(key, descriptor.commandId)
    if (result.commandId !== descriptor.commandId || (descriptor.targetId !== null && result.id !== descriptor.targetId))
      throw targetCostProblem('unavailable', '预算回执与原编号或原目标不匹配')
    const read = descriptor.action === 'save-items'
      ? await repositories().detail({ origin: 'real' }, result.id)
      : await repositories().form({ origin: 'real' }, result.id)
    const expected = versionOf(result.sourceVersion)
    const actual = versionOf(read.context.sourceVersion)
    if (read.targetCostId !== result.id || read.context.origin !== 'real' || read.context.workspaceId !== descriptor.workspaceId || read.context.actorId !== descriptor.actorId || !read.context.capabilities.includes('target-cost:write') || expected === null || actual === null || actual < expected)
      throw targetCostProblem('unavailable', '已保存的预算尚未授权可靠读取，请只重试读取')
    recovery.clear(key, descriptor.commandId)
    const next = { ...pending.value }
    delete next[key]
    pending.value = next
    revision.value += 1
    return result
  }
  async function send(command: TargetCostCommand) {
    const descriptor = descriptorFor(command)
    const key = commandRecoveryKey(descriptor)
    if (active.value.has(command.commandId))
      throw targetCostProblem('conflict', '原提交仍在处理中')
    recovery.verify(key, command.commandId)
    active.value = new Set([...active.value, command.commandId])
    try {
      const result = await repositories().execute(JSON.parse(JSON.stringify(command)))
      pending.value = { ...pending.value, [key]: { command, descriptor, result } }
      return await afterRead(descriptor, result)
    }
    catch (cause) {
      const problem = projectProblemFromUnknown(cause).problem as { commandId?: string, commandOutcome?: string, code: string }
      if (!pending.value[key]?.result && problem.commandId === command.commandId && problem.commandOutcome === 'not-applied' && ['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found', 'conflict'].includes(problem.code)) {
        recovery.clear(key, command.commandId)
        const next = { ...pending.value }
        delete next[key]
        pending.value = next
      }
      throw cause
    }
    finally { active.value = new Set([...active.value].filter(id => id !== command.commandId)) }
  }
  function executeAction(read: Read, action: TargetCostAction) {
    if (read.context.origin !== 'real' || !read.context.capabilities.includes('target-cost:write'))
      throw targetCostProblem('forbidden', '当前预算为只读')
    if (getPending(read))
      throw targetCostProblem('conflict', '请先核对这个预算的原提交结果')
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    const command: TargetCostCommand = { workspaceId, actorId, origin, sourceVersion, requiredCapability: 'target-cost:write', commandId: generateId('target-cost-command'), targetCostId: read.targetCostId, ...('draftKey' in read && read.draftKey ? { draftKey: read.draftKey } : {}), action: JSON.parse(JSON.stringify(action)) }
    const descriptor = descriptorFor(command)
    const key = commandRecoveryKey(descriptor)
    try {
      recovery.remember(key, descriptor)
    }
    catch { throw targetCostProblem('unavailable', '浏览器无法可靠登记原编号，尚未发送。请保留草稿与附件，恢复存储后重试。') }
    pending.value = { ...pending.value, [key]: { command, descriptor, result: null } }
    return send(command)
  }
  async function loadForm(id: string | null, origin: DataOriginDTO = 'real', draftKey?: string): Promise<TargetCostFormRead> {
    if (isTauri())
      return localTargetCostForm({ workspaceId: 'tauri', actorId: 'local', origin: 'real', sourceVersion: 'local', capabilities: ['target-cost:read', 'target-cost:write'] }, id, draftKey)
    adoptLegacyPending()
    if (origin === 'demo') {
      const authorized = await repositories().list({ origin, includeDemo: useDataVisibilityStore().includeDemo })
      return localTargetCostForm(authorized.context, id, draftKey)
    }
    return repositories().form({ origin }, id, draftKey)
  }
  const saveForm = (read: TargetCostFormRead, draft: TargetCostFormDraft, action: MasterDataSaveAction, files?: BudgetFileChanges) => executeAction(read, { kind: 'save-header', draft, saveAction: action, files })
  async function recover(original: TargetCostPending) {
    const descriptor = original.descriptor
    const key = commandRecoveryKey(descriptor)
    recovery.verify(key, descriptor.commandId)
    if (active.value.has(descriptor.commandId))
      throw targetCostProblem('conflict', '原提交仍在处理中')
    active.value = new Set([...active.value, descriptor.commandId])
    try {
      const known = pending.value[key]?.result
      if (known)
        return await afterRead(descriptor, known)
      const outcome = await repositories().resolve(descriptor)
      if (outcome.outcome === 'applied')
        return await afterRead(descriptor, outcome.result)
      recovery.clear(key, descriptor.commandId)
      const next = { ...pending.value }
      delete next[key]
      pending.value = next
      throw targetCostProblem('conflict', '原提交已确认未应用并封存；原稿与附件保留，可继续编辑后重新保存')
    }
    finally { active.value = new Set([...active.value].filter(id => id !== descriptor.commandId)) }
  }
  function nativeOnly() {
    if (!isTauri())
      throw targetCostProblem('forbidden', '正式浏览器预算必须从中央版本读取后提交')
  }
  function remove(read: Read): Promise<TargetCostCommandResult>
  function remove(id: string): ReturnType<typeof local.remove>
  function remove(read: Read | string) {
    if (typeof read === 'string') {
      nativeOnly()
      return local.remove(read)
    }
    return executeAction(read, { kind: 'delete' })
  }
  function restore(read: Read): Promise<TargetCostCommandResult>
  function restore(id: string): ReturnType<typeof local.restore>
  function restore(read: Read | string) {
    if (typeof read === 'string') {
      nativeOnly()
      return local.restore(read)
    }
    return executeAction(read, { kind: 'restore' })
  }
  return {
    ...local,
    revision: computed(() => revision.value + local.revision.value),
    saving: computed(() => active.value.size > 0 || local.saving.value),
    loadForm,
    saveForm,
    getPending,
    getPendingForList,
    recover,
    executeAction,
    load: (id: string) => {
      nativeOnly()
      return local.load(id)
    },
    save: (draft: TargetCostFormDraft, action: MasterDataSaveAction, files?: FormAttachmentChanges) => {
      nativeOnly()
      return local.save(draft, action, files)
    },
    remove,
    restore,
  }
})
