import type { AttendanceRecord } from '~/lib/payroll/attendance'
import type { PayrollQuery } from '~/lib/payroll/central-contract'
import { defineStore } from 'pinia'
import { reactive, shallowRef } from 'vue'
import { getDb, withTransaction } from '~/lib/db/connection'
import {
  listAttendanceBlockedWorkerIds,
  listAttendanceRecords,
  upsertAttendanceRecord,
} from '~/lib/payroll/attendance'
import { payrollScopeFromOptions } from '~/lib/payroll/navigation'
import { loadPayrollSourcesRead, requirePayrollNative } from '~/lib/payroll/platform-read'
import { loadPayrollWorkbenchOptions } from '~/lib/payroll/statements'
import { useDataVisibilityStore } from './data-visibility'

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export const useAttendanceStore = defineStore('attendance-workbench', () => {
  const records = shallowRef<AttendanceRecord[]>([])
  const options = shallowRef({
    projects: [],
    crews: [],
    workers: [],
    c2SubjectConfigs: [],
  } as Awaited<ReturnType<typeof loadPayrollWorkbenchOptions>>)
  const blockedWorkerIds = shallowRef<string[]>([])
  const filters = reactive({
    projectId: '',
    crewId: '',
    month: currentMonth(),
  })
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  let loadSequence = 0

  async function load(loadOptions: { clearFacts?: boolean } = {}) {
    requirePayrollNative()
    const sequence = ++loadSequence
    const requestedScope = {
      projectId: filters.projectId,
      crewId: filters.crewId,
      month: filters.month,
    }
    if (loadOptions.clearFacts) {
      records.value = []
      blockedWorkerIds.value = []
    }
    loading.value = true
    error.value = ''
    try {
      const db = await getDb()
      let nextOptions = await loadPayrollWorkbenchOptions(db, requestedScope.projectId)
      const { projectId, crewId } = payrollScopeFromOptions(requestedScope, nextOptions)
      if (projectId !== requestedScope.projectId)
        nextOptions = await loadPayrollWorkbenchOptions(db, projectId)
      const [nextRecords, nextBlockedWorkerIds] = projectId
        ? await Promise.all([
            listAttendanceRecords(db, {
              projectId,
              crewId,
              month: requestedScope.month,
            }),
            listAttendanceBlockedWorkerIds(db, {
              projectId,
              month: requestedScope.month,
            }),
          ])
        : [[], []]
      const scopeChangedDuringLoad = (
        filters.projectId !== requestedScope.projectId
        || filters.crewId !== requestedScope.crewId
        || filters.month !== requestedScope.month
      )
      if (sequence !== loadSequence || scopeChangedDuringLoad)
        return
      filters.projectId = projectId
      filters.crewId = crewId
      options.value = nextOptions
      records.value = nextRecords
      blockedWorkerIds.value = nextBlockedWorkerIds
    }
    catch (cause) {
      if (sequence === loadSequence)
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
    finally {
      if (sequence === loadSequence)
        loading.value = false
    }
  }

  async function save(input: Parameters<typeof upsertAttendanceRecord>[1]) {
    requirePayrollNative()
    if (saving.value)
      return false
    saving.value = true
    try {
      await withTransaction(tx => upsertAttendanceRecord(tx, input))
      await load()
      return true
    }
    finally {
      saving.value = false
    }
  }

  return {
    loadRead: (query: PayrollQuery & { projectId: string }) => loadPayrollSourcesRead(useNuxtApp().$repositories.payroll, { ...query, includeDemo: useDataVisibilityStore().includeDemo }),
    records,
    options,
    blockedWorkerIds,
    filters,
    loading,
    saving,
    error,
    load,
    save,
  }
})
