import type { PayrollQuery } from '~/lib/payroll/central-contract'

import { defineStore } from 'pinia'
import { loadPayrollListRead } from '~/lib/payroll/platform-read'

import { useDataVisibilityStore } from './data-visibility'
import { usePayrollAStore } from './payroll-a'

export const usePayrollStore = defineStore('payroll-workbench', () => {
  const centralA = usePayrollAStore()

  return {
    loadAForm: centralA.loadAForm,
    loadAConfig: centralA.loadAConfig,
    loadAOutput: centralA.loadAOutput,
    saveADraft: centralA.saveADraft,
    checkA: centralA.checkA,
    setAPayRatio: centralA.setAPayRatio,
    setARatioPlan: centralA.setARatioPlan,
    releaseA: centralA.releaseA,
    saveASubjectConfig: centralA.saveASubjectConfig,
    saveAPrices: centralA.saveAPrices,
    getAPending: centralA.getAPending,
    recoverA: centralA.recoverA,
    acknowledgeA: centralA.acknowledgeA,
    loadRead: (query: PayrollQuery) => loadPayrollListRead(useNuxtApp().$repositories.payroll, { ...query, includeDemo: useDataVisibilityStore().includeDemo }),
  }
})
