import type {
  ConstructionContractDetailQueryDTO,
  ConstructionContractDetailReadDTO,
  ConstructionContractListPageDTO,
  ConstructionContractListQueryDTO,
} from '~/lib/construction-contract/repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { constructionContractProblemFromUnknown } from '~/lib/construction-contract/repository'

function previous<T>(state: ReadState<T>): T | null {
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
}

function failureState<T>(cause: unknown, prior: T | null): ReadState<T> {
  const { problem } = constructionContractProblemFromUnknown(cause)
  if (problem.code === 'forbidden')
    return { kind: 'forbidden', problem }
  if (problem.code === 'not-found')
    return { kind: 'not-found', problem }
  if (problem.code === 'relationship-mismatch')
    return { kind: 'mismatch', problem }
  return { kind: 'error', problem, previous: prior }
}

function sameDetail(left: ConstructionContractDetailQueryDTO | null, right: ConstructionContractDetailQueryDTO) {
  return left?.id === right.id && left.origin === right.origin && left.includeDemo === right.includeDemo && left.focusId === right.focusId
}

export const useConstructionContractReadStore = defineStore('construction-contract-read', () => {
  const repository = useNuxtApp().$repositories.constructionContractRead
  const listState = shallowRef<ReadState<ConstructionContractListPageDTO>>({ kind: 'idle' })
  const detailState = shallowRef<ReadState<ConstructionContractDetailReadDTO>>({ kind: 'idle' })
  const listQuery = shallowRef<ConstructionContractListQueryDTO | null>(null)
  const detailQuery = shallowRef<ConstructionContractDetailQueryDTO | null>(null)
  let latestList = 0
  let latestDetail = 0

  async function loadList(query: ConstructionContractListQueryDTO) {
    const request = ++latestList
    const prior = previous(listState.value)
    listQuery.value = { ...query }
    listState.value = { kind: 'loading', previous: prior }
    try {
      const page = await repository.list(query)
      if (request === latestList)
        listState.value = page.empty ? { kind: 'empty', data: page, empty: page.empty } : { kind: 'ready', data: page }
    }
    catch (cause) {
      if (request === latestList)
        listState.value = failureState(cause, prior)
    }
  }

  async function loadDetail(query: ConstructionContractDetailQueryDTO) {
    const request = ++latestDetail
    const prior = sameDetail(detailQuery.value, query) ? previous(detailState.value) : null
    detailQuery.value = { ...query }
    detailState.value = { kind: 'loading', previous: prior }
    try {
      const detail = await repository.get(query)
      if (request === latestDetail)
        detailState.value = { kind: 'ready', data: detail }
    }
    catch (cause) {
      if (request === latestDetail)
        detailState.value = failureState(cause, prior)
    }
  }

  return {
    listState: shallowReadonly(listState),
    detailState: shallowReadonly(detailState),
    listQuery: shallowReadonly(listQuery),
    detailQuery: shallowReadonly(detailQuery),
    loadList,
    loadDetail,
  }
})
