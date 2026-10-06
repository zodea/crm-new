import type {
  ProjectListItemDTO,
  ProjectListPageDTO,
  ProjectListQueryDTO,
} from '~/lib/project/repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { listAllProjects } from '~/lib/project/list-all'
import {
  projectProblemFromUnknown,
} from '~/lib/project/repository'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { readStateData as previousData, readFailureState } from '~/lib/read-model/state'

export const useProjectListStore = defineStore('project-list', () => {
  const repository = useNuxtApp().$repositories.projectList
  const state = shallowRef<ReadState<ProjectListPageDTO>>({ kind: 'idle' })
  const query = shallowRef<ProjectListQueryDTO | null>(null)
  let latestLoad = 0
  bindReadAuthority((problem) => {
    latestLoad++
    query.value = null
    state.value = readFailureState<ProjectListPageDTO>(problem, null)
  })

  async function load(nextQuery: ProjectListQueryDTO) {
    const loadId = ++latestLoad
    const previous = query.value?.includeDemo === nextQuery.includeDemo ? previousData(state.value) : null
    query.value = {
      ...nextQuery,
      filters: {
        statuses: [...nextQuery.filters.statuses],
        plannedEnds: [...nextQuery.filters.plannedEnds],
        managers: [...nextQuery.filters.managers],
        customerIds: [...nextQuery.filters.customerIds],
      },
    }
    state.value = { kind: 'loading', previous }
    try {
      const page = await repository.list(nextQuery)
      if (loadId !== latestLoad)
        return
      state.value = page.empty
        ? { kind: 'empty', data: page, empty: page.empty }
        : { kind: 'ready', data: page }
    }
    catch (cause) {
      if (loadId !== latestLoad)
        return
      const { problem } = projectProblemFromUnknown(cause)
      state.value = readFailureState(problem, previous)
    }
  }

  async function listAll(nextQuery: ProjectListQueryDTO): Promise<ProjectListItemDTO[]> {
    const generation = latestLoad
    return listAllProjects(repository, nextQuery, () => generation === latestLoad)
  }

  async function retry() {
    if (query.value)
      await load(query.value)
  }

  return {
    state: shallowReadonly(state),
    query: shallowReadonly(query),
    load,
    listAll,
    retry,
  }
})
