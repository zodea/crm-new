import type { PayrollC1Action, PayrollC1Command, PayrollC1CommandRead, PayrollC1ConfigRead, PayrollC1ConfigScope, PayrollC1Draft, PayrollC1FormInput, PayrollC1FormRead, PayrollC1OutputRead, PayrollC1RateDraft, PayrollC1ReleaseDraft } from '~/lib/payroll/central-c1-contract'
import type { PayrollQuery } from '~/lib/payroll/central-contract'
import { defineStore } from 'pinia'
import { decodePayrollC1Result, encodePayrollC1Wire, parsePayrollC1Command } from '~/lib/payroll/central-c1-codec'
import { payrollCanonical } from '~/lib/payroll/central-command-shared'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'

export const usePayrollC1Store = defineStore('payroll-c1-central', () => {
  const repository = () => useNuxtApp().$repositories.payroll
  const keyFor = (c: Pick<PayrollC1Command, 'workspaceId' | 'actorId' | 'origin' | 'statementId' | 'draftKey' | 'configScope'>) => payrollCanonical([c.workspaceId, c.actorId, c.origin, 'C1', c.configScope ?? c.statementId ?? c.draftKey])
  const readKey = (r: PayrollC1CommandRead) => keyFor({ ...r.context, statementId: 'statementId' in r ? r.statementId : null, draftKey: 'draftKey' in r ? r.draftKey : null, configScope: 'scope' in r ? r.scope : null })
  const pending = usePayrollPending('payroll-c1-central-pending-v1', keyFor, (c: PayrollC1Command) => {
    parsePayrollC1Command(encodePayrollC1Wire(c))
  }, c => repository().executeC1(c), decodePayrollC1Result)
  function execute(read: PayrollC1CommandRead, action: PayrollC1Action) {
    if (read.context.origin !== 'real' || read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前 C1 资料只能阅读')
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    const projectId = 'scope' in read ? read.scope.projectId : read.draft.projectId
    if (!projectId)
      throw payrollProblem('validation-failed', '请先选择工资项目')
    return pending.submit({ commandId: generateId('payroll-c1-command'), workspaceId, actorId, origin, sourceVersion, requiredCapability: 'payroll:write', projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
  }
  async function statementAction(read: PayrollC1FormRead, action: PayrollC1Action) {
    const result = await execute(read, action)
    if (!result.statementId)
      throw payrollProblem('unavailable', 'C1 回执缺少原单据身份')
    return { ...result, statementId: result.statementId }
  }
  function acknowledgeC1(original: { command: PayrollC1Command }, refreshed: PayrollC1CommandRead, output?: PayrollC1OutputRead) {
    const command = original.command
    const sameContext = (r: PayrollC1CommandRead | PayrollC1OutputRead) => r.context.workspaceId === command.workspaceId && r.context.actorId === command.actorId && r.context.origin === command.origin && !r.context.readonly && r.context.capabilities.includes('payroll:write')
    pending.acknowledge(original, output ? [refreshed, output] : [refreshed], (result) => {
      if (!sameContext(refreshed))
        return false
      if (command.action.kind === 'save-c1-rates') {
        return 'scope' in refreshed
          && !refreshed.readonlyReasons.length
          && payrollCanonical(refreshed.scope) === payrollCanonical(command.configScope)
      }
      if (!('statementId' in refreshed) || refreshed.statementId !== result.statementId || refreshed.draft.projectId !== command.projectId)
        return false
      return result.outcome !== 'released' || (refreshed.status === 'released' && !!output && sameContext(output) && output.statementId === result.statementId && output.state === 'available' && output.document.id === result.statementId && output.document.projectId === command.projectId)
    })
  }
  return {
    c1Saving: pending.saving,
    loadC1Form: (q: PayrollQuery, input: PayrollC1FormInput) => input.draft === undefined ? pending.read(() => repository().c1Form(q, input)) : repository().c1Form(q, input),
    loadC1Config: (q: PayrollQuery, scope: PayrollC1ConfigScope) => pending.read(() => repository().c1Config(q, scope)),
    loadC1Output: (q: PayrollQuery, id: string) => pending.read(() => repository().c1Output(q, id)),
    saveC1Draft: (r: PayrollC1FormRead, draft: PayrollC1Draft) => statementAction(r, { kind: 'save-c1-draft', draft }),
    checkC1: (r: PayrollC1FormRead) => statementAction(r, { kind: 'check-c1' }),
    releaseC1: (r: PayrollC1FormRead, release: PayrollC1ReleaseDraft) => statementAction(r, { kind: 'release-c1', release }),
    saveC1Rates: (r: PayrollC1ConfigRead, rates: PayrollC1RateDraft[]) => execute(r, { kind: 'save-c1-rates', rates }),
    getC1Pending: (r: PayrollC1CommandRead) => pending.get(readKey(r)),
    recoverC1: pending.recover,
    acknowledgeC1,
  }
})
