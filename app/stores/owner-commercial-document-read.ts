import type {
  OwnerCommercialDocumentDetailQueryDTO,
  OwnerCommercialDocumentDetailReadDTO,
} from '~/lib/owner-document/central-repository'
import type { ReadState } from '~/types/read-model'
import { defineStore } from 'pinia'
import { shallowReadonly, shallowRef } from 'vue'
import { ownerCommercialDocumentProblemFromUnknown } from '~/lib/owner-document/central-repository'

function previous<T>(state: ReadState<T>): T | null {
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
}

function failureState<T>(cause: unknown, prior: T | null): ReadState<T> {
  const { problem } = ownerCommercialDocumentProblemFromUnknown(cause)
  if (problem.code === 'forbidden')
    return { kind: 'forbidden', problem }
  if (problem.code === 'not-found')
    return { kind: 'not-found', problem }
  if (problem.code === 'relationship-mismatch')
    return { kind: 'mismatch', problem }
  return { kind: 'error', problem, previous: prior }
}

function sameQuery(left: OwnerCommercialDocumentDetailQueryDTO | null, right: OwnerCommercialDocumentDetailQueryDTO) {
  return left?.kind === right.kind && left.id === right.id && left.origin === right.origin
    && left.includeDemo === right.includeDemo && left.variant === right.variant
}

export const useOwnerCommercialDocumentReadStore = defineStore('owner-commercial-document-read', () => {
  const repository = useNuxtApp().$repositories.ownerCommercialDocumentRead
  const detailState = shallowRef<ReadState<OwnerCommercialDocumentDetailReadDTO>>({ kind: 'idle' })
  const detailQuery = shallowRef<OwnerCommercialDocumentDetailQueryDTO | null>(null)
  let latest = 0

  async function loadDetail(query: OwnerCommercialDocumentDetailQueryDTO) {
    const request = ++latest
    const prior = sameQuery(detailQuery.value, query) ? previous(detailState.value) : null
    detailQuery.value = { ...query }
    detailState.value = { kind: 'loading', previous: prior }
    try {
      const detail = await repository.get(query)
      if (request === latest)
        detailState.value = { kind: 'ready', data: detail }
    }
    catch (cause) {
      if (request === latest)
        detailState.value = failureState(cause, prior)
    }
  }

  return {
    detailState: shallowReadonly(detailState),
    detailQuery: shallowReadonly(detailQuery),
    loadDetail,
  }
})
