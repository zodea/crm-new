import type { PayrollQuery } from '~/lib/payroll/central-contract'
import type { PayrollDayworkAction, PayrollDayworkCommand, PayrollDayworkFormInput, PayrollDayworkFormRead, PayrollDayworkRecordDraft, PayrollDayworkScope } from '~/lib/payroll/central-daywork-contract'
import { defineStore } from 'pinia'
import { payrollCanonical } from '~/lib/payroll/central-command-shared'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { decodePayrollDayworkResult, encodePayrollDayworkWire, parsePayrollDayworkCommand } from '~/lib/payroll/central-daywork-codec'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'

export const useDayworkCentralStore = defineStore('daywork-central', () => {
  const repository = () => useNuxtApp().$repositories.payroll
  const keyFor = (c: Pick<PayrollDayworkCommand, 'workspaceId' | 'actorId' | 'origin' | 'recordId' | 'draftKey'>) => payrollCanonical([c.workspaceId, c.actorId, c.origin, 'daywork', c.recordId ?? c.draftKey])
  const readKey = (r: PayrollDayworkFormRead) => keyFor({ ...r.context, recordId: r.recordId, draftKey: r.draftKey })
  const pending = usePayrollPending('payroll-daywork-central-pending-v1', keyFor, (c: PayrollDayworkCommand) => {
    parsePayrollDayworkCommand(encodePayrollDayworkWire(c))
  }, c => repository().executeDaywork(c), decodePayrollDayworkResult)
  function execute(read: PayrollDayworkFormRead, action: PayrollDayworkAction) {
    if (read.context.origin !== 'real' || read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前签工资料只能阅读')
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    const originalScope = read.record ? { projectId: read.record.projectId, crewId: read.record.crewId, workerId: read.record.workerId, workDate: read.record.workDate } : null
    const projectId = originalScope?.projectId ?? (action.kind === 'save-daywork' ? action.record.projectId : '')
    if (!projectId)
      throw payrollProblem('validation-failed', '请先选择签工项目')
    return pending.submit({ commandId: generateId('daywork-command'), workspaceId, actorId, origin, sourceVersion, requiredCapability: 'payroll:write', projectId, recordId: read.recordId, draftKey: read.draftKey, originalScope, action })
  }
  function acknowledgeDaywork(original: { command: PayrollDayworkCommand }, refreshed: PayrollDayworkFormRead) {
    const command = original.command
    let changedSinceCommand = false
    pending.acknowledge(original, [refreshed], (result) => {
      if (refreshed.context.workspaceId !== command.workspaceId || refreshed.context.actorId !== command.actorId || refreshed.context.origin !== command.origin || refreshed.context.readonly || !refreshed.context.capabilities.includes('payroll:write') || refreshed.recordId !== result.recordId || refreshed.record?.id !== result.recordId)
        return false
      // 同一实体随后可以合法改变归属或正文；原提交的成功由原回执证明。
      changedSinceCommand = refreshed.record.sourceFingerprint !== result.recordFingerprint
      return true
    })
    return { changedSinceCommand }
  }
  return {
    dayworkSaving: pending.saving,
    loadDayworkList: (query: PayrollQuery, scope: PayrollDayworkScope) => repository().dayworkList(query, scope),
    loadDayworkForm: (query: PayrollQuery, input: PayrollDayworkFormInput) => input.draft === undefined ? pending.read(() => repository().dayworkForm(query, input)) : repository().dayworkForm(query, input),
    saveDaywork: (read: PayrollDayworkFormRead, record: PayrollDayworkRecordDraft) => execute(read, { kind: 'save-daywork', record }),
    confirmDaywork: (read: PayrollDayworkFormRead, confirmation: { witness: string, confirmedOn: string }) => execute(read, { kind: 'confirm-daywork', confirmation }),
    getDayworkPending: (read: PayrollDayworkFormRead) => pending.get(readKey(read)),
    recoverDaywork: pending.recover,
    acknowledgeDaywork,
  }
})
