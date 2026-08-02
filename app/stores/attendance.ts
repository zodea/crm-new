import type { AttendanceRecord } from '~/lib/payroll/attendance'
import { defineStore } from 'pinia'
import { getDb, withTransaction } from '~/lib/db/connection'
import {
  listAttendanceBlockedWorkerIds,
  listAttendanceRecords,
  upsertAttendanceRecord,
} from '~/lib/payroll/attendance'
import { loadPayrollWorkbenchOptions } from '~/lib/payroll/statements'

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
      let projectId = requestedScope.projectId
      let nextOptions = await loadPayrollWorkbenchOptions(db, projectId)
      if (!projectId) {
        projectId = nextOptions.projects[0]?.id ?? ''
        if (projectId)
          nextOptions = await loadPayrollWorkbenchOptions(db, projectId)
      }
      const crewId = requestedScope.crewId
        && nextOptions.crews.some(crew => crew.id === requestedScope.crewId)
        ? requestedScope.crewId
        : ''
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
