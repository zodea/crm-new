import type { PayrollActualPaymentDetailRead, PayrollActualPaymentFormInput, PayrollActualPaymentFormRead, PayrollActualReversalFormInput, PayrollActualReversalFormRead, PayrollActualScope } from '~/lib/payroll/central-actual-contract'
import type { PayrollAdjustmentCommand, PayrollAdjustmentDetailRead, PayrollAdjustmentDraft, PayrollAdjustmentFormInput, PayrollAdjustmentFormRead } from '~/lib/payroll/central-adjustment-contract'
import type { PayrollQuery } from '~/lib/payroll/central-contract'
import { defineStore } from 'pinia'
import { decodePayrollAdjustmentResult } from '~/lib/payroll/central-adjustment-codec'
import { encodePayrollAdjustmentWire, parsePayrollAdjustmentCommand } from '~/lib/payroll/central-adjustment-wire'
import { payrollCanonical } from '~/lib/payroll/central-command-shared'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { usePayrollPending } from '~/lib/payroll/central-pending'
import { generateId } from '~/lib/util/id'

type CommandRead = PayrollAdjustmentFormRead | PayrollActualPaymentFormRead | PayrollActualReversalFormRead
type ConfirmedRead = PayrollAdjustmentDetailRead | PayrollActualPaymentDetailRead

export const usePayrollAdjustmentsStore = defineStore('payroll-adjustments-central', () => {
  const repository = () => useNuxtApp().$repositories.payroll
  const keyFor = (command: Pick<PayrollAdjustmentCommand, 'workspaceId' | 'actorId' | 'origin' | 'projectId' | 'target'>) => payrollCanonical([command.workspaceId, command.actorId, command.origin, command.projectId, command.target])
  const projectOf = (read: CommandRead) => 'original' in read ? read.original.projectId : read.originals[0]?.projectId
  const pending = usePayrollPending('payroll-adjustments-central-pending-v1', keyFor, (command: PayrollAdjustmentCommand) => {
    parsePayrollAdjustmentCommand(encodePayrollAdjustmentWire(command))
  }, command => repository().executeAdjustment(command), decodePayrollAdjustmentResult)
  function header(read: CommandRead) {
    if (read.context.origin !== 'real' || read.context.readonly || !read.context.capabilities.includes('payroll:write'))
      throw payrollProblem('forbidden', '当前资料只能阅读，请保留原更正和收付输入')
    const projectId = projectOf(read)
    if (!projectId)
      throw payrollProblem('unavailable', '暂不能核实原工资项目，请保留输入')
    const { workspaceId, actorId, origin, sourceVersion } = read.context
    return { commandId: generateId('payroll-adjustment-command'), workspaceId, actorId, origin, sourceVersion, requiredCapability: 'payroll:write' as const, projectId }
  }
  function acknowledgeAdjustment(original: { command: PayrollAdjustmentCommand }, refreshed: ConfirmedRead) {
    const command = original.command
    pending.acknowledge(original, [refreshed], (result) => {
      const context = refreshed.context
      if (context.workspaceId !== command.workspaceId || context.actorId !== command.actorId || context.origin !== command.origin || context.readonly || !context.capabilities.includes('payroll:write'))
        return false
      if ('adjustment' in refreshed) {
        if (command.action.kind !== 'save-adjustment-draft' && command.action.kind !== 'confirm-adjustment')
          return false
        // 可靠保存回执之后原稿可有后续合法编辑或确认；不要求现值仍等于旧稿。
        return refreshed.original.projectId === command.projectId && refreshed.original.statementId === result.originalStatementId && refreshed.adjustment.id === result.adjustmentId && (command.action.kind === 'save-adjustment-draft' || refreshed.adjustment.snapshot?.commandId === command.commandId)
      }
      return (command.action.kind === 'confirm-actual-payment' || command.action.kind === 'confirm-recording-reversal') && refreshed.fact.projectId === command.projectId && refreshed.fact.ref.kind === 'actual-event' && refreshed.fact.ref.eventId === result.actualEventId && refreshed.fact.qualification === 'proven' && refreshed.snapshot.commandId === command.commandId && refreshed.snapshot.id === result.actualEventId && refreshed.fact.originalStatementIds.includes(result.originalStatementId)
    })
  }
  return {
    adjustmentSaving: pending.saving,
    loadAdjustmentForm: (query: PayrollQuery, input: PayrollAdjustmentFormInput) => repository().adjustmentForm(query, input),
    loadAdjustmentDetail: (query: PayrollQuery, adjustmentId: string) => pending.read(() => repository().adjustmentDetail(query, adjustmentId)),
    loadAdjustmentHistory: (query: PayrollQuery, originalStatementId: string) => repository().adjustmentHistory(query, originalStatementId),
    loadActualPaymentForm: (query: PayrollQuery, input: PayrollActualPaymentFormInput) => repository().actualPaymentForm(query, input),
    loadActualReversalForm: (query: PayrollQuery, input: PayrollActualReversalFormInput) => repository().actualReversalForm(query, input),
    loadActualPaymentDetail: (query: PayrollQuery, eventId: string) => pending.read(() => repository().actualPaymentDetail(query, eventId)),
    loadActualLedger: (query: PayrollQuery, scope: PayrollActualScope) => repository().actualLedger(query, scope),
    loadReleaseAdjustments: (query: PayrollQuery, statementId: string) => repository().releaseAdjustmentPreview(query, { statementId }),
    saveAdjustmentDraft: (read: PayrollAdjustmentFormRead, draft: PayrollAdjustmentDraft) => pending.submit({ ...header(read), target: read.target, action: { kind: 'save-adjustment-draft', draft } }),
    confirmAdjustment: (read: PayrollAdjustmentFormRead) => pending.submit({ ...header(read), target: read.target, action: { kind: 'confirm-adjustment' } }),
    confirmActualPayment: (read: PayrollActualPaymentFormRead) => pending.submit({ ...header(read), target: read.target, action: { kind: 'confirm-actual-payment', payment: read.draft } }),
    confirmRecordingReversal: (read: PayrollActualReversalFormRead) => pending.submit({ ...header(read), target: read.target, action: { kind: 'confirm-recording-reversal', reversal: read.draft } }),
    getAdjustmentPending: (read: CommandRead) => {
      const projectId = projectOf(read)
      return projectId ? pending.get(keyFor({ ...read.context, projectId, target: read.target })) : null
    },
    recoverAdjustment: pending.recover,
    acknowledgeAdjustment,
  }
})
