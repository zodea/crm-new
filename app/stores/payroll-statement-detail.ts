import type { PayrollQuery } from '~/lib/payroll/central-contract'
import type { PayrollStatementDetailSnapshot } from '~/lib/payroll/detail'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { getDb } from '~/lib/db/connection'
import { loadPayrollStatementDetail } from '~/lib/payroll/detail'
import { loadPayrollDetailRead, requirePayrollNative } from '~/lib/payroll/platform-read'
import { useDataVisibilityStore } from './data-visibility'

export const usePayrollStatementDetailStore = defineStore('payroll-statement-detail', () => {
  const snapshots = shallowRef<Record<string, PayrollStatementDetailSnapshot | null>>({})
  const loadingIds = shallowRef(new Set<string>())

  function byId(statementId: string): PayrollStatementDetailSnapshot | null | undefined {
    return snapshots.value[statementId]
  }

  function isLoading(statementId: string): boolean {
    return loadingIds.value.has(statementId)
  }

  async function load(statementId: string): Promise<void> {
    requirePayrollNative()
    const nextLoading = new Set(loadingIds.value)
    nextLoading.add(statementId)
    loadingIds.value = nextLoading
    try {
      const db = await getDb()
      const snapshot = await loadPayrollStatementDetail(db, statementId)
      snapshots.value = { ...snapshots.value, [statementId]: snapshot }
    }
    finally {
      const settledLoading = new Set(loadingIds.value)
      settledLoading.delete(statementId)
      loadingIds.value = settledLoading
    }
  }

  return { byId, isLoading, load, loadRead: (query: PayrollQuery, id: string) => loadPayrollDetailRead(useNuxtApp().$repositories.payroll, { ...query, includeDemo: useDataVisibilityStore().includeDemo }, id) }
})
