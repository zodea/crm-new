import type { PayrollStatementOptions } from './usePayrollTierStatement'
import { usePayrollTierStatement } from './usePayrollTierStatement'

export function usePayrollC2Statement(options: PayrollStatementOptions) {
  const store = usePayrollC2Store()
  return usePayrollTierStatement(options, {
    load: store.loadC2Form,
    loadOutput: store.loadC2Output,
    pending: store.getC2Pending,
    releaseFromPending: ({ command: { action } }) => action.kind === 'release-c2' ? action.release : null,
    check: store.checkC2,
    release: store.releaseC2,
    recover: store.recoverC2,
    acknowledge: store.acknowledgeC2,
    changedSource: '签工或主体配置',
  })
}
