import type {
  SignedDayworkFilter,
  SignedDayworkInput,
  SignedDayworkRecord,
} from '~/lib/payroll/daywork'
import { defineStore } from 'pinia'
import { reactive, shallowRef } from 'vue'
import { getDb, withTransaction } from '~/lib/db/connection'
import {
  listSignedDayworkRecords,
  saveSignedDayworkRecord,
} from '~/lib/payroll/daywork'
import { payrollScopeFromOptions } from '~/lib/payroll/navigation'
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
  const hasSnapshot = shallowRef(false)
  const error = shallowRef('')
  let loadSequence = 0
  let snapshotScope = ''
  const scopeKey = (value: SignedDayworkFilter) => JSON.stringify([value.projectId, value.month, value.crewId ?? ''])

  async function load() {
    const sequence = ++loadSequence
    const requestedFilters: SignedDayworkFilter = { ...filters }
    if (snapshotScope !== scopeKey(requestedFilters)) {
      records.value = []
      hasSnapshot.value = false
      snapshotScope = ''
    }
    loading.value = true
    error.value = ''
    try {
      const db = await getDb()
      let nextOptions = await loadPayrollWorkbenchOptions(db, requestedFilters.projectId)
      const scope = payrollScopeFromOptions(requestedFilters, nextOptions)
      if (scope.projectId !== requestedFilters.projectId)
        nextOptions = await loadPayrollWorkbenchOptions(db, scope.projectId)
      Object.assign(requestedFilters, scope)
      const nextRecords = requestedFilters.projectId
        ? await listSignedDayworkRecords(db, requestedFilters)
        : []
      if (sequence !== loadSequence)
        return
      Object.assign(filters, requestedFilters)
      options.value = nextOptions
      records.value = nextRecords
      snapshotScope = scopeKey(requestedFilters)
      hasSnapshot.value = true
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

  async function save(input: SignedDayworkInput) {
    await withTransaction(tx => saveSignedDayworkRecord(tx, input))
    await load()
  }

  return {
    records,
    options,
    filters,
    loading,
    hasSnapshot,
    error,
    load,
    save,
  }
})
