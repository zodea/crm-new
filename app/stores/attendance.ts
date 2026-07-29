import type { AttendanceRecord } from '~/lib/payroll/attendance'
import { defineStore } from 'pinia'
import { getDb } from '~/lib/db/connection'
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
  const options = shallowRef({ projects: [], crews: [], workers: [] } as Awaited<ReturnType<typeof loadPayrollWorkbenchOptions>>)
  const blockedWorkerIds = shallowRef<string[]>([])
  const filters = reactive({
    projectId: '',
    crewId: '',
    month: currentMonth(),
  })
  const loading = ref(false)
  const error = ref('')

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const db = await getDb()
      options.value = await loadPayrollWorkbenchOptions(db, filters.projectId)
      if (!filters.projectId)
        filters.projectId = options.value.projects[0]?.id ?? ''
      if (filters.projectId)
        options.value = await loadPayrollWorkbenchOptions(db, filters.projectId)
      if (filters.projectId) {
        [records.value, blockedWorkerIds.value] = await Promise.all([
          listAttendanceRecords(db, filters),
          listAttendanceBlockedWorkerIds(db, filters),
        ])
      }
      else {
        records.value = []
        blockedWorkerIds.value = []
      }
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
    finally {
      loading.value = false
    }
  }

  async function save(input: Parameters<typeof upsertAttendanceRecord>[1]) {
    await upsertAttendanceRecord(await getDb(), input)
    await load()
  }

  return { records, options, blockedWorkerIds, filters, loading, error, load, save }
})
