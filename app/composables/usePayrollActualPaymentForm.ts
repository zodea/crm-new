import type { PayrollActualPaymentDraft, PayrollActualPaymentFormRead, PayrollActualPaymentTarget, PayrollActualReversalDraft, PayrollActualReversalFormRead, PayrollActualReversalTarget } from '~/lib/payroll/central-actual-contract'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { usePayrollEvidenceForm } from './usePayrollEvidenceForm'

export function usePayrollActualPaymentForm() {
  const route = useRoute()
  const store = usePayrollAdjustmentsStore()
  function target(draftKey: string): PayrollActualPaymentTarget {
    const raw = route.query.adjustmentId
    const ids = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string')
    if (!isStableRouteIdentity(draftKey) || !ids.length || ids.some(id => !isStableRouteIdentity(id)) || new Set(ids).size !== ids.length)
      throw new Error('请从已确认更正选择本次补退关联。')
    return { kind: 'actual-payment', draftKey, adjustmentIds: ids }
  }
  return usePayrollEvidenceForm<PayrollActualPaymentDraft, PayrollActualPaymentFormRead>({
    target: draftKey => [draftKey, route.query.adjustmentId],
    load: async (draftKey, draft) => {
      const requested = target(draftKey)
      const read = await store.loadActualPaymentForm({ origin: 'real' }, { target: requested, ...(draft ? { draft } : {}) })
      if (JSON.stringify(read.target) !== JSON.stringify(requested))
        throw new Error('本次补退的更正集合与读取目标不一致。')
      if (draft && draft.applications.some(row => read.balances.find(balance => balance.adjustmentId === row.adjustmentId)?.balanceVersion !== row.balanceVersion)) {
        // 用户明确点击重新核对时仅采用当前余额版本，原收付金额与人员仍不变。
        const adopted = { ...draft, applications: draft.applications.map(row => ({ ...row, balanceVersion: read.balances.find(balance => balance.adjustmentId === row.adjustmentId)?.balanceVersion ?? row.balanceVersion })) }
        return store.loadActualPaymentForm({ origin: 'real' }, { target: requested, draft: adopted })
      }
      return read
    },
    pending: store.getAdjustmentPending,
    restoredDraft: (operation, read) => operation.command.action.kind === 'confirm-actual-payment' ? operation.command.action.payment : read.draft,
    canEdit: () => true,
    canConfirm: read => read.eligibility.canConfirmActual,
    confirm: store.confirmActualPayment,
    confirmation: read => ({ title: read.draft.kind === 'refund' ? '确认实际退款' : '确认实际补发', message: `实际日期 ${read.draft.occurredOn}；本次有符号实额 ${payrollAmount(read.draft.amount)}；${read.draft.allocations.length} 位收付成员，关联 ${read.draft.applications.length} 项更正。请核实款项已真实发生，确认后独立保存，原工资签名金额不改。` }),
  })
}

export function usePayrollRecordingReversalForm() {
  const route = useRoute()
  const store = usePayrollAdjustmentsStore()
  function target(draftKey: string): PayrollActualReversalTarget {
    const statementId = route.query.statementId
    const eventId = route.query.eventId
    if (!isStableRouteIdentity(draftKey) || (!!statementId === !!eventId) || (statementId ? !isStableRouteIdentity(statementId) : !isStableRouteIdentity(eventId)))
      throw new Error('请从具体的工资收付事实发起错记冲销。')
    return { kind: 'recording-reversal', draftKey, original: statementId ? { kind: 'released-statement', statementId: String(statementId) } : { kind: 'actual-event', eventId: String(eventId) } }
  }
  return usePayrollEvidenceForm<PayrollActualReversalDraft, PayrollActualReversalFormRead>({
    target: draftKey => [draftKey, route.query.statementId, route.query.eventId],
    load: async (draftKey, draft) => {
      const requested = target(draftKey)
      const read = await store.loadActualReversalForm({ origin: 'real' }, { target: requested, ...(draft ? { draft } : {}) })
      if (JSON.stringify(read.target) !== JSON.stringify(requested))
        throw new Error('错记冲销的原事实与读取目标不一致。')
      return read
    },
    pending: store.getAdjustmentPending,
    restoredDraft: (operation, read) => operation.command.action.kind === 'confirm-recording-reversal' ? operation.command.action.reversal : read.draft,
    canEdit: () => true,
    canConfirm: read => read.eligibility.canConfirmReversal,
    confirm: store.confirmRecordingReversal,
    confirmation: read => read.originalFact.kind === 'recording-reversal'
      ? { title: '确认对原错记冲销追加纠错', message: `核实日期 ${read.draft.confirmedOn}；本次纠错登记效果 ${payrollAmount(read.reversalAmount.value)}。本次引用具体原冲销形成独立反向记录，不代表新的实际补发或退款。原记录仍保留。依据：${read.draft.evidenceNote}` }
      : { title: '确认未实际发生的错记冲销', message: `核实日期 ${read.draft.confirmedOn}；冲销登记效果 ${payrollAmount(read.reversalAmount.value)}。这是有依据的错记冲销，不是工人实际退款。原记录仍保留。依据：${read.draft.evidenceNote}` },
  })
}
