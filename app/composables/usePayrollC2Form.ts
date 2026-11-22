import { c2Draft } from '~/lib/payroll/c2-presentation'
import { usePayrollTierForm } from './usePayrollTierForm'

export function usePayrollC2Form() {
  const store = usePayrollC2Store()
  return usePayrollTierForm({
    tier: 'C2',
    successMessage: '工资草稿已保存，请继续核对逐条签工与主体配置。',
    createDraft: c2Draft,
    load: store.loadC2Form,
    pending: store.getC2Pending,
    draftFromPending: ({ command: { action } }) => action.kind === 'save-c2-draft' ? action.draft : null,
    save: store.saveC2Draft,
    recover: store.recoverC2,
    acknowledge: store.acknowledgeC2,
  })
}
