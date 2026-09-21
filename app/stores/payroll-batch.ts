import type { PayrollBatchCommand, PayrollBatchConfirmCommand, PayrollBatchConfirmInput, PayrollBatchPlanRead, PayrollBatchPreviewInput, PayrollBatchPreviewRead } from '~/lib/payroll/central-batch-service-contract'
import type { PayrollContext, PayrollQuery } from '~/lib/payroll/central-contract'
import { useSessionStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import { decodePayrollBatchPlan, parsePayrollBatchCommand } from '~/lib/payroll/central-batch-codec'
import { payrollCanonical } from '~/lib/payroll/central-command-shared'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'

export interface PayrollBatchDraft {
  planId?: string
  purpose: 'check' | 'release'
  statementIds: string[]
  fundingInput: string
  amounts: Record<string, string>
  allocations: Record<string, Record<string, string>>
}

const storageKey = 'payroll-batch-central-pending-v1'
const draftStorageKey = 'payroll-batch-central-drafts-v1'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function commandKey(command: PayrollBatchCommand): string {
  const target = command.action.kind === 'confirm-batch'
    ? ['scope', command.action.input.projectId, command.action.input.month]
    : ['plan', command.action.input.planId]
  return payrollCanonical([command.workspaceId, command.actorId, command.origin, ...target])
}

function resultQuery(command: PayrollBatchCommand): PayrollQuery {
  return command.action.kind === 'confirm-batch'
    ? { origin: command.origin, projectId: command.action.input.projectId, month: command.action.input.month }
    : { origin: command.origin }
}

export const usePayrollBatchStore = defineStore('payroll-batch-central', () => {
  const repository = () => useNuxtApp().$repositories.payroll
  const drafts = useSessionStorage<Record<string, PayrollBatchDraft>>(draftStorageKey, {}, { flush: 'sync', writeDefaults: false, onError: () => {} })
  const pending = usePayrollPending(
    storageKey,
    commandKey,
    (command: PayrollBatchCommand) => { parsePayrollBatchCommand(command) },
    command => repository().executeBatch(command),
    (value, command) => decodePayrollBatchPlan(value, resultQuery(command), command.action.kind === 'confirm-batch' ? undefined : command.action.input.planId, command),
  )

  function draftKey(context: Pick<PayrollContext, 'workspaceId' | 'actorId' | 'origin'>, projectId: string, month: string, statementIds: string[]): string {
    return payrollCanonical([context.workspaceId, context.actorId, context.origin, projectId, month, [...statementIds].sort()])
  }

  function getDraft(context: Pick<PayrollContext, 'workspaceId' | 'actorId' | 'origin'>, projectId: string, month: string, statementIds: string[]): PayrollBatchDraft | null {
    return clone(drafts.value[draftKey(context, projectId, month, statementIds)] ?? null)
  }

  function rememberDraft(context: Pick<PayrollContext, 'workspaceId' | 'actorId' | 'origin'>, projectId: string, month: string, draft: PayrollBatchDraft): void {
    drafts.value = { ...drafts.value, [draftKey(context, projectId, month, draft.statementIds)]: clone(draft) }
  }

  function discardDraft(context: Pick<PayrollContext, 'workspaceId' | 'actorId' | 'origin'>, projectId: string, month: string, statementIds: string[]): void {
    const next = { ...drafts.value }
    delete next[draftKey(context, projectId, month, statementIds)]
    drafts.value = next
  }

  async function settle(command: PayrollBatchCommand, result: PayrollBatchPlanRead): Promise<PayrollBatchPlanRead> {
    const query = { origin: command.origin, projectId: result.projectId, month: result.month }
    const refreshed = await pending.read(() => repository().batch(query, result.planId))
    pending.acknowledge({ command }, [refreshed], saved => saved.planId === refreshed.planId && saved.planVersion === refreshed.planVersion)
    return refreshed
  }

  async function submit(command: PayrollBatchCommand): Promise<PayrollBatchPlanRead> {
    return settle(command, await pending.submit(command))
  }

  async function preview(query: PayrollQuery, input: PayrollBatchPreviewInput): Promise<PayrollBatchPreviewRead> {
    return repository().batchPreview(query, input)
  }

  async function loadPlan(query: PayrollQuery, planId: string): Promise<PayrollBatchPlanRead> {
    return pending.read(() => repository().batch(query, planId))
  }

  async function confirm(read: PayrollBatchPreviewRead, input: PayrollBatchConfirmInput): Promise<PayrollBatchPlanRead> {
    if (read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前工资资料只能阅读')
    const command: PayrollBatchConfirmCommand = { schemaVersion: 1, commandId: generateId('payroll-batch-confirm'), workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: read.context.origin, requiredCapability: 'payroll:write', action: { kind: 'confirm-batch', input: clone(input) } }
    return submit(command)
  }

  async function prepare(plan: PayrollBatchPlanRead): Promise<PayrollBatchPlanRead> {
    const executeCommandId = generateId('payroll-batch-execute')
    const command: PayrollBatchCommand = { schemaVersion: 1, commandId: generateId('payroll-batch-prepare'), workspaceId: plan.context.workspaceId, actorId: plan.context.actorId, origin: plan.context.origin, requiredCapability: 'payroll:write', action: { kind: 'prepare-batch-item', input: { planId: plan.planId, planVersion: plan.planVersion, executeCommandId } } }
    return executePrepared(await submit(command))
  }

  async function executePrepared(plan: PayrollBatchPlanRead): Promise<PayrollBatchPlanRead> {
    const saved = await repository().batch({ origin: plan.context.origin, projectId: plan.projectId, month: plan.month }, plan.planId)
    if (saved.state !== 'prepared')
      throw payrollProblem('conflict', '当前批次没有待恢复的已准备原单')
    if (!saved.preparedExecuteCommandId)
      throw payrollProblem('unavailable', '已准备项缺少原执行编号，不能更换编号继续')
    const command: PayrollBatchCommand = { schemaVersion: 1, commandId: saved.preparedExecuteCommandId, workspaceId: saved.context.workspaceId, actorId: saved.context.actorId, origin: saved.context.origin, requiredCapability: 'payroll:write', action: { kind: 'execute-batch-original', input: { planId: saved.planId, planVersion: saved.planVersion } } }
    return submit(command)
  }

  function advance(plan: PayrollBatchPlanRead): Promise<PayrollBatchPlanRead> {
    const original = pendingForPlan(plan)
    if (original)
      return recover(original)
    if (plan.state === 'prepared')
      return executePrepared(plan)
    if (plan.state === 'ready')
      return prepare(plan)
    throw payrollProblem('conflict', '当前批次不需要继续执行')
  }

  function pendingForScope(context: Pick<PayrollContext, 'workspaceId' | 'actorId' | 'origin'>, projectId: string, month: string) {
    const key = payrollCanonical([context.workspaceId, context.actorId, context.origin, 'scope', projectId, month])
    return pending.get(key)
  }

  function pendingForPlan(plan: PayrollBatchPlanRead) {
    const key = payrollCanonical([plan.context.workspaceId, plan.context.actorId, plan.context.origin, 'plan', plan.planId])
    return pending.get(key)
  }

  async function recover(original: { command: PayrollBatchCommand }): Promise<PayrollBatchPlanRead> {
    const result = await settle(original.command, await pending.recover(original))
    return original.command.action.kind === 'prepare-batch-item' && result.state === 'prepared' ? executePrepared(result) : result
  }

  return { saving: computed(() => pending.saving.value), preview, loadPlan, confirm, advance, recover, pendingForScope, pendingForPlan, getDraft, rememberDraft, discardDraft }
})
