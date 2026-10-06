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
import { bindReadAuthority } from '~/lib/read-model/authority'
import { readStateData as previous, readFailureState } from '~/lib/read-model/state'

function failure<T>(cause: unknown, prior: T | null): ReadState<T> {
  return readFailureState(crewWorkerProblemFromUnknown(cause).problem, prior)
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
  let crewDetailQuery: CrewDetailQueryDTO | null = null
  let workerDetailQuery: WorkerDetailQueryDTO | null = null
  bindReadAuthority((problem) => {
    crewListRequest++
    workerListRequest++
    crewDetailRequest++
    workerDetailRequest++
    crewIncludeDemo = undefined
    workerIncludeDemo = undefined
    crewDetailQuery = null
    workerDetailQuery = null
    crewListState.value = readFailureState<CrewListPageDTO>(problem, null)
    workerListState.value = readFailureState<WorkerListPageDTO>(problem, null)
    crewDetailState.value = readFailureState<CrewDetailReadDTO>(problem, null)
    workerDetailState.value = readFailureState<WorkerDetailReadDTO>(problem, null)
  })

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
    const prior = crewDetailQuery?.id === query.id && crewDetailQuery.origin === query.origin
      && crewDetailQuery.includeDemo === query.includeDemo
      ? previous(crewDetailState.value)
      : null
    crewDetailQuery = { ...query }
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
    const prior = workerDetailQuery?.id === query.id && workerDetailQuery.origin === query.origin
      && workerDetailQuery.includeDemo === query.includeDemo
      ? previous(workerDetailState.value)
      : null
    workerDetailQuery = { ...query }
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
