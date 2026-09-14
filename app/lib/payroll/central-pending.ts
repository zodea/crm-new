import { useSessionStorage } from '@vueuse/core'
import { computed, shallowRef, toRaw } from 'vue'
import { projectProblemFromUnknown } from '../project/repository'
import { payrollCanonical } from './central-command-shared'
import { payrollProblem } from './central-contract'

/** 成功回执与原命令一并保存，只有原目标后读确认或明确未应用才能解除。 */
export function usePayrollPending<C extends { commandId: string }, R>(storageKey: string, keyFor: (command: C) => string, validate: (command: C) => void, execute: (command: C) => Promise<R>, validateResult: (result: unknown, command: C) => R) {
  // 兼容旧版本仅保存命令的未知提交，不为它补造成功回执。
  type Entry = C | { command: C, result: R }
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  const pending = useSessionStorage<Record<string, Entry>>(storageKey, {}, { flush: 'sync', writeDefaults: false, onError: () => {} })
  const active = shallowRef(new Set<string>())
  const reads = new WeakMap<object, { content: string, receipts: Set<string> }>()
  const commandOf = (entry: Entry): C => 'commandId' in entry ? entry : entry.command
  function validatedEntry(key: string) {
    const entry = pending.value[key]
    if (!entry)
      return null
    const command = commandOf(entry)
    validate(command)
    if (keyFor(command) !== key)
      throw payrollProblem('conflict', '原提交存储目标不一致，请保留输入')
    if (!('commandId' in entry))
      validateResult(entry.result, command)
    return entry
  }
  function persist(next: Record<string, Entry>, creating = false) {
    try {
      const storage = window.sessionStorage
      const before = storage.getItem(storageKey)
      if (before !== null && payrollCanonical(JSON.parse(before)) !== payrollCanonical(pending.value))
        throw new Error('原提交已变化')
      const encoded = JSON.stringify(next)
      storage.setItem(storageKey, encoded)
      if (storage.getItem(storageKey) !== encoded)
        throw new Error('原提交未保存')
      pending.value = next
    }
    catch { throw payrollProblem('unavailable', creating ? '浏览器无法可靠保存原提交，尚未发送，请保留输入' : '原提交存储无法核对，请保留输入并恢复后按原编号核对') }
  }
  function get(key: string): { command: C, state: 'sending' | 'unknown' | 'awaiting-read' } | null {
    const entry = validatedEntry(key)
    if (!entry)
      return null
    const command = commandOf(entry)
    return { command: clone(command), state: active.value.has(command.commandId) ? 'sending' : 'commandId' in entry ? 'unknown' : 'awaiting-read' }
  }
  function clear(command: C) {
    const key = keyFor(command)
    const entry = validatedEntry(key)
    if (!entry || payrollCanonical(commandOf(entry)) !== payrollCanonical(command))
      return
    const next = { ...pending.value }
    delete next[key]
    persist(next)
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
  function recover(original: { command: C }) {
    const entry = validatedEntry(keyFor(original.command))
    if (!entry || payrollCanonical(commandOf(entry)) !== payrollCanonical(original.command))
      throw payrollProblem('not-found', '原提交已核对或不属于这份输入')
    return send(commandOf(entry))
  }
  async function read<T extends object>(load: () => Promise<T>): Promise<T> {
    // 请求开始前必须已有成功回执，旧的在途读不能冒充提交后的冷读。
    const receipts = new Set(Object.values(pending.value).filter(entry => !('commandId' in entry)).map(entry => payrollCanonical(entry)))
    const value = await load()
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
