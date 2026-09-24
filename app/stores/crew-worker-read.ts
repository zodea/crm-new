import type {
  CrewDetailQueryDTO,
  CrewDetailReadDTO,
  CrewListPageDTO,
  CrewListQueryDTO,
  WorkerDetailQueryDTO,
  WorkerDetailReadDTO,
  WorkerListPageDTO,
  WorkerListQueryDTO,
} from '~/lib/crew-worker/repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { crewWorkerProblemFromUnknown } from '~/lib/crew-worker/repository'

function previous<T>(state: ReadState<T>): T | null {
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
}

function failure<T>(cause: unknown, prior: T | null): ReadState<T> {
  const { problem } = crewWorkerProblemFromUnknown(cause)
  if (problem.code === 'forbidden')
    return { kind: 'forbidden', problem }
  if (problem.code === 'not-found')
    return { kind: 'not-found', problem }
  if (problem.code === 'relationship-mismatch')
    return { kind: 'mismatch', problem }
  return { kind: 'error', problem, previous: prior }
}

export const useCrewWorkerReadStore = defineStore('crew-worker-read', () => {
  const repository = () => useNuxtApp().$repositories.crewWorkerRead
  const crewListState = shallowRef<ReadState<CrewListPageDTO>>({ kind: 'idle' })
  const workerListState = shallowRef<ReadState<WorkerListPageDTO>>({ kind: 'idle' })
  const crewDetailState = shallowRef<ReadState<CrewDetailReadDTO>>({ kind: 'idle' })
  const workerDetailState = shallowRef<ReadState<WorkerDetailReadDTO>>({ kind: 'idle' })
  let crewListRequest = 0
  let workerListRequest = 0
  let crewDetailRequest = 0
  let workerDetailRequest = 0
  let crewIncludeDemo: boolean | undefined
  let workerIncludeDemo: boolean | undefined

  async function loadCrewList(query: CrewListQueryDTO) {
    const request = ++crewListRequest
    const prior = crewIncludeDemo === query.includeDemo ? previous(crewListState.value) : null
    crewIncludeDemo = query.includeDemo
    crewListState.value = { kind: 'loading', previous: prior }
    try {
      const page = await repository().listCrews(query)
      if (request === crewListRequest)
        crewListState.value = page.empty ? { kind: 'empty', data: page, empty: page.empty } : { kind: 'ready', data: page }
    }
    catch (cause) {
      if (request === crewListRequest)
        crewListState.value = failure(cause, prior)
    }
  }

  async function loadWorkerList(query: WorkerListQueryDTO) {
    const request = ++workerListRequest
    const prior = workerIncludeDemo === query.includeDemo ? previous(workerListState.value) : null
    workerIncludeDemo = query.includeDemo
    workerListState.value = { kind: 'loading', previous: prior }
    try {
      const page = await repository().listWorkers(query)
      if (request === workerListRequest)
        workerListState.value = page.empty ? { kind: 'empty', data: page, empty: page.empty } : { kind: 'ready', data: page }
    }
    catch (cause) {
      if (request === workerListRequest)
        workerListState.value = failure(cause, prior)
    }
  }

  async function loadCrewDetail(query: CrewDetailQueryDTO) {
    const request = ++crewDetailRequest
    const prior = previous(crewDetailState.value)
    crewDetailState.value = { kind: 'loading', previous: prior }
    try {
      const detail = await repository().getCrew(query)
      if (request === crewDetailRequest)
        crewDetailState.value = { kind: 'ready', data: detail }
    }
    catch (cause) {
      if (request === crewDetailRequest)
        crewDetailState.value = failure(cause, prior)
    }
  }

  async function loadWorkerDetail(query: WorkerDetailQueryDTO) {
    const request = ++workerDetailRequest
    const prior = previous(workerDetailState.value)
    workerDetailState.value = { kind: 'loading', previous: prior }
    try {
      const detail = await repository().getWorker(query)
      if (request === workerDetailRequest)
        workerDetailState.value = { kind: 'ready', data: detail }
    }
    catch (cause) {
      if (request === workerDetailRequest)
        workerDetailState.value = failure(cause, prior)
    }
  }

  return {
    crewListState: shallowReadonly(crewListState),
    workerListState: shallowReadonly(workerListState),
    crewDetailState: shallowReadonly(crewDetailState),
    workerDetailState: shallowReadonly(workerDetailState),
    loadCrewList,
    loadWorkerList,
    loadCrewDetail,
    loadWorkerDetail,
  }
})
