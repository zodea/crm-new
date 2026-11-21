import type { PayrollStatementOptions } from './usePayrollTierStatement'
import { usePayrollTierStatement } from './usePayrollTierStatement'

export function usePayrollC1Statement(options: PayrollStatementOptions) {
  const store = usePayrollC1Store()
  return usePayrollTierStatement(options, {
    load: store.loadC1Form,
    loadOutput: store.loadC1Output,
    pending: store.getC1Pending,
    releaseFromPending: ({ command: { action } }) => action.kind === 'release-c1' ? action.release : null,
    check: store.checkC1,
    release: store.releaseC1,
    recover: store.recoverC1,
    acknowledge: store.acknowledgeC1,
    changedSource: '考勤或个人标准',
  })
}
