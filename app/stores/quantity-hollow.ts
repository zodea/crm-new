import type { QuantityContext, QuantityUnitReadQuery } from '~/lib/quantity/central-contract'
import type { QuantityHollowAction, QuantityHollowCommand, QuantityHollowCommandResult, QuantityHollowRead } from '~/lib/quantity/central-hollow-contract'
import { useSessionStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, shallowRef, toRaw } from 'vue'
import { quantityProblem } from '~/lib/quantity/central-contract'
import { decodeQuantityHollowCommand, quantityHollowReceiptObserved } from '~/lib/quantity/central-hollow-codec'
import { parseQuantityHollowCommand } from '~/lib/quantity/central-hollow-validation'
import { quantityProblemFromUnknown } from '~/lib/quantity/central-repository'
import { generateId } from '~/lib/util/id'

interface StoredOperation {
  unitId: string
  command: QuantityHollowCommand
  result?: QuantityHollowCommandResult
}
export interface QuantityHollowPending {
  unitId: string
  command: QuantityHollowCommand
  state: 'sending' | 'unknown' | 'awaiting-read'
}
export interface QuantityHollowDraftFields {
  target: string
  inspectedOn: string
  rectifiedOn: string
  count: string
  note: string
  reason: string
}
export interface QuantityHollowDraftCache { fields: QuantityHollowDraftFields, baseline: string, sourceVersion: string, revisionId: string | null }
const storageKey = 'quantity-hollow-pending-v1'
const serialize = (value: unknown) => JSON.stringify(value)
const clone = <T>(value: T): T => JSON.parse(serialize(value))
const operationKey = (value: StoredOperation) => serialize([value.command.workspaceId, value.command.actorId, value.command.origin, value.command.projectId, value.unitId])
const readKey = (read: QuantityHollowRead) => serialize([read.context.workspaceId, read.context.actorId, read.dataOrigin, read.data.projectId, read.data.unitId])

/** 每户独立原提交槽位；回执和后读核对前绝不因换页或重新读取清空。 */
export const useQuantityHollowStore = defineStore('quantity-hollow', () => {
  const repositories = useNuxtApp().$repositories
  const operations = useSessionStorage<Record<string, StoredOperation>>(storageKey, {}, { flush: 'sync', writeDefaults: false, onError: () => {} })
  const drafts = useSessionStorage<Record<string, QuantityHollowDraftCache>>('quantity-hollow-drafts-v1', {}, { flush: 'sync', writeDefaults: false, onError: () => {} })
  const active = shallowRef(new Set<string>())
  const identity = shallowRef<QuantityContext | null>(null)
  const reads = new WeakMap<object, { content: string, receipts: Set<string> }>()
  let identitySequence = 0

  function stored(key: string): StoredOperation | null {
    const cached = operations.value[key]
    if (!cached)
      return null
    const value = clone(cached)
    parseQuantityHollowCommand(value.command)
    if (typeof value.unitId !== 'string' || !value.unitId || operationKey(value) !== key || (value.command.action.kind === 'create-hollow-inspection' && value.command.action.target.unitId !== value.unitId))
      throw quantityProblem('conflict', '原空鼓提交的目标身份不一致，请保留输入')
    if (value.result && decodeQuantityHollowCommand(value.result, value.command).hollow.unitId !== value.unitId)
      throw quantityProblem('conflict', '原空鼓回执与户身份不一致，请保留输入')
    return value
  }
  function getDraft(key: string) {
    const value = drafts.value[key]
    return value ? clone(value) : null
  }
  function rememberDraft(key: string, value: QuantityHollowDraftCache) {
    drafts.value = { ...drafts.value, [key]: clone(value) }
  }
  function discardDraft(key: string) {
    const next = { ...drafts.value }
    delete next[key]
    drafts.value = next
  }
  function persist(next: Record<string, StoredOperation>) {
    try {
      const before = window.sessionStorage.getItem(storageKey)
      if (before !== null && serialize(JSON.parse(before)) !== serialize(operations.value))
        throw new Error('原提交已变化')
      const encoded = serialize(next)
      window.sessionStorage.setItem(storageKey, encoded)
      if (window.sessionStorage.getItem(storageKey) !== encoded)
        throw new Error('原提交未保存')
      operations.value = next
    }
    catch { throw quantityProblem('unavailable', '无法可靠保存原空鼓提交，请保留输入；尚未发送的操作不会提交') }
  }
  async function currentIdentity() {
    const request = ++identitySequence
    identity.value = null
    const current = await repositories.projectCommands.context()
    if (request === identitySequence)
      identity.value = current
    return current
  }
  function sameIdentity(context: QuantityContext, expected: Pick<QuantityContext, 'workspaceId' | 'actorId'>, write = false) {
    return context.workspaceId === expected.workspaceId && context.actorId === expected.actorId
      && context.capabilities.includes('quantity:read') && (!write || context.capabilities.includes('quantity:write'))
  }
  function getPending(read: QuantityHollowRead): QuantityHollowPending | null {
    if (!identity.value || !sameIdentity(identity.value, read.context))
      return null
    const value = stored(readKey(read))
    return value ? { unitId: value.unitId, command: clone(value.command), state: active.value.has(value.command.commandId) ? 'sending' : value.result ? 'awaiting-read' : 'unknown' } : null
  }
  async function load(query: QuantityUnitReadQuery, options: { signal?: AbortSignal } = {}) {
    const receipts = new Set(Object.values(operations.value).filter(value => value.result).map(serialize))
    const [read, context] = await Promise.all([repositories.quantity.hollow({ ...query }, options), currentIdentity()])
    options.signal?.throwIfAborted()
    if (!sameIdentity(context, read.context) || read.data.projectId !== query.projectId || read.data.unitId !== query.unitId || read.dataOrigin !== query.origin || serialize([...context.capabilities].sort()) !== serialize([...read.context.capabilities].sort()))
      throw quantityProblem('relationship-mismatch', '空鼓读取的身份、权限或原户与当前页面不一致')
    reads.set(toRaw(read), { content: serialize(read), receipts })
    return read
  }
  function originalEntry(original: Pick<QuantityHollowPending, 'unitId' | 'command'>) {
    const entry = stored(operationKey(original))
    if (!entry || serialize(entry.command) !== serialize(original.command))
      throw quantityProblem('conflict', '原空鼓提交已改变或不属于当前目标，请保留输入')
    return entry
  }
  function clear(entry: StoredOperation) {
    originalEntry(entry)
    const next = { ...operations.value }
    delete next[operationKey(entry)]
    persist(next)
  }
  async function send(entry: StoredOperation) {
    const command = clone(entry.command)
    const key = operationKey(entry)
    if (active.value.has(command.commandId))
      throw quantityProblem('conflict', '原空鼓提交仍在处理中')
    active.value = new Set([...active.value, command.commandId])
    try {
      const result = decodeQuantityHollowCommand(await repositories.quantity.execute(command), command)
      if (result.hollow.unitId !== entry.unitId)
        throw quantityProblem('relationship-mismatch', '保存回执不是原户，请保留原提交')
      originalEntry(entry)
      persist({ ...operations.value, [key]: { unitId: entry.unitId, command, result } })
      return result
    }
    catch (cause) {
      const problem = quantityProblemFromUnknown(cause).problem as { commandId?: string, commandOutcome?: string, code: string }
      if (!stored(key)?.result && problem.commandId === command.commandId && problem.commandOutcome === 'not-applied' && ['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found', 'conflict'].includes(problem.code))
        clear(entry)
      throw cause
    }
    finally { active.value = new Set([...active.value].filter(id => id !== command.commandId)) }
  }
  async function submit(read: QuantityHollowRead, action: QuantityHollowAction) {
    if (reads.get(toRaw(read))?.content !== serialize(read) || read.dataOrigin !== 'real' || !sameIdentity(await currentIdentity(), read.context, true))
      throw quantityProblem('forbidden', '请先读取当前有写入权限的正式原户')
    if (stored(readKey(read)))
      throw quantityProblem('conflict', '请先核对原空鼓提交，再保存新的输入')
    const eligible = action.kind === 'create-hollow-inspection'
      ? read.data.targets.find(value => serialize(value.target) === serialize(action.target))?.create.allowed
      : read.data.records.find(value => value.recordId === action.recordId)?.eligibility[action.kind === 'revise-hollow-inspection' ? 'revise' : 'rectify'].allowed
    if (!eligible)
      throw quantityProblem('forbidden', '当前原责任或记录没有此操作资格，请重新核对')
    const command = parseQuantityHollowCommand({ workspaceId: read.context.workspaceId, actorId: read.context.actorId, commandId: generateId('quantity-hollow-command'), requiredCapability: 'quantity:write', origin: read.dataOrigin, projectId: read.data.projectId, baseVersion: read.sourceVersion, action: clone(action) })
    const entry = { unitId: read.data.unitId, command }
    persist({ ...operations.value, [operationKey(entry)]: entry })
    return send(entry)
  }
  async function recover(original: Pick<QuantityHollowPending, 'unitId' | 'command'>) {
    const entry = originalEntry(original)
    if (entry.command.origin !== 'real' || !sameIdentity(await currentIdentity(), entry.command, true))
      throw quantityProblem('forbidden', '当前身份不能核对这份原空鼓提交')
    return send(entry)
  }
  function acknowledge(original: Pick<QuantityHollowPending, 'unitId' | 'command'>, read: QuantityHollowRead) {
    const entry = originalEntry(original)
    const evidence = reads.get(toRaw(read))
    if (!entry.result || active.value.has(entry.command.commandId) || !identity.value || !sameIdentity(identity.value, entry.command, true)
      || !sameIdentity(read.context, entry.command, true) || readKey(read) !== operationKey(entry)
      || evidence?.content !== serialize(read) || !evidence.receipts.has(serialize(entry)) || !quantityHollowReceiptObserved(read, entry.command, entry.result)) {
      throw quantityProblem('conflict', '原空鼓记录尚未完整读取确认，请保留输入并核对原提交')
    }
    clear(entry)
  }
  return { load, getPending, submit, recover, acknowledge, getDraft, rememberDraft, discardDraft, saving: computed(() => active.value.size > 0) }
})
