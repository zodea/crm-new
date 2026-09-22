import type { PayrollADraft, PayrollAFormRead } from '~/lib/payroll/central-a-contract'
import { usePayrollAStore } from '~/stores/payroll-a'

interface PayrollACachedInput { draft: PayrollADraft, original: string, ratioExplicit: boolean }

/** 只保存输入；冷返回必须取得当前身份的正式读取并重新预览，缓存不提供来源证明。 */
export function usePayrollADraftCache() {
  const store = usePayrollAStore()
  function get(read: PayrollAFormRead): PayrollACachedInput | null {
    return store.getADraftInput(read)
  }
  function remember(read: PayrollAFormRead, value: PayrollACachedInput) {
    store.rememberADraftInput(read, value)
  }
  function discard(read: PayrollAFormRead) {
    store.discardADraftInput(read)
  }
  return { get, remember, discard }
}
