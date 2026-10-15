import type { PayrollQuery } from '~/lib/payroll/central-contract'
import { defineStore } from 'pinia'
import { loadPayrollDetailRead } from '~/lib/payroll/platform-read'
import { useDataVisibilityStore } from './data-visibility'

export const usePayrollStatementDetailStore = defineStore('payroll-statement-detail', () => {
  return { loadRead: (query: PayrollQuery, id: string) => loadPayrollDetailRead(useNuxtApp().$repositories.payroll, { ...query, includeDemo: useDataVisibilityStore().includeDemo }, id) }
})
