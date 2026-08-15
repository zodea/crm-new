import type {
  ProjectListItemDTO,
  ProjectListPageDTO,
  ProjectListQueryDTO,
} from '~/lib/project/repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import {
  projectProblem,
  projectProblemFromUnknown,
  ProjectRepositoryProblem,
} from '~/lib/project/repository'

function previousData(state: ReadState<ProjectListPageDTO>): ProjectListPageDTO | null {
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
}

export const useProjectListStore = defineStore('project-list', () => {
  const repository = useNuxtApp().$repositories.projectList
  const state = shallowRef<ReadState<ProjectListPageDTO>>({ kind: 'idle' })
  const query = shallowRef<ProjectListQueryDTO | null>(null)
  let latestLoad = 0

  async function load(nextQuery: ProjectListQueryDTO) {
    const loadId = ++latestLoad
    const previous = previousData(state.value)
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
      if (problem.code === 'forbidden')
        state.value = { kind: 'forbidden', problem }
      else if (problem.code === 'not-found')
        state.value = { kind: 'not-found', problem }
      else if (problem.code === 'relationship-mismatch')
        state.value = { kind: 'mismatch', problem }
      else
        state.value = { kind: 'error', problem, previous }
    }
  }

  async function listAll(nextQuery: ProjectListQueryDTO): Promise<ProjectListItemDTO[]> {
    const first = await repository.list({ ...nextQuery, page: 1, pageSize: 100 })
    const items = [...first.items]
    const pageCount = Math.ceil(first.pagination.total / 100)
    for (let page = 2; page <= pageCount; page += 1) {
      const next = await repository.list({ ...nextQuery, page, pageSize: 100 })
      if (next.sourceVersion !== first.sourceVersion) {
        throw new ProjectRepositoryProblem(projectProblem(
          'stale-source',
          '项目列表在导出读取期间发生变化，请重试',
          true,
        ))
      }
      items.push(...next.items)
    }
    return items
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
