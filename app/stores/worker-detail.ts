import type { WorkerDetail } from '~/lib/worker/detail'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { getDb } from '~/lib/db/connection'
import { toErrorMessage } from '~/lib/util/error'
import { loadWorkerDetail } from '~/lib/worker/detail'

export const useWorkerDetailStore = defineStore('worker-detail', () => {
  const current = shallowRef<WorkerDetail | null>(null)
  const loadedId = shallowRef('')
  const loading = shallowRef(false)
  const error = shallowRef('')
  let latestRequest = 0

  async function load(id: string) {
    const request = ++latestRequest
    loading.value = true
    error.value = ''
    try {
      const db = await getDb()
      const detail = await loadWorkerDetail(db, id)
      if (request !== latestRequest)
        return
      current.value = detail
      loadedId.value = id
    }
    catch (cause) {
      if (request !== latestRequest)
        return
      current.value = null
      loadedId.value = id
      error.value = toErrorMessage(cause)
    }
    finally {
      if (request === latestRequest)
        loading.value = false
    }
  }

  return {
    current: readonly(current),
    loadedId: readonly(loadedId),
    loading: readonly(loading),
    error: readonly(error),
    load,
  }
})
