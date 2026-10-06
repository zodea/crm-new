import type {
  SubcontractContractDetailQueryDTO,
  SubcontractContractDetailReadDTO,
  SubcontractContractListPageDTO,
  SubcontractContractListQueryDTO,
} from '~/lib/subcontract-contract/repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { readStateData as previous, readFailureState } from '~/lib/read-model/state'
import { subcontractContractUnavailable } from '~/lib/subcontract-contract/repository'

function failureState<T>(cause: unknown, prior: T | null): ReadState<T> {
  return readFailureState(subcontractContractUnavailable(cause).problem, prior)
}

function sameDetail(left: SubcontractContractDetailQueryDTO | null, right: SubcontractContractDetailQueryDTO) {
  return left?.id === right.id && left.origin === right.origin && left.includeDemo === right.includeDemo && left.focusId === right.focusId
}

export const useSubcontractContractReadStore = defineStore('subcontract-contract-read', () => {
  const repository = useNuxtApp().$repositories.subcontractContractRead
  const listState = shallowRef<ReadState<SubcontractContractListPageDTO>>({ kind: 'idle' })
  const detailState = shallowRef<ReadState<SubcontractContractDetailReadDTO>>({ kind: 'idle' })
  const listQuery = shallowRef<SubcontractContractListQueryDTO | null>(null)
  const detailQuery = shallowRef<SubcontractContractDetailQueryDTO | null>(null)
  let latestList = 0
  let latestDetail = 0
  bindReadAuthority((problem) => {
    latestList++
    latestDetail++
    listQuery.value = null
    detailQuery.value = null
    listState.value = readFailureState<SubcontractContractListPageDTO>(problem, null)
    detailState.value = readFailureState<SubcontractContractDetailReadDTO>(problem, null)
  })

  async function loadList(query: SubcontractContractListQueryDTO) {
    const request = ++latestList
    const prior = listQuery.value?.origin === query.origin && listQuery.value.includeDemo === query.includeDemo
      ? previous(listState.value)
      : null
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

  async function loadDetail(query: SubcontractContractDetailQueryDTO) {
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

  return { listState: shallowReadonly(listState), detailState: shallowReadonly(detailState), loadList, loadDetail }
})
