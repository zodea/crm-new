import type { PayrollARoundingCommand, PayrollARoundingCommandResult, PayrollARoundingRead, PayrollARoundingScope } from '~/lib/payroll/central-a-rounding-contract'
import type { PayrollARoundingRule } from '~/lib/payroll/central-batch-contract'
import type { PayrollContext, PayrollQuery } from '~/lib/payroll/central-contract'
import { defineStore } from 'pinia'
import { decodePayrollARoundingResult, parsePayrollARoundingCommand } from '~/lib/payroll/central-a-rounding-codec'
import { payrollCanonical } from '~/lib/payroll/central-command-shared'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'

const storageKey = 'payroll-a-rounding-central-pending-v1'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function keyFor(command: PayrollARoundingCommand): string {
  return payrollCanonical([command.workspaceId, command.actorId, command.origin, command.scope])
}

export const usePayrollARoundingStore = defineStore('payroll-a-rounding-central', () => {
  const repository = () => useNuxtApp().$repositories.payroll
  const pending = usePayrollPending(
    storageKey,
    keyFor,
    (command: PayrollARoundingCommand) => { parsePayrollARoundingCommand(command) },
    command => repository().executeARounding(command),
    decodePayrollARoundingResult,
  )

  function scopeKey(context: Pick<PayrollContext, 'workspaceId' | 'actorId' | 'origin'>, scope: PayrollARoundingScope): string {
    return payrollCanonical([context.workspaceId, context.actorId, context.origin, scope])
  }

  function getPending(read: PayrollARoundingRead) {
    return pending.get(scopeKey(read.context, read.scope))
  }

  function load(query: PayrollQuery, scope: PayrollARoundingScope): Promise<PayrollARoundingRead> {
    return pending.read(() => repository().aRounding(query, scope))
  }

  async function settle(command: PayrollARoundingCommand, result: PayrollARoundingCommandResult): Promise<PayrollARoundingRead> {
    const refreshed = await load({ origin: command.origin, projectId: command.scope.projectId, month: command.scope.month }, command.scope)
    pending.acknowledge({ command }, [refreshed], receipt => receipt.revision.id === result.revision.id && refreshed.current?.id === result.revision.id)
    return refreshed
  }

  async function save(read: PayrollARoundingRead, rule: PayrollARoundingRule): Promise<PayrollARoundingRead> {
    if (read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前 A 工资取整规则只能阅读')
    if (getPending(read))
      throw payrollProblem('conflict', '请先核对原取整规则提交')
    const command: PayrollARoundingCommand = { schemaVersion: 1, commandId: generateId('payroll-a-rounding'), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: read.context.origin, requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, scope: clone(read.scope), action: { kind: 'save-a-rounding', rule: clone(rule) } }
    return settle(command, await pending.submit(command))
  }

  async function recover(read: PayrollARoundingRead): Promise<PayrollARoundingRead> {
    const original = getPending(read)
    if (!original)
      throw payrollProblem('not-found', '没有需要恢复的取整规则提交')
    return settle(original.command, await pending.recover(original))
  }

  return { saving: pending.saving, load, save, recover, getPending }
})
