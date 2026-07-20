import type { QuantityCatalogProject, QuantityProjectSnapshot } from '~/lib/quantity/read-model'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { db } from '~/lib/db/client'
import { loadQuantityCatalog, loadQuantityProjectSnapshot } from '~/lib/quantity/read-model'
import { toErrorMessage } from '~/lib/util/error'

export const useQuantityStore = defineStore('quantity', () => {
  const catalog = shallowRef<QuantityCatalogProject[]>([])
  const snapshot = shallowRef<QuantityProjectSnapshot | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef('')
  let pending = 0
  let latestProjectRequest = 0

  function beginRequest() {
    pending += 1
    loading.value = true
    error.value = ''
  }

  function endRequest() {
    pending = Math.max(0, pending - 1)
    loading.value = pending > 0
  }

  async function loadCatalog() {
    beginRequest()
    try {
      catalog.value = await loadQuantityCatalog(db)
    }
    catch (cause) {
      catalog.value = []
      error.value = `工程量项目加载失败：${toErrorMessage(cause)}`
    }
    finally {
      endRequest()
    }
  }

  async function loadProject(projectId: string) {
    const request = ++latestProjectRequest
    if (!projectId) {
      snapshot.value = null
      return
    }
    if (snapshot.value?.projectId !== projectId)
      snapshot.value = null
    beginRequest()
    try {
      const result = await loadQuantityProjectSnapshot(db, projectId)
      if (request === latestProjectRequest)
        snapshot.value = result
    }
    catch (cause) {
      if (request === latestProjectRequest) {
        snapshot.value = null
        error.value = `工程量矩阵加载失败：${toErrorMessage(cause)}`
      }
    }
    finally {
      endRequest()
    }
  }

  return {
    catalog: readonly(catalog),
    snapshot: readonly(snapshot),
    loading: readonly(loading),
    error: readonly(error),
    loadCatalog,
    loadProject,
  }
})
