import type { OcrRecognitionSettings, OcrSettingsDatabase } from '~/lib/ocr/settings'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { db } from '~/lib/db/client'
import {
  createDefaultOcrRecognitionSettings,
  loadOcrRecognitionSettings,
  saveOcrRecognitionSettings,
  toOcrRuntimeOptions,
} from '~/lib/ocr/settings'
import { toErrorMessage } from '~/lib/util/error'

export const useOcrSettingsStore = defineStore('ocr-settings', () => {
  const settings = ref<OcrRecognitionSettings>(createDefaultOcrRecognitionSettings())
  const loaded = shallowRef(false)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  let pendingLoad: Promise<void> | null = null

  const recognitionOptions = computed(() => toOcrRuntimeOptions(settings.value))

  function load(database: OcrSettingsDatabase = db): Promise<void> {
    if (pendingLoad)
      return pendingLoad
    loaded.value = false
    loading.value = true
    error.value = ''
    pendingLoad = loadOcrRecognitionSettings(database)
      .then((next) => {
        settings.value = next
        loaded.value = true
      })
      .catch((cause) => {
        error.value = toErrorMessage(cause)
        throw cause
      })
      .finally(() => {
        loading.value = false
        pendingLoad = null
      })
    return pendingLoad
  }

  async function save(next: OcrRecognitionSettings, database: OcrSettingsDatabase = db) {
    if (!loaded.value || loading.value) {
      error.value = '请先成功读取 OCR 设置'
      throw new Error(error.value)
    }
    saving.value = true
    error.value = ''
    try {
      settings.value = await saveOcrRecognitionSettings(database, next)
    }
    catch (cause) {
      error.value = toErrorMessage(cause)
      throw cause
    }
    finally {
      saving.value = false
    }
  }

  return {
    settings,
    loaded,
    loading,
    saving,
    error,
    recognitionOptions,
    load,
    save,
  }
})
