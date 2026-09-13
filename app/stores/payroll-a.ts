import type { PayrollAAction, PayrollACommand, PayrollACommandRead, PayrollACommandResult, PayrollAConfigRead, PayrollAConfigScope, PayrollADraft, PayrollAFormInput, PayrollAFormRead, PayrollAPending, PayrollAPriceDraft, PayrollAReleaseDraft, PayrollAStatementCommandResult, PayrollASubjectConfigDraft } from '~/lib/payroll/central-a-contract'
import type { PayrollQuery } from '~/lib/payroll/central-contract'
import { useSessionStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { payrollACanonical } from '~/lib/payroll/central-a-calculation'
import { encodePayrollAWire, parsePayrollACommand } from '~/lib/payroll/central-a-codec'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { generateId } from '~/lib/util/id'

const storageKey = 'payroll-a-central-pending-v1'
export const usePayrollAStore = defineStore('payroll-a-central', () => {
  const pending = useSessionStorage<Record<string, PayrollACommand>>(storageKey, {}, { flush: 'sync', writeDefaults: false, onError: () => {} })
  const active = shallowRef(new Set<string>())
  const repository = () => useNuxtApp().$repositories.payroll
  const keyFor = (c: Pick<PayrollACommand, 'workspaceId' | 'actorId' | 'origin' | 'statementId' | 'draftKey' | 'configScope'>) => payrollACanonical([c.workspaceId, c.actorId, c.origin, c.configScope ?? c.statementId ?? c.draftKey])
  const readKey = (read: PayrollACommandRead) => keyFor({ ...read.context, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null })
  function persist(next: Record<string, PayrollACommand>, creating = false) {
    try {
      const storage = window.sessionStorage
      const before = storage.getItem(storageKey)
      if (before !== null && payrollACanonical(JSON.parse(before)) !== payrollACanonical(pending.value))
        throw new Error('原提交已经改变')
      const encoded = JSON.stringify(next)
      storage.setItem(storageKey, encoded)
      if (storage.getItem(storageKey) !== encoded)
        throw new Error('原提交未可靠保存')
      pending.value = next
    }
    catch { throw payrollProblem('unavailable', creating ? '浏览器无法可靠保存原提交，尚未发送。请保留草稿，恢复存储后重试。' : '原提交记录无法核对，请保留当前输入并在恢复存储后按原编号核对。') }
  }
  function getAPending(read: PayrollACommandRead): PayrollAPending | null {
    const command = pending.value[readKey(read)]
    return command ? { command, state: active.value.has(command.commandId) ? 'sending' : 'unknown' } : null
  }
  function clear(command: PayrollACommand) {
    const key = keyFor(command)
    if (pending.value[key]?.commandId !== command.commandId)
      return
    const next = { ...pending.value }
    delete next[key]
    persist(next)
  }
  async function send(command: PayrollACommand): Promise<PayrollACommandResult> {
    if (active.value.has(command.commandId))
      throw payrollProblem('conflict', '原工资提交仍在处理，请勿重复操作')
    persist({ ...pending.value })
    active.value = new Set([...active.value, command.commandId])
    try {
      const result = await repository().execute(JSON.parse(JSON.stringify(command)))
      clear(command)
      return result
    }
    catch (cause) {
      const problem = projectProblemFromUnknown(cause).problem as { commandId?: string, commandOutcome?: string, code: string }
      if (problem.commandId === command.commandId && problem.commandOutcome === 'not-applied' && ['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found', 'conflict'].includes(problem.code))
        clear(command)
      throw cause
    }
    finally { active.value = new Set([...active.value].filter(id => id !== command.commandId)) }
  }
  function execute(read: PayrollACommandRead, action: PayrollAAction) {
    if (read.context.origin !== 'real' || read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前工资资料仅可阅读')
    if (getAPending(read))
      throw payrollProblem('conflict', '请先核对这份工资或配置的原提交结果')
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    const projectId = 'scope' in read ? read.scope.projectId : read.draft.projectId
    if (!projectId)
      throw payrollProblem('validation-failed', '请先核对工资项目')
    const command: PayrollACommand = { workspaceId, actorId, origin, sourceVersion, requiredCapability: 'payroll:write', commandId: generateId('payroll-command'), projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? { ...read.scope } : null, action: JSON.parse(JSON.stringify(action)) }
    // 尚未发送的本地格式错误不建立未知提交；保存的必须是可原样传输的完整命令。
    parsePayrollACommand(encodePayrollAWire(command))
    persist({ ...pending.value, [keyFor(command)]: command }, true)
    return send(command)
  }
  async function statementAction(read: PayrollAFormRead, action: PayrollAAction): Promise<PayrollAStatementCommandResult> {
    const result = await execute(read, action)
    if (!result.statementId)
      throw payrollProblem('unavailable', '工资提交回执缺少原单据身份')
    return { ...result, statementId: result.statementId }
  }
  function recoverA(original: PayrollAPending) {
    const command = pending.value[keyFor(original.command)]
    if (!command || payrollACanonical(command) !== payrollACanonical(original.command))
      throw payrollProblem('not-found', '原工资提交已核对或不属于这份输入')
    return send(command)
  }
  return {
    aSaving: computed(() => active.value.size > 0),
    loadAForm: (query: PayrollQuery, input: PayrollAFormInput) => repository().aForm(query, input),
    loadAConfig: (query: PayrollQuery, scope: PayrollAConfigScope) => repository().aConfig(query, scope),
    loadAOutput: (query: PayrollQuery, id: string) => repository().aOutput(query, id),
    saveADraft: (read: PayrollAFormRead, draft: PayrollADraft) => statementAction(read, { kind: 'save-a-draft', draft }),
    checkA: (read: PayrollAFormRead) => statementAction(read, { kind: 'check-a' }),
    setAPayRatio: (read: PayrollAFormRead, payRatio: number | null) => statementAction(read, { kind: 'set-a-pay-ratio', payRatio }),
    releaseA: (read: PayrollAFormRead, release: PayrollAReleaseDraft) => statementAction(read, { kind: 'release-a', release }),
    saveASubjectConfig: (read: PayrollAConfigRead, config: PayrollASubjectConfigDraft) => execute(read, { kind: 'save-a-subject-config', config }),
    saveAPrices: (read: PayrollAConfigRead, prices: PayrollAPriceDraft[]) => execute(read, { kind: 'save-a-prices', prices }),
    getAPending,
    recoverA,
  }
})
