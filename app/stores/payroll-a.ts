import type { PayrollAAction, PayrollACommand, PayrollACommandRead, PayrollAConfigRead, PayrollAConfigScope, PayrollADraft, PayrollAFormInput, PayrollAFormRead, PayrollAOutputRead, PayrollAPriceDraft, PayrollAReleaseDraft, PayrollAStatementCommandResult, PayrollASubjectConfigDraft } from '~/lib/payroll/central-a-contract'
import type { PayrollQuery } from '~/lib/payroll/central-contract'
import { defineStore } from 'pinia'
import { payrollACanonical } from '~/lib/payroll/central-a-calculation'
import { decodePayrollAResult, encodePayrollAWire, parsePayrollACommand } from '~/lib/payroll/central-a-codec'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'
import { usePayrollAFeesStore } from './payroll-a-fees'

const storageKey = 'payroll-a-central-pending-v1'
export const usePayrollAStore = defineStore('payroll-a-central', () => {
  const repository = () => useNuxtApp().$repositories.payroll
  const keyFor = (c: Pick<PayrollACommand, 'workspaceId' | 'actorId' | 'origin' | 'statementId' | 'draftKey' | 'configScope'>) => payrollACanonical([c.workspaceId, c.actorId, c.origin, c.configScope ?? c.statementId ?? c.draftKey])
  const readKey = (read: PayrollACommandRead) => keyFor({ ...read.context, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null })
  const pending = usePayrollPending(storageKey, keyFor, (command: PayrollACommand) => {
    parsePayrollACommand(encodePayrollAWire(command))
  }, command => repository().execute(command), decodePayrollAResult)
  const getAPending = (read: PayrollACommandRead) => pending.get(readKey(read))
  function execute(read: PayrollACommandRead, action: PayrollAAction) {
    if (read.context.origin !== 'real' || read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前工资资料仅可阅读')
    if (getAPending(read))
      throw payrollProblem('conflict', '请先核对这份工资或配置的原提交结果')
    if ('statementId' in read && hasPayrollAFeesForm(read)) {
      if (usePayrollAFeesStore().getPending(read))
        throw payrollProblem('conflict', '请先核对本管理清单的原提交结果')
      if (!read.fees || read.bookProof.state !== 'proven')
        throw payrollProblem('unavailable', '费用或请款簿依据尚未完整读取')
    }
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    const projectId = 'scope' in read ? read.scope.projectId : read.draft.projectId
    if (!projectId)
      throw payrollProblem('validation-failed', '请先核对工资项目')
    const command: PayrollACommand = { workspaceId, actorId, origin, sourceVersion, requiredCapability: 'payroll:write', commandId: generateId('payroll-command'), projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? { ...read.scope } : null, action: JSON.parse(JSON.stringify(action)) }
    // 尚未发送的本地格式错误不建立未知提交；保存的必须是可原样传输的完整命令。
    parsePayrollACommand(encodePayrollAWire(command))
    return pending.submit(command)
  }
  async function statementAction(read: PayrollAFormRead, action: PayrollAAction): Promise<PayrollAStatementCommandResult> {
    const result = await execute(read, action)
    if (!result.statementId)
      throw payrollProblem('unavailable', '工资提交回执缺少原单据身份')
    return { ...result, statementId: result.statementId }
  }
  function acknowledgeA(original: { command: PayrollACommand }, refreshed: PayrollACommandRead, output?: PayrollAOutputRead) {
    const command = original.command
    const sameContext = (read: PayrollACommandRead | PayrollAOutputRead) => read.context.workspaceId === command.workspaceId && read.context.actorId === command.actorId && read.context.origin === command.origin && read.context.capabilities.includes('payroll:write')
    pending.acknowledge(original, output ? [refreshed, output] : [refreshed], (result) => {
      // 冻结输出始终只读；原表单仍须确认当前经办写权限，不能因输出可读解除撤权后的原提交。
      if (!sameContext(refreshed) || refreshed.context.readonly)
        return false
      if (command.configScope) {
        if (!('scope' in refreshed) || payrollACanonical(refreshed.scope) !== payrollACanonical(command.configScope))
          return false
        return command.action.kind === 'save-a-subject-config' ? refreshed.subject?.id === result.subjectConfigId : result.priceRevisionIds.every(id => refreshed.prices.some(price => price.id === id))
      }
      if (!('statementId' in refreshed) || refreshed.statementId !== result.statementId || refreshed.draft.projectId !== command.projectId)
        return false
      return result.outcome !== 'released' || (refreshed.status === 'released' && !!output && sameContext(output) && output.statementId === result.statementId && output.state === 'available' && output.document.id === result.statementId && output.document.projectId === command.projectId)
    })
  }
  return {
    aSaving: pending.saving,
    loadAForm: (query: PayrollQuery, input: PayrollAFormInput) => input.draft === undefined ? pending.read(() => repository().aForm(query, input)) : repository().aForm(query, input),
    loadAConfig: (query: PayrollQuery, scope: PayrollAConfigScope) => pending.read(() => repository().aConfig(query, scope)),
    loadAOutput: (query: PayrollQuery, id: string) => pending.read(() => repository().aOutput(query, id)),
    saveADraft: (read: PayrollAFormRead, draft: PayrollADraft) => statementAction(read, { kind: 'save-a-draft', draft }),
    checkA: (read: PayrollAFormRead) => statementAction(read, { kind: 'check-a' }),
    setAPayRatio: (read: PayrollAFormRead, payRatio: number | null) => statementAction(read, { kind: 'set-a-pay-ratio', payRatio }),
    releaseA: (read: PayrollAFormRead, release: PayrollAReleaseDraft) => statementAction(read, { kind: 'release-a', release }),
    saveASubjectConfig: (read: PayrollAConfigRead, config: PayrollASubjectConfigDraft) => execute(read, { kind: 'save-a-subject-config', config }),
    saveAPrices: (read: PayrollAConfigRead, prices: PayrollAPriceDraft[]) => execute(read, { kind: 'save-a-prices', prices }),
    getAPending,
    recoverA: pending.recover,
    acknowledgeA,
  }
})
