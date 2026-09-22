import type { PayrollNumberingCommand, PayrollNumberingInput, PayrollNumberingRead, PayrollNumberingResult } from '~/lib/payroll/central-numbering-contract'
import { defineStore } from 'pinia'
import { payrollCanonical } from '~/lib/payroll/central-command-shared'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { decodePayrollNumberingResult, parsePayrollNumberingCommand } from '~/lib/payroll/central-numbering-codec'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'

function keyFor(command: Pick<PayrollNumberingCommand, 'workspaceId' | 'actorId' | 'projectId' | 'statementId'>) {
  return payrollCanonical([command.workspaceId, command.actorId, command.projectId, command.statementId])
}
export const usePayrollNumberingStore = defineStore('payroll-numbering', () => {
  const repository = () => useNuxtApp().$repositories.payroll
  const pending = usePayrollPending('payroll-numbering-pending-v1', keyFor, (command: PayrollNumberingCommand) => {
    parsePayrollNumberingCommand(command)
  }, command => repository().executeNumbering(command), decodePayrollNumberingResult)
  const load = (input: PayrollNumberingInput) => pending.read(() => repository().numbering({ origin: 'real', projectId: input.projectId }, input))
  const getPending = (read: PayrollNumberingRead) => pending.get(keyFor({ ...read.context, ...read.input }))
  async function settle(command: PayrollNumberingCommand, result: PayrollNumberingResult) {
    const read = await load({ projectId: command.projectId, statementId: command.statementId })
    if (read.context.workspaceId !== command.workspaceId || read.context.actorId !== command.actorId)
      throw payrollProblem('forbidden', '回读期间工作区或身份已变化，请保留原提交')
    pending.acknowledge({ command }, [read], receipt => receipt.settings.id === result.settings.id && read.settings?.id === result.settings.id
      && (command.action.kind === 'initialize' ? read.settings.firstNumber === command.action.nextNumber : read.issue?.id === receipt.issue?.id && read.issue?.number === receipt.issue?.number && read.eligibility.canDownload))
    return read
  }
  async function submit(read: PayrollNumberingRead, action: PayrollNumberingCommand['action']) {
    if (read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前身份只能阅读正式工资')
    const command: PayrollNumberingCommand = { schemaVersion: 1, commandId: generateId('payroll-numbering'), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, ...read.input, action }
    return settle(command, await pending.submit(command))
  }
  async function recover(read: PayrollNumberingRead) {
    const original = getPending(read)
    if (!original)
      throw payrollProblem('not-found', '没有需要核对的正式编号提交')
    return settle(original.command, await pending.recover(original))
  }
  return { load, getPending, submit, recover }
})
