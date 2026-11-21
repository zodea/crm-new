import { c1Draft } from '~/lib/payroll/c1-presentation'
import { usePayrollTierForm } from './usePayrollTierForm'

export function usePayrollC1Form() {
  const store = usePayrollC1Store()
  return usePayrollTierForm({
    tier: 'C1',
    successMessage: '工资草稿已保存，请继续核对逐日考勤与个人标准。',
    createDraft: c1Draft,
    load: store.loadC1Form,
    pending: store.getC1Pending,
    draftFromPending: ({ command: { action } }) => action.kind === 'save-c1-draft' ? action.draft : null,
    save: store.saveC1Draft,
    recover: store.recoverC1,
    acknowledge: store.acknowledgeC1,
  })
}
