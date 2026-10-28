import type { PayrollC2Action, PayrollC2Command, PayrollC2CommandRead, PayrollC2ConfigDraft, PayrollC2ConfigRead, PayrollC2ConfigScope, PayrollC2Draft, PayrollC2FormInput, PayrollC2FormRead, PayrollC2OutputRead, PayrollC2ReleaseDraft } from '~/lib/payroll/central-c2-contract'
import type { PayrollQuery } from '~/lib/payroll/central-contract'
import { defineStore } from 'pinia'
import { decodePayrollC2Result, encodePayrollC2Wire, parsePayrollC2Command } from '~/lib/payroll/central-c2-codec'
import { payrollCanonical } from '~/lib/payroll/central-command-shared'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'

export const usePayrollC2Store = defineStore('payroll-c2-central', () => {
  const repository = () => useNuxtApp().$repositories.payroll
  const keyFor = (c: Pick<PayrollC2Command, 'workspaceId' | 'actorId' | 'origin' | 'statementId' | 'draftKey' | 'configScope'>) => payrollCanonical([c.workspaceId, c.actorId, c.origin, 'C2', c.configScope ?? c.statementId ?? c.draftKey])
  const readKey = (r: PayrollC2CommandRead) => keyFor({ ...r.context, statementId: 'statementId' in r ? r.statementId : null, draftKey: 'draftKey' in r ? r.draftKey : null, configScope: 'scope' in r ? r.scope : null })
  const pending = usePayrollPending('payroll-c2-central-pending-v1', keyFor, (c: PayrollC2Command) => {
    parsePayrollC2Command(encodePayrollC2Wire(c))
  }, c => repository().executeC2(c), decodePayrollC2Result)
  function execute(read: PayrollC2CommandRead, action: PayrollC2Action) {
    if (read.context.origin !== 'real' || read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前 C2 资料只能阅读')
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    const projectId = 'scope' in read ? read.scope.projectId : read.draft.projectId
    if (!projectId)
      throw payrollProblem('validation-failed', '请先选择工资项目')
    return pending.submit({ commandId: generateId('payroll-c2-command'), workspaceId, actorId, origin, sourceVersion, requiredCapability: 'payroll:write', projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, configId: 'scope' in read ? read.config?.id ?? null : null, action })
  }
  async function statementAction(read: PayrollC2FormRead, action: PayrollC2Action) {
    const result = await execute(read, action)
    if (!result.statementId)
      throw payrollProblem('unavailable', 'C2 回执缺少原单据身份')
    return { ...result, statementId: result.statementId }
  }
  function acknowledgeC2(original: { command: PayrollC2Command }, refreshed: PayrollC2CommandRead, output?: PayrollC2OutputRead) {
    const command = original.command
    const sameContext = (r: PayrollC2CommandRead | PayrollC2OutputRead) => r.context.workspaceId === command.workspaceId && r.context.actorId === command.actorId && r.context.origin === command.origin && !r.context.readonly && r.context.capabilities.includes('payroll:write')
    pending.acknowledge(original, output ? [refreshed, output] : [refreshed], (result) => {
      if (!sameContext(refreshed))
        return false
      if (command.action.kind === 'save-c2-config')
        return 'scope' in refreshed && payrollCanonical(refreshed.scope) === payrollCanonical(command.configScope) && refreshed.configs.some(config => config.id === result.configId)
      if (!('statementId' in refreshed) || refreshed.statementId !== result.statementId || refreshed.draft.projectId !== command.projectId)
        return false
      // 需重核回执也可能已有后续合法核对；确认原成功不要求当前状态停留在旧结果。
      return result.outcome !== 'released' || (refreshed.status === 'released' && !!output && sameContext(output) && output.statementId === result.statementId && output.state === 'available' && output.document.id === result.statementId && output.document.projectId === command.projectId)
    })
  }
  return {
    loadC2Form: (q: PayrollQuery, input: PayrollC2FormInput) => input.draft === undefined ? pending.read(() => repository().c2Form(q, input)) : repository().c2Form(q, input),
    loadC2Config: (q: PayrollQuery, scope: PayrollC2ConfigScope) => pending.read(() => repository().c2Config(q, scope)),
    loadC2Output: (q: PayrollQuery, id: string) => pending.read(() => repository().c2Output(q, id)),
    saveC2Draft: (r: PayrollC2FormRead, draft: PayrollC2Draft) => statementAction(r, { kind: 'save-c2-draft', draft }),
    checkC2: (r: PayrollC2FormRead) => statementAction(r, { kind: 'check-c2' }),
    releaseC2: (r: PayrollC2FormRead, release: PayrollC2ReleaseDraft) => statementAction(r, { kind: 'release-c2', release }),
    saveC2Config: (r: PayrollC2ConfigRead, config: PayrollC2ConfigDraft) => execute(r, { kind: 'save-c2-config', config }),
    getC2Pending: (r: PayrollC2CommandRead) => pending.get(readKey(r)),
    recoverC2: pending.recover,
    acknowledgeC2,
  }
})
