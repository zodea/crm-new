import type { PayrollAdjustmentDraft, PayrollAdjustmentFormRead, PayrollAdjustmentTarget } from '~/lib/payroll/central-adjustment-contract'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import { usePayrollEvidenceForm } from './usePayrollEvidenceForm'

export function usePayrollAdjustmentForm() {
  const route = useRoute()
  const store = usePayrollAdjustmentsStore()
  function target(draftKey: string): PayrollAdjustmentTarget {
    const id = typeof route.params.id === 'string' ? route.params.id : null
    if (id) {
      if (!isStableRouteIdentity(id))
        throw new Error('更正记录身份无效。')
      return { adjustmentId: id }
    }
    const statementId = route.query.statementId
    if (!isStableRouteIdentity(statementId) || !isStableRouteIdentity(draftKey))
      throw new Error('请从原已发工资发起独立更正。')
    return { adjustmentId: null, draftKey, originalStatementId: String(statementId) }
  }
  return usePayrollEvidenceForm<PayrollAdjustmentDraft, PayrollAdjustmentFormRead>({
    target: draftKey => [route.params.id, route.query.statementId, route.query.correctsAdjustmentId, draftKey],
    load: async (draftKey, draft) => {
      const requested = target(draftKey)
      const read = await store.loadAdjustmentForm({ origin: 'real' }, { target: requested, ...(draft ? { draft } : {}) })
      if (JSON.stringify(read.target) !== JSON.stringify(requested))
        throw new Error('更正读取目标不一致。')
      if (!draft && requested.adjustmentId === null && typeof route.query.correctsAdjustmentId === 'string') {
        if (!isStableRouteIdentity(route.query.correctsAdjustmentId))
          throw new Error('前序更正身份无效。')
        return store.loadAdjustmentForm({ origin: 'real' }, { target: requested, draft: { ...read.draft, correctsAdjustmentId: route.query.correctsAdjustmentId } })
      }
      return read
    },
    pending: store.getAdjustmentPending,
    restoredDraft: (operation, read) => operation.command.action.kind === 'save-adjustment-draft' ? operation.command.action.draft : read.draft,
    canEdit: read => read.status !== 'confirmed' && read.eligibility.canSaveDraft,
    canConfirm: read => read.status === 'draft' && read.eligibility.canConfirmAdjustment,
    save: store.saveAdjustmentDraft,
    confirm: store.confirmAdjustment,
    confirmation: read => ({ title: '确认核算更正', message: `原签名实发 ${payrollAmount(read.original.originalSignatureAmount.value)}；本次核算差额 ${payrollAmount(read.preview.delta.value)}。确认仅登记核算更正，尚未发生实际补发或退款。依据：${read.draft.reason}` }),
  })
}
