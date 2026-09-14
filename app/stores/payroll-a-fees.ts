import type { PayrollAFormRead, PayrollAPeriodKind } from '~/lib/payroll/central-a-contract'
import type { PayrollAFeeConfigRead, PayrollAFeeConfigScope, PayrollAFeeDraft, PayrollAFeesAction, PayrollAFeesCommand, PayrollAFeesFormRead, PayrollAManagementBookDraft, PayrollAManagementBookRead, PayrollANegativeLineDraft } from '~/lib/payroll/central-a-fees-contract'
import type { PayrollQuery } from '~/lib/payroll/central-contract'
import { defineStore } from 'pinia'
import { payrollACanonical } from '~/lib/payroll/central-a-calculation'
import { decodePayrollAFeesResult, encodePayrollAFeesWire, parsePayrollAFeesCommand } from '~/lib/payroll/central-a-fees-codec'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'
import { usePayrollAStore } from './payroll-a'

type Read = PayrollAFeeConfigRead | PayrollAFeesFormRead
export const usePayrollAFeesStore = defineStore('payroll-a-fees-central', () => {
  const repository = () => useNuxtApp().$repositories.payroll
  const keyFor = (command: Pick<PayrollAFeesCommand, 'workspaceId' | 'actorId' | 'origin' | 'configScope' | 'statementId' | 'draftKey'>) => payrollACanonical([command.workspaceId, command.actorId, command.origin, command.configScope ?? command.statementId ?? command.draftKey])
  const readKey = (read: Read) => keyFor({ ...read.context, configScope: 'scope' in read ? read.scope : null, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null })
  const pending = usePayrollPending('payroll-a-fees-central-pending-v1', keyFor, (command: PayrollAFeesCommand) => {
    parsePayrollAFeesCommand(encodePayrollAFeesWire(command))
  }, command => repository().executeFees(command), decodePayrollAFeesResult)
  const getPending = (read: Read) => pending.get(readKey(read))
  function execute(read: Read, action: PayrollAFeesAction) {
    if (read.context.origin !== 'real' || read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前费用资料仅可阅读')
    if (getPending(read))
      throw payrollProblem('conflict', '请先核对本份费用的原提交结果')
    if ('scope' in read && ((action.kind === 'save-a-fees' && !read.eligibility.canSaveFees) || (action.kind === 'save-a-management-book' && !read.eligibility.canSaveManagementBook) || (action.kind === 'start-a-management-draft' && !read.eligibility.canStartManagementDraft)))
      throw payrollProblem('unavailable', '当前动作资格未通过，请核对对应费用或管理范围说明')
    if ('statementId' in read && usePayrollAStore().getAPending(read))
      throw payrollProblem('conflict', '请先核对本工资原提交，再修改管理清单')
    const book = 'scope' in read ? read.scope.book : read.book
    const projectId = 'scope' in read ? read.scope.projectId : read.draft.projectId
    if (!book || !projectId || (!('scope' in read) && (!read.fees || read.bookProof.state !== 'proven' || read.status === 'released')))
      throw payrollProblem('unavailable', '工资簿或费用依据尚未证明，不能保存')
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    const command: PayrollAFeesCommand = { workspaceId, actorId, origin, sourceVersion, commandId: generateId('payroll-fees-command'), requiredCapability: 'payroll:write', projectId, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, book, action }
    parsePayrollAFeesCommand(encodePayrollAFeesWire(command))
    return pending.submit(command)
  }
  function acknowledge(original: {
    command: PayrollAFeesCommand
  }, read: Read) {
    const command = original.command
    pending.acknowledge(original, [read], (result) => {
      if (read.context.workspaceId !== command.workspaceId || read.context.actorId !== command.actorId || read.context.origin !== command.origin || read.context.readonly || !read.context.capabilities.includes('payroll:write'))
        return false
      if (command.action.kind === 'start-a-management-draft') {
        return !('scope' in read) && read.statementId === result.statementId && read.draft.projectId === command.projectId && read.book?.bookPurpose === 'management' && read.book.managementBookId === command.action.managementBookId && payrollACanonical(read.book) === payrollACanonical(result.book)
      }
      if (command.configScope) {
        if (!('scope' in read) || payrollACanonical(read.scope) !== payrollACanonical(command.configScope))
          return false
        if (command.action.kind === 'save-a-management-book')
          return read.managementBooks.some(item => item.book.id === result.managementBookId && item.revision?.id === result.managementRevisionId)
        return command.action.kind === 'save-a-fees' && result.feeRevisionIds.every(id => read.fees.some(fee => fee.id === id))
      }
      return !('scope' in read) && read.statementId === command.statementId && read.statementId === result.statementId && read.draft.projectId === command.projectId && payrollACanonical(read.book) === payrollACanonical(command.book) && payrollACanonical(read.book) === payrollACanonical(result.book) && !!read.fees && result.negativeLineRevisionIds.every(id => read.negativeLineRevisions.some(line => line.id === id))
    })
  }
  return {
    getPending,
    acknowledge,
    recover: pending.recover,
    saving: pending.saving,
    loadActualReferences: async (query: PayrollQuery, projectId: string) => {
      const [ledger, list] = await Promise.all([repository().actualLedger(query, { projectId }), repository().list({ ...query, projectId })])
      return { ledger, list }
    },
    loadConfig: (query: PayrollQuery, scope: PayrollAFeeConfigScope) => pending.read(() => repository().aFeeConfig(query, scope)),
    loadForm: (query: PayrollQuery, statementId: string) => pending.read(async () => {
      const read: PayrollAFormRead = await repository().aForm(query, { statementId })
      if (!hasPayrollAFeesForm(read))
        throw payrollProblem('unavailable', '原费用单尚未完整读取')
      return read
    }),
    saveFees: (read: PayrollAFeeConfigRead, fees: PayrollAFeeDraft[], remove: Array<{
      feeId: string
      baseRevisionId: string
    }>) => execute(read, { kind: 'save-a-fees', baseVersion: read.baseVersion, fees, remove }),
    saveManagement: (read: PayrollAFeeConfigRead, management: PayrollAManagementBookDraft) => execute(read, { kind: 'save-a-management-book', baseVersion: read.baseVersion, management }),
    startManagement: (read: PayrollAFeeConfigRead, book: PayrollAManagementBookRead, periodKind: PayrollAPeriodKind) => {
      if (!book.revision || !book.eligible || book.revision.managementMode !== 'crew-managed')
        throw payrollProblem('validation-failed', '该范围没有管理费单资格')
      return execute(read, { kind: 'start-a-management-draft', baseVersion: read.baseVersion, managementBookId: book.book.id, managementRevisionId: book.revision.id, month: read.scope.month, periodKind })
    },
    saveNegativeLines: (read: PayrollAFeesFormRead, lines: PayrollANegativeLineDraft[], remove: Array<{
      lineId: string
      baseRevisionId: string
    }>) => execute(read, { kind: 'save-a-negative-lines', baseVersion: read.context.sourceVersion, lines, remove }),
  }
})
