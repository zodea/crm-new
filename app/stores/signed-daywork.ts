import type { PayrollQuery } from '~/lib/payroll/central-contract'

import { defineStore } from 'pinia'

import { loadPayrollSourcesRead } from '~/lib/payroll/platform-read'
import { useDataVisibilityStore } from './data-visibility'

export const useSignedDayworkStore = defineStore('signed-daywork-workbench', () => {
  return {
    loadRead: (query: PayrollQuery & { projectId: string }) => loadPayrollSourcesRead(useNuxtApp().$repositories.payroll, { ...query, includeDemo: useDataVisibilityStore().includeDemo }),
  }
})
