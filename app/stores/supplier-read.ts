import type {
  SupplierDetailQueryDTO,
  SupplierDetailReadDTO,
  SupplierListPageDTO,
  SupplierListQueryDTO,
} from '~/lib/supplier/repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { readFailureState, readStateData } from '~/lib/read-model/state'
import { supplierProblemFromUnknown } from '~/lib/supplier/repository'

function failureState<T>(cause: unknown, prior: T | null): ReadState<T> {
  const { problem } = supplierProblemFromUnknown(cause)
  return readFailureState(problem, prior)
}

function sameDetail(left: SupplierDetailQueryDTO | null, right: SupplierDetailQueryDTO) {
  return left?.id === right.id && left.origin === right.origin && left.includeDemo === right.includeDemo
}

export const useSupplierReadStore = defineStore('supplier-read', () => {
  const repository = useNuxtApp().$repositories.supplierRead
  const listState = shallowRef<ReadState<SupplierListPageDTO>>({ kind: 'idle' })
  const detailState = shallowRef<ReadState<SupplierDetailReadDTO>>({ kind: 'idle' })
  const listQuery = shallowRef<SupplierListQueryDTO | null>(null)
  const detailQuery = shallowRef<SupplierDetailQueryDTO | null>(null)
  let latestList = 0
  let latestDetail = 0
  bindReadAuthority((problem) => {
    ++latestList
    ++latestDetail
    listState.value = readFailureState<SupplierListPageDTO>(problem, null)
    detailState.value = readFailureState<SupplierDetailReadDTO>(problem, null)
  })

  async function loadList(query: SupplierListQueryDTO) {
    const request = ++latestList
    const prior = listQuery.value?.includeDemo === query.includeDemo ? readStateData(listState.value) : null
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

  async function loadDetail(query: SupplierDetailQueryDTO) {
    const request = ++latestDetail
    const prior = sameDetail(detailQuery.value, query) ? readStateData(detailState.value) : null
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
