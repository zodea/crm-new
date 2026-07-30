import type {
  ScheduleProcessLibraryDetail,
  ScheduleProcessLibraryVersionDraft,
} from '~/lib/schedule/process-library'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { execute, select, withTransaction } from '~/lib/db/connection'
import {
  createScheduleProcessLibraryVersion,
  loadScheduleProcessLibraries,
  loadScheduleProcessLibraryDetail,
} from '~/lib/schedule/process-library'
import { toErrorMessage } from '~/lib/util/error'

const db = {
  execute,
  select,
}

export const useScheduleProcessLibraryStore = defineStore('schedule-process-library', () => {
  const libraries = shallowRef<Awaited<ReturnType<typeof loadScheduleProcessLibraries>>>([])
  const detail = shallowRef<ScheduleProcessLibraryDetail | null>(null)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')

  async function loadLibraries() {
    loading.value = true
    error.value = ''
    try {
      libraries.value = await loadScheduleProcessLibraries(db)
    }
    catch (cause) {
      error.value = `标准工序库读取失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      loading.value = false
    }
  }

  async function loadDetail(libraryId: string) {
    loading.value = true
    error.value = ''
    try {
      detail.value = libraryId
        ? await loadScheduleProcessLibraryDetail(db, libraryId)
        : null
      return detail.value
    }
    catch (cause) {
      error.value = `工序库版本读取失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      loading.value = false
    }
  }

  async function saveVersion(draft: ScheduleProcessLibraryVersionDraft) {
    saving.value = true
    error.value = ''
    try {
      const created = await withTransaction(tx =>
        createScheduleProcessLibraryVersion(tx, draft),
      )
      detail.value = created
      await loadLibraries()
      return created
    }
    catch (cause) {
      error.value = `标准工序库保存失败：${toErrorMessage(cause)}`
      throw cause
    }
    finally {
      saving.value = false
    }
  }

  return {
    libraries: readonly(libraries),
    detail: readonly(detail),
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    loadLibraries,
    loadDetail,
    saveVersion,
  }
})
