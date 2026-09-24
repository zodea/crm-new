import type { ProjectSupplierWorkbenchQueryDTO, ProjectSupplierWorkbenchReadDTO } from '~/lib/project-supplier/repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { projectSupplierProblemFromUnknown } from '~/lib/project-supplier/repository'

function previous(state: ReadState<ProjectSupplierWorkbenchReadDTO>) {
  return state.kind === 'ready' || state.kind === 'empty' || state.kind === 'partial'
    ? state.data
    : state.kind === 'loading' || state.kind === 'error' ? state.previous : null
}

export const useProjectSupplierReadStore = defineStore('project-supplier-read', () => {
  const repository = useNuxtApp().$repositories.projectSupplierRead
  const state = shallowRef<ReadState<ProjectSupplierWorkbenchReadDTO>>({ kind: 'idle' })
  let latest = 0

  async function load(query: ProjectSupplierWorkbenchQueryDTO) {
    const request = ++latest
    const prior = previous(state.value)
    state.value = { kind: 'loading', previous: prior }
    try {
      const data = await repository.get(query)
      if (request !== latest)
        return
      const empty = Object.values(data.counts).every(count => count === 0)
      state.value = empty
        ? { kind: 'empty', data, empty: { reason: 'no-records', missingRelations: [] } }
        : { kind: 'ready', data }
    }
    catch (cause) {
      if (request !== latest)
        return
      const { problem } = projectSupplierProblemFromUnknown(cause)
      if (problem.code === 'forbidden')
        state.value = { kind: 'forbidden', problem }
      else if (problem.code === 'not-found')
        state.value = { kind: 'not-found', problem }
      else if (problem.code === 'relationship-mismatch')
        state.value = { kind: 'mismatch', problem }
      else
        state.value = { kind: 'error', problem, previous: prior }
    }
  }

  return { state: shallowReadonly(state), load }
})
