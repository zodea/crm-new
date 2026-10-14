import type { CommandRecoveryDescriptor } from '../forms/command-recovery'
import { useSessionStorage } from '@vueuse/core'
import { getActivePinia } from 'pinia'
import { computed, shallowRef, toRaw } from 'vue'
import { useProductionAccessStore } from '../../stores/production-access'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../forms/command-recovery'
import { projectProblemFromUnknown } from '../project/repository'
import { payrollCanonical } from './central-command-shared'
import { payrollProblem } from './central-contract'

/** 成功回执与原命令一并保存，只有原目标后读确认或明确未应用才能解除。 */
export function usePayrollPending<C extends { commandId: string }, R>(storageKey: string, keyFor: (command: C) => string, validate: (command: C) => void, execute: (command: C) => Promise<R>, validateResult: (result: unknown, command: C) => R) {
  // 兼容旧版本仅保存命令的未知提交，不为它补造成功回执。
  type Entry = C | { command: C, result: R }
  type StoredEntry = Entry | CommandRecoveryDescriptor
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  const pending = useSessionStorage<Record<string, StoredEntry>>(storageKey, {}, { flush: 'sync', writeDefaults: false, onError: () => {} })
  const access = getActivePinia() ? useProductionAccessStore() : null
  const minimal = () => access?.status?.mode === 'production'
  const memory = new Map<string, Entry>()
  const restored = new Set<string>()
  const active = shallowRef(new Set<string>())
  const reads = new WeakMap<object, { content: string, receipts: Set<string> }>()
  const commandOf = (entry: Entry): C => 'commandId' in entry ? entry : entry.command
  function isDescriptor(entry: StoredEntry): entry is CommandRecoveryDescriptor {
    return 'family' in entry
  }
  function descriptor(command: C): CommandRecoveryDescriptor {
    const value = command as C & { workspaceId: string, actorId: string, statementId?: string | null, recordId?: string | null, target?: { adjustmentId?: string, eventId?: string, statementId?: string }, action: { kind: string } }
    return { workspaceId: value.workspaceId, actorId: value.actorId, family: 'payroll', commandId: value.commandId, targetId: [value.statementId, value.recordId, value.target?.adjustmentId, value.target?.eventId, value.target?.statementId].find(id => typeof id === 'string') ?? null, action: value.action.kind, scopeId: encodeURIComponent(keyFor(command)) }
  }
  function validateDescriptor(value: CommandRecoveryDescriptor, key: string) {
    const encoded = JSON.stringify(value)
    const original = createCommandRecoveryStorage(() => ({ getItem: () => encoded, setItem() {}, removeItem() {} })).read(commandRecoveryKey(value))
    if (!original || original.family !== 'payroll' || original.scopeId !== encodeURIComponent(key))
      throw payrollProblem('unavailable', '原工资最小恢复上下文无法核实，请保全原记录')
  }
  function validatedEntry(key: string) {
    const stored = pending.value[key]
    if (!stored)
      return null
    if (isDescriptor(stored))
      validateDescriptor(stored, key)
    const entry = isDescriptor(stored) ? memory.get(key) : stored
    if (!entry)
      throw payrollProblem('unavailable', '原工资提交只保留编号，请先恢复当前身份并读取原目标核对')
    const command = commandOf(entry)
    validate(command)
    if (keyFor(command) !== key)
      throw payrollProblem('conflict', '原提交存储目标不一致，请保留输入')
    if (!('commandId' in entry))
      validateResult(entry.result, command)
    if (isDescriptor(stored) && payrollCanonical(descriptor(command)) !== payrollCanonical(stored))
      throw payrollProblem('conflict', '原工资编号与当前恢复动作不一致')
    return entry
  }
  function persist(next: Record<string, StoredEntry>, creating = false) {
    try {
      const storage = window.sessionStorage
      const before = storage.getItem(storageKey)
      if (before !== null && payrollCanonical(JSON.parse(before)) !== payrollCanonical(pending.value))
        throw new Error('原提交已变化')
      const persisted = Object.fromEntries(Object.entries(next).map(([key, entry]) => {
        if (!minimal() || isDescriptor(entry))
          return [key, entry]
        const command = commandOf(entry)
        validate(command)
        if (keyFor(command) !== key)
          throw new Error('原工资存储上下文不匹配')
        memory.set(key, entry)
        return [key, descriptor(command)]
      }))
      const encoded = JSON.stringify(persisted)
      storage.setItem(storageKey, encoded)
      if (storage.getItem(storageKey) !== encoded)
        throw new Error('原提交未保存')
      pending.value = persisted
    }
    catch { throw payrollProblem('unavailable', creating ? '浏览器无法可靠保存原提交，尚未发送，请保留输入' : '原提交存储无法核对，请保留输入并恢复后按原编号核对') }
  }
  function get(key: string): { command: C, state: 'sending' | 'unknown' | 'awaiting-read', restoredFromDescriptor?: boolean } | null {
    const entry = validatedEntry(key)
    if (!entry)
      return null
    const command = commandOf(entry)
    return { command: clone(command), state: active.value.has(command.commandId) ? 'sending' : 'commandId' in entry ? 'unknown' : 'awaiting-read', ...(restored.has(key) ? { restoredFromDescriptor: true } : {}) }
  }
  function clear(command: C) {
    const key = keyFor(command)
    const entry = validatedEntry(key)
    if (!entry || payrollCanonical(commandOf(entry)) !== payrollCanonical(command))
      return
    const next = { ...pending.value }
    delete next[key]
    persist(next)
    memory.delete(key)
    restored.delete(key)
  }
  async function send(command: C) {
    if (active.value.has(command.commandId))
      throw payrollProblem('conflict', '原提交仍在处理中，请勿重复操作')
    validate(command)
    persist({ ...pending.value })
    active.value = new Set([...active.value, command.commandId])
    try {
      const result = validateResult(await execute(clone(command)), command)
      persist({ ...pending.value, [keyFor(command)]: clone({ command, result }) })
      return result
    }
    catch (cause) {
      const problem = projectProblemFromUnknown(cause).problem as { commandId?: string, commandOutcome?: string, code: string }
      const entry = validatedEntry(keyFor(command))
      if (entry && 'commandId' in entry && problem.commandId === command.commandId && problem.commandOutcome === 'not-applied' && ['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found', 'conflict'].includes(problem.code))
        clear(command)
      throw cause
    }
    finally { active.value = new Set([...active.value].filter(id => id !== command.commandId)) }
  }
  function submit(input: C) {
    const command = clone(input)
    validate(command)
    const key = keyFor(command)
    if (get(key))
      throw payrollProblem('conflict', '请先核对原提交结果，再提交新的内容')
    persist({ ...pending.value, [key]: command }, true)
    return send(command)
  }
  async function recover(original: { command: C }) {
    const entry = validatedEntry(keyFor(original.command))
    if (!entry || payrollCanonical(commandOf(entry)) !== payrollCanonical(original.command))
      throw payrollProblem('not-found', '原提交已核对或不属于这份输入')
    if (!minimal())
      return send(commandOf(entry))
    if (active.value.has(original.command.commandId))
      throw payrollProblem('conflict', '原工资提交仍在处理中，请保留原编号')
    if (!('commandId' in entry))
      return clone(entry.result)
    const resolve = useNuxtApp().$repositories.payroll.resolveCommand
    if (!resolve)
      throw payrollProblem('unavailable', '原工资编号的正式恢复接口尚未接通')
    const resolution = await resolve(descriptor(original.command))
    if (resolution.outcome === 'not-applied') {
      clear(original.command)
      throw payrollProblem('conflict', '原工资编号已核实未应用，请保留输入重新读取依据')
    }
    const result = validateResult(resolution.result, original.command)
    memory.set(keyFor(original.command), { command: original.command, result })
    persist({ ...pending.value })
    return result
  }
  async function read<T extends object>(load: () => Promise<T>): Promise<T> {
    // 请求开始前必须已有成功回执，旧的在途读不能冒充提交后的冷读。
    const known = Object.entries(pending.value).map(([key, entry]) => isDescriptor(entry) ? memory.get(key) : entry).filter((entry): entry is Entry => !!entry)
    const receipts = new Set(known.filter(entry => !('commandId' in entry)).map(entry => payrollCanonical(entry)))
    const value = await load()
    if (minimal()) {
      const context = (value as { context?: { workspaceId: string, actorId: string, origin: string, capabilities: string[] } }).context
      persist({ ...pending.value })
      for (const [key, stored] of Object.entries(pending.value)) {
        if (!isDescriptor(stored) || memory.has(key) || !context || context.origin !== 'real' || context.workspaceId !== stored.workspaceId || context.actorId !== stored.actorId || !context.capabilities.includes('payroll:write'))
          continue
        validateDescriptor(stored, key)
        const face = value as Record<string, unknown>
        const scope = JSON.parse(key) as unknown[]
        const has = (field: string) => Object.hasOwn(face, field)
        let matches = false
        if (storageKey.includes('attendance')) {
          const matrix = face.scope as { projectId?: string, month?: string } | undefined
          matches = !!matrix && scope[4] === matrix.projectId && typeof scope[6] === 'string' && scope[6].slice(0, 7) === matrix.month
        }
        else if (storageKey.includes('numbering')) {
          const input = face.input as { projectId?: string, statementId?: string } | undefined
          matches = !!input && scope[2] === input.projectId && scope[3] === input.statementId
        }
        else if (storageKey.includes('batch')) {
          matches = scope[3] === 'plan' ? scope[4] === face.planId : scope[4] === face.projectId && scope[5] === face.month
        }
        else if (storageKey.includes('daywork')) {
          matches = scope[4] === (face.recordId ?? face.draftKey)
        }
        else if (storageKey.includes('adjustments')) {
          matches = has('target') && payrollCanonical(scope[4]) === payrollCanonical(face.target)
        }
        else if (storageKey.includes('hollow')) {
          matches = (has('target') || has('query')) && payrollCanonical(scope[3]) === payrollCanonical(face.target ?? face.query)
        }
        else if (storageKey.includes('rounding')) {
          matches = has('scope') && payrollCanonical(scope[3]) === payrollCanonical(face.scope)
        }
        else {
          const part = storageKey.includes('-c1-') || storageKey.includes('-c2-') ? scope[4] : scope[3]
          matches = (has('scope') || has('statementId') || has('draftKey')) && payrollCanonical(part) === payrollCanonical(face.scope ?? face.statementId ?? face.draftKey)
        }
        if (!matches)
          continue
        const resolve = useNuxtApp().$repositories.payroll.resolveCommand
        if (!resolve)
          throw payrollProblem('unavailable', '原工资编号的正式恢复接口尚未接通')
        const resolution = await resolve(stored)
        if (resolution.outcome === 'not-applied') {
          const next = { ...pending.value }
          delete next[key]
          persist(next)
        }
        else {
          const command = resolution.command as C
          validate(command)
          if (keyFor(command) !== key || payrollCanonical(descriptor(command)) !== payrollCanonical(stored))
            throw payrollProblem('conflict', '恢复出的原工资动作或目标不匹配')
          memory.set(key, { command, result: validateResult(resolution.result, command) })
          restored.add(key)
        }
      }
    }
    reads.set(toRaw(value), { content: payrollCanonical(value), receipts })
    return value
  }
  function acknowledge(original: { command: C }, confirmedReads: object[], matches: (result: R) => boolean) {
    const entry = validatedEntry(keyFor(original.command))
    if (!entry || 'commandId' in entry || active.value.has(original.command.commandId) || payrollCanonical(entry.command) !== payrollCanonical(original.command))
      throw payrollProblem('conflict', '请先按原编号核对提交回执，再读取原目标')
    const receipt = payrollCanonical(entry)
    if (!confirmedReads.length || confirmedReads.some((value) => {
      const evidence = reads.get(toRaw(value))
      return !evidence?.receipts.has(receipt) || evidence.content !== payrollCanonical(value)
    }) || !matches(entry.result)) {
      throw payrollProblem('conflict', '原目标尚未完整读取确认，请保留原输入并重试核对')
    }
    clear(original.command)
  }
  return { get, submit, recover, read, acknowledge, saving: computed(() => active.value.size > 0) }
}
