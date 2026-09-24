import type { FormAttachmentChanges, MasterDataSaveAction, TargetCostFormDraft } from '~/lib/master-data/forms'
import type { TargetCostAction, TargetCostCommand, TargetCostCommandResult, TargetCostDetailRead, TargetCostFormRead, TargetCostListRead, TargetCostPending } from '~/lib/target-cost/central-contract'
import type { BudgetFileChanges } from '~/lib/target-cost/central-files'
import type { DataOriginDTO } from '~/types/read-model'
import { isTauri } from '@tauri-apps/api/core'
import { useSessionStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { loadTargetCostForm, saveTargetCostForm } from '~/lib/master-data/forms'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { targetCostProblem } from '~/lib/target-cost/central-contract'
import { localTargetCostForm } from '~/lib/target-cost/local-read'
import { generateId } from '~/lib/util/id'
import { useDataVisibilityStore } from './data-visibility'
import { createMasterDataFormState } from './master-data-form'

type Read = TargetCostFormRead | TargetCostDetailRead
const PENDING_STORAGE_KEY = 'target-cost-central-pending-v1'
export const useTargetCostStore = defineStore('target-cost', () => {
  const local = createMasterDataFormState<TargetCostFormDraft>('target_cost', loadTargetCostForm, saveTargetCostForm)
  const pending = useSessionStorage<Record<string, TargetCostCommand>>(PENDING_STORAGE_KEY, {}, { flush: 'sync', writeDefaults: false, onError: () => {} })
  const active = shallowRef(new Set<string>())
  const repositories = () => useNuxtApp().$repositories.targetCosts
  const keyFor = (command: Pick<TargetCostCommand, 'workspaceId' | 'actorId' | 'origin' | 'targetCostId' | 'draftKey'>) => JSON.stringify([command.workspaceId, command.actorId, command.origin, command.targetCostId ?? command.draftKey])
  const readKey = (read: Read) => keyFor({ ...read.context, targetCostId: read.targetCostId, draftKey: 'draftKey' in read ? read.draftKey ?? undefined : undefined })
  /** 提交前同步保存并读回原字节，不能把 VueUse 延后写入或配额失败当成持久化成功。 */
  function persistPending(next: Record<string, TargetCostCommand>, newCommand = false) {
    try {
      const storage = window.sessionStorage
      const previous = storage.getItem(PENDING_STORAGE_KEY)
      if (previous !== null && JSON.stringify(JSON.parse(previous)) !== JSON.stringify(pending.value))
        throw new Error('原提交记录已有变化')
      const encoded = JSON.stringify(next)
      if (previous !== encoded)
        storage.setItem(PENDING_STORAGE_KEY, encoded)
      if (storage.getItem(PENDING_STORAGE_KEY) !== encoded)
        throw new Error('原提交写后核对失败')
      pending.value = next
    }
    catch {
      throw targetCostProblem('unavailable', newCommand ? '浏览器无法可靠保存原提交，尚未发送。请保留当前草稿与附件，恢复浏览器存储后重试。' : '浏览器无法核对原提交记录。请保留当前草稿，恢复存储后按原提交编号核对。')
    }
  }
  function getPending(read: Read): TargetCostPending | null {
    const command = pending.value[readKey(read)]
    return command ? { command, state: active.value.has(command.commandId) ? 'sending' : 'unknown' } : null
  }
  function getPendingForList(read: TargetCostListRead): TargetCostPending[] {
    const ids = new Set(read.rows.map(row => row.id))
    return Object.values(pending.value).filter(command => command.workspaceId === read.context.workspaceId && command.actorId === read.context.actorId && command.origin === read.context.origin && command.targetCostId != null && ids.has(command.targetCostId)).map(command => ({ command, state: active.value.has(command.commandId) ? 'sending' : 'unknown' }))
  }
  function clearPending(command: TargetCostCommand) {
    const key = keyFor(command)
    if (pending.value[key]?.commandId !== command.commandId)
      return
    const next = { ...pending.value }
    delete next[key]
    persistPending(next)
  }
  async function send(command: TargetCostCommand) {
    if (active.value.has(command.commandId))
      throw targetCostProblem('conflict', '原提交仍在处理中')
    persistPending({ ...pending.value })
    active.value = new Set([...active.value, command.commandId])
    try {
      const result = await repositories().execute(JSON.parse(JSON.stringify(command)))
      clearPending(command)
      return result
    }
    catch (cause) {
      const problem = projectProblemFromUnknown(cause).problem as {
        commandId?: string
        commandOutcome?: string
        code: string
      }
      if (problem.commandId === command.commandId && problem.commandOutcome === 'not-applied' && ['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found', 'conflict'].includes(problem.code))
        clearPending(command)
      throw cause
    }
    finally {
      active.value = new Set([...active.value].filter(id => id !== command.commandId))
    }
  }
  function executeAction(read: Read, action: TargetCostAction) {
    if (read.context.origin !== 'real' || !read.context.capabilities.includes('target-cost:write'))
      throw targetCostProblem('forbidden', '当前预算为只读')
    if (getPending(read))
      throw targetCostProblem('conflict', '请先核对这个预算的原提交结果')
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    const command: TargetCostCommand = { workspaceId, actorId, origin, sourceVersion, requiredCapability: 'target-cost:write', commandId: generateId('target-cost-command'), targetCostId: read.targetCostId, ...('draftKey' in read && read.draftKey ? { draftKey: read.draftKey } : {}), action: JSON.parse(JSON.stringify(action)) }
    persistPending({ ...pending.value, [keyFor(command)]: command }, true)
    return send(command)
  }
  async function loadForm(id: string | null, origin: DataOriginDTO = 'real', draftKey?: string): Promise<TargetCostFormRead> {
    if (isTauri())
      return localTargetCostForm({ workspaceId: 'tauri', actorId: 'local', origin: 'real', sourceVersion: 'local', capabilities: ['target-cost:read', 'target-cost:write'] }, id, draftKey)
    if (origin === 'demo') {
      const authorized = await repositories().list({ origin, includeDemo: useDataVisibilityStore().includeDemo })
      return localTargetCostForm(authorized.context, id, draftKey)
    }
    return repositories().form({ origin }, id, draftKey)
  }
  function saveForm(read: TargetCostFormRead, draft: TargetCostFormDraft, action: MasterDataSaveAction, files?: BudgetFileChanges) {
    return executeAction(read, { kind: 'save-header', draft, saveAction: action, files })
  }
  function recover(original: TargetCostPending) {
    const command = pending.value[keyFor(original.command)]
    if (!command || command.commandId !== original.command.commandId)
      throw targetCostProblem('not-found', '原提交已核对或不属于当前草稿')
    return send(command)
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
