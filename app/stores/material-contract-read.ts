import type {
  MaterialContractDetailQueryDTO,
  MaterialContractDetailReadDTO,
  MaterialContractListPageDTO,
  MaterialContractListQueryDTO,
} from '~/lib/material-contract/repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { materialContractProblemFromUnknown } from '~/lib/material-contract/repository'

function previous<T>(state: ReadState<T>): T | null {
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
}

function failureState<T>(cause: unknown, prior: T | null): ReadState<T> {
  const { problem } = materialContractProblemFromUnknown(cause)
  if (problem.code === 'forbidden')
    return { kind: 'forbidden', problem }
  if (problem.code === 'not-found')
    return { kind: 'not-found', problem }
  if (problem.code === 'relationship-mismatch')
    return { kind: 'mismatch', problem }
  return { kind: 'error', problem, previous: prior }
}

function sameDetail(left: MaterialContractDetailQueryDTO | null, right: MaterialContractDetailQueryDTO) {
  return left?.id === right.id && left.origin === right.origin && left.includeDemo === right.includeDemo
}

export const useMaterialContractReadStore = defineStore('material-contract-read', () => {
  const repository = useNuxtApp().$repositories.materialContractRead
  const listState = shallowRef<ReadState<MaterialContractListPageDTO>>({ kind: 'idle' })
  const detailState = shallowRef<ReadState<MaterialContractDetailReadDTO>>({ kind: 'idle' })
  const listQuery = shallowRef<MaterialContractListQueryDTO | null>(null)
  const detailQuery = shallowRef<MaterialContractDetailQueryDTO | null>(null)
  let latestList = 0
  let latestDetail = 0

  async function loadList(query: MaterialContractListQueryDTO) {
    const request = ++latestList
    const prior = listQuery.value?.origin === query.origin && listQuery.value.includeDemo === query.includeDemo
      ? previous(listState.value)
      : null
    listQuery.value = { ...query }
    listState.value = { kind: 'loading', previous: prior }
    try {
      const page = await repository.list(query)
      if (request !== latestList)
        return
      listState.value = page.empty ? { kind: 'empty', data: page, empty: page.empty } : { kind: 'ready', data: page }
    }
    catch (cause) {
      if (request === latestList)
        listState.value = failureState(cause, prior)
    }
  }

  async function loadDetail(query: MaterialContractDetailQueryDTO) {
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
