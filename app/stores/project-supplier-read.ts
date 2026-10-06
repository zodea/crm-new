import type { ProjectSupplierWorkbenchQueryDTO, ProjectSupplierWorkbenchReadDTO } from '~/lib/project-supplier/repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { projectSupplierProblemFromUnknown } from '~/lib/project-supplier/repository'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { readStateData as previous, readFailureState } from '~/lib/read-model/state'

export const useProjectSupplierReadStore = defineStore('project-supplier-read', () => {
  const repository = useNuxtApp().$repositories.projectSupplierRead
  const state = shallowRef<ReadState<ProjectSupplierWorkbenchReadDTO>>({ kind: 'idle' })
  let latest = 0
  let previousQuery: ProjectSupplierWorkbenchQueryDTO | null = null
  bindReadAuthority((problem) => {
    latest++
    previousQuery = null
    state.value = readFailureState<ProjectSupplierWorkbenchReadDTO>(problem, null)
  })

  async function load(query: ProjectSupplierWorkbenchQueryDTO) {
    const request = ++latest
    const prior = previousQuery?.projectId === query.projectId && previousQuery.supplierId === query.supplierId
      && previousQuery.origin === query.origin && previousQuery.includeDemo === query.includeDemo
      ? previous(state.value)
      : null
    previousQuery = { ...query }
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
      state.value = readFailureState(problem, prior)
    }
  }

  return { state: shallowReadonly(state), load }
})
