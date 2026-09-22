import type {
  CustomerDetailQueryDTO,
  CustomerDetailReadDTO,
  CustomerListPageDTO,
  CustomerListQueryDTO,
  CustomerReceiptDetailQueryDTO,
  CustomerReceiptDetailReadDTO,
} from '~/lib/customer/repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { customerProblemFromUnknown } from '~/lib/customer/repository'

function previous<T>(state: ReadState<T>): T | null {
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
}

function failureState<T>(cause: unknown, prior: T | null): ReadState<T> {
  const { problem } = customerProblemFromUnknown(cause)
  if (problem.code === 'forbidden')
    return { kind: 'forbidden', problem }
  if (problem.code === 'not-found')
    return { kind: 'not-found', problem }
  if (problem.code === 'relationship-mismatch')
    return { kind: 'mismatch', problem }
  return { kind: 'error', problem, previous: prior }
}

function sameDetailQuery(left: CustomerDetailQueryDTO | null, right: CustomerDetailQueryDTO): boolean {
  return left?.id === right.id
    && left.origin === right.origin
    && left.includeDemo === right.includeDemo
}

function sameReceiptQuery(left: CustomerReceiptDetailQueryDTO | null, right: CustomerReceiptDetailQueryDTO): boolean {
  return sameDetailQuery(left, right)
    && left?.customerId === right.customerId
}

export const useCustomerReadStore = defineStore('customer-read', () => {
  const repository = useNuxtApp().$repositories.customerRead
  const listState = shallowRef<ReadState<CustomerListPageDTO>>({ kind: 'idle' })
  const detailState = shallowRef<ReadState<CustomerDetailReadDTO>>({ kind: 'idle' })
  const receiptState = shallowRef<ReadState<CustomerReceiptDetailReadDTO>>({ kind: 'idle' })
  const listQuery = shallowRef<CustomerListQueryDTO | null>(null)
  const detailQuery = shallowRef<CustomerDetailQueryDTO | null>(null)
  const receiptQuery = shallowRef<CustomerReceiptDetailQueryDTO | null>(null)
  let latestList = 0
  let latestDetail = 0
  let latestReceipt = 0

  async function loadList(query: CustomerListQueryDTO) {
    const request = ++latestList
    const prior = listQuery.value?.includeDemo === query.includeDemo ? previous(listState.value) : null
    listQuery.value = { ...query }
    listState.value = { kind: 'loading', previous: prior }
    try {
      const page = await repository.list(query)
      if (request !== latestList)
        return
      listState.value = page.empty
        ? { kind: 'empty', data: page, empty: page.empty }
        : { kind: 'ready', data: page }
    }
    catch (cause) {
      if (request === latestList)
        listState.value = failureState(cause, prior)
    }
  }

  async function loadDetail(query: CustomerDetailQueryDTO) {
    const request = ++latestDetail
    const prior = sameDetailQuery(detailQuery.value, query) ? previous(detailState.value) : null
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

  async function loadReceipt(query: CustomerReceiptDetailQueryDTO) {
    const request = ++latestReceipt
    const prior = sameReceiptQuery(receiptQuery.value, query) ? previous(receiptState.value) : null
    receiptQuery.value = { ...query }
    receiptState.value = { kind: 'loading', previous: prior }
    try {
      const detail = await repository.getReceipt(query)
      if (request === latestReceipt)
        receiptState.value = { kind: 'ready', data: detail }
    }
    catch (cause) {
      if (request === latestReceipt)
        receiptState.value = failureState(cause, prior)
    }
  }

  return {
    listState: shallowReadonly(listState),
    detailState: shallowReadonly(detailState),
    receiptState: shallowReadonly(receiptState),
    listQuery: shallowReadonly(listQuery),
    detailQuery: shallowReadonly(detailQuery),
    receiptQuery: shallowReadonly(receiptQuery),
    loadList,
    loadDetail,
    loadReceipt,
  }
})
