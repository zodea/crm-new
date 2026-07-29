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

  const recognitionOptions = computed(() => toOcrRuntimeOptions(settings.value))

  async function load(database: OcrSettingsDatabase = db) {
    loading.value = true
    error.value = ''
    try {
      settings.value = await loadOcrRecognitionSettings(database)
      loaded.value = true
    }
    catch (cause) {
      error.value = toErrorMessage(cause)
      throw cause
    }
    finally {
      loading.value = false
    }
  }

  async function save(next: OcrRecognitionSettings, database: OcrSettingsDatabase = db) {
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
