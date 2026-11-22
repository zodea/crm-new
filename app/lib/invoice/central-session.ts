import type { RecoveryStorage } from '../forms/command-recovery'
import type { CentralInvoiceCommand, CentralInvoiceCommandResult, CentralInvoicePrintCommand, CentralInvoicePrintResult } from './central-contract'
import type { InvoiceDetailRead, InvoicePrintResolution, InvoiceResolution } from './central-http'
import { commandRecoveryKey, commandVersionAtLeast, createCommandRecoveryStorage } from '../forms/command-recovery'
import { CentralInvoiceProblem, CONFIRM_ORIGINAL_VERIFICATION, INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY, RECORD_ORIGINAL_VERIFICATION } from './central-contract'

interface Identity { workspaceId: string, actorId: string }
type Context = Identity & { capabilities: readonly string[] }
export class CentralInvoiceReadInconsistentError extends Error {
  constructor(message = '发票读取来源或权限已变化，请重新读取并核对。') {
    super(message)
    this.name = 'CentralInvoiceReadInconsistentError'
  }
}
export function sameInvoiceCapabilities(left: readonly string[], right: readonly string[]) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && new Set(left).size === left.length && new Set(right).size === right.length
    && left.every(value => typeof value === 'string' && value.trim().length > 0 && right.includes(value))
}
const createActions = ['upload', 'manual', 'import']
const invoiceActions = ['import-replace', 'attach-original', 'link-contract', 'confirm-legacy', 'recognize', 'rerecognize', 'edit', 'review', 'archive', 'edit-archived', 'discard', 'restore', RECORD_ORIGINAL_VERIFICATION, CONFIRM_ORIGINAL_VERIFICATION]
function validInvoicePending(value: { action: string, targetId: string | null, scopeId?: string }) {
  if (value.scopeId !== undefined)
    return value.targetId !== null && ['save-draft', 'submit'].includes(value.action)
  return (value.targetId === null ? createActions : invoiceActions).includes(value.action)
}

/** 仅发现当前工作区及当前用户的发票原命令，不依赖票据仍出现在列表。 */
export function pendingCentralInvoiceCommands(identity: Identity, storage: () => RecoveryStorage = () => globalThis.sessionStorage) {
  try {
    const store = storage()
    const enumerable = store as Partial<Pick<Storage, 'length' | 'key'>>
    if (!Number.isSafeInteger(enumerable.length) || enumerable.length! < 0 || typeof enumerable.key !== 'function')
      throw new Error('无法枚举浏览器存储')
    const prefix = commandRecoveryKey({ ...identity, family: 'finance-invoice', targetId: null }).slice(0, -3)
    const recovery = createCommandRecoveryStorage(() => store)
    const commands = []
    const count = enumerable.length!
    for (let index = 0; index < count; index++) {
      const key = enumerable.key(index)
      if (typeof key !== 'string')
        throw new Error('浏览器存储已变化')
      if (!key.startsWith(prefix))
        continue
      const value = recovery.read(key)
      if (!value || value.family !== 'finance-invoice' || value.workspaceId !== identity.workspaceId || value.actorId !== identity.actorId
        || (value.targetId !== null && !/^[a-z0-9][\w-]{2,79}$/i.test(value.targetId)) || !validInvoicePending(value)) {
        throw new Error('发票原提交身份无效')
      }
      commands.push(value)
    }
    if (enumerable.length !== count)
      throw new Error('浏览器存储已变化')
    return commands.sort((left, right) => left.commandId.localeCompare(right.commandId))
  }
  catch {
    throw new Error('无法可靠核对原提交编号，请保留输入并恢复浏览器存储。')
  }
}
interface Repository {
  execute: (command: CentralInvoiceCommand) => Promise<CentralInvoiceCommandResult>
  resolve: (commandId: string) => Promise<InvoiceResolution>
  get: (invoiceId: string, deleted?: boolean) => Promise<InvoiceDetailRead>
}

/** 浏览器只保存身份与原命令编号；发票字段和原件始终留在当前页面内存。 */
export function createCentralInvoiceSession(options: {
  identity: Identity
  targetId: string | null
  repository: Repository
  context: () => Promise<Context>
  storage?: () => RecoveryStorage
  beforeClear?: (reads: readonly InvoiceDetailRead[]) => void
}) {
  const identity = { workspaceId: options.identity.workspaceId, actorId: options.identity.actorId }
  const scope = { ...identity, family: 'finance-invoice', targetId: options.targetId }
  const key = commandRecoveryKey(scope)
  const recovery = createCommandRecoveryStorage(options.storage)
  let busy = false
  async function authorize() {
    const context = await options.context()
    if (context.workspaceId !== identity.workspaceId || context.actorId !== identity.actorId
      || !sameInvoiceCapabilities(context.capabilities, context.capabilities)
      || !context.capabilities.includes(INVOICE_READ_CAPABILITY) || !context.capabilities.includes(INVOICE_WRITE_CAPABILITY)) {
      throw new CentralInvoiceProblem('forbidden', '当前身份或权限已变化，请恢复原会话后核对原提交。')
    }
    return [...context.capabilities]
  }
  async function confirmRead(result: CentralInvoiceCommandResult, commandId: string, initialCapabilities: readonly string[]) {
    if (result.commandId !== commandId || (scope.targetId !== null && result.invoiceId !== scope.targetId))
      throw new CentralInvoiceReadInconsistentError('原提交回执与当前发票不一致，请保留原编号。')
    const read = await options.repository.get(result.invoiceId, true)
    const finalCapabilities = await authorize()
    if (!sameInvoiceCapabilities(initialCapabilities, finalCapabilities) || !sameInvoiceCapabilities(read.capabilities, finalCapabilities))
      throw new CentralInvoiceReadInconsistentError()
    const pendingAction = recovery.read(key)?.action
    if (read.record.id !== result.invoiceId || !commandVersionAtLeast(read.record.version, result.version)
      || (result.originalId !== null && read.record.original?.id !== result.originalId)
      || (read.record.version === result.version && ((pendingAction === RECORD_ORIGINAL_VERIFICATION && read.verification?.candidateId !== commandId)
        || (pendingAction === CONFIRM_ORIGINAL_VERIFICATION && read.record.originalVerificationId !== commandId)))) {
      throw new CentralInvoiceReadInconsistentError('发票已保存，但尚未可靠回读，请只重试读取。')
    }
    options.beforeClear?.([read])
    recovery.clear(key, commandId)
    return read
  }
  async function guard<T>(operation: () => Promise<T>) {
    if (busy)
      throw new Error('原提交仍在处理中，请稍候。')
    busy = true
    try {
      return await operation()
    }
    finally { busy = false }
  }
  return {
    pending: () => recovery.read(key),
    submit(command: CentralInvoiceCommand, beforeSubmit?: () => boolean) {
      return guard(async () => {
        const initialCapabilities = await authorize()
        if (command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId
          || ('invoiceId' in command ? command.invoiceId : null) !== scope.targetId) {
          throw new Error('发票提交身份或目标已变化，请保留输入。')
        }
        if (beforeSubmit && !beforeSubmit())
          throw new Error(command.action === 'recognize' ? '发票或权限已变化，识别结果未提交。' : '发票或权限已变化，操作未提交。')
        const descriptor = { ...scope, commandId: command.commandId, action: command.action }
        recovery.remember(key, descriptor)
        const result = await options.repository.execute(command)
        const read = await confirmRead(result, command.commandId, initialCapabilities)
        return { result, read }
      })
    },
    recover() {
      return guard(async () => {
        const descriptor = recovery.read(key)
        if (!descriptor)
          return null
        if (!validInvoicePending(descriptor) || descriptor.scopeId !== undefined)
          throw new Error('该发票存在其他待核对操作，请先回原页面核对。')
        const initialCapabilities = await authorize()
        const resolution = await options.repository.resolve(descriptor.commandId)
        if (resolution.outcome === 'not-applied') {
          if (resolution.commandId !== descriptor.commandId)
            throw new Error('原提交核对结果与原编号不一致。')
          if (!sameInvoiceCapabilities(initialCapabilities, await authorize()))
            throw new CentralInvoiceReadInconsistentError()
          recovery.clear(key, descriptor.commandId)
          return { outcome: 'not-applied' as const }
        }
        const read = await confirmRead(resolution.result, descriptor.commandId, initialCapabilities)
        return { outcome: 'applied' as const, result: resolution.result, read }
      })
    },
  }
}

/** 一次打印回执覆盖整批；回读任何一张失败都会保留原任务编号。 */
export function createCentralInvoicePrintSession(options: {
  identity: Identity
  repository: { recordPrinted: (command: CentralInvoicePrintCommand) => Promise<CentralInvoicePrintResult>, resolvePrinted: (commandId: string) => Promise<InvoicePrintResolution>, get: Repository['get'] }
  context: () => Promise<Context>
  storage?: () => RecoveryStorage
  beforeClear?: (reads: readonly InvoiceDetailRead[]) => void
}) {
  const identity = { workspaceId: options.identity.workspaceId, actorId: options.identity.actorId }
  const scope = { ...identity, family: 'finance-invoice-print', targetId: null }
  const key = commandRecoveryKey(scope)
  const recovery = createCommandRecoveryStorage(options.storage)
  let busy = false
  async function authorize() {
    const context = await options.context()
    if (context.workspaceId !== identity.workspaceId || context.actorId !== identity.actorId
      || !sameInvoiceCapabilities(context.capabilities, context.capabilities)
      || !context.capabilities.includes(INVOICE_READ_CAPABILITY) || !context.capabilities.includes(INVOICE_WRITE_CAPABILITY)) {
      throw new CentralInvoiceProblem('forbidden', '当前身份或权限已变化，请恢复原会话后核对打印任务。')
    }
    return [...context.capabilities]
  }
  async function confirmRead(result: CentralInvoicePrintResult, commandId: string, initialCapabilities: readonly string[], beforeClear?: () => boolean) {
    if (result.commandId !== commandId || !result.records.length)
      throw new CentralInvoiceReadInconsistentError('打印回执与原任务不一致，请保留原编号。')
    const reads: InvoiceDetailRead[] = []
    for (const item of result.records) {
      const read = await options.repository.get(item.invoiceId, true)
      if (read.record.id !== item.invoiceId || !commandVersionAtLeast(read.record.version, item.version)
        || read.record.printCount < item.printCount || (read.record.version === item.version && read.record.printRotation !== item.printRotation)) {
        throw new CentralInvoiceReadInconsistentError('打印已记录，但整批尚未可靠回读，请只重试读取。')
      }
      reads.push(read)
    }
    const finalCapabilities = await authorize()
    if (!sameInvoiceCapabilities(initialCapabilities, finalCapabilities)
      || reads.some(read => !sameInvoiceCapabilities(read.capabilities, finalCapabilities)
        || read.sourceVersion !== reads[0]!.sourceVersion
        || read.meta.sources[0]?.sourceVersion !== reads[0]!.meta.sources[0]?.sourceVersion)) {
      throw new CentralInvoiceReadInconsistentError()
    }
    options.beforeClear?.(reads)
    if (beforeClear && !beforeClear())
      throw new CentralInvoiceReadInconsistentError('打印登记已发送，原编号仍保留，请回原来源核对。')
    recovery.clear(key, commandId)
    return reads
  }
  async function guard<T>(operation: () => Promise<T>) {
    if (busy)
      throw new Error('原打印任务仍在处理中，请稍候。')
    busy = true
    try {
      return await operation()
    }
    finally { busy = false }
  }
  return {
    pending: () => recovery.read(key),
    submit(command: CentralInvoicePrintCommand, beforeSubmit?: () => boolean, beforeClear?: () => boolean) {
      return guard(async () => {
        const initialCapabilities = await authorize()
        if (command.workspaceId !== identity.workspaceId || command.actorId !== identity.actorId)
          throw new Error('打印任务身份已变化，请保留原任务。')
        if (beforeSubmit && !beforeSubmit())
          throw new Error('打印记录未提交，纸张可能已输出，请先人工核对。')
        recovery.remember(key, { ...scope, commandId: command.commandId, action: command.action })
        const result = await options.repository.recordPrinted(command)
        return { result, reads: await confirmRead(result, command.commandId, initialCapabilities, beforeClear) }
      })
    },
    recover() {
      return guard(async () => {
        const descriptor = recovery.read(key)
        if (!descriptor)
          return null
        const initialCapabilities = await authorize()
        const resolution = await options.repository.resolvePrinted(descriptor.commandId)
        if (resolution.outcome === 'not-applied') {
          if (resolution.commandId !== descriptor.commandId)
            throw new Error('打印核对结果与原编号不一致。')
          if (!sameInvoiceCapabilities(initialCapabilities, await authorize()))
            throw new CentralInvoiceReadInconsistentError()
          recovery.clear(key, descriptor.commandId)
          return { outcome: 'not-applied' as const }
        }
        const reads = await confirmRead(resolution.result, descriptor.commandId, initialCapabilities)
        return { outcome: 'applied' as const, result: resolution.result, reads }
      })
    },
  }
}
