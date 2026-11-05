import type { RecoveryStorage } from '../forms/command-recovery'
import type { InvoiceCorrectionDraft, InvoiceCorrectionResolutionRequest, InvoiceCorrectionResult, InvoiceCorrectionSaveCommand, InvoiceCorrectionSubmitCommand, InvoiceCorrectionSubmitResult } from './correction-contract'
import { commandRecoveryKey, commandVersionAtLeast, createCommandRecoveryStorage } from '../forms/command-recovery'
import { CentralInvoiceProblem, INVOICE_WRITE_CAPABILITY } from './central-contract'

interface Identity { workspaceId: string, actorId: string }
interface Context extends Identity { capabilities: readonly string[] }
interface Repository {
  save: (command: InvoiceCorrectionSaveCommand) => Promise<InvoiceCorrectionResult>
  submit: (command: InvoiceCorrectionSubmitCommand) => Promise<InvoiceCorrectionSubmitResult>
  get: (id: string) => Promise<InvoiceCorrectionDraft>
  resolve: (request: InvoiceCorrectionResolutionRequest) => Promise<{ outcome: 'applied', result: InvoiceCorrectionResult | InvoiceCorrectionSubmitResult } | { outcome: 'not-applied', commandId: string }>
}

/** 原编号在结果核实和发票及更正单回读前始终保留；不持久化输入或附件。 */
export function createInvoiceCorrectionSession(options: { identity: Identity, invoiceId: string, repository: Repository, invoiceVersion: () => Promise<string>, context: () => Promise<Context>, storage?: () => RecoveryStorage }) {
  const scope = { workspaceId: options.identity.workspaceId, actorId: options.identity.actorId, family: 'finance-invoice', targetId: options.invoiceId }
  const key = commandRecoveryKey(scope)
  const recovery = createCommandRecoveryStorage(options.storage)
  let busy = false
  async function authorize() {
    const actor = await options.context()
    if (actor.workspaceId !== scope.workspaceId || actor.actorId !== scope.actorId || !actor.capabilities.includes(INVOICE_WRITE_CAPABILITY))
      throw new CentralInvoiceProblem('forbidden', '身份或权限已变化，请恢复原身份后核对原提交。')
  }
  async function confirmRead(result: InvoiceCorrectionResult | InvoiceCorrectionSubmitResult, commandId: string) {
    if (result.commandId !== commandId || result.invoiceId !== scope.targetId)
      throw new Error('原回执与发票不一致，请保留原编号。')
    const correction = await options.repository.get(result.correctionId)
    if (correction.invoiceId !== scope.targetId || !commandVersionAtLeast(correction.version, result.version))
      throw new Error('更正已保存，但尚未可靠回读，请只重试读取。')
    if ('invoiceVersion' in result && (!commandVersionAtLeast(await options.invoiceVersion(), result.invoiceVersion) || correction.state !== 'submitted' || correction.resultInvoiceVersion !== result.invoiceVersion))
      throw new Error('更正已提交，但发票或更正单尚未可靠回读，请只重试读取。')
    await authorize()
    recovery.clear(key, commandId)
    return correction
  }
  async function guarded<T>(work: () => Promise<T>) {
    if (busy)
      throw new Error('原更正仍在处理中。')
    busy = true
    try {
      return await work()
    }
    finally { busy = false }
  }
  return {
    pending: () => recovery.read(key),
    execute(command: InvoiceCorrectionSaveCommand | InvoiceCorrectionSubmitCommand) {
      return guarded(async () => {
        await authorize()
        if (command.workspaceId !== scope.workspaceId || command.actorId !== scope.actorId || command.invoiceId !== scope.targetId)
          throw new Error('更正提交身份或目标已变化。')
        recovery.remember(key, { ...scope, action: command.action, commandId: command.commandId, scopeId: command.correctionId ?? 'new' })
        const result = command.action === 'save-draft' ? await options.repository.save(command) : await options.repository.submit(command)
        return { result, correction: await confirmRead(result, command.commandId) }
      })
    },
    recover() {
      return guarded(async () => {
        const pending = recovery.read(key)
        if (!pending)
          return null
        if (!['save-draft', 'submit'].includes(pending.action) || !pending.scopeId)
          throw new Error('该发票存在其他待核对操作，请先回原页面核对。')
        await authorize()
        const request: InvoiceCorrectionResolutionRequest = { workspaceId: scope.workspaceId, actorId: scope.actorId, commandId: pending.commandId, action: pending.action as InvoiceCorrectionResolutionRequest['action'], invoiceId: scope.targetId, correctionId: pending.scopeId === 'new' ? null : pending.scopeId }
        const resolution = await options.repository.resolve(request)
        if (resolution.outcome === 'not-applied') {
          await authorize()
          recovery.clear(key, pending.commandId)
          return { outcome: 'not-applied' as const }
        }
        return { outcome: 'applied' as const, result: resolution.result, correction: await confirmRead(resolution.result, pending.commandId) }
      })
    },
  }
}
