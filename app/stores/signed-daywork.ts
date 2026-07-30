import type {
  SignedDayworkFilter,
  SignedDayworkInput,
  SignedDayworkRecord,
} from '~/lib/payroll/daywork'
import { defineStore } from 'pinia'
import { getDb, withTransaction } from '~/lib/db/connection'
import {
  listSignedDayworkRecords,
  saveSignedDayworkRecord,
} from '~/lib/payroll/daywork'
import { loadPayrollWorkbenchOptions } from '~/lib/payroll/statements'

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export const useSignedDayworkStore = defineStore('signed-daywork-workbench', () => {
  const records = shallowRef<SignedDayworkRecord[]>([])
  const options = shallowRef({
    projects: [],
    crews: [],
    workers: [],
    c2SubjectConfigs: [],
  } as Awaited<ReturnType<typeof loadPayrollWorkbenchOptions>>)
  const filters = reactive<SignedDayworkFilter>({
    projectId: '',
    month: currentMonth(),
    crewId: '',
    status: '',
  })
  const loading = shallowRef(false)
  const error = shallowRef('')

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
      records.value = filters.projectId
        ? await listSignedDayworkRecords(db, filters)
        : []
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
    finally {
      loading.value = false
    }
  }

  async function save(input: SignedDayworkInput) {
    await withTransaction(tx => saveSignedDayworkRecord(tx, input))
    await load()
  }

  return {
    records,
    options,
    filters,
    loading,
    error,
    load,
    save,
  }
})
