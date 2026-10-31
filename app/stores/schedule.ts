import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import type { ScheduleBindingRead, ScheduleBindingResult } from '~/lib/schedule/central-binding-contract'
import type { ScheduleAction, ScheduleCommand, ScheduleCommandResult, SchedulePending, ScheduleRead, ScheduleReadContext } from '~/lib/schedule/central-contract'
import type { ScheduleHistory } from '~/lib/schedule/history'
import type { DataOriginDTO } from '~/types/read-model'
import { useSessionStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'
import { execute, select, withTransaction } from '~/lib/db/connection'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { scheduleProblem } from '~/lib/schedule/central-contract'
import { scheduleVersionBasis } from '~/lib/schedule/command-recovery'
import { createScheduleEngine } from '~/lib/schedule/engine'
import { loadScheduleProject } from '~/lib/schedule/read-model'
import { generateId } from '~/lib/util/id'
import { toLocalDateInputValue } from '~/lib/util/local-date'
import { useDataVisibilityStore } from '~/stores/data-visibility'

export type { AddScheduleTaskDraft, CreateScheduleGroupDraft, SaveScheduleTaskPlanDraft, ScheduleProvisionalBuildingPreview, ScheduleProvisionalScopePreview, UpdateScheduleFloorPlanPatch, UpdateScheduleTaskPatch } from '~/lib/schedule/engine'
type Engine = ReturnType<typeof createScheduleEngine>

export const useScheduleStore = defineStore('schedule', () => {
  const db = { execute, select }
  const local = createScheduleEngine(db, withTransaction, shallowRef)
  const repositories = () => useNuxtApp().$repositories
  const origin = shallowRef<DataOriginDTO>('real')
  const scopeProjectId = shallowRef('')
  const context = shallowRef<ScheduleReadContext | null>(null)
  const history = shallowRef<ScheduleHistory>({ logs: [], removedTasks: [], migrationEvidence: [] })
  const workspaceId = computed(() => context.value?.workspaceId ?? '')
  const actorId = computed(() => context.value?.actorId ?? '')
  const capabilities = computed(() => context.value?.capabilities ?? [])
  const sourceVersion = computed(() => context.value?.sourceVersion ?? '')
  const sessionKey = computed(() => JSON.stringify([workspaceId.value, actorId.value, origin.value]))
  const scopeKey = computed(() => JSON.stringify([workspaceId.value, actorId.value, origin.value, scopeProjectId.value]))
  const pending = shallowRef<Record<string, { command: ScheduleCommand, result: ScheduleCommandResult | null }>>({})
  const recovery = createCommandRecoveryStorage()
  const recoveryRevision = shallowRef(0)
  const sending = shallowRef(new Set<string>())
  const recoveryScope = () => ({ workspaceId: workspaceId.value, actorId: actorId.value, family: 'schedule', targetId: scopeProjectId.value })
  const descriptorFor = (command: ScheduleCommand): CommandRecoveryDescriptor => ({ commandId: command.commandId, workspaceId: command.workspaceId, actorId: command.actorId, family: 'schedule', targetId: command.projectId, action: command.action.kind })
  function adoptLegacy() {
    const encoded = sessionStorage.getItem('schedule-central-pending-v1')
    if (encoded === null)
      return
    const legacy = JSON.parse(encoded)
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy))
      throw scheduleProblem('unavailable', '旧排程原提交损坏，请保留已有存储核对')
    for (const value of Object.values(legacy)) {
      const command = value as ScheduleCommand
      if (!command || command.origin !== 'real' || command.requiredCapability !== 'schedule:write' || !command.projectId || !command.action?.kind || !command.sourceVersion || !command.workspaceId || !command.actorId)
        throw scheduleProblem('unavailable', '旧排程原提交无法核验，请保留已有存储')
      const descriptor = descriptorFor(command)
      const key = commandRecoveryKey(descriptor)
      const known = recovery.read(key)
      if (known && known.commandId !== command.commandId)
        throw scheduleProblem('conflict', '旧排程原编号与当前编号冲突')
      if (!known)
        recovery.remember(key, descriptor)
      pending.value = { ...pending.value, [key]: { command, result: null } }
    }
    sessionStorage.removeItem('schedule-central-pending-v1')
    if (sessionStorage.getItem('schedule-central-pending-v1') !== null)
      throw scheduleProblem('unavailable', '旧排程正文尚未可靠清理，不能发送新的命令')
  }
  const expanded = useSessionStorage<Record<string, string[]>>('schedule-wbs-expanded-groups-v2', {})
  const pendingCommand = computed<SchedulePending | null>(() => {
    void recoveryRevision.value
    if (!context.value || origin.value !== 'real' || !scopeProjectId.value)
      return null
    const key = commandRecoveryKey(recoveryScope())
    const descriptor = recovery.read(key)
    if (!descriptor)
      return null
    return { descriptor, command: pending.value[key]?.command ?? null, state: sending.value.has(descriptor.commandId) ? 'sending' : pending.value[key]?.result ? 'applied' : 'unknown' }
  })
  const contractSourceState = shallowRef<'available' | 'unavailable'>('available')
  const contractSourceMessage = shallowRef('')
  const editingBaselines = new Map<string, ScheduleReadContext>()
  function beginPlanEdit(taskId: string) {
    if (context.value)
      editingBaselines.set(taskId, structuredClone({ workspaceId: context.value.workspaceId, actorId: context.value.actorId, origin: context.value.origin, capabilities: [...context.value.capabilities], sourceVersion: context.value.sourceVersion }))
  }
  const canWrite = computed(() => origin.value === 'real' && capabilities.value.includes('schedule:write'))
  let today = toLocalDateInputValue()
  let generation = 0
  let catalogGeneration = 0
  let libraryGeneration = 0
  let taskGeneration = 0
  let bindingTarget: { projectId: string, groupId: string, contractId: string } | null = null
  let bindingGeneration = 0
  const catalog = shallowRef<(Engine['catalog']['value'][number] & { origin: DataOriginDTO })[]>([])

  function setOrigin(value: DataOriginDTO) {
    if (value === origin.value)
      return
    origin.value = value
    scopeProjectId.value = ''
    context.value = null
    history.value = { logs: [], removedTasks: [], migrationEvidence: [] }
    local.snapshot.value = null
    local.saving.value = false
    local.buildings.value = []
    local.contracts.value = []
    local.buildingCoverage.value = []
    local.processLibraries.value = []
    local.processTasks.value = []
    local.processTasksLibraryId.value = ''
    generation += 1
    libraryGeneration += 1
    taskGeneration += 1
    cancelBindingRead()
  }
  function query(projectId = scopeProjectId.value) {
    return { projectId, origin: origin.value, includeDemo: useDataVisibilityStore().includeDemo, today }
  }
  function apply(read: ScheduleRead) {
    local.error.value = ''
    history.value = read.history
    context.value = read
    local.snapshot.value = read.snapshot
    local.contracts.value = read.contracts
    local.buildings.value = read.buildings
    local.buildingCoverage.value = read.buildingCoverage
    contractSourceState.value = read.contractSourceState ?? 'available'
    contractSourceMessage.value = read.contractSourceMessage ?? ''
  }
  async function loadCatalog() {
    adoptLegacy()
    const request = ++catalogGeneration
    const includeDemo = useDataVisibilityStore().includeDemo
    const results = await Promise.all([repositories().schedule.catalog('real'), ...(includeDemo ? [repositories().schedule.catalog('demo', true)] : [])])
    if (request === catalogGeneration && includeDemo === useDataVisibilityStore().includeDemo)
      catalog.value = results.flatMap(result => result.projects)
    if (!context.value && request === catalogGeneration)
      context.value = results[0]!
  }
  async function loadProject(projectId: string, currentDay = toLocalDateInputValue(), selectedOrigin: DataOriginDTO = origin.value) {
    setOrigin(selectedOrigin)
    adoptLegacy()
    const request = ++generation
    if (scopeProjectId.value !== projectId) {
      cancelBindingRead()
      local.snapshot.value = null
      context.value = null
      history.value = { logs: [], removedTasks: [], migrationEvidence: [] }
      local.saving.value = false
    }
    scopeProjectId.value = projectId
    today = currentDay
    local.loading.value = true
    local.error.value = ''
    try {
      if (!projectId) {
        local.snapshot.value = null
        return
      }
      if (selectedOrigin === 'demo') {
        const catalog = await repositories().schedule.catalog('demo', useDataVisibilityStore().includeDemo)
        if (!catalog.projects.some(row => row.id === projectId))
          throw scheduleProblem('not-found', '演示项目不存在')
        const snapshot = await loadScheduleProject(db, projectId, currentDay)
        if (!snapshot)
          throw scheduleProblem('unavailable', '当前演示项目没有可读排程快照')
        if (request === generation)
          apply({ ...catalog, sourceVersion: `demo:${catalog.sourceVersion}`, snapshot, contracts: [], buildings: [], buildingCoverage: [], history: { logs: [], removedTasks: [], migrationEvidence: [] } })
      }
      else {
        const read = await repositories().schedule.read(query(projectId))
        if (request === generation)
          apply(read)
      }
    }
    catch (cause) {
      if (request === generation) {
        local.error.value = projectProblemFromUnknown(cause).message
        if (projectProblemFromUnknown(cause).problem.code === 'forbidden') {
          if (context.value)
            context.value = { ...context.value, capabilities: [] }
          local.snapshot.value = null
          history.value = { logs: [], removedTasks: [], migrationEvidence: [] }
        }
      }
      throw cause
    }
    finally {
      if (request === generation)
        local.loading.value = false
    }
  }
  async function loadContracts(projectId: string, selectedOrigin: DataOriginDTO = origin.value) {
    if (scopeProjectId.value !== projectId || origin.value !== selectedOrigin || !context.value) {
      await loadProject(projectId, today, selectedOrigin)
    }
    else {
      const key = scopeKey.value
      const read = await repositories().schedule.read(query(projectId))
      if (key === scopeKey.value)
        apply(read)
    }
  }
  async function loadBuildings(projectId: string, contractId = '', selectedOrigin: DataOriginDTO = origin.value) {
    if (scopeProjectId.value !== projectId || origin.value !== selectedOrigin || !context.value)
      await loadProject(projectId, today, selectedOrigin)
    const key = scopeKey.value
    const read = await repositories().schedule.read(query(projectId), contractId)
    if (key === scopeKey.value) {
      context.value = read
      local.buildings.value = read.buildings
      local.buildingCoverage.value = read.buildingCoverage
      local.contracts.value = read.contracts
    }
  }
  async function previewProvisionalScope(buildingIds: readonly string[]) {
    const key = scopeKey.value
    const read = await repositories().schedule.scope(query(), buildingIds)
    if (key !== scopeKey.value)
      throw scheduleProblem('stale-source', '当前项目已变化，请重新核对范围')
    if (context.value && context.value.sourceVersion !== read.sourceVersion) {
      const original = scheduleVersionBasis(context.value.sourceVersion)
      const latest = scheduleVersionBasis(read.sourceVersion)
      if (!original || !latest || original.projectId !== latest.projectId || original.project !== latest.project || buildingIds.some(id => !original.buildings[id] || original.buildings[id] !== latest.buildings[id]))
        throw scheduleProblem('stale-source', '实际采用的区域或模板来源已变化，请保留草稿并重新读取')
    }
    return read.preview
  }
  async function loadProcessLibraries() {
    const request = ++libraryGeneration
    const selected = origin.value
    const loaded = await repositories().processLibraries.list(selected)
    if (request === libraryGeneration && selected === origin.value)
      local.processLibraries.value = loaded.libraries
  }
  function cancelBindingRead() {
    bindingGeneration += 1
    bindingTarget = null
  }
  async function readBinding(projectId: string, groupId: string, contractId = '', selectedOrigin: DataOriginDTO = 'real'): Promise<ScheduleBindingRead> {
    if (selectedOrigin !== 'real')
      throw scheduleProblem('forbidden', '中央绑定仅用于真实来源，演示保持各自读取边界')
    setOrigin(selectedOrigin)
    const request = ++bindingGeneration
    generation += 1
    if (scopeProjectId.value !== projectId) {
      context.value = null
      local.snapshot.value = null
      history.value = { logs: [], removedTasks: [], migrationEvidence: [] }
      local.saving.value = false
    }
    scopeProjectId.value = projectId
    bindingTarget = { projectId, groupId, contractId }
    const result = await repositories().schedule.binding(query(projectId), groupId, contractId)
    if (request !== bindingGeneration || projectId !== scopeProjectId.value || origin.value !== selectedOrigin)
      throw scheduleProblem('stale-source', '绑定目标已变化，请重新读取当前分组')
    context.value = result
    return result
  }
  async function confirmBinding(read: ScheduleBindingRead): Promise<ScheduleBindingResult> {
    if (read.state !== 'unbound' || !read.preview?.canBind || !bindingTarget || bindingTarget.projectId !== read.group.projectId
      || bindingTarget.groupId !== read.group.id || bindingTarget.contractId !== read.preview.contractId
      || read.group.projectId !== scopeProjectId.value || read.origin !== origin.value
      || read.workspaceId !== workspaceId.value || read.actorId !== actorId.value) {
      throw scheduleProblem('stale-source', '绑定分组或确认依据已变化，请重新预览')
    }
    return submit<ScheduleBindingResult>({ kind: 'bind-contract', groupId: read.group.id, contractId: read.preview.contractId }, read)
  }
  async function loadProcessLibraryTasks(libraryId: string) {
    const request = ++taskGeneration
    const selected = origin.value
    try {
      const loaded = await repositories().processLibraries.detail(libraryId, selected)
      if (request !== taskGeneration || selected !== origin.value)
        return []
      local.processTasks.value = loaded.tasks
      local.processTasksLibraryId.value = libraryId
      return loaded.tasks
    }
    catch (cause) {
      if (request === taskGeneration && selected === origin.value) {
        local.processTasks.value = []
        local.processTasksLibraryId.value = ''
      }
      throw cause
    }
  }
  async function submit<T>(action: ScheduleAction, baseline: ScheduleReadContext | null = context.value): Promise<T> {
    if (!canWrite.value || !context.value)
      throw scheduleProblem('forbidden', '当前来源或身份不能修改排程')
    if (pendingCommand.value)
      throw scheduleProblem('conflict', '上次提交结果尚未确认，请先恢复原提交')
    const editingId = action.kind === 'reschedule-task' ? null : 'taskId' in action ? action.taskId : action.kind === 'update-dependency' ? action.successorId : null
    if (editingId && editingBaselines.has(editingId))
      baseline = editingBaselines.get(editingId)!
    if (!baseline || baseline.workspaceId !== workspaceId.value || baseline.actorId !== actorId.value || baseline.origin !== origin.value)
      throw scheduleProblem('forbidden', '原编辑身份或来源已变化，请保留原稿重新读取')
    const command: ScheduleCommand = { commandId: generateId('schedule-command'), workspaceId: workspaceId.value, actorId: actorId.value, origin: origin.value, requiredCapability: 'schedule:write', projectId: scopeProjectId.value, sourceVersion: baseline!.sourceVersion, action: JSON.parse(JSON.stringify(action)) }
    const descriptor = descriptorFor(command)
    const key = commandRecoveryKey(descriptor)
    recovery.remember(key, descriptor)
    pending.value = { ...pending.value, [key]: { command, result: null } }
    recoveryRevision.value++
    return send<T>(command, key)
  }
  async function afterRead<T>(descriptor: CommandRecoveryDescriptor, result: ScheduleCommandResult): Promise<T> {
    const key = commandRecoveryKey(descriptor)
    recovery.verify(key, descriptor.commandId)
    if (result.commandId !== descriptor.commandId || result.projectId !== descriptor.targetId)
      throw scheduleProblem('unavailable', '回执与原WBS编号或项目不一致，请保留原编号')
    const loaded = await repositories().schedule.read({ projectId: result.projectId, origin: 'real', includeDemo: false, today })
    if (loaded.workspaceId !== descriptor.workspaceId || loaded.actorId !== descriptor.actorId || loaded.snapshot.id !== descriptor.targetId || loaded.origin !== 'real' || !loaded.capabilities.includes('schedule:write'))
      throw scheduleProblem('forbidden', '已保存WBS尚未获同一可信身份授权读取，请保留原编号')
    // A newer authoritative read may contain later work; it must still carry a valid original owner version protocol.
    const original = scheduleVersionBasis(result.sourceVersion)
    const current = scheduleVersionBasis(loaded.sourceVersion)
    if ((result.sourceVersion.startsWith('wbs-v1:') && (!original || !current || current.projectId !== result.projectId || current.revision < original.revision)) || (!result.sourceVersion.startsWith('wbs-v1:') && !loaded.sourceVersion))
      throw scheduleProblem('unavailable', '已保存的WBS版本尚未可靠读取，请只重试读取')
    const command = pending.value[key]?.command
    if (command?.action.kind === 'update-dependency' && scopeProjectId.value === descriptor.targetId && workspaceId.value === descriptor.workspaceId && actorId.value === descriptor.actorId && origin.value === 'real' && loaded.sourceVersion === result.sourceVersion) {
      const baseline = editingBaselines.get(command.action.successorId)
      if (baseline?.sourceVersion === command.sourceVersion && baseline.workspaceId === command.workspaceId && baseline.actorId === command.actorId && baseline.origin === command.origin)
        editingBaselines.set(command.action.successorId, { ...baseline, sourceVersion: result.sourceVersion })
    }
    if (scopeProjectId.value === descriptor.targetId && workspaceId.value === descriptor.workspaceId && actorId.value === descriptor.actorId && origin.value === 'real')
      apply(loaded)
    recovery.clear(key, descriptor.commandId)
    const next = { ...pending.value }
    delete next[key]
    pending.value = next
    recoveryRevision.value++
    return result.value as T
  }
  async function send<T>(command: ScheduleCommand, key: string): Promise<T> {
    if (sending.value.has(command.commandId))
      throw scheduleProblem('conflict', '原WBS提交仍在处理中')
    recovery.verify(key, command.commandId)
    sending.value = new Set([...sending.value, command.commandId])
    local.saving.value = true
    try {
      const result = await repositories().schedule.execute(JSON.parse(JSON.stringify(command)) as ScheduleCommand)
      pending.value = { ...pending.value, [key]: { command, result } }
      return await afterRead<T>(descriptorFor(command), result)
    }
    catch (cause) {
      const problem = projectProblemFromUnknown(cause)
      const outcome = problem.problem as typeof problem.problem & { commandId?: string, commandOutcome?: string }
      // 无响应、暂时撤权或写后读回失败均保留原命令；明确未应用拒绝才释放。
      if (!pending.value[key]?.result && outcome.commandId === command.commandId && outcome.commandOutcome === 'not-applied'
        && ['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found', 'conflict'].includes(problem.problem.code)) {
        recovery.clear(key, command.commandId)
        const next = { ...pending.value }
        delete next[key]
        pending.value = next
        recoveryRevision.value++
      }
      if (key === commandRecoveryKey(recoveryScope()))
        local.error.value = problem.message
      throw cause
    }
    finally {
      sending.value = new Set([...sending.value].filter(id => id !== command.commandId))
      if (key === commandRecoveryKey(recoveryScope()))
        local.saving.value = false
    }
  }
  async function recoverPending() {
    const original = pendingCommand.value
    if (!original)
      return null
    const { descriptor } = original
    const key = commandRecoveryKey(descriptor)
    recovery.verify(key, descriptor.commandId)
    if (sending.value.has(descriptor.commandId))
      throw scheduleProblem('conflict', '原WBS提交仍在处理中')
    local.saving.value = true
    sending.value = new Set([...sending.value, descriptor.commandId])
    try {
      const known = pending.value[key]?.result
      if (known)
        return await afterRead(descriptor, known)
      const outcome = await repositories().schedule.resolve(descriptor)
      if (outcome.outcome === 'applied')
        return await afterRead(descriptor, outcome.result)
      recovery.clear(key, descriptor.commandId)
      const next = { ...pending.value }
      delete next[key]
      pending.value = next
      recoveryRevision.value++
      throw scheduleProblem('conflict', '原WBS提交已确认未应用并封存；保留的原稿可核对后重新保存')
    }
    finally {
      sending.value = new Set([...sending.value].filter(id => id !== descriptor.commandId))
      if (key === commandRecoveryKey(recoveryScope()))
        local.saving.value = false
    }
  }
  function recheck() {
    return loadProject(scopeProjectId.value, today, origin.value)
  }
  function blockedBinding(): never {
    throw scheduleProblem('unavailable', '新的暂估绑定合同由后续工单接通，当前分组保持不变')
  }
  function setExpandedGroupIds(projectId: string, ids: readonly string[]) {
    expanded.value = { ...expanded.value, [`${sessionKey.value}:${projectId}`]: [...new Set(ids)] }
  }
  const expandedGroupIdsByProject = computed(() => Object.fromEntries(Object.entries(expanded.value).filter(([key]) => key.startsWith(`${sessionKey.value}:`)).map(([key, value]) => [key.slice(sessionKey.value.length + 1), value])))
  return {
    ...local,
    catalog: readonly(catalog),
    origin: readonly(origin),
    sourceVersion,
    capabilities,
    canWrite,
    sessionKey,
    workspaceId,
    actorId,
    pendingCommand,
    beginPlanEdit,
    contractSourceState: readonly(contractSourceState),
    contractSourceMessage: readonly(contractSourceMessage),
    history: readonly(history),
    snapshot: computed(() => local.snapshot.value),
    buildings: computed(() => local.buildings.value),
    buildingCoverage: computed(() => local.buildingCoverage.value),
    contracts: computed(() => local.contracts.value),
    processLibraries: computed(() => local.processLibraries.value),
    processTasks: computed(() => local.processTasks.value),
    processTasksLibraryId: computed(() => local.processTasksLibraryId.value),
    loading: computed(() => local.loading.value),
    saving: computed(() => local.saving.value),
    error: computed(() => local.error.value),
    expandedGroupIdsByProject,
    setExpandedGroupIds,
    setOrigin,
    loadCatalog,
    loadProject,
    loadBuildings,
    loadContracts,
    previewProvisionalScope,
    loadProcessLibraries,
    loadProcessLibraryTasks,
    recoverPending,
    readBinding,
    confirmBinding,
    cancelBindingRead,
    recheck,
    createGroup: (...args: Parameters<Engine['createGroup']>) => submit<Awaited<ReturnType<Engine['createGroup']>>>({ kind: 'create-group', draft: args[0] }),
    updateTask: (...args: Parameters<Engine['updateTask']>) => submit<Awaited<ReturnType<Engine['updateTask']>>>({ kind: 'update-task', taskId: args[0], patch: args[1] }),
    updateFloorPlans: (...args: Parameters<Engine['updateFloorPlans']>) => submit<Awaited<ReturnType<Engine['updateFloorPlans']>>>({ kind: 'update-floors', taskId: args[0], patches: [...args[1]] }),
    updateDependency: (...args: Parameters<Engine['updateDependency']>) => submit<Awaited<ReturnType<Engine['updateDependency']>>>({ kind: 'update-dependency', successorId: args[0], predecessorId: args[1], lagDays: args[2] }),
    saveTaskPlan: (...args: Parameters<Engine['saveTaskPlan']>) => submit<Awaited<ReturnType<Engine['saveTaskPlan']>>>({ kind: 'save-task-plan', taskId: args[0], draft: args[1] }),
    rescheduleTask: (...args: Parameters<Engine['rescheduleTask']>) => submit<Awaited<ReturnType<Engine['rescheduleTask']>>>({ kind: 'reschedule-task', taskId: args[0], patch: args[1], dependencyIdsToDisable: [...args[2]] }),
    removeDependency: (...args: Parameters<Engine['removeDependency']>) => submit<Awaited<ReturnType<Engine['removeDependency']>>>({ kind: 'remove-dependency', dependencyId: args[0] }),
    restoreDependency: (...args: Parameters<Engine['restoreDependency']>) => submit<Awaited<ReturnType<Engine['restoreDependency']>>>({ kind: 'restore-dependency', dependencyId: args[0] }),
    setBaseline: (...args: Parameters<Engine['setBaseline']>) => {
      if (args[0] !== scopeProjectId.value)
        return Promise.reject(scheduleProblem('stale-source', '项目已变化，请重新确认基线'))
      return submit<Awaited<ReturnType<Engine['setBaseline']>>>({ kind: 'set-baseline' })
    },
    addTask: (...args: Parameters<Engine['addTask']>) => submit<Awaited<ReturnType<Engine['addTask']>>>({ kind: 'add-task', groupId: args[0], draft: args[1] }),
    removeTask: (...args: Parameters<Engine['removeTask']>) => submit<Awaited<ReturnType<Engine['removeTask']>>>({ kind: 'remove-task', taskId: args[0] }),
    undo: (...args: Parameters<Engine['undo']>) => submit<Awaited<ReturnType<Engine['undo']>>>({ kind: 'undo', logIds: [...args[0]] }),
    previewContractBinding: () => Promise.reject(blockedBinding()),
    bindContract: () => Promise.reject(blockedBinding()),
  }
})
