import type { PayrollQuery } from '~/lib/payroll/central-contract'
import type { PayrollHollowAction, PayrollHollowCommand, PayrollHollowConfigQuery, PayrollHollowConfigRead, PayrollHollowPolicyDraft, PayrollHollowRead } from '~/lib/payroll/central-hollow-deduction-contract'
import { defineStore } from 'pinia'
import { payrollACanonical } from '~/lib/payroll/central-a-calculation'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { decodePayrollHollowResult, encodePayrollHollowWire, parsePayrollHollowCommand } from '~/lib/payroll/central-hollow-deduction-codec'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'

type Read = PayrollHollowRead | PayrollHollowConfigRead
export const usePayrollHollowStore = defineStore('payroll-hollow-central', () => {
  const repositories = () => useNuxtApp().$repositories
  const keyFor = (command: Pick<PayrollHollowCommand, 'workspaceId' | 'actorId' | 'origin' | 'target' | 'config'>) => payrollACanonical([command.workspaceId, command.actorId, command.origin, command.target ?? command.config])
  const readKey = (read: Read) => keyFor({ ...read.context, target: 'target' in read ? read.target : null, config: 'query' in read ? read.query : null })
  const pending = usePayrollPending('payroll-hollow-central-pending-v1', keyFor, (command: PayrollHollowCommand) => {
    parsePayrollHollowCommand(encodePayrollHollowWire(command))
  }, command => repositories().payroll.executeHollow(command), decodePayrollHollowResult)
  const getPending = (read: Read) => pending.get(readKey(read))
  async function identity(expected: { workspaceId: string, actorId: string }) {
    const context = await repositories().projectCommands.context()
    if (context.workspaceId !== expected.workspaceId || context.actorId !== expected.actorId || !context.capabilities.includes('payroll:read') || !context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前身份或权限不能处理这份原空鼓扣款提交')
  }
  async function execute(read: Read, action: PayrollHollowAction) {
    if (read.context.origin !== 'real' || read.context.readonly || !read.context.capabilities.includes('payroll:write') || getPending(read))
      throw payrollProblem('forbidden', '请先核对原提交及当前写入资格')
    const scope = 'query' in read ? read.query.scope : read.scope
    if (!scope || ('query' in read ? !read.eligibility.canSave : read.state !== 'available' || !read.target.statementId || !read.eligibility.canStart))
      throw payrollProblem('unavailable', '当前扣款依据尚未满足，请先核对来源与资格说明')
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    await identity(read.context)
    const command: PayrollHollowCommand = { workspaceId, actorId, origin, sourceVersion, commandId: generateId('payroll-hollow-command'), requiredCapability: 'payroll:write', projectId: scope.projectId, target: 'target' in read ? read.target : null, config: 'query' in read ? read.query : null, action }
    return pending.submit(command)
  }
  function acknowledge(original: { command: PayrollHollowCommand }, read: Read) {
    const command = original.command
    pending.acknowledge(original, [read], (result) => {
      const context = read.context
      if (context.workspaceId !== command.workspaceId || context.actorId !== command.actorId || context.origin !== command.origin || context.readonly || !context.capabilities.includes('payroll:read') || !context.capabilities.includes('payroll:write') || readKey(read) !== keyFor(command))
        return false
      if (command.action.kind === 'save-hollow-policies') {
        const policies = command.action.policies
        return 'query' in read && result.policyRevisionIds.every(id => read.revisions.some(revision => revision.id === id && revision.commandId === command.commandId && payrollACanonical(revision.scope) === payrollACanonical(command.config?.scope) && policies.some(policy => policy.itemId === revision.itemId && policy.baseRevisionId === revision.previousRevisionId && policy.enabled === revision.enabled && policy.unitAmount === revision.unitAmount && policy.effectiveMonth === revision.effectiveMonth)))
      }
      return 'target' in read && read.state === 'available' && read.scope?.projectId === command.projectId && read.starts.some(start => start.id === result.startId && start.commandId === command.commandId && start.statementId === command.target?.statementId && start.projectId === command.projectId && payrollACanonical(start.scope) === payrollACanonical(read.scope))
    })
  }
  async function recover(original: { command: PayrollHollowCommand }) {
    await identity(original.command)
    return pending.recover(original)
  }
  return {
    getPending,
    acknowledge,
    recover,
    saving: pending.saving,
    loadConfig: (query: PayrollQuery, config: PayrollHollowConfigQuery) => pending.read(() => repositories().payroll.hollowConfig(query, config)),
    loadStatement: (query: PayrollQuery, format: 'A' | 'C1' | 'C2', statementId: string) => pending.read(async () => {
      const repository = repositories().payroll
      const result = format === 'A' ? await repository.aForm(query, { statementId }) : format === 'C1' ? await repository.c1Form(query, { statementId }) : await repository.c2Form(query, { statementId })
      if (!result.hollow || result.hollow.target.statementId !== statementId || result.hollow.context.origin !== query.origin || (result.hollow.scope && result.hollow.scope.formatFamily !== format))
        throw payrollProblem('unavailable', '原工资空鼓扣款依据尚未完整读取')
      return result.hollow
    }),
    savePolicies: (read: PayrollHollowConfigRead, policies: PayrollHollowPolicyDraft[]) => execute(read, { kind: 'save-hollow-policies', policies }),
    start: (read: PayrollHollowRead) => execute(read, { kind: 'start-hollow-deduction' }),
  }
})
